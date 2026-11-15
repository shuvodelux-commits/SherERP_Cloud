import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_M03_ID_POST_DDL} from '../fixtures/m03-id-post-schema.mjs';
import {planSourceIdCounterFloor} from '../../src/modules/source-id-counter-floor.js';

const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m03-id-post-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m03-id-post-workerd-test');
let DB;
async function call(path,body){
  const response=await worker.fetch('http://m03-idpost.local'+path,{
    method:'POST',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}
const rows=async sql=>{
  const result=await DB.prepare(sql).all();
  assert.equal(result.success,true);
  return result.results.map(r=>({...r}));
};
async function state(){
  const parts={};
  for(const [name,query] of Object.entries({
    counters:'SELECT tenant_id,id_key,current_sequence FROM synthetic_m03_id_counters ORDER BY tenant_id,id_key',
    receipts:'SELECT tenant_id,id_key,operation_id,intent_hash,issued_sequence FROM synthetic_m03_id_receipts ORDER BY tenant_id,id_key,operation_id',
    stock:'SELECT tenant_id,sku,available FROM synthetic_m03_post_stock ORDER BY tenant_id,sku',
    journal:'SELECT tenant_id,operation_id,source_id,sku,units FROM synthetic_m03_post_journal ORDER BY tenant_id,operation_id'
  }))parts[name]=await rows(query);
  return parts;
}
const current=(s,tenant)=>s.counters.find(c=>c.tenant_id===tenant)?.current_sequence;
const available=(s,tenant)=>s.stock.find(c=>c.tenant_id===tenant)?.available;
const receiptsFor=(s,tenant)=>s.receipts.filter(c=>c.tenant_id===tenant);
const postingsFor=(s,tenant)=>s.journal.filter(c=>c.tenant_id===tenant);

before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const ddl of SYNTHETIC_M03_ID_POST_DDL) {
    assert.equal((await DB.prepare(ddl).run()).success,true);
  }
  const preflight=planSourceIdCounterFloor({
    idKey:'SALES',prefix:'INV',storedCounter:'4',
    existingIds:['INV-000001','INV-000016'],padLength:6
  });
  assert.equal(preflight.floor,16);
  const counters=DB.prepare(
    'INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES(?,?,?,?)'
  );
  const stock=DB.prepare(
    'INSERT INTO synthetic_m03_post_stock(tenant_id,sku,available) VALUES(?,?,?)'
  );
  for(const [tenant,floor,stockUnits] of [
    ['TENANT-A',preflight.floor,2],
    ['TENANT-B',0,1],['TENANT-C',10,1],['TENANT-D',4,0],
    ['TENANT-E',Number.MAX_SAFE_INTEGER,1],
    ['TENANT-F',null,1],['TENANT-G',0,1]
  ]){
    if(floor!==null)
      assert.equal((await counters.bind(tenant,'SALES','INV',floor).run()).success,true);
    assert.equal((await stock.bind(tenant,'PIPE-1',stockUnits).run()).success,true);
  }
});
after(async()=>{await harness.close();});

test('one local D1 INSERT stamps source INV ID, deducts stock and posts journal atomically',async()=>{
  assert.deepEqual(await call('/__m03_idpost__/a-1'),{
    status:200,body:{id:'INV-000017',sequence:17,posted:true}
  });
  const s=await state();
  assert.equal(current(s,'TENANT-A'),17);
  assert.equal(available(s,'TENANT-A'),1);
  assert.deepEqual(receiptsFor(s,'TENANT-A').map(r=>r.issued_sequence),[17]);
  assert.deepEqual(postingsFor(s,'TENANT-A'),[{
    tenant_id:'TENANT-A',operation_id:'OP-ONE',source_id:'INV-000017',
    sku:'PIPE-1',units:1
  }]);
});

test('same operation and intent replays exact posted sale; changed hash collides without any write',async()=>{
  const before=await state();
  assert.deepEqual(await call('/__m03_idpost__/a-1'),{
    status:200,body:{id:'INV-000017',sequence:17,posted:true}
  });
  assert.equal((await call('/__m03_idpost__/a-1-changed')).status,409);
  assert.deepEqual(await state(),before);
});

test('lost response after complete D1 commit replays exact ID and does not duplicate stock or journal',async()=>{
  assert.equal((await call('/__m03_idpost__/a-lost')).status,503);
  const committed=await state();
  assert.equal(current(committed,'TENANT-A'),18);
  assert.equal(available(committed,'TENANT-A'),0);
  assert.equal(postingsFor(committed,'TENANT-A').length,2);
  assert.deepEqual(await call('/__m03_idpost__/a-lost-retry'),{
    status:200,body:{id:'INV-000018',sequence:18,posted:true}
  });
  assert.deepEqual(await state(),committed);
});

