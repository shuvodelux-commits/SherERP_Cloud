import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceExpenseCategoriesWithD1} from '../../src/db/expense-category-source-import.js';
import {summarizeM10Catalog} from '../../src/migration/m10-catalog-digest.js';

const inventory=JSON.parse(readFileSync(
  new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-expense-categories-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-expense-categories-import-local-only');
let DB;
const source=()=>[
  {'Category ID':'EXCAT-001','Category Name':'দোকান ভাড়া','Description':'  মাসিক ভাড়া  ',
   Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-002','Category Name':'দোকান ভাড়া','Description':'',
   Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-003','Category Name':'বিদ্যুৎ বিল','Description':'ফি',
   Status:'','Created At':'2026-11-15T10:01:00.000Z',_rowIndex:4}
];
const digest=rows=>summarizeM10Catalog({inventory,sheetKey:'EXPENSE_CATEGORIES',rows});
async function readStored(){
  const response=await DB.prepare(
    'SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories ORDER BY legacy_sheet_row'
  ).all();
  assert.equal(response.success,true,'must query real local D1');
  assert.ok(Array.isArray(response.results));
  return response.results.map(row=>({
    'Category ID':row.category_id,'Category Name':row.category_name,
    Description:row.description,Status:row.status,'Created At':row.created_at,
    _rowIndex:row.legacy_sheet_row
  }));
}

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('M10 hashes independently supplied Expense Categories and actual imported D1 readback',async()=>{
  const original=source(),before=structuredClone(original);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM expense_categories').first()).n,0);
  const imported=await importSourceExpenseCategoriesWithD1({DB,sourceRows:original});
  assert.equal(imported.reconciled,true);
  assert.equal(imported.importedRows,3);
  const persisted=await readStored();
  assert.notStrictEqual(persisted,original,'D1 readback must not alias original rows');
  assert.deepEqual(persisted,original,'original descriptions, positions, ID and dates survive');
  assert.deepEqual(digest(persisted),digest(original));
  assert.deepEqual(original,before);
});

test('direct SQL description drift changes entire-row digest but does not change legacy identity',async()=>{
  const base=digest(source());
  const updated=await DB.prepare('UPDATE expense_categories SET description=? WHERE category_id=?')
    .bind('Tampered description','EXCAT-002').run();
  assert.equal(updated.meta.changes,1);
  const after=digest(await readStored());
  assert.notEqual(after.rowDigest,base.rowDigest);
  assert.equal(after.idDigest,base.idDigest);
});

test('direct SQL original-ID drift changes original-ID digest even with same human-readable name',async()=>{
  const base=digest(source());
  const updated=await DB.prepare('UPDATE expense_categories SET category_id=? WHERE category_id=?')
    .bind('EXCAT-099','EXCAT-001').run();
  assert.equal(updated.meta.changes,1);
  const after=digest(await readStored());
  assert.notEqual(after.idDigest,base.idDigest);
  assert.notEqual(after.rowDigest,base.rowDigest);
});

test('deleting a persisted original source row cannot be silently treated as parity',async()=>{
  const result=await DB.prepare('DELETE FROM expense_categories WHERE category_id=?')
    .bind('EXCAT-003').run();
  assert.equal(result.meta.changes,1);
  assert.equal((await readStored()).length,2);
  const persisted=await readStored();
  const fromD1=digest(persisted),fromSource=digest(source());
  assert.equal(fromD1.rowCount,2);
  assert.equal(fromSource.rowCount,3);
  assert.notEqual(fromD1.rowDigest,fromSource.rowDigest);
  assert.notEqual(fromD1.idDigest,fromSource.idDigest);
});

test('isolated Workerd fixture exposes no source, D1, import or public RPC route',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m10__/expense-snapshot']){
    const response=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});
