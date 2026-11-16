import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {summarizeM10InvoiceEditAudit} from '../src/migration/m10-invoice-edit-audit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const rows=()=>[
  {'Log ID':'IEL-001','Invoice ID':'INV-01','Edit Date':'2026-11-16T11:00Z',
    Reason:'  রিটার্ন সম্পাদনা  ','Before Grand Total':'','After Grand Total':'',
    'Return ID':'SRT-01','Before Return Amount':12.5,'After Return Amount':'13.50',
    'Before Return Items JSON':' [{"qty":1,"unit":"Pcs"}] ',
    'After Return Items JSON':' [{"qty":2,"unit":"Pcs"}] ',
    'Edited By':'মিনা',_rowIndex:2},
  {'Log ID':'IEL-002','Invoice ID':'INV-01','Edit Date':'2026-11-16T11:10Z',
    Reason:'  রিটার্ন সম্পাদনা  ','Before Grand Total':'100.00','After Grand Total':99.5,
    'Return ID':'SRT-01','Before Return Amount':'13.50','After Return Amount':14,
    'Before Return Items JSON':' [{"unit":"Pcs","qty":2}] ',
    'After Return Items JSON':'[{"unit":"Pcs","qty":3}]',
    'Edited By':'মিনা',_rowIndex:3}
];
const evidence=sourceRows=>summarizeM10InvoiceEditAudit({inventory,rows:sourceRows});
const fixed=error=>error instanceof Error&&error.message==='M10 INVOICE_EDIT_LOG evidence invalid';

test('true original Log IDs and exact twelve source headers drive independent M10 SHA256',()=>{
  const source=rows(),copy=structuredClone(source);
  const sourceContent=[
    [2,'IEL-001','INV-01','2026-11-16T11:00Z','  রিটার্ন সম্পাদনা  ','','',
      'SRT-01','12.5','13.50',' [{"qty":1,"unit":"Pcs"}] ',
      ' [{"qty":2,"unit":"Pcs"}] ','মিনা'],
    [3,'IEL-002','INV-01','2026-11-16T11:10Z','  রিটার্ন সম্পাদনা  ',
      '100.00','99.5','SRT-01','13.50','14',' [{"unit":"Pcs","qty":2}] ',
      '[{"unit":"Pcs","qty":3}]','মিনা']
  ];
  assert.deepEqual(evidence(source),{
    sheetKey:'INVOICE_EDIT_LOG',rowCount:2,
    rowDigest:sha(['M10-ROW-v1','INVOICE_EDIT_LOG',sourceContent]),
    idDigest:sha(['M10-ID-v1','INVOICE_EDIT_LOG',[[2,'IEL-001'],[3,'IEL-002']]])
  });
  assert.deepEqual(source,copy,'source export snapshots must not be mutated');
  const result=JSON.stringify(evidence(source));
  assert.equal(result.includes('INV-01'),false);
  assert.equal(result.includes('রিটার্ন সম্পাদনা'),false);
  assert.equal(result.includes('IEL-001'),false);
});

test('property insertion order never changes the original ID or full-row digests',()=>{
  const reordered=rows().map(r=>Object.fromEntries(Object.entries(r).reverse()));
  assert.deepEqual(evidence(reordered),evidence(rows()));
});

test('native Edit Date normalizes to ISO; original string text never changes implicitly',()=>{
  const native=rows();native[0]['Edit Date']=new Date('2026-11-16T11:00:00Z');
  const iso=rows();iso[0]['Edit Date']='2026-11-16T11:00:00.000Z';
  assert.deepEqual(evidence(native),evidence(iso));
  assert.notEqual(evidence(native).rowDigest,evidence(rows()).rowDigest);
});

test('money source TEXT precision, original JSON formatting and Unicode only change row hash',()=>{
  const before=evidence(rows());
  for(const [i,key,value] of [
    [0,'Before Return Amount','12.50'],
    [1,'Before Grand Total','100'],
    [1,'After Grand Total','99.50'],
    [1,'After Return Amount','14.00'],
    [0,'Before Return Items JSON','[{"qty":1,"unit":"Pcs"}]'],
    [1,'After Return Items JSON','[{"qty":3,"unit":"Pcs"}]'],
    [0,'Reason',' রিটার্ন সম্পাদনা  '],
    [0,'Edited By','অন্য'],
    [0,'Return ID','SRT-02']
  ]){
    const altered=rows();altered[i][key]=value;
    const result=evidence(altered);
    assert.notEqual(result.rowDigest,before.rowDigest,key);
    assert.equal(result.idDigest,before.idDigest,key);
  }
});

test('changing authentic Log ID changes row and ID digests, duplicate invoice ID is allowed',()=>{
  const source=rows();source[1]['Log ID']='IEL-NEW';
  const before=evidence(rows()),after=evidence(source);
  assert.notEqual(after.idDigest,before.idDigest);
  assert.notEqual(after.rowDigest,before.rowDigest);
});

test('internally valid shortened capture is measurable drift, not an invalid snapshot',()=>{
  const full=evidence(rows()),short=evidence(rows().slice(0,1));
  assert.equal(short.rowCount,1);
  assert.notEqual(short.rowDigest,full.rowDigest);
  assert.notEqual(short.idDigest,full.idDigest);
});

test('duplicate Log IDs, gaps, invalid source types, malformed Dates, accessors and symbols fail closed',()=>{
  const samples=[
    [],rows().slice().reverse(),[rows()[0],{...rows()[1],_rowIndex:4}],
    [rows()[0],{...rows()[1],'Log ID':'IEL-001'}],
    [{...rows()[0],'Log ID':' '},rows()[1]],
    [{...rows()[0],'Before Return Amount':Infinity},rows()[1]],
    [{...rows()[0],'After Grand Total':NaN},rows()[1]],
    [{...rows()[0],'Before Return Items JSON':{}},rows()[1]],
    [{...rows()[0],'Edit Date':new Date('wrong')},rows()[1]],
    [{...rows()[0],Private:'SECRET_ACCOUNT'},rows()[1]]
  ];
  for(const source of samples)assert.throws(()=>evidence(source),fixed);
  const getter=rows();
  Object.defineProperty(getter[0],'Reason',{enumerable:true,get(){throw new Error('PRIVATE_REASON')}});
  assert.throws(()=>evidence(getter),fixed);
  const symbol=rows();symbol[0][Symbol('secret')]='secret';
  assert.throws(()=>evidence(symbol),fixed);
});

test('frozen 49 source group inventory, exact headers and uniqueness are required',()=>{
  const missing=structuredClone(inventory);missing.tables.pop();
  assert.throws(()=>summarizeM10InvoiceEditAudit({inventory:missing,rows:rows()}),fixed);
  const drift=structuredClone(inventory);
  drift.tables.find(x=>x.sheetKey==='INVOICE_EDIT_LOG').columns.push('Unreviewed column');
  assert.throws(()=>summarizeM10InvoiceEditAudit({inventory:drift,rows:rows()}),fixed);
  const duplicate=structuredClone(inventory);
  duplicate.tables[0].sheetKey=duplicate.tables[1].sheetKey;
  assert.throws(()=>summarizeM10InvoiceEditAudit({inventory:duplicate,rows:rows()}),fixed);
});
