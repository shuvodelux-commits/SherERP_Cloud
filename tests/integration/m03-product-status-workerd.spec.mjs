import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-product-status-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-product-status-workerd-test');
let DB;
async function call(path,body,method='POST'){
  const response=await worker.fetch('http://m03-status.local'+path,{
    method,...(body===undefined?{}:{
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    })
  });
  return {status:response.status,body:await response.json()};
}
const categoryRows=async()=>{
  const result=await DB.prepare(
    'SELECT category_id,category_name,status,legacy_sheet_row FROM product_categories ORDER BY legacy_sheet_row'
  ).all();
  assert.equal(result.success,true);
  return result.results.map(row=>({...row}));
};
const unitRows=async()=>{
  const result=await DB.prepare(
    'SELECT unit_id,unit_name,status,legacy_sheet_row FROM product_units ORDER BY legacy_sheet_row'
  ).all();
  assert.equal(result.success,true);
  return result.results.map(row=>({...row}));
};
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.equal((await DB.prepare("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('CAT-A','Electrical','Inactive',2),('CAT-B','Hardware','Active',3),('CAT-C','Tools','Active',4)").run()).success,true);
  assert.equal((await DB.prepare("INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('UNT-A','Pcs','Inactive',2),('UNT-B','Feet','Active',3),('UNT-C','গিরা','Active',4)").run()).success,true);
});
after(async()=>{await harness.close();});

test('real local D1 activates one source category with original row and ID unchanged',async()=>{
  assert.deepEqual(await call('/__m03_status__/activate-category'),{
    status:200,body:{success:true,data:{id:'CAT-A',status:'Active'}}
  });
  const rows=await categoryRows();
  assert.deepEqual(rows.map(x=>x.legacy_sheet_row),[2,3,4]);
  assert.deepEqual(rows[0],{
    category_id:'CAT-A',category_name:'Electrical',status:'Active',legacy_sheet_row:2
  });
  assert.equal(rows[1].status,'Active');
});

test('two concurrent delete requests remove exactly one source category and do not delete shifted sibling',async()=>{
  const [a,b]=await Promise.all([
    call('/__m03_status__/delete-category'),
    call('/__m03_status__/delete-category')
  ]);
  assert.deepEqual([a.body.success,b.body.success].sort(),[false,true]);
  assert.deepEqual(
    [a.body,b.body].sort((x,y)=>Number(x.success)-Number(y.success)),[
      {success:false,message:'Category not found.'},
      {success:true,data:{id:'CAT-B',deleted:true}}
    ]
  );
  assert.deepEqual((await categoryRows()).map(x=>[x.category_id,x.legacy_sheet_row]),
    [['CAT-A',2],['CAT-C',3]]);
  assert.deepEqual(await call('/__m03_status__/missing-category'),{
    status:200,body:{success:false,message:'Category not found.'}
  });
});

test('real D1 unit activation preserves original identity; stale replay is not a new row',async()=>{
  assert.deepEqual(await call('/__m03_status__/activate-unit'),{
    status:200,body:{success:true,data:{id:'UNT-A',status:'Active'}}
  });
  assert.deepEqual(await call('/__m03_status__/activate-unit'),{
    status:200,body:{success:true,data:{id:'UNT-A',status:'Active'}}
  });
  assert.deepEqual((await unitRows()).map(x=>[x.unit_id,x.status,x.legacy_sheet_row]),[
    ['UNT-A','Active',2],['UNT-B','Active',3],['UNT-C','Active',4]
  ]);
});

test('trigger failure during D1 compaction rolls back original source unit deletion and row shifts',async()=>{
  const before=await unitRows();
  assert.equal((await DB.prepare(
    "CREATE TRIGGER fail_m03_status_compaction BEFORE UPDATE ON product_units "+
    "WHEN NEW.legacy_sheet_row>1002 BEGIN SELECT RAISE(ABORT,'local compaction fault'); END"
  ).run()).success,true);
  assert.equal((await call('/__m03_status__/delete-unit')).status,409);
  assert.deepEqual(await unitRows(),before);
  assert.equal((await DB.prepare('DROP TRIGGER fail_m03_status_compaction').run()).success,true);
  assert.deepEqual(await call('/__m03_status__/delete-unit'),{
    status:200,body:{success:true,data:{id:'UNT-B',deleted:true}}
  });
  assert.deepEqual((await unitRows()).map(x=>[x.unit_id,x.legacy_sheet_row]),
    [['UNT-A',2],['UNT-C',3]]);
});

test('fixed test worker ignores attacker body and cannot expose dynamic SQL or public RPC',async()=>{
  const before={categories:await categoryRows(),units:await unitRows()};
  assert.equal((await call('/__m03_status__/unknown')).status,404);
  assert.equal((await call('/__m03_status__/activate-category',undefined,'GET')).status,405);
  assert.deepEqual(await call('/__m03_status__/activate-category',{
    sheet:'SETTINGS',sourceId:'ATTACKER',status:'Inactive',sql:'DROP TABLE parties'
  }),{status:200,body:{success:true,data:{id:'CAT-A',status:'Active'}}});
  assert.deepEqual({categories:await categoryRows(),units:await unitRows()},before);
  const config=JSON.parse(readFileSync(new URL(
    '../../wrangler.m03-product-status-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.assets,undefined);
  assert.equal(config.main,'tests/fixtures/m03-product-status-worker.mjs');
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000097');
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m03-product-status'),false);
  assert.equal(live.includes('setCategoryStatus_'),false);
});
