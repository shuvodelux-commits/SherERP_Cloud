/**
 * M10 Run 6: real *local* Workerd D1, three existing operational M02 tables.
 * Only fabricated source rows; no public endpoints, customer data or remote D1.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {assessM10LocalD1ThreeGroup} from '../../src/migration/m10-local-d1-three-group-audit.js';
import {importSourceProductCategoriesWithD1} from '../../src/db/product-category-source-import.js';
import {importSourceProductUnitsWithD1} from '../../src/db/product-unit-source-import.js';
import {importSourceExpenseCategoriesWithD1} from '../../src/db/expense-category-source-import.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const fixture=()=>({
  PRODUCT_CATEGORIES:[
    {'Category ID':'CAT-M10-001','Category Name':'ইলেকট্রিক',Status:'Active','Created At':'2026-11-20T00:00:00.000Z',_rowIndex:2},
    {'Category ID':'CAT-M10-002','Category Name':'ইলেকট্রিক',Status:'Inactive','Created At':'',_rowIndex:3}
  ],
  PRODUCT_UNITS:[
    {'Unit ID':'UNT-M10-001','Unit Name':'গিরা',Status:'Active','Created At':'2026-11-20T00:00:00.000Z',_rowIndex:2},
    {'Unit ID':'UNT-M10-002','Unit Name':'Feet',Status:'Inactive','Created At':'',_rowIndex:3}
  ],
  EXPENSE_CATEGORIES:[
    {'Category ID':'EX-M10-001','Category Name':'মাসিক',Description:'  ভাড়া  ',Status:'Active','Created At':'',_rowIndex:2},
    {'Category ID':'EX-M10-002','Category Name':'মাসিক',Description:'',Status:'Inactive','Created At':'2026-11-20T00:00:00.000Z',_rowIndex:3}
  ]
});
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-party-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-workerd-local-test');
let DB;
const audit=(sources=fixture(),binding=DB)=>assessM10LocalD1ThreeGroup({DB:binding,inventory,sourceRows:sources});
const reason=(result,code)=>result.issues.find(i=>i.code===code)?.count??0;
const n=table=>DB.prepare('SELECT COUNT(*) AS n FROM '+table).first().then(v=>v.n);
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('cold real migrated D1 rejects fabricated source as missing, never false parity',async()=>{
  const original=fixture();
  const r=await audit(original);
  assert.equal(r.candidateLocalReadbackParity,false);
  assert.equal(r.reviewedGroups,3);
  assert.equal(r.expectedRows,6);
  assert.equal(r.observedRows,0);
  assert.equal(reason(r,'MISSING_ROW'),6);
  assert.equal(r.authorizesRealImport,false);
  assert.equal(r.productionReady,false);
});

test('interrupted two-group import cannot masquerade as complete three-group D1 parity',async()=>{
  const original=fixture(),before=structuredClone(original);
  await importSourceProductCategoriesWithD1({DB,sourceRows:original.PRODUCT_CATEGORIES});
  await importSourceProductUnitsWithD1({DB,sourceRows:original.PRODUCT_UNITS});
  const r=await audit(original);
  assert.equal(r.candidateLocalReadbackParity,false);
  assert.equal(r.expectedRows,6);
  assert.equal(r.observedRows,4);
  assert.equal(reason(r,'MISSING_ROW'),2);
  assert.equal(r.authorizesCutover,false);
  assert.deepEqual(original,before);
  assert.deepEqual([await n('product_categories'),await n('product_units'),await n('expense_categories')],[2,2,0]);
});

test('existing M02 importers persist three exact original-ID/position groups on Workerd D1',async()=>{
  const source=fixture(),frozen=structuredClone(source);
  assert.deepEqual([await n('product_categories'),await n('product_units'),await n('expense_categories')],[2,2,0]);
  await importSourceExpenseCategoriesWithD1({DB,sourceRows:source.EXPENSE_CATEGORIES});
  assert.deepEqual(source,frozen);
  assert.deepEqual([await n('product_categories'),await n('product_units'),await n('expense_categories')],[2,2,2]);
});

test('one independent three-SELECT D1 batch returns parity with no public release authority',async()=>{
  const r=await audit();
  assert.deepEqual(r.issues,[]);
  assert.equal(r.candidateLocalReadbackParity,true);
  assert.equal(r.reviewedGroups,3);
  assert.equal(r.expectedRows,6);
  assert.equal(r.observedRows,6);
  assert.equal(r.readbackPerformed,true);
  assert.equal(r.authorizesRealImport,false);
  assert.equal(r.authorizesRemoteD1Write,false);
  assert.equal(r.authorizesCutover,false);
  assert.equal(r.productionReady,false);
  assert.doesNotMatch(JSON.stringify(r),/CAT-M10|UNT-M10|EX-M10|ইলেকট্রিক|ভাড়া|SELECT|sqlite|\/tmp\//);
});

test('readback issues exactly one bounded prepared SELECT batch and no D1 writes',async()=>{
  const sql=[];
  let batches=0;
  const bound={prepare(query){sql.push(query);return DB.prepare(query);},async batch(ops){batches++;return DB.batch(ops);}};
  const r=await audit(fixture(),bound);
  assert.equal(r.candidateLocalReadbackParity,true);
  assert.equal(batches,1);
  assert.equal(sql.length,3);
  assert.ok(sql.every(q=>/^SELECT\s/i.test(q.trim())));
  assert.ok(sql.every(q=>!/\b(?:INSERT|UPDATE|DELETE|DROP|JOIN|PRAGMA|ATTACH|DETACH|CREATE)\b/i.test(q)));
  assert.ok(sql.every(q=>/\bLIMIT\s+\?/i.test(q)));
});

test('same-snapshot import replay is refused and cannot double-count three groups',async()=>{
  const before=[await n('product_categories'),await n('product_units'),await n('expense_categories')];
  await assert.rejects(()=>importSourceProductCategoriesWithD1({DB,sourceRows:fixture().PRODUCT_CATEGORIES}));
  await assert.rejects(()=>importSourceProductUnitsWithD1({DB,sourceRows:fixture().PRODUCT_UNITS}));
  await assert.rejects(()=>importSourceExpenseCategoriesWithD1({DB,sourceRows:fixture().EXPENSE_CATEGORIES}));
  assert.deepEqual([await n('product_categories'),await n('product_units'),await n('expense_categories')],before);
  assert.equal((await audit()).candidateLocalReadbackParity,true);
});

test('one D1 Category label/status drift flags field mismatch without confusing source identity',async()=>{
  await DB.prepare("UPDATE product_categories SET category_name='Tampered',status='Active' WHERE category_id='CAT-M10-002'").run();
  try{
    const r=await audit();
    assert.equal(reason(r,'FIELD_MISMATCH'),1);
    assert.equal(reason(r,'SOURCE_ID_MISMATCH'),0);
    assert.equal(r.candidateLocalReadbackParity,false);
  }finally{
    await DB.prepare("UPDATE product_categories SET category_name='ইলেকট্রিক',status='Inactive' WHERE category_id='CAT-M10-002'").run();
  }
});

test('persisted Unit original source-ID drift is not a display-label match',async()=>{
  await DB.prepare("UPDATE product_units SET unit_id='UNT-M10-999' WHERE unit_id='UNT-M10-001'").run();
  try{
    const r=await audit();
    assert.equal(reason(r,'SOURCE_ID_MISMATCH'),1);
    assert.equal(r.candidateLocalReadbackParity,false);
  }finally{
    await DB.prepare("UPDATE product_units SET unit_id='UNT-M10-001' WHERE unit_id='UNT-M10-999'").run();
  }
});

test('a missing D1 Expense Category row cannot hide behind other two green groups',async()=>{
  await DB.prepare("DELETE FROM expense_categories WHERE category_id='EX-M10-002'").run();
  try{
    const r=await audit();
    assert.equal(reason(r,'MISSING_ROW'),1);
    assert.equal(r.observedRows,5);
    assert.equal(r.candidateLocalReadbackParity,false);
  }finally{
    await DB.prepare(`INSERT INTO expense_categories
      (legacy_sheet_row,category_id,category_name,description,status,created_at)
      VALUES(3,'EX-M10-002','মাসিক','','Inactive','2026-11-20T00:00:00.000Z')`).run();
  }
});

test('extra structurally valid row in any group blocks whole packet',async()=>{
  await DB.prepare(`INSERT INTO product_units
    (legacy_sheet_row,unit_id,unit_name,status,created_at)
    VALUES(4,'UNT-M10-EXTRA','New','Active','')`).run();
  try{
    const r=await audit();
    assert.equal(reason(r,'EXTRA_ROW'),1);
    assert.equal(r.observedRows,7);
    assert.equal(r.candidateLocalReadbackParity,false);
  }finally{
    await DB.prepare("DELETE FROM product_units WHERE unit_id='UNT-M10-EXTRA'").run();
  }
});

test('physical source position drift reports missing and unexpected positions',async()=>{
  await DB.prepare("UPDATE product_categories SET legacy_sheet_row=4 WHERE category_id='CAT-M10-002'").run();
  try{
    const r=await audit();
    assert.equal(reason(r,'MISSING_ROW'),1);
    assert.equal(reason(r,'EXTRA_ROW'),1);
    assert.equal(r.candidateLocalReadbackParity,false);
  }finally{
    await DB.prepare("UPDATE product_categories SET legacy_sheet_row=3 WHERE category_id='CAT-M10-002'").run();
  }
});

test('source evidence must be exactly three reviewed groups with no accessor execution',async()=>{
  const sources=fixture();
  const bad=[
    {...sources,UNKNOWN:[]},
    {PRODUCT_CATEGORIES:sources.PRODUCT_CATEGORIES},
    {...sources,PRODUCT_UNITS:[{...sources.PRODUCT_UNITS[0],_rowIndex:3},sources.PRODUCT_UNITS[1]]},
    {...sources,EXPENSE_CATEGORIES:[{...sources.EXPENSE_CATEGORIES[0],Description:{toString(){throw Error('SECRET');}}},sources.EXPENSE_CATEGORIES[1]]}
  ];
  for(const sourceRows of bad){
    const spy={prepare(){throw Error('SHOULD_NOT_TOUCH_DB')},batch(){throw Error('SHOULD_NOT_TOUCH_DB')}};
    await assert.rejects(()=>audit(sourceRows,spy),e=>e.message==='M10 local D1 three-group audit rejected');
  }
});

test('untrusted D1 success envelopes are rejected without leaking real driver details',async()=>{
  const binding={
    prepare(sql){return DB.prepare(sql);},
    async batch(statements){const rows=await DB.batch(statements);return rows.map((r,i)=>i===1?{...r,success:1}:r);}
  };
  await assert.rejects(()=>audit(fixture(),binding),
    e=>e.message==='M10 local D1 three-group audit rejected');
  await assert.rejects(()=>audit(fixture(),{prepare(){throw Error('PRIVATE SQL & IDs')}}),
    e=>e.message==='M10 local D1 three-group audit rejected');
});

test('all original source rows remain intact and synthetic Worker exposes no public import surface',async()=>{
  assert.equal((await audit()).candidateLocalReadbackParity,true);
  for(const path of ['/api/rpc','/__m10__/reconcile','/api/import']){
    const reply=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'
    });
    assert.equal(reply.status,404);
  }
});
