import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceExpenseCategoriesWithD1} from '../../src/db/expense-category-source-import.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-expense-categories-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-expense-categories-import-local-only');
let DB;
const sample=()=>[
  {'Category ID':'EXCAT-1','Category Name':'দোকান ভাড়া','Description':'  মাসিক ভাড়া  ',
   Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-2','Category Name':'দোকান ভাড়া','Description':'',
   Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-3','Category Name':'বিদ্যুৎ বিল','Description':'ফি',
   Status:'','Created At':'',_rowIndex:4}
];
const count=async()=> (await DB.prepare('SELECT COUNT(*) AS n FROM expense_categories').first()).n;
const saved=async()=> (await DB.prepare('SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories ORDER BY legacy_sheet_row').all()).results;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('source preflight rejects invalid snapshots without ever writing to local D1',async()=>{
  const s=sample();
  for(const rows of [
    [],[s[2],s[0],s[1]],
    [s[0],{...s[1],'Category ID':s[0]['Category ID']},s[2]],
    [s[0],{...s[1],Status:'DELETED'},s[2]],
    [s[0],{...s[1],Secret:'no'},s[2]]
  ]){
    await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:rows}),/source|invalid|duplicate/i);
    assert.equal(await count(),0);
  }
});

test('late-row SQL failure atomically rolls back entire expense-category batch',async()=>{
  await DB.prepare("CREATE TRIGGER m02_expense_late_failure BEFORE INSERT ON expense_categories WHEN NEW.category_id='EXCAT-2' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").run();
  try {
    await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:sample()}),/D1|failed|import/i);
    assert.equal(await count(),0);
  }finally{
    await DB.prepare('DROP TRIGGER m02_expense_late_failure').run();
  }
});

test('only one concurrent import wins, source IDs, identical labels and values survive full D1 readback',async()=>{
  const input=sample(),before=JSON.stringify(input);
  const outcomes=await Promise.allSettled([
    importSourceExpenseCategoriesWithD1({DB,sourceRows:input}),
    importSourceExpenseCategoriesWithD1({DB,sourceRows:sample()})
  ]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value,{
    sourceGroup:'EXPENSE_CATEGORIES',importedRows:3,reconciled:true
  });
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(await saved(),[
    {legacy_sheet_row:2,category_id:'EXCAT-1',category_name:'দোকান ভাড়া',
     description:'  মাসিক ভাড়া  ',status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,category_id:'EXCAT-2',category_name:'দোকান ভাড়া',
     description:'',status:'Inactive',created_at:''},
    {legacy_sheet_row:4,category_id:'EXCAT-3',category_name:'বিদ্যুৎ বিল',
     description:'ফি',status:'',created_at:''}
  ]);
});

test('same or changed snapshot replay cannot overwrite an existing D1 category',async()=>{
  const before=await saved();
  await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:sample()}),/D1|failed|import/i);
  const other=sample();other[0]['Category ID']='EXCAT-FORGED';
  await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:other}),/D1|failed|import/i);
  assert.deepEqual(await saved(),before);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM product_units').first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM parties').first()).n,0);
});

test('postcommit D1 readback mismatch is explicitly NEEDS_REVIEW, never an imagined rollback',async()=>{
  await DB.prepare('DELETE FROM expense_categories').run();
  await DB.prepare("CREATE TRIGGER m02_expense_readback_tamper AFTER INSERT ON expense_categories WHEN NEW.category_id='EXCAT-2' BEGIN UPDATE expense_categories SET description='changed' WHERE category_id='EXCAT-2'; END").run();
  try{
    await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:sample()}),/NEEDS_REVIEW/);
    assert.equal(await count(),3);
    assert.equal((await saved())[1].description,'changed');
  }finally{
    await DB.prepare('DROP TRIGGER m02_expense_readback_tamper').run();
  }
});

test('local-only Worker exposes no import, RPC or health endpoint',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m02_test__/expense-categories-import']){
    const response=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});
