import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createLegacyCatalogReadAdapter}
  from '../../src/db/legacy-catalog-read.js';
import {importSourceExpenseCategoriesWithD1}
  from '../../src/db/expense-category-source-import.js';
import publicWorker from '../../src/index.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m02-expense-categories-test.jsonc'
}]});
const worker=server.getWorker('shererp-m02-expense-categories-import-local-only');
const rows=[
  {'Category ID':'EXCAT-1','Category Name':'দোকান ভাড়া',
   Description:'  মাসিক ভাড়া  ',Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-2','Category Name':'দোকান ভাড়া',
   Description:'',Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-3','Category Name':'বিদ্যুৎ বিল',
   Description:'ফি',Status:'','Created At':'',_rowIndex:4}
];
let DB;
const reader=()=>createLegacyCatalogReadAdapter({DB});
const count=async()=> (await DB.prepare('SELECT COUNT(*) AS n FROM expense_categories').first()).n;

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceExpenseCategoriesWithD1({DB,sourceRows:rows}),{
    sourceGroup:'EXPENSE_CATEGORIES',importedRows:3,reconciled:true
  });
});
after(async()=>server.close());

test('real Workerd+D1 returns exact frozen Expense Categories columns and original physical Sheet rows',async()=>{
  const output=await reader().getAllRows_('EXPENSE_CATEGORIES');
  assert.deepEqual(output,rows);
  assert.deepEqual(await reader().getSheetHeaders_('EXPENSE_CATEGORIES'),
    ['Category ID','Category Name','Description','Status','Created At']);
  assert.equal(output[1]['Category Name'],output[0]['Category Name'],
    'source duplicate labels must not be normalized or merged');
  assert.equal(output[1].Status,'Inactive');
  assert.equal(output[2].Status,'');
  assert.equal(await count(),3);
});

test('real D1 preserves original exact find and first physical match semantics',async()=>{
  const x=reader();
  assert.deepEqual(await x.findRows_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া'),
    rows.slice(0,2));
  assert.deepEqual(await x.findFirstRow_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া'),rows[0]);
  assert.equal(await x.findRowIndex_('EXPENSE_CATEGORIES','Category ID','EXCAT-2'),3);
  assert.deepEqual(await x.findRow_('EXPENSE_CATEGORIES','Category ID','EXCAT-3'),
    {row:rows[2],rowIndex:4});
  assert.equal(await x.findRowIndex_('EXPENSE_CATEGORIES','Category ID','missing'),-1);
  assert.equal(await x.findFirstRow_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া '),null);
});

test('new read is D1 read-only, original source rows still present and public route unavailable',async()=>{
  const x=reader();
  const sourceBefore=await DB.prepare('SELECT * FROM expense_categories ORDER BY legacy_sheet_row').all();
  await x.getAllRows_('EXPENSE_CATEGORIES');
  await x.findRows_('EXPENSE_CATEGORIES','Status','Inactive');
  const sourceAfter=await DB.prepare('SELECT * FROM expense_categories ORDER BY legacy_sheet_row').all();
  // D1 reports nondeterministic query timing for equivalent SELECT results.
  // Compare persisted records, never transport/query duration metadata.
  assert.deepEqual(sourceAfter.results,sourceBefore.results);
  assert.equal(sourceAfter.meta.changed_db,false);
  assert.equal(sourceAfter.meta.rows_written,0);
  for(const path of ['/api/rpc','/api/health','/__m03_test__/expense-categories']){
    assert.equal((await worker.fetch('http://expense-read.local'+path,{method:'POST'})).status,404);
  }
  const response=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{
      Origin:'https://erp.invalid','Content-Type':'application/json'
    },
    body:JSON.stringify({fnName:'getExpenseSettingsBootstrap',args:['a'.repeat(64)]})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(live.includes('legacy-catalog-read'),false);
  assert.equal(registry.includes('getExpenseSettingsBootstrap'),false);
  assert.equal(preview.d1_databases,undefined);
});

test('actual D1 refuses gapped or NULL legacy physical rows rather than misaddressing source records',async()=>{
  await DB.prepare("UPDATE expense_categories SET legacy_sheet_row=8 WHERE category_id='EXCAT-2'").run();
  try{
    await assert.rejects(()=>reader().getAllRows_('EXPENSE_CATEGORIES'),/legacy|physical|row/i);
    await assert.rejects(()=>reader().findRowIndex_('EXPENSE_CATEGORIES','Category ID','EXCAT-3'),/legacy|physical|row/i);
  }finally{
    await DB.prepare("UPDATE expense_categories SET legacy_sheet_row=3 WHERE category_id='EXCAT-2'").run();
  }
  await DB.prepare("UPDATE expense_categories SET legacy_sheet_row=NULL WHERE category_id='EXCAT-2'").run();
  try{
    await assert.rejects(()=>reader().getAllRows_('EXPENSE_CATEGORIES'),/legacy|physical|row/i);
  }finally{
    await DB.prepare("UPDATE expense_categories SET legacy_sheet_row=3 WHERE category_id='EXCAT-2'").run();
  }
  assert.deepEqual(await reader().getAllRows_('EXPENSE_CATEGORIES'),rows);
  assert.equal(await count(),3);
});
