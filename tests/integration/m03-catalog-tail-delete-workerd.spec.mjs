import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

// Dedicated isolated nondeployable local Worker and synthetic D1 database.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-tail-delete-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-tail-delete-workerd-test');
let DB;
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO product_categories
    (category_id,category_name,status,legacy_sheet_row) VALUES
    ('CAT-D1','Electrical','Active',2),
    ('CAT-D2','Hardware','Active',3),
    ('CAT-D3','বাংলা','Inactive',4)`).run();
  await DB.prepare(`INSERT INTO product_units
    (unit_id,unit_name,status,legacy_sheet_row) VALUES
    ('UNT-D1','Pcs','Active',2),
    ('UNT-D2','Feet','Inactive',3)`).run();
});
after(async()=>{await harness.close();});
async function call(path,method='POST',body){
  const result=await worker.fetch('http://m03-tail.local'+path,{
    method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  });
  return {status:result.status,body:await result.json()};
}
async function rows(table,id){
  const result=await DB.prepare('SELECT '+id+',legacy_sheet_row FROM '+table+' ORDER BY legacy_sheet_row').all();
  return result.results.map(x=>[x[id],x.legacy_sheet_row]);
}

test('real local D1 rejects middle-row deletion and wrong stable source ID without changing row positions',async()=>{
  assert.equal((await call('/__m03_tail__/category-middle')).status,409);
  assert.equal((await call('/__m03_tail__/category-wrong-id')).status,409);
  assert.deepEqual(await rows('product_categories','category_id'),[
    ['CAT-D1',2],['CAT-D2',3],['CAT-D3',4]]);
});

test('real local D1 deletes final category, refuses replay, and allows safe append at same physical row',async()=>{
  assert.deepEqual(await call('/__m03_tail__/category-tail'),{status:200,body:{deleted:true}});
  assert.equal((await call('/__m03_tail__/category-tail')).status,409);
  assert.deepEqual(await rows('product_categories','category_id'),[['CAT-D1',2],['CAT-D2',3]]);
  assert.deepEqual(await call('/__m03_tail__/append-fresh-category'),{status:200,body:{rowIndex:4}});
  assert.deepEqual(await rows('product_categories','category_id'),[
    ['CAT-D1',2],['CAT-D2',3],['CAT-D4',4]]);
});

test('real local D1 deletes last unit then remaining sole row; no fake success for empty catalog',async()=>{
  assert.deepEqual(await call('/__m03_tail__/unit-tail'),{status:200,body:{deleted:true}});
  assert.deepEqual(await rows('product_units','unit_id'),[['UNT-D1',2]]);
  assert.deepEqual(await call('/__m03_tail__/unit-sole'),{status:200,body:{deleted:true}});
  assert.deepEqual(await rows('product_units','unit_id'),[]);
  assert.equal((await call('/__m03_tail__/unit-sole')).status,409);
});

test('real local D1 denies deletion when unrelated source index is NULL, without partial changes',async()=>{
  await DB.prepare("UPDATE product_categories SET legacy_sheet_row=NULL WHERE category_id='CAT-D1'").run();
  assert.equal((await call('/__m03_tail__/category-new-tail')).status,409);
  const result=await DB.prepare("SELECT COUNT(*) AS n FROM product_categories").first();
  assert.equal(result.n,3);
  assert.deepEqual(await rows('product_categories','category_id'),[['CAT-D1',null],['CAT-D2',3],['CAT-D4',4]]);
});

test('test-only endpoint refuses unknown sheet/routes, GET and ignores forged request body',async()=>{
  assert.equal((await call('/__m03_tail__/settings')).status,404);
  assert.equal((await call('/__m03_tail__/category-tail','GET')).status,405);
  assert.equal((await call('/__m03_tail__/anything')).status,404);
  assert.equal((await call('/__m03_tail__/category-middle','PUT')).status,405);
  const before=await DB.prepare('SELECT COUNT(*) AS n FROM settings').first();
  const attacker=await call('/__m03_tail__/category-middle','POST',
    {sheet:'SETTINGS',rowIndex:2,sourceId:'ADMIN',value:'evil'});
  assert.equal(attacker.status,409);
  assert.deepEqual(await DB.prepare('SELECT COUNT(*) AS n FROM settings').first(),before);
});
