import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {SYNTHETIC_M03_MASTER_ATOMIC_DDL} from '../fixtures/m03-master-atomic-schema.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-master-atomic-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-master-atomic-workerd-test');
let DB;
const query=async sql=>(await DB.prepare(sql).all()).results.map(r=>({...r}));
async function state(){
  return {
    categories:await query('SELECT category_id,category_name,status,legacy_sheet_row FROM product_categories ORDER BY legacy_sheet_row'),
    units:await query('SELECT unit_id,unit_name,status,legacy_sheet_row FROM product_units ORDER BY legacy_sheet_row'),
    counters:await query('SELECT id_key,current_sequence FROM synthetic_m03_id_counters ORDER BY id_key'),
    receipts:await query('SELECT id_key,operation_id,issued_sequence FROM synthetic_m03_id_receipts ORDER BY id_key,operation_id'),
    intents:await query('SELECT id_key,operation_id,result_id FROM synthetic_m03_master_intents ORDER BY id_key,operation_id')
  };
}
async function call(path,body,method='POST'){
  const response=await worker.fetch('http://m03-atomic-master.local'+path,{
    method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json()};
}
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  for(const sql of SYNTHETIC_M03_MASTER_ATOMIC_DDL){
    const result=await DB.prepare(sql).run();
    assert.equal(result.success,true,'test-only D1 schema statement must succeed');
  }
  await DB.prepare(
    "INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
      "('PCAT-000002','Electrical','Active',2),"+
      "('PCAT-000005','Wire','Inactive',3),"+
      "('PCAT-000006',' wire ','Paused',4),"+
      "('PCAT-000016','Other','Active',5)"
  ).run();
  await DB.prepare(
    "INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('PUNT-000007','Pcs','Active',2)"
  ).run();
  await DB.prepare(
    "INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES "+
    "('BUS-A','PRODUCT_CATEGORIES','PCAT',16),('BUS-A','PRODUCT_UNITS','PUNT',7)"
  ).run();
});
after(async()=>{await harness.close();});

test('real local Workerd D1 creates PCAT source ID and replays identical operation without second write',async()=>{
  assert.deepEqual(await call('/__m03_atomic_master__/category-tools'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  const before=await state();
  assert.deepEqual(await call('/__m03_atomic_master__/category-tools-retry'),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  assert.deepEqual(await state(),before);
  assert.equal((await call('/__m03_atomic_master__/category-tools-collision')).status,409);
  assert.deepEqual(await state(),before);
});

test('real local D1 retains active duplicate and removes only source inactive Wire rows atomically',async()=>{
  const before=await state();
  assert.deepEqual(await call('/__m03_atomic_master__/category-duplicate'),{
    status:200,body:{success:false,message:'A category with this name already exists.'}
  });
  assert.deepEqual(await state(),before);
  assert.deepEqual(await call('/__m03_atomic_master__/category-reuse'),{
    status:200,body:{success:true,data:{id:'PCAT-000018',name:'wIrE'}}
  });
  const after=await state();
  assert.deepEqual(after.categories.map(x=>[x.category_id,x.legacy_sheet_row]),[
    ['PCAT-000002',2],['PCAT-000016',3],['PCAT-000017',4],['PCAT-000018',5]
  ]);
  assert.deepEqual(after.units,before.units);
  assert.equal(after.counters.find(x=>x.id_key==='PRODUCT_CATEGORIES').current_sequence,18);
});

test('real Workerd D1 keeps Unit counter independent of PCAT and writes PUNT-000008',async()=>{
  assert.deepEqual(await call('/__m03_atomic_master__/unit-gira'),{
    status:200,body:{success:true,data:{id:'PUNT-000008',name:'গিরা'}}
  });
  const saved=await state();
  assert.deepEqual(saved.units.map(x=>[x.unit_id,x.legacy_sheet_row]),[
    ['PUNT-000007',2],['PUNT-000008',3]
  ]);
  assert.equal(saved.counters.find(x=>x.id_key==='PRODUCT_UNITS').current_sequence,8);
  assert.equal(saved.counters.find(x=>x.id_key==='PRODUCT_CATEGORIES').current_sequence,18);
});

test('simultaneous same Unicode-casefold name can commit only one receipt and one category',async()=>{
  const [a,b]=await Promise.all([
    call('/__m03_atomic_master__/category-race-a'),
    call('/__m03_atomic_master__/category-race-b')
  ]);
  const successes=[a,b].filter(x=>x.status===200&&x.body.success===true);
  assert.equal(successes.length,1);
  const saved=await state();
  assert.equal(saved.categories.filter(x=>x.category_name.toLowerCase()==='latch').length,1);
  assert.equal(saved.receipts.filter(x=>x.operation_id.startsWith('OP-RACE')).length,1);
  assert.equal(saved.counters.find(x=>x.id_key==='PRODUCT_CATEGORIES').current_sequence,19);
});

test('HTTP lost-response retry returns committed ID and does not duplicate row/counter',async()=>{
  assert.equal((await call('/__m03_atomic_master__/category-lost')).status,503);
  const afterCommit=await state();
  assert.equal(afterCommit.counters.find(x=>x.id_key==='PRODUCT_CATEGORIES').current_sequence,20);
  assert.deepEqual(await call('/__m03_atomic_master__/category-lost-retry'),{
    status:200,body:{success:true,data:{id:'PCAT-000020',name:'Tape'}}
  });
  assert.deepEqual(await state(),afterCommit);
});

test('real local D1 late failure rolls back catalog, ID counter, receipt and intent',async()=>{
  assert.equal((await DB.prepare("CREATE TRIGGER fail_master_insert BEFORE INSERT ON product_categories "+
    "WHEN NEW.category_name='Fault' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").run()).success,true);
  const before=await state();
  assert.equal((await call('/__m03_atomic_master__/category-fault')).status,409);
  assert.deepEqual(await state(),before);
  assert.equal((await DB.prepare('DROP TRIGGER fail_master_insert').run()).success,true);
  assert.deepEqual(await call('/__m03_atomic_master__/category-fault'),{
    status:200,body:{success:true,data:{id:'PCAT-000021',name:'Fault'}}
  });
});

test('test-only Workerd ignores external payload and live Worker/RPC stay inert',async()=>{
  const previous=await state();
  const body={name:'Evil',operationId:'OP-ATTACK',idKey:'SETTINGS',sql:'DROP TABLE product_categories'};
  assert.equal((await call('/__m03_atomic_master__/nope',body)).status,404);
  assert.equal((await call('/__m03_atomic_master__/category-tools',body,'GET')).status,405);
  assert.deepEqual(await call('/__m03_atomic_master__/category-tools',body),{
    status:200,body:{success:true,data:{id:'PCAT-000017',name:'Tools'}}
  });
  assert.deepEqual(await state(),previous);
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m03-master-atomic-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.main,'tests/fixtures/m03-master-atomic-worker.mjs');
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m03-master-atomic'),false);
  assert.equal(live.includes('m03-product-master-atomic-create'),false);
});
