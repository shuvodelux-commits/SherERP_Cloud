import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceProductCategoriesWithD1} from '../../src/db/product-category-source-import.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';
import {createGuardedCatalogUpdateAdapter} from '../../src/db/legacy-catalog-update.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-categories-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-categories-import-local-only');
let DB;
const source=()=>[
  {'Category ID':'CAT-SRC-001','Category Name':'ইলেকট্রিক',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'CAT-SRC-002','Category Name':'ইলেকট্রিক',Status:'Inactive',
    'Created At':'',_rowIndex:3},
  {'Category ID':'CAT-SRC-003','Category Name':'Hardware',Status:'Active',
    'Created At':'',_rowIndex:4}
];
const count=async()=> (await DB.prepare('SELECT COUNT(*) AS n FROM product_categories').first()).n;
const saved=async()=> (await DB.prepare(`SELECT legacy_sheet_row,category_id,category_name,status,created_at
  FROM product_categories ORDER BY legacy_sheet_row ASC`).all()).results;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('invalid whole-source Category snapshots fail before any local D1 write',async()=>{
  const all=source();
  const bad=[
    [],[all[2],all[0],all[1]],
    [{...all[0],_rowIndex:3},all[1],all[2]],
    [all[0],{...all[1],'Category ID':all[0]['Category ID']},all[2]],
    [all[0],all[1],{...all[2],Status:'Archived'}],
    [all[0],{...all[1],'Internal Token':'private'},all[2]],
    [all[0],all[1],{...all[2],'Category Name':{toString(){throw new Error('source leak');}}}]
  ];
  for(const rows of bad){
    await assert.rejects(()=>importSourceProductCategoriesWithD1({DB,sourceRows:rows}),
      /invalid|source|category|row|duplicate|status/i);
    assert.equal(await count(),0);
  }
});

test('second-row failed D1 INSERT aborts all category rows without partial import',async()=>{
  await DB.prepare(`CREATE TRIGGER m02_category_late_failure
    BEFORE INSERT ON product_categories
    WHEN NEW.category_id='CAT-SRC-002'
    BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END`).run();
  try{
    await assert.rejects(()=>importSourceProductCategoriesWithD1({DB,sourceRows:source()}),
      /D1|failed|import/i);
    assert.equal(await count(),0);
  }finally{
    await DB.prepare('DROP TRIGGER m02_category_late_failure').run();
  }
});

test('concurrent same-snapshot import has exactly one winner; original source IDs and duplicate names survive',async()=>{
  const input=source(),original=JSON.stringify(input);
  const outcome=await Promise.allSettled([
    importSourceProductCategoriesWithD1({DB,sourceRows:input}),
    importSourceProductCategoriesWithD1({DB,sourceRows:source()})
  ]);
  assert.deepEqual(outcome.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(outcome.find(x=>x.status==='fulfilled').value,{
    sourceGroup:'PRODUCT_CATEGORIES',importedRows:3,reconciled:true
  });
  assert.equal(JSON.stringify(input),original);
  assert.equal(await count(),3);
  assert.deepEqual(await saved(),[
    {legacy_sheet_row:2,category_id:'CAT-SRC-001',category_name:'ইলেকট্রিক',
      status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,category_id:'CAT-SRC-002',category_name:'ইলেকট্রিক',
      status:'Inactive',created_at:''},
    {legacy_sheet_row:4,category_id:'CAT-SRC-003',category_name:'Hardware',
      status:'Active',created_at:''}
  ]);
});

test('awaited source-shaped reader and guarded category CAS operate on persisted original IDs',async()=>{
  const reader=createLegacyCatalogReadAdapter({DB});
  assert.deepEqual(await reader.getAllRows_('PRODUCT_CATEGORIES'),source());
  const writer=createGuardedCatalogUpdateAdapter({DB});
  await writer.updateRowFields_('PRODUCT_CATEGORIES',3,{'Category Name':'বৈদ্যুতিক'},{
    sourceId:'CAT-SRC-002',name:'ইলেকট্রিক',status:'Inactive'
  });
  assert.equal((await reader.getAllRows_('PRODUCT_CATEGORIES'))[1]['Category Name'],'বৈদ্যুতিক');
  await assert.rejects(()=>writer.updateRowFields_('PRODUCT_CATEGORIES',3,
    {'Category Name':'forged'},{
      sourceId:'CAT-SRC-002',name:'ইলেকট্রিক',status:'Inactive'
    }),/stale|refused|precondition/i);
  assert.equal((await saved())[1].category_name,'বৈদ্যুতিক');
  assert.equal((await saved())[0].category_name,'ইলেকট্রিক');
});

test('replay and changed snapshot cannot import into nonempty categories table',async()=>{
  const before=await saved();
  await assert.rejects(()=>importSourceProductCategoriesWithD1({DB,sourceRows:source()}),
    /D1|failed|import/i);
  const change=source();change[0]['Category ID']='CAT-NEW-001';
  await assert.rejects(()=>importSourceProductCategoriesWithD1({DB,sourceRows:change}),
    /D1|failed|import/i);
  assert.deepEqual(await saved(),before);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM product_units').first()).n,0);
});

test('test-only local Worker has no source import HTTP route or public RPC',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/categories-import','/api/health']){
    const reply=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(reply.status,404);
  }
  assert.equal(await count(),3);
});
