import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

// Distinct test-only Worker/config: the existing M03 read-only fixture is unchanged.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-write-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-write-workerd-test');
let db;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB:db}=await worker.getEnv());
  await db.prepare("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES ('CAT-1','Electrical','Active',2),('CAT-2','Hardware','Active',3)").run();
  await db.prepare("INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES ('UNIT-1','Pcs','Active',2)").run();
});
after(async()=>{await harness.close();});

async function call(path,method='GET') {
  const response=await worker.fetch('http://m03-write.local'+path,{method});
  return {status:response.status,body:await response.json()};
}

test('local Worker/D1 assigns distinct source Sheet rows under concurrent guarded appends',async()=>{
  const [a,b]=await Promise.all([
    call('/__m03_write_test__/append-category-a','POST'),
    call('/__m03_write_test__/append-category-b','POST')
  ]);
  assert.equal(a.status,200,JSON.stringify(a.body));
  assert.equal(b.status,200,JSON.stringify(b.body));
  assert.deepEqual([a.body.rowIndex,b.body.rowIndex].sort((x,y)=>x-y),[4,5]);
  assert.deepEqual(await call('/__m03_write_test__/append-unit-a','POST'),{status:200,body:{rowIndex:3}});

  const saved=await db.prepare('SELECT category_id,category_name,legacy_sheet_row FROM product_categories ORDER BY legacy_sheet_row').all();
  assert.equal(saved.success,true);
  assert.deepEqual(saved.results.map(x=>x.legacy_sheet_row),[2,3,4,5]);
  assert.deepEqual(saved.results.slice(2).map(x=>x.category_id).sort(),['CAT-W-A','CAT-W-B']);
  const sourceRows=await call('/__m03_write_test__/categories');
  assert.equal(sourceRows.status,200);
  assert.deepEqual(sourceRows.body.rows.map(x=>x._rowIndex),[2,3,4,5]);
  assert.deepEqual(sourceRows.body.rows.map(x=>x['Category ID']).sort(),['CAT-1','CAT-2','CAT-W-A','CAT-W-B'].sort());
});

test('real local D1 refuses duplicate-ID replay without growing either catalog',async()=>{
  assert.equal((await call('/__m03_write_test__/append-category-a','POST')).status,500);
  assert.equal((await call('/__m03_write_test__/append-unit-a','POST')).status,500);
  const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM product_units) AS units').first();
  assert.deepEqual(counts,{categories:4,units:2});
});

test('real local D1 rejects corrupt physical provenance in one SQL statement',async()=>{
  await db.prepare("UPDATE product_units SET legacy_sheet_row=9 WHERE unit_id='UNIT-1'").run();
  const attempt=await call('/__m03_write_test__/append-unit-b','POST');
  assert.equal(attempt.status,500,JSON.stringify(attempt.body));
  const saved=await db.prepare('SELECT unit_id,legacy_sheet_row FROM product_units ORDER BY unit_id').all();
  assert.deepEqual(saved.results.map(x=>x.unit_id).sort(),['UNIT-1','UNIT-W-A']);
});

test('test-only write endpoint is strict and never accepts external row payload or unknown group',async()=>{
  assert.equal((await call('/__m03_write_test__/append-category-a','GET')).status,404);
  assert.equal((await call('/__m03_write_test__/append-category-a','PUT')).status,405);
  assert.equal((await call('/__m03_write_test__/anything','POST')).status,405);
  assert.equal((await call('/__m03_write_test__/settings')).status,404);
  const forged=await worker.fetch('http://m03-write.local/__m03_write_test__/append-category-c',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sheet:'SETTINGS',row:{Key:'ADMIN_TOKEN',Value:'attacker-controlled'}})
  });
  assert.equal(forged.status,200);
  assert.deepEqual(await forged.json(),{rowIndex:6});
  const saved=await db.prepare("SELECT category_id,category_name FROM product_categories WHERE category_id='CAT-W-C'").first();
  assert.deepEqual(saved,{category_id:'CAT-W-C',category_name:'Hardware'});
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
});

