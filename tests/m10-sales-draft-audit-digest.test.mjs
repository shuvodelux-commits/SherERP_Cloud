import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {summarizeM10SalesDraftAudit} from '../src/migration/m10-sales-draft-audit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const source=()=>[
  {'Audit ID':'AUD-001',Timestamp:'2026-11-16T10:00Z',Action:'CREATED',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:1,'Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-002',Timestamp:'2026-11-16T10:01Z',Action:'POST_CLEANUP_RETRY',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'02','Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'INV-1',Note:'  retry বাংলা  ',_rowIndex:3},
  {'Audit ID':'AUD-003',Timestamp:'',Action:'DELETED',
    'Draft ID':'DR-2','Draft No':'D-0002',Version:'3','Actor ID':'',
    'Actor Name':'','Source Owner ID':'','Invoice ID':'',Note:'',_rowIndex:4}
];
const digest=rows=>summarizeM10SalesDraftAudit({inventory,rows});
const failClosed=e=>e instanceof Error&&e.message==='M10 SALES_DRAFT_AUDIT evidence invalid';

test('M10 draft audit canonical SHA-256 preserves each authentic Audit ID and all eleven columns',()=>{
  const rows=source(),original=structuredClone(rows);
  const raw=[
    [2,'AUD-001','2026-11-16T10:00Z','CREATED','DR-1','D-0001','1','U-1','শুভ','U-1','',''],
    [3,'AUD-002','2026-11-16T10:01Z','POST_CLEANUP_RETRY','DR-1','D-0001','02','U-1','শুভ','U-1','INV-1','  retry বাংলা  '],
    [4,'AUD-003','','DELETED','DR-2','D-0002','3','','','','','']
  ];
  assert.deepEqual(digest(rows),{
    sheetKey:'SALES_DRAFT_AUDIT',rowCount:3,
    rowDigest:sha(['M10-ROW-v1','SALES_DRAFT_AUDIT',raw]),
    idDigest:sha(['M10-ID-v1','SALES_DRAFT_AUDIT',[[2,'AUD-001'],[3,'AUD-002'],[4,'AUD-003']]])
  });
  assert.deepEqual(rows,original);
  assert.equal(JSON.stringify(digest(rows)).includes('retry বাংলা'),false);
});

test('header insertion order is irrelevant, Date maps to ISO but source timestamp text is unchanged',()=>{
  const reordered=source().map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(digest(reordered),digest(source()));
  const dates=source();dates[0].Timestamp=new Date('2026-11-16T10:00:00.000Z');
  const normalized=source();normalized[0].Timestamp='2026-11-16T10:00:00.000Z';
  assert.deepEqual(digest(dates),digest(normalized));
  assert.notEqual(digest(dates).rowDigest,digest(source()).rowDigest,
    'original source timestamp text is not normalized unless it is Date');
});

test('leading zeros in Version and original whitespace in Note affect only full-row hash',()=>{
  const base=digest(source());
  for(const [index,key,value] of [
    [1,'Version','2'],[1,'Note',' retry বাংলা  '],
    [0,'Actor Name','নাম'],[1,'Action','UPDATED'],
    [1,'Invoice ID','INV-999'],[0,'Draft No','D-NEW']
  ]){
    const changed=source();changed[index][key]=value;
    const result=digest(changed);
    assert.notEqual(result.rowDigest,base.rowDigest,key);
    assert.equal(result.idDigest,base.idDigest,key);
  }
});

test('original Audit ID edit changes both hashes, even when Draft ID and Draft No are repeated',()=>{
  const before=digest(source()),changed=source();changed[1]['Audit ID']='AUD-099';
  const after=digest(changed);
  assert.notEqual(after.rowDigest,before.rowDigest);
  assert.notEqual(after.idDigest,before.idDigest);
});

test('truncated but internally valid source differs by row count and both hashes',()=>{
  const full=digest(source()),short=digest(source().slice(0,2));
  assert.equal(full.rowCount,3);
  assert.equal(short.rowCount,2);
  assert.notEqual(full.rowDigest,short.rowDigest);
  assert.notEqual(full.idDigest,short.idDigest);
});

test('duplicate Audit IDs, invalid rows, action, version, accessors and symbols fail redacted',()=>{
  const bad=[
    [],source().slice().reverse(),
    source().map((r,i)=>i===1?{...r,_rowIndex:4}:r),
    source().map((r,i)=>i===1?{...r,'Audit ID':'AUD-001'}:r),
    source().map((r,i)=>i===0?{...r,Action:'CANCELLED'}:r),
    source().map((r,i)=>i===0?{...r,Version:0}:r),
    source().map((r,i)=>i===1?{...r,Version:'00'}:r),
    source().map((r,i)=>i===1?{...r,Note:null}:r),
    source().map((r,i)=>i===1?{...r,Secret:'PRIVATE_ACCOUNT'}:r)
  ];
  for(const rows of bad)assert.throws(()=>digest(rows),failClosed);
  const getter=source();
  Object.defineProperty(getter[1],'Note',{enumerable:true,get(){throw Error('PRIVATE_NOTE')}});
  assert.throws(()=>digest(getter),failClosed);
  const symbol=source();symbol[0][Symbol('SECRET')]='PRIVATE';
  assert.throws(()=>digest(symbol),failClosed);
});

test('unreviewed or duplicated 49 source groups and changed frozen headers fail closed',()=>{
  const incomplete=structuredClone(inventory);incomplete.tables.pop();
  assert.throws(()=>summarizeM10SalesDraftAudit({inventory:incomplete,rows:source()}),failClosed);
  const duplicated=structuredClone(inventory);
  duplicated.tables[1].sheetKey=duplicated.tables[0].sheetKey;
  assert.throws(()=>summarizeM10SalesDraftAudit({inventory:duplicated,rows:source()}),failClosed);
  const changed=structuredClone(inventory);
  changed.tables.find(r=>r.sheetKey==='SALES_DRAFT_AUDIT').columns.push('Unreviewed Secret');
  assert.throws(()=>summarizeM10SalesDraftAudit({inventory:changed,rows:source()}),failClosed);
});
