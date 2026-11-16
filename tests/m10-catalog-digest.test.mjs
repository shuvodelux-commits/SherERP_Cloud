import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeM10Catalog} from '../src/migration/m10-catalog-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const categories=()=>[
  {'Category ID':'CAT-000001','Category Name':'ইলেকট্রিক',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'CAT-000002','Category Name':'ইলেকট্রিক',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];
const units=()=>[
  {'Unit ID':'UNT-000001','Unit Name':'গিরা',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Unit ID':'UNT-000002','Unit Name':'Feet',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];
const summary=(sheetKey,rows)=>summarizeM10Catalog({inventory,sheetKey,rows});
const equal=(a,b)=>{assert.equal(a.rowCount,b.rowCount);assert.ok(a.rowDigest===b.rowDigest,'source and target rows differ');assert.ok(a.idDigest===b.idDigest,'source IDs differ')};

test('catalog digest returns only M10 summary fields, deterministic hashes and exact original source counts',()=>{
  for(const [sheetKey,rows] of [['PRODUCT_CATEGORIES',categories()],['PRODUCT_UNITS',units()]]){
    const first=summary(sheetKey,rows),second=summary(sheetKey,structuredClone(rows));
    assert.deepEqual(Object.keys(first).sort(),['idDigest','rowCount','rowDigest','sheetKey']);
    assert.equal(first.sheetKey,sheetKey);
    assert.equal(first.rowCount,2);
    assert.match(first.rowDigest,/^[0-9a-f]{64}$/);
    assert.match(first.idDigest,/^[0-9a-f]{64}$/);
    equal(first,second);
  }
});

test('source object key insertion order does not alter stable original column-order encoding',()=>{
  const rows=categories();
  const rekey=rows.map(row=>Object.fromEntries(Object.entries(row).reverse()));
  equal(summary('PRODUCT_CATEGORIES',rows),summary('PRODUCT_CATEGORIES',rekey));
});

test('source Date and its exact UTC ISO string yield the same persisted data digest',()=>{
  const date=units();
  date[0]['Created At']=new Date('2026-11-15T10:00:00.000Z');
  equal(summary('PRODUCT_UNITS',date),summary('PRODUCT_UNITS',units()));
});

test('single-cell name, status, time, original ID and physical row drift cannot hide behind row counts',()=>{
  const original=summary('PRODUCT_CATEGORIES',categories());
  for(const [field,newValue,changesId] of [
    ['Category Name','ইলেকট্রিক ',false],
    ['Status','',false],
    ['Created At','2026-11-15T10:00:01.000Z',false],
    ['Category ID','CAT-000003',true]
  ]){
    const changed=categories();changed[0][field]=newValue;
    const next=summary('PRODUCT_CATEGORIES',changed);
    assert.equal(next.rowCount,original.rowCount);
    assert.ok(next.rowDigest!==original.rowDigest,field);
    assert.equal(next.idDigest!==original.idDigest,changesId,field);
  }
  const swapped=categories();swapped.reverse();
  assert.throws(()=>summary('PRODUCT_CATEGORIES',swapped),/M10 catalog digest invalid/);
});

test('leading-zero source IDs and distinct record order are preserved, not numerically coerced',()=>{
  const base=summary('PRODUCT_UNITS',units());
  const rows=units();
  rows[0]['Unit ID']='UNT-1';
  assert.ok(summary('PRODUCT_UNITS',rows).idDigest!==base.idDigest);
  assert.ok(summary('PRODUCT_UNITS',rows).rowDigest!==base.rowDigest);
  const rowPosition=units();rowPosition[1]._rowIndex=4;
  assert.throws(()=>summary('PRODUCT_UNITS',rowPosition),/M10 catalog digest invalid/);
});

test('duplicate original IDs, malformed and unreviewed fields fail closed with a fixed redacted error',()=>{
  const invalid=[
    {sheetKey:'PRODUCT_UNITS',rows:[units()[0],{...units()[1],'Unit ID':'UNT-000001'}]},
    {sheetKey:'PRODUCT_UNITS',rows:[{...units()[0],'Unit Name':{secret:'PRIVATE_VALUE'}},units()[1]]},
    {sheetKey:'PRODUCT_CATEGORIES',rows:[{...categories()[0],'Sensitive Token':'PRIVATE_VALUE'},categories()[1]]},
    {sheetKey:'PRODUCT_CATEGORIES',rows:[{...categories()[0],_rowIndex:999},categories()[1]]},
    {sheetKey:'PRODUCT_CATEGORIES',rows:[]},
    {sheetKey:'SALES',rows:categories()},
    {sheetKey:'PRODUCT_UNITS',rows:undefined},
    {sheetKey:'PRODUCT_CATEGORIES',rows:[{...categories()[0],'Created At':new Date('bad')},categories()[1]]}
  ];
  for(const x of invalid){
    assert.throws(()=>summary(x.sheetKey,x.rows),
      e=>e.message==='M10 catalog digest invalid'&&!/PRIVATE|CAT-000|UNT-000/.test(e.message));
  }
  const tamperedInventory=structuredClone(inventory);
  tamperedInventory.tables.find(x=>x.sheetKey==='PRODUCT_UNITS').columns.push('New Secret');
  assert.throws(()=>summarizeM10Catalog({inventory:tamperedInventory,sheetKey:'PRODUCT_UNITS',rows:units()}),
    /M10 catalog digest invalid/);
});

test('source input remains unchanged and outputs do not contain raw IDs, labels or values',()=>{
  const source=units(),before=structuredClone(source);
  const output=summary('PRODUCT_UNITS',source);
  assert.deepEqual(source,before);
  assert.doesNotMatch(JSON.stringify(output),/UNT-000001|গিরা|Created At|PRIVATE_VALUE/);
});
