import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_M03_ID_DDL} from '../fixtures/m03-id-issuer-schema.mjs';
import {planSourceIdCounterFloor} from '../../src/modules/source-id-counter-floor.js';

const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m03-id-issuer-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m03-id-issuer-workerd-test');
let DB;
async function call(path,body){
  const response=await worker.fetch('http://m03-issuer.local'+path,{
    method:'POST',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}
const value=async(sql,...args)=>DB.prepare(sql).bind(...args).first();
const reads=async(sql)=> {
  const result=await DB.prepare(sql).all();
  assert.equal(result.success,true);
  return result.results.map(row=>({...row}));
};
const snapshot=async()=>({
  counters:await reads('SELECT tenant_id,id_key,prefix,current_sequence FROM synthetic_m03_id_counters ORDER BY tenant_id,id_key'),
  receipts:await reads('SELECT tenant_id,id_key,operation_id,intent_hash,issued_sequence FROM synthetic_m03_id_receipts ORDER BY tenant_id,id_key,operation_id')
});
before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const ddl of SYNTHETIC_M03_ID_DDL){
    const result=await DB.prepare(ddl).run();
    assert.equal(result.success,true);
  }
  // Source-approved floor comes from original ID column, never from row count.
  const imported=planSourceIdCounterFloor({
    idKey:'PRODUCT_CATEGORIES',prefix:'PCAT',storedCounter:'4',
    existingIds:['PCAT-000001','PCAT-000016'],padLength:6
  });
  assert.equal(imported.floor,16);
  const insert=DB.prepare(
    'INSERT INTO synthetic_m03_id_counters '+
    '(tenant_id,id_key,prefix,current_sequence) VALUES (?,?,?,?)'
  );
  for(const seed of [
    ['TENANT-A','PRODUCT_CATEGORIES','PCAT',imported.floor],
    ['TENANT-B','PRODUCT_CATEGORIES','PCAT',2],
    ['TENANT-A','PRODUCT_UNITS','PUNT',0],
    ['TENANT-D','PRODUCT_CATEGORIES','PCAT',0],
    ['TENANT-E','PRODUCT_CATEGORIES','PCAT',Number.MAX_SAFE_INTEGER]
  ]){
    assert.equal((await insert.bind(...seed).run()).success,true);
  }
});
after(async()=>{await harness.close();});

test('real local Workerd/D1 issues original PCAT family from imported high-water floor',async()=>{
  assert.deepEqual(await call('/__m03_id__/a-first'),{
    status:200,body:{id:'PCAT-000017',sequence:17}
  });
  assert.deepEqual(await call('/__m03_id__/a-second'),{
    status:200,body:{id:'PCAT-000018',sequence:18}
  });
  assert.equal((await value(
    "SELECT current_sequence AS n FROM synthetic_m03_id_counters WHERE tenant_id=? AND id_key=?",
    'TENANT-A','PRODUCT_CATEGORIES')).n,18);
});

