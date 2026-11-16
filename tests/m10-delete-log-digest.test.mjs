import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {summarizeM10DeleteLog} from '../src/migration/m10-delete-log-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const hash=record=>createHash('sha256').update(JSON.stringify(record),'utf8').digest('hex');
const sample=()=>[
  {'Log ID':'DEL-001',Date:'2026-11-15',Time:'12:30',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-001','Deleted By Mobile':'01700000009',_rowIndex:2},
  {'Log ID':'DEL-002',Date:'2026-11-15',Time:'12:30',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-001','Deleted By Mobile':'01700000009',_rowIndex:3},
  {'Log ID':'DEL-003',Date:'',Time:'',Module:'PURCHASE',
    'Record ID':'', 'Invoice No':'',Reason:'',
    'Deleted By':'', 'Deleted By Mobile':'',_rowIndex:4}
];
const digest=rows=>summarizeM10DeleteLog({inventory,rows});
const fixed=e=>e instanceof Error&&e.message==='M10 DELETE_LOG evidence invalid';

test('M10 DELETE_LOG hashes exact nine original source columns and distinct genuine Log IDs',()=>{
  const rows=sample(),original=structuredClone(rows);
  const actual=digest(rows);
  const expectedRows=[
    [2,'DEL-001','2026-11-15','12:30','SALES','INV-1','INV-1','  ভুল বিক্রয়  ','STAFF-001','01700000009'],
    [3,'DEL-002','2026-11-15','12:30','SALES','INV-1','INV-1','  ভুল বিক্রয়  ','STAFF-001','01700000009'],
    [4,'DEL-003','','','PURCHASE','','','','','']
  ];
  const expectedIDs=[[2,'DEL-001'],[3,'DEL-002'],[4,'DEL-003']];
  assert.deepEqual(actual,{
    sheetKey:'DELETE_LOG',rowCount:3,
    rowDigest:hash(['M10-ROW-v1','DELETE_LOG',expectedRows]),
    idDigest:hash(['M10-ID-v1','DELETE_LOG',expectedIDs])
  });
  assert.deepEqual(rows,original);
  assert.equal(JSON.stringify(actual).includes('01700000009'),false);
  assert.equal(JSON.stringify(actual).includes('INV-1'),false);
  assert.equal(Object.hasOwn(actual,'positionDigest'),false,'DELETE_LOG has authentic Log IDs');
});

test('original key insertion order is irrelevant to canonical row and ID checksum',()=>{
  const original=digest(sample());
  const rekeyed=sample().map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(digest(rekeyed),original);
});

test('changing reason, module, invoice or leading-zero mobile changes row digest only',()=>{
  const baseline=digest(sample());
  for(const [index,field,value] of [
    [0,'Reason',' ভুল বিক্রয়  '],
    [0,'Module','PURCHASE'],
    [1,'Invoice No','INV-NEW'],
    [0,'Deleted By Mobile','1700000009'],
    [2,'Date','2026-11-16']
  ]){
    const src=sample();
    src[index][field]=value;
    const changed=digest(src);
    assert.notEqual(changed.rowDigest,baseline.rowDigest,field);
    assert.equal(changed.idDigest,baseline.idDigest,field);
  }
});

test('original Log ID alteration changes both source-position-bound ID and full row digest',()=>{
  const original=digest(sample()),rows=sample();
  rows[1]['Log ID']='DEL-099';
  const changed=digest(rows);
  assert.notEqual(changed.idDigest,original.idDigest);
  assert.notEqual(changed.rowDigest,original.rowDigest);
});

test('short but valid source snapshot differs in count and both digests',()=>{
  const full=digest(sample()),truncated=digest(sample().slice(0,2));
  assert.equal(truncated.rowCount,2);
  assert.notEqual(truncated.rowDigest,full.rowDigest);
  assert.notEqual(truncated.idDigest,full.idDigest);
});

test('malformed rows, duplicate IDs, unsafe types and getters fail closed without leaking values',()=>{
  const bad=[
    [],sample().slice().reverse(),
    sample().map((r,i)=>i===1?{...r,_rowIndex:5}:r),
    sample().map((r,i)=>i===1?{...r,'Log ID':'DEL-001'}:r),
    sample().map((r,i)=>i===1?{...r,'Log ID':'   '}:r),
    sample().map((r,i)=>i===1?{...r,Reason:null}:r),
    sample().map((r,i)=>i===1?{...r,'Deleted By Mobile':1700000009}:r),
    sample().map((r,i)=>i===1?{...r,HiddenSecret:'PRIVATE_BANK_ACCOUNT'}:r)
  ];
  for(const rows of bad) assert.throws(()=>digest(rows),fixed);
  const sneaky=sample();
  Object.defineProperty(sneaky[0],'Reason',{
    enumerable:true,get(){throw new Error('PRIVATE_SOURCE_REASON');}
  });
  assert.throws(()=>digest(sneaky),fixed);
  const symbol=sample();symbol[0][Symbol('PRIVATE')]='BANK-SECRET';
  assert.throws(()=>digest(symbol),fixed);
});

test('unreviewed inventory and changed frozen DELETE_LOG headers fail closed',()=>{
  const short=structuredClone(inventory);short.tables.pop();
  assert.throws(()=>summarizeM10DeleteLog({inventory:short,rows:sample()}),fixed);
  const changed=structuredClone(inventory);
  changed.tables.find(x=>x.sheetKey==='DELETE_LOG').columns.push('Private Field');
  assert.throws(()=>summarizeM10DeleteLog({inventory:changed,rows:sample()}),fixed);
  assert.throws(()=>summarizeM10DeleteLog({inventory,rows:undefined}),fixed);
});