test('local Worker/D1 batch insert is ordered and duplicate replay rolls back every sibling',async()=>{
  const initial=await db.prepare('SELECT MAX(legacy_sheet_row) AS last FROM product_categories').first();
  const savedBefore=await db.prepare('SELECT COUNT(*) AS n FROM product_categories').first();
  const batch=await call('/__m03_write_test__/batch-categories','POST');
  assert.deepEqual(batch,{status:200,body:{inserted:2}});
  const stored=await db.prepare("SELECT category_id,category_name,legacy_sheet_row FROM product_categories WHERE category_id LIKE 'CAT-W-BATCH-%' ORDER BY legacy_sheet_row").all();
  assert.deepEqual(stored.results,[
    {category_id:'CAT-W-BATCH-1',category_name:'Hardware',legacy_sheet_row:initial.last+1},
    {category_id:'CAT-W-BATCH-2',category_name:'বাংলা',legacy_sheet_row:initial.last+2}
  ]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM product_categories').first()).n,savedBefore.n+2);
  const replay=await call('/__m03_write_test__/batch-categories','POST');
  assert.equal(replay.status,500);
  const conflict=await call('/__m03_write_test__/batch-conflict','POST');
  assert.equal(conflict.status,500);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM product_categories').first()).n,savedBefore.n+2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM product_categories WHERE category_id='CAT-W-BATCH-UNCOMMITTED'").first()).n,0);
});

test('real Workerd D1 guarded reactivation rejects stale replay and corrupt source row provenance',async()=>{
  // Existing append tests intentionally remain first; this fixture uses only synthetic rows.
  await db.prepare("UPDATE product_categories SET status='Inactive' WHERE category_id='CAT-2'").run();
  const [a,b]=await Promise.all([
    call('/__m03_write_test__/activate-category-2','POST'),
    call('/__m03_write_test__/activate-category-2','POST')
  ]);
  assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[200,500]);
  assert.deepEqual((a.status===200?a:b).body,{rowIndex:3});
  const row=await db.prepare("SELECT status,legacy_sheet_row FROM product_categories WHERE category_id='CAT-2'").first();
  assert.deepEqual(row,{status:'Active',legacy_sheet_row:3});
  await db.prepare("UPDATE product_categories SET status='Inactive' WHERE category_id='CAT-2'").run();
  await db.prepare("UPDATE product_categories SET legacy_sheet_row=12 WHERE category_id='CAT-1'").run();
  assert.equal((await call('/__m03_write_test__/activate-category-2','POST')).status,500);
  assert.equal((await db.prepare("SELECT status FROM product_categories WHERE category_id='CAT-2'").first()).status,'Inactive');
  await db.prepare("UPDATE product_categories SET legacy_sheet_row=2 WHERE category_id='CAT-1'").run();

  await db.prepare("UPDATE product_units SET legacy_sheet_row=2,status='Inactive' WHERE unit_id='UNIT-1'").run();
  assert.deepEqual(await call('/__m03_write_test__/activate-unit-1','POST'),{status:200,body:{rowIndex:2}});
  assert.equal((await db.prepare("SELECT status FROM product_units WHERE unit_id='UNIT-1'").first()).status,'Active');
  assert.equal((await call('/__m03_write_test__/activate-unit-1','POST')).status,500);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
});

test('real Workerd/D1 catalog delete rolls back on mid-batch failure and compacts physical Sheet rows',async()=>{
  const pre=await db.prepare("SELECT category_id,legacy_sheet_row FROM product_categories WHERE category_id LIKE 'CAT-W-BATCH-%' ORDER BY legacy_sheet_row").all();
  assert.deepEqual(pre.results,[
    {category_id:'CAT-W-BATCH-1',legacy_sheet_row:7},
    {category_id:'CAT-W-BATCH-2',legacy_sheet_row:8}
  ]);
  await db.prepare(`CREATE TRIGGER stop_compaction BEFORE UPDATE ON product_categories
    WHEN NEW.legacy_sheet_row>1002
    BEGIN SELECT RAISE(ABORT,'forced-middle-step-failure'); END`).run();
  assert.equal((await call('/__m03_write_test__/delete-category-batch-1','POST')).status,500);
  const rolledBack=await db.prepare("SELECT category_id,legacy_sheet_row FROM product_categories WHERE category_id LIKE 'CAT-W-BATCH-%' ORDER BY legacy_sheet_row").all();
  assert.deepEqual(rolledBack.results,pre.results,'aborting the shift must restore the already-deleted row');
  await db.prepare('DROP TRIGGER stop_compaction').run();

  assert.deepEqual(await call('/__m03_write_test__/delete-category-batch-1','POST'),{status:200,body:{deleted:true}});
  const after=await db.prepare("SELECT category_id,legacy_sheet_row FROM product_categories WHERE category_id LIKE 'CAT-W-BATCH-%' ORDER BY legacy_sheet_row").all();
  assert.deepEqual(after.results,[{category_id:'CAT-W-BATCH-2',legacy_sheet_row:7}]);
  assert.equal((await call('/__m03_write_test__/delete-category-batch-1','POST')).status,500,'idempotent retry must not delete a shifted sibling');
  assert.deepEqual((await call('/__m03_write_test__/categories')).body.rows.map(row=>row._rowIndex),[2,3,4,5,6,7]);
  assert.deepEqual(await call('/__m03_write_test__/delete-category-batch-2','POST'),{status:200,body:{deleted:true}});
  assert.deepEqual((await call('/__m03_write_test__/categories')).body.rows.map(row=>row._rowIndex),[2,3,4,5,6]);
  assert.deepEqual(await call('/__m03_write_test__/delete-unit-last','POST'),{status:200,body:{deleted:true}});
  const units=await db.prepare('SELECT unit_id,legacy_sheet_row FROM product_units ORDER BY legacy_sheet_row').all();
  assert.deepEqual(units.results,[{unit_id:'UNIT-1',legacy_sheet_row:2}]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
});