test('stable operation replay returns exact issued ID; changed intent fails with zero new writes',async()=>{
  const before=await snapshot();
  assert.deepEqual(await call('/__m03_id__/a-first'),{
    status:200,body:{id:'PCAT-000017',sequence:17}
  });
  assert.equal((await call('/__m03_id__/a-first-drift')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('twelve concurrent requests against one tenant+family issue distinct gapless sequences',async()=>{
  const result=await Promise.all(Array.from({length:12},(_,i)=>
    call('/__m03_id__/bulk-'+i)));
  assert(result.every(r=>r.status===200),JSON.stringify(result));
  assert.deepEqual(result.map(r=>r.body.id).sort(),Array.from({length:12},(_,i)=>
    'PUNT-'+String(i+1).padStart(6,'0')).sort());
  assert.equal((await value(
    "SELECT current_sequence AS n FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A' AND id_key='PRODUCT_UNITS'"
  )).n,12);
  const receipts=await reads(
    "SELECT issued_sequence FROM synthetic_m03_id_receipts WHERE tenant_id='TENANT-A' AND id_key='PRODUCT_UNITS' ORDER BY issued_sequence"
  );
  assert.deepEqual(receipts.map(r=>r.issued_sequence),Array.from({length:12},(_,i)=>i+1));
});

test('lost response after commit can be recovered without consuming another ID',async()=>{
  assert.equal((await call('/__m03_id__/a-lost')).status,503);
  const before=await snapshot();
  assert.deepEqual(await call('/__m03_id__/a-lost-retry'),{
    status:200,body:{id:'PCAT-000019',sequence:19}
  });
  assert.deepEqual(await snapshot(),before);
});

test('same operation ID in another tenant is a distinct allocation, never leaked across tenants',async()=>{
  assert.deepEqual(await call('/__m03_id__/b-first'),{
    status:200,body:{id:'PCAT-000003',sequence:3}
  });
  const a=await value(
    "SELECT issued_sequence AS n FROM synthetic_m03_id_receipts WHERE tenant_id='TENANT-A' AND operation_id='OP-SAME'"
  );
  const b=await value(
    "SELECT issued_sequence AS n FROM synthetic_m03_id_receipts WHERE tenant_id='TENANT-B' AND operation_id='OP-SAME'"
  );
  assert.deepEqual([a.n,b.n],[17,3]);
});

test('injected trigger failure rolls back both ID counter and original receipt claim',async()=>{
  const before=await snapshot();
  await DB.prepare(
    "CREATE TRIGGER synthetic_m03_id_injected_abort BEFORE UPDATE ON synthetic_m03_id_counters "+
    "WHEN NEW.tenant_id='TENANT-D' BEGIN SELECT RAISE(ABORT,'synthetic DB write aborted'); END"
  ).run();
  assert.equal((await call('/__m03_id__/d-blocked')).status,409);
  assert.deepEqual(await snapshot(),before);
  await DB.prepare('DROP TRIGGER synthetic_m03_id_injected_abort').run();
  assert.deepEqual(await call('/__m03_id__/d-retry'),{
    status:200,body:{id:'PCAT-000001',sequence:1}
  });
});

test('missing and exhausted counters fail closed, never leaving orphan issue receipts',async()=>{
  const before=await snapshot();
  assert.equal((await call('/__m03_id__/no-counter')).status,409);
  assert.equal((await call('/__m03_id__/e-exhausted')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('committed ID receipts are immutable and cannot be deleted or reassigned',async()=>{
  const before=await snapshot();
  await assert.rejects(()=>DB.prepare(
    "UPDATE synthetic_m03_id_receipts SET issued_sequence=999 WHERE operation_id='OP-SAME'"
  ).run(),/immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM synthetic_m03_id_receipts WHERE operation_id='OP-SAME'"
  ).run(),/immutable|abort|D1_ERROR/i);
  assert.deepEqual(await snapshot(),before);
});

test('public RPC and client-provided SQL/tenant cannot enter isolated fixed test worker',async()=>{
  const before=await snapshot();
  assert.equal((await call('/__m03_id__/unknown')).status,404);
  const get=await worker.fetch('http://m03-issuer.local/__m03_id__/a-first');
  assert.equal(get.status,405);
  assert.deepEqual(await call('/__m03_id__/a-first',{
    tenantId:'TENANT-Z',idKey:'PRODUCT_CATEGORIES',operationId:'OP-ATTACK',
    intentHash:'b'.repeat(64),sql:'DROP TABLE synthetic_m03_id_counters'
  }),{status:200,body:{id:'PCAT-000017',sequence:17}});
  assert.deepEqual(await snapshot(),before);
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m03-id-issuer-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.main,'tests/fixtures/m03-id-issuer-worker.mjs');
  assert.equal(config.routes,undefined);
  assert.equal(config.assets,undefined);
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000099');
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('atomic-source-id-issuer'),false);
  assert.equal(live.includes('synthetic_m03_id_'),false);
});
