import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeM10Catalog} from '../src/migration/m10-catalog-digest.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const digest=rows=>summarizeM10Catalog({inventory,sheetKey:'EXPENSE_CATEGORIES',rows});

const source=()=>[
  {'Category ID':'EXCAT-001','Category Name':'দোকান ভাড়া','Description':'  মাসিক ভাড়া  ',
    Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-002','Category Name':'দোকান ভাড়া','Description':'',
    Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-003','Category Name':'বিদ্যুৎ বিল','Description':'ফি',
    Status:'','Created At':'2026-11-15T10:01:00.000Z',_rowIndex:4}
];

test('M10 Expense Categories hashes frozen five source columns and original IDs in physical-row order',()=>{
  const s=source(),before=structuredClone(s);
  const d=digest(s);
  assert.deepEqual(d,{
    sheetKey:'EXPENSE_CATEGORIES',rowCount:3,
    rowDigest:'dd0aa0b76370c6a7f8d7daa5965c26c3dafaba62e4dec49dd7a9999d5f62c8b4',
    idDigest:'9827c6275e21d76baaaf351fdcca52ebf7d82f35502a30f08f899f772af5e296'
  });
  assert.deepEqual(s,before,'digest must never mutate original source rows');
});

test('source object field insertion order and UTC date representation cannot cause false D1 mismatch',()=>{
  const s=source(),expected=digest(s);
  const reordered=s.map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(digest(reordered),expected);
  const withDate=source();withDate[0]['Created At']=new Date('2026-11-15T10:00:00.000Z');
  assert.deepEqual(digest(withDate),expected);
});

test('description content, blank status and whitespace changes affect rows but not original-ID checksum',()=>{
  const before=digest(source());
  for(const [row,field,value] of [
    [0,'Description',' মাসিক ভাড়া  '],
    [1,'Description','fee'],
    [2,'Status','Active'],
    [0,'Category Name','দোকান ভাড়া '],
    [2,'Created At','2026-11-15T10:01:01.000Z']
  ]){
    const s=source();s[row][field]=value;
    const result=digest(s);
    assert.equal(result.rowCount,3);
    assert.notEqual(result.rowDigest,before.rowDigest,field);
    assert.equal(result.idDigest,before.idDigest,field);
  }
});

test('changing original Expense Category ID affects both digests even when category labels are identical',()=>{
  const before=digest(source()),s=source();
  s[1]['Category ID']='EXCAT-099';
  const after=digest(s);
  assert.notEqual(after.rowDigest,before.rowDigest);
  assert.notEqual(after.idDigest,before.idDigest);
});

test('duplicate original IDs, missing rows, wrong positions and non-source fields fail closed',()=>{
  const bad=[
    [],
    source().slice().reverse(),
    source().slice(0,2),
    source().map((r,i)=>i===1?{...r,_rowIndex:5}:r),
    source().map((r,i)=>i===1?{...r,'Category ID':'EXCAT-001'}:r),
    source().map((r,i)=>i===1?{...r,'Description':null}:r),
    source().map((r,i)=>i===1?{...r,'Created At':new Date('invalid')}:r),
    source().map((r,i)=>i===1?{...r,privateToken:'PRIVATE_LEDGER'}:r)
  ];
  for(const rows of bad)
    assert.throws(()=>digest(rows),e=>e.message==='M10 catalog digest invalid' &&
      !/PRIVATE_LEDGER|EXCAT-/.test(e.message));
});

test('source getter must not execute or leak a private expense description',()=>{
  const s=source();
  Object.defineProperty(s[0],'Description',{
    enumerable:true,get(){throw Error('PRIVATE_EXPENSE_DESCRIPTION');}
  });
  assert.throws(()=>digest(s),e=>e.message==='M10 catalog digest invalid' &&
    !e.message.includes('PRIVATE_EXPENSE_DESCRIPTION'));
});

test('frozen Config.gs Expense Categories headers cannot silently gain an unmapped field',()=>{
  const tampered=structuredClone(inventory);
  tampered.tables.find(t=>t.sheetKey==='EXPENSE_CATEGORIES').columns.push('Hidden Legacy Field');
  assert.throws(()=>summarizeM10Catalog({
    inventory:tampered,sheetKey:'EXPENSE_CATEGORIES',rows:source()
  }),e=>e.message==='M10 catalog digest invalid');
});

test('unchanged Product Category and Product Unit digest contracts still remain independently selectable',()=>{
  for(const group of ['PRODUCT_CATEGORIES','PRODUCT_UNITS']){
    const src=group==='PRODUCT_CATEGORIES'
      ? [{'Category ID':'CAT-X','Category Name':'Hardware',Status:'Active','Created At':'',_rowIndex:2}]
      : [{'Unit ID':'UNT-X','Unit Name':'Pcs',Status:'Active','Created At':'',_rowIndex:2}];
    const value=summarizeM10Catalog({inventory,sheetKey:group,rows:src});
    assert.equal(value.sheetKey,group);
    assert.equal(value.rowCount,1);
    assert.match(value.rowDigest,/^[0-9a-f]{64}$/);
    assert.match(value.idDigest,/^[0-9a-f]{64}$/);
  }
});
