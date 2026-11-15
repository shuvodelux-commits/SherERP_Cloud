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
