import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

// Dedicated nondeployable local Worker; no production/staging bindings.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-update-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-update-workerd-test');
let DB;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO product_categories
    (category_id,category_name,status,created_at,legacy_sheet_row)
    VALUES ('CAT-UP-1','Electrical','Active','2026-11-14',2),
           ('CAT-UP-2','Hardware','Active','2026-11-14',3)`).run();
  await DB.prepare(`INSERT INTO product_units
    (unit_id,unit_name,status,created_at,legacy_sheet_row)
    VALUES ('UNT-UP-1','Pcs','Active','2026-11-14',2),
           ('UNT-UP-2','Feet','Active','2026-11-14',3)`).run();
});
after(async()=>{await harness.close();});

async function call(path,method='POST',body){
  const response=await worker.fetch('http://m03-update.local'+path,{
    method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  });
  return {status:response.status,body:await response.json()};
}

test('real local Workerd/D1 updates exactly one category Status with original ID and row preserved',async()=>{
  assert.deepEqual(await call('/__m03_update_test__/category-status'),{status:200,body:{updated:true}});
  const a=await DB.prepare("SELECT category_id,category_name,status,created_at,legacy_sheet_row FROM product_categories WHERE category_id='CAT-UP-1'").first();
  assert.deepEqual({...a},{category_id:'CAT-UP-1',category_name:'Electrical',status:'Inactive',created_at:'2026-11-14',legacy_sheet_row:2});
  const b=await DB.prepare("SELECT status FROM product_categories WHERE category_id='CAT-UP-2'").first();
  assert.equal(b.status,'Active');
});

test('real Workerd/D1 rejects a stale replay and never overwrites the original row',async()=>{
  const attempt=await call('/__m03_update_test__/category-status');
  assert.equal(attempt.status,409);
  assert.equal((await DB.prepare("SELECT status FROM product_categories WHERE category_id='CAT-UP-1'").first()).status,'Inactive');
});

test('real Workerd/D1 preserves UTF-8 unit labels and refuses mismatched stable ID',async()=>{
  assert.deepEqual(await call('/__m03_update_test__/unit-rename'),{status:200,body:{updated:true}});
  const unit=await DB.prepare("SELECT unit_id,unit_name,status,created_at,legacy_sheet_row FROM product_units WHERE unit_id='UNT-UP-2'").first();
  assert.deepEqual({...unit},{unit_id:'UNT-UP-2',unit_name:'গিরা',status:'Active',created_at:'2026-11-14',legacy_sheet_row:3});
  assert.equal((await call('/__m03_update_test__/wrong-category-id')).status,409);
  assert.equal((await DB.prepare("SELECT status FROM product_categories WHERE category_id='CAT-UP-2'").first()).status,'Active');
});

test('test-only endpoint ignores caller payload, cannot update SETTINGS, and hides internal errors',async()=>{
  assert.equal((await call('/__m03_update_test__/category-noop','GET')).status,405);
  assert.equal((await call('/__m03_update_test__/settings')).status,404);
  const injection=await call('/__m03_update_test__/category-noop','POST',{
    sheet:'SETTINGS',fields:{Value:'attacker'},
    sourceId:'CAT-UP-1',rowIndex:2
  });
  assert.deepEqual(injection,{status:200,body:{updated:true}});
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
  assert.equal((await DB.prepare("SELECT status FROM product_categories WHERE category_id='CAT-UP-2'").first()).status,'Active');
});

test('two simultaneous stale-preimage updates to the same unit cannot both commit',async()=>{
  const [a,b]=await Promise.all([
    call('/__m03_update_test__/unit-1-status'),
    call('/__m03_update_test__/unit-1-name')
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const unit=await DB.prepare("SELECT unit_name,status FROM product_units WHERE unit_id='UNT-UP-1'").first();
  assert.deepEqual({...unit},a.status===200?
    {unit_name:'Pcs',status:'Inactive'}:{unit_name:'Pieces',status:'Active'});
});

test('corrupt source-row provenance blocks even correctly identified D1 row',async()=>{
  await DB.prepare("UPDATE product_categories SET legacy_sheet_row=8 WHERE category_id='CAT-UP-2'").run();
  const invalid=await call('/__m03_update_test__/category-after-corruption');
  assert.equal(invalid.status,409);
  assert.equal((await DB.prepare("SELECT category_name FROM product_categories WHERE category_id='CAT-UP-1'").first()).category_name,'Electrical');
});
