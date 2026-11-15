import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_REVERSAL_SCHEMA,seedSyntheticReversalD1}
  from '../fixtures/m03-reversal-schema.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m03-reversal-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-reversal-workerd-test');
let DB;
before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  // Disposable local Workerd D1. No migration applied or remote writes.
  for(const sql of SYNTHETIC_REVERSAL_SCHEMA)await DB.prepare(sql).run();
  await seedSyntheticReversalD1(DB);
});
after(async()=>{await server.close();});

async function invoke(path,body,method='POST'){
  const response=await worker.fetch('http://m03-reversal.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}
async function state(){
  const sql={
    stock:'SELECT tenant_id,sku,available FROM synthetic_stock ORDER BY tenant_id,sku',
    reversals:'SELECT tenant_id,reversal_id,original_operation_id,actor_id,original_hash,reversal_hash,units,reason,sku,result_ref FROM synthetic_reversals ORDER BY tenant_id,reversal_id',
    movements:'SELECT tenant_id,reversal_id,original_operation_id,sku,units FROM synthetic_reverse_movements ORDER BY tenant_id,reversal_id'
  };
  const results={};
  for(const [key,query] of Object.entries(sql)){
    const part=await DB.prepare(query).all();
    assert.equal(part.success,true,key);
    results[key]=part.results.map(row=>({...row}));
  }
  return results;
}
const stockQty=(s,t,sku)=>s.stock.find(x=>x.tenant_id===t&&x.sku===sku)?.available;

test('actual Workerd D1 restores one owned unit with original source identity and one reverse movement',async()=>{
  const result=await invoke('/__m03_reverse__/owned');
  assert.deepEqual(result,{
    status:200,body:{status:'REVERSED',reversalId:'REV-ONE',resultRef:'REV-ONE'}
  });
  const s=await state();
  assert.equal(stockQty(s,'TENANT-1','PIPE'),1);
  assert.equal(s.reversals.length,1);
  assert.deepEqual(s.movements,[{
    tenant_id:'TENANT-1',reversal_id:'REV-ONE',
    original_operation_id:'OP-OWN',sku:'PIPE',units:1
  }]);
});

test('same reversal ID and intent replay returns original result without another stock write',async()=>{
  const before=await state();
  assert.deepEqual(await invoke('/__m03_reverse__/owned'),{
    status:200,body:{status:'REPLAY',reversalId:'REV-ONE',resultRef:'REV-ONE'}
  });
  assert.deepEqual(await state(),before);
});

test('same reversal ID different reason or actor and different ID same original are all conflicts',async()=>{
  const before=await state();
  for(const path of [
    '/__m03_reverse__/changed-reason',
    '/__m03_reverse__/changed-actor',
    '/__m03_reverse__/second-id'
  ]){
    const r=await invoke(path);
    assert.equal(r.status,200,path);
    assert.equal(r.body.status,'CONFLICT',path);
    assert.deepEqual(await state(),before,path);
  }
});

test('same original operation and reversal IDs can be used independently in another tenant',async()=>{
  assert.deepEqual(await invoke('/__m03_reverse__/other-tenant'),{
    status:200,body:{status:'REVERSED',reversalId:'REV-ONE',resultRef:'REV-ONE'}
  });
  const s=await state();
  assert.equal(stockQty(s,'TENANT-1','PIPE'),1);
  assert.equal(stockQty(s,'TENANT-2','PIPE'),1);
  assert.equal(s.reversals.filter(x=>x.reversal_id==='REV-ONE').length,2);
  assert.equal(s.movements.filter(x=>x.reversal_id==='REV-ONE').length,2);
});

test('vendor movement, active return, no original and missing owned evidence decline without restoration',async()=>{
  const before=await state();
  for(const path of [
    '/__m03_reverse__/vendor',
    '/__m03_reverse__/active-return',
    '/__m03_reverse__/no-source',
    '/__m03_reverse__/unproven'
  ]){
    const r=await invoke(path);
    assert.equal(r.status,200,path);
    assert.equal(r.body.status,'DECLINED',path);
    assert.deepEqual(await state(),before,path);
  }
});

test('stale original hash against an already-reversed source conflicts without another stock write',async()=>{
  const before=await state();
  assert.deepEqual(await invoke('/__m03_reverse__/wrong-original-hash'),{
    status:200,body:{status:'CONFLICT',reversalId:'REV-WRONG'}
  });
  assert.deepEqual(await state(),before);
});

test('two concurrent distinct reversal IDs cannot both undo one original sale in D1',async()=>{
  const results=await Promise.all([
    invoke('/__m03_reverse__/race-a'),
    invoke('/__m03_reverse__/race-b')
  ]);
  assert.deepEqual(results.map(r=>r.body.status).sort(),['CONFLICT','REVERSED']);
  const s=await state();
  assert.equal(stockQty(s,'TENANT-1','RACE'),1);
  assert.equal(s.reversals.filter(x=>x.original_operation_id==='OP-RACE').length,1);
  assert.equal(s.movements.filter(x=>x.original_operation_id==='OP-RACE').length,1);
});

test('missing stock row triggers full D1 rollback of a provisional reversal row',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_reverse__/missing-stock')).status,409);
  assert.deepEqual(await state(),before);
});

test('forced inverse journal failure rolls back stock restoration and reversal receipt in real D1',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_reverse__/journal-failure')).status,409);
  assert.deepEqual(await state(),before);
});

test('D1 rejects mutations or deletion of committed reversal evidence',async()=>{
  const before=await state();
  await assert.rejects(()=>DB.prepare(
    "UPDATE synthetic_reversals SET actor_id='ATTACKER' WHERE reversal_id='REV-ONE'").run(),
    /immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM synthetic_reversals WHERE reversal_id='REV-ONE'").run(),
    /immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>DB.prepare(
    "UPDATE synthetic_reverse_movements SET units=20 WHERE reversal_id='REV-ONE'").run(),
    /immutable|abort|D1_ERROR/i);
  assert.deepEqual(await state(),before);
});

test('test-only routes reject wrong method and ignore attacker-supplied actor or SQL',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_reverse__/unknown')).status,404);
  assert.equal((await invoke('/__m03_reverse__/owned',null,'GET')).status,405);
  assert.deepEqual(await invoke('/__m03_reverse__/owned',{
    tenantId:'TENANT-2',actorId:'ADMIN',units:99999,reversalId:'REV-FAKE',
    sql:'DELETE FROM synthetic_reversals'
  }),{
    status:200,body:{status:'REPLAY',reversalId:'REV-ONE',resultRef:'REV-ONE'}
  });
  assert.deepEqual(await state(),before);
});