test('out-of-stock D1 posting aborts original ID claim and counter, no sequence gap',async()=>{
  const before=await state();
  assert.equal((await call('/__m03_idpost__/a-stock-empty')).status,409);
  assert.deepEqual(await state(),before);
  assert.equal(current(before,'TENANT-A'),18);
});

test('two concurrent final-item requests issue and post exactly one continuous ID',async()=>{
  const pair=await Promise.all([
    call('/__m03_idpost__/b-race-1'),
    call('/__m03_idpost__/b-race-2')
  ]);
  assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(pair.find(r=>r.status===200).body,{
    id:'INV-000001',sequence:1,posted:true
  });
  const s=await state();
  assert.equal(available(s,'TENANT-B'),0);
  assert.equal(current(s,'TENANT-B'),1);
  assert.equal(receiptsFor(s,'TENANT-B').length,1);
  assert.equal(postingsFor(s,'TENANT-B').length,1);
});

test('failed late journal insert rolls back receipt, sequence increment AND stock debit',async()=>{
  const before=await state();
  await DB.prepare(
    "CREATE TRIGGER synthetic_m03_post_inject_failure BEFORE INSERT ON synthetic_m03_post_journal "+
    "WHEN NEW.tenant_id='TENANT-C' BEGIN SELECT RAISE(ABORT,'synthetic journal failure'); END"
  ).run();
  assert.equal((await call('/__m03_idpost__/c-journal-fails')).status,409);
  assert.deepEqual(await state(),before);
  await DB.prepare('DROP TRIGGER synthetic_m03_post_inject_failure').run();
  assert.deepEqual(await call('/__m03_idpost__/c-retry'),{
    status:200,body:{id:'INV-000011',sequence:11,posted:true}
  });
  const afterState=await state();
  assert.equal(current(afterState,'TENANT-C'),11);
  assert.equal(available(afterState,'TENANT-C'),0);
  assert.equal(postingsFor(afterState,'TENANT-C').length,1);
});

test('stock zero, exhausted and absent counters fail without any partial receipt or posting',async()=>{
  const before=await state();
  for(const path of [
    '/__m03_idpost__/d-no-stock',
    '/__m03_idpost__/e-exhausted',
    '/__m03_idpost__/f-no-counter'
  ])assert.equal((await call(path)).status,409,path);
  assert.deepEqual(await state(),before);
});

test('same operation in another tenant issues independently without exposing previous source ID',async()=>{
  assert.deepEqual(await call('/__m03_idpost__/g-same-op'),{
    status:200,body:{id:'INV-000001',sequence:1,posted:true}
  });
  const s=await state();
  assert.equal(current(s,'TENANT-G'),1);
  assert.equal(available(s,'TENANT-G'),0);
  assert.deepEqual(postingsFor(s,'TENANT-G').map(r=>r.source_id),['INV-000001']);
  assert.deepEqual(postingsFor(s,'TENANT-A').map(r=>r.source_id),
    ['INV-000017','INV-000018']);
});

test('D1 cannot mutate or delete either committed sale journal or ID receipt',async()=>{
  const before=await state();
  await assert.rejects(()=>DB.prepare(
    "UPDATE synthetic_m03_post_journal SET units=9 WHERE tenant_id='TENANT-A'"
  ).run(),/immutable|D1_ERROR|abort/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM synthetic_m03_post_journal WHERE tenant_id='TENANT-A'"
  ).run(),/immutable|D1_ERROR|abort/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM synthetic_m03_id_receipts WHERE tenant_id='TENANT-A'"
  ).run(),/immutable|D1_ERROR|abort/i);
  assert.deepEqual(await state(),before);
});

test('only immutable test routes exist and request body cannot supply SQL or tenant',async()=>{
  const before=await state();
  assert.equal((await call('/__m03_idpost__/unknown')).status,404);
  const get=await worker.fetch('http://m03-idpost.local/__m03_idpost__/a-1');
  assert.equal(get.status,405);
  assert.deepEqual(await call('/__m03_idpost__/a-1',{
    tenantId:'TENANT-Z',idKey:'SUPPLIERS',operationId:'OP-ATTACK',
    sql:'DELETE FROM synthetic_m03_post_stock',units:999
  }),{status:200,body:{id:'INV-000017',sequence:17,posted:true}});
  assert.deepEqual(await state(),before);
  const config=JSON.parse(readFileSync(
    new URL('../../wrangler.m03-id-post-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.main,'tests/fixtures/m03-id-post-worker.mjs');
  assert.equal(config.d1_databases[0].database_id,
    '00000000-0000-0000-0000-000000000098');
});
