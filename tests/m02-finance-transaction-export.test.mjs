import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFinanceTransactionExport} from '../src/party/finance-export-coverage.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sourceHeaders=()=>[...inventory.tables.find(t=>t.sheetKey==='FINANCE_TRANSACTIONS').columns];
const base=(id,position,options={})=>({
  ...Object.fromEntries(sourceHeaders().map(field=>[field,''])),
  'Finance ID':id,'Person ID':'FIN-001','Person':'Synthetic Name',
  'Transaction Type':'Owner Investment','Amount':'15.50',
  'Is Deleted':options.deleted?'TRUE':'FALSE',_rowIndex:position
});
function example(){
  const sourceRows=[
    base('FIN-TX-001',2),
    {...base('FIN-TX-002',3),'Transaction Type':'Loan Received',Amount:120.25},
    {...base('FIN-TX-003',4,{deleted:true}),Amount:''}
  ];
  return {sourceRows,sourceHeaders:sourceHeaders(),declaredRowCount:3};
}
const check=(arg=example())=>validateFinanceTransactionExport(arg);
const code=(r,name)=>r.issues.find(x=>x.code===name);

test('pinned Finance Transactions headers, three source records and audit metadata pass',()=>{
  const r=check();
  assert.equal(r.formatVersion,1);
  assert.equal(r.sourceGroup,'FINANCE_TRANSACTIONS');
  assert.equal(r.offlineExportComplete,true);
  assert.deepEqual(r.counts,{
    declaredRows:3,observedRows:3,headerIssues:0,missingFields:0,
    unexpectedFields:0,unsafeValues:0,missingIds:0,duplicateIds:0,
    missingPersonIds:0,duplicateSourceRows:0,invalidActiveAmounts:0
  });
  assert.deepEqual(r.issues,[]);
});
test('all original column names and order are source-pinned, not inferred from source rows',()=>{
  assert.equal(sourceHeaders().length,20);
  const src=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.ok(src.includes('FINANCE_TRANSACTIONS'));
  const a=example();a.sourceHeaders.reverse();
  assert.equal(code(check(a),'HEADER_MISMATCH').count,1);
});
test('lost source header fails despite every raw row still containing that field',()=>{
  const a=example();a.sourceHeaders=a.sourceHeaders.filter(h=>h!=='Amount');
  assert.equal(check(a).offlineExportComplete,false);
  assert.equal(code(check(a),'HEADER_MISMATCH').count,1);
});
test('duplicate or extra Finance header fails even on zero rows',()=>{
  for(const extra of ['Finance ID','Future Field']){
    const a=example();a.sourceHeaders.push(extra);
    assert.equal(code(check(a),'HEADER_MISMATCH').count,1);
  }
});
test('source count mismatch blocks truncated export even though all remaining rows are complete',()=>{
  const a=example();a.sourceRows.pop();
  const r=check(a);
  assert.equal(r.counts.declaredRows,3);
  assert.equal(r.counts.observedRows,2);
  assert.equal(code(r,'SOURCE_COUNT_MISMATCH').count,1);
  assert.equal(r.offlineExportComplete,false);
});
test('an explicitly empty source still requires zero count and all 20 headers',()=>{
  const a=example();a.sourceRows=[];a.declaredRowCount=0;
  assert.equal(check(a).offlineExportComplete,true);
  a.declaredRowCount=1;
  assert.equal(check(a).offlineExportComplete,false);
});
test('unknown or missing independent source count fails closed',()=>{
  for(const invalid of [undefined,null,'3',-1,1.1,Infinity,Number.MAX_SAFE_INTEGER+1]){
    const a=example();a.declaredRowCount=invalid;
    assert.throws(()=>check(a),/^Error: Invalid Finance export$/);
  }
});
test('missing Finance ID, Person ID, Amount, soft-deleted metadata fields counted on raw row',()=>{
  const a=example();
  for(const field of ['Finance ID','Person ID','Amount','Deleted At']){
    delete a.sourceRows[0][field];
  }
  const r=check(a);
  assert.equal(code(r,'MISSING_FIELD').count,4);
  assert.equal(r.offlineExportComplete,false);
});
test('soft-deleted rows also require every original source audit column',()=>{
  const a=example();delete a.sourceRows[2]['Deleted By'];
  assert.equal(code(check(a),'MISSING_FIELD').count,1);
});
test('unexpected source cell property is blocked but _rowIndex is allowed',()=>{
  const a=example();a.sourceRows[0]['Invisible Field']='SENSITIVE_NAME';
  assert.equal(code(check(a),'UNEXPECTED_FIELD').count,1);
  assert.equal(check(example()).offlineExportComplete,true);
});
test('original Finance ID is unique including a soft-deleted historical transaction',()=>{
  const a=example();a.sourceRows[2]['Finance ID']='FIN-TX-001';
  const r=check(a);
  assert.equal(code(r,'DUPLICATE_FINANCE_ID').count,1);
  assert.equal(r.offlineExportComplete,false);
});
test('blank or absent original Finance ID cannot support source provenance',()=>{
  const a=example();a.sourceRows[1]['Finance ID']='  ';
  assert.equal(code(check(a),'MISSING_FINANCE_ID').count,1);
});
test('numeric Finance ID and Person ID are unsafe; original zero prefixes must survive',()=>{
  const a=example();a.sourceRows[0]['Finance ID']=1;
  a.sourceRows[1]['Person ID']=123;
  const r=check(a);
  assert.equal(code(r,'UNSAFE_IDENTIFIER').count,2);
  assert.equal(r.offlineExportComplete,false);
  const safe=example();safe.sourceRows[0]['Finance ID']='000123';
  safe.sourceRows[0]['Person ID']='000321';
  assert.equal(check(safe).offlineExportComplete,true);
});
test('active finance entries missing source Person ID are quarantined',()=>{
  const a=example();a.sourceRows[0]['Person ID']='';
  assert.equal(code(check(a),'MISSING_PERSON_ID').count,1);
  const deleted=example();deleted.sourceRows[2]['Person ID']='';
  assert.equal(check(deleted).offlineExportComplete,true);
});
test('physical row index must be original sheet row integer starting at 2',()=>{
  for(const value of [1,0,2.5,'2',null]){
    const a=example();a.sourceRows[0]._rowIndex=value;
    assert.equal(code(check(a),'INVALID_SOURCE_ROW').count,1);
  }
});
test('duplicate sheet position cannot silently overwrite two distinct transactions',()=>{
  const a=example();a.sourceRows[1]._rowIndex=2;
  assert.equal(code(check(a),'DUPLICATE_SOURCE_ROW').count,1);
});
test('source row and property order do not alter export completeness',()=>{
  const a=example();
  a.sourceRows=a.sourceRows.reverse().map(r=>Object.fromEntries(Object.entries(r).reverse()));
  assert.equal(check(a).offlineExportComplete,true);
});
test('active positive amount with exactly two decimals passes',()=>{
  const a=example();a.sourceRows[0].Amount='0.01';
  a.sourceRows[1].Amount=100.5;
  assert.equal(check(a).offlineExportComplete,true);
});
test('active finance Amount absent, blank, zero, negative or unsafe precision fails',()=>{
  for(const value of [null,undefined,'',' ','0','0.00',0,-1,'-2.50','2.001',1.234,'NaN','1e3',1e15]){
    const a=example();a.sourceRows[0].Amount=value;
    assert.equal(code(check(a),'INVALID_ACTIVE_AMOUNT').count,1, String(value));
  }
});
test('soft-deleted Finance Amount may be blank or zero; no financial movement is implied',()=>{
  for(const value of ['',null,0,'0.00']){
    const a=example();a.sourceRows[2].Amount=value;
    assert.equal(check(a).offlineExportComplete,true);
  }
});
test('unsupported nested cells, non-finite values and invalid _rowIndex fail closed',()=>{
  for(const value of [{secret:'SENSITIVE'},['PRIVATE'],NaN,Infinity,undefined]){
    const a=example();a.sourceRows[0]['Bank Account Name']=value;
    assert.equal(code(check(a),'UNSAFE_VALUE').count,1);
  }
});
test('missing or malformed outer collection fails with fixed non-identifying error',()=>{
  for(const arg of [null,{}, {...example(),sourceRows:{}},
    {...example(),sourceHeaders:{}}, {...example(),sourceRows:[null]}]){
    assert.throws(()=>check(arg),/^Error: Invalid Finance export$/);
  }
});
test('the validator never changes input or removes deleted finance transactions',()=>{
  const a=example(),before=structuredClone(a);check(a);assert.deepEqual(a,before);
});
test('diagnostics never include original transaction IDs, Person IDs, names or amounts',()=>{
  const a=example();a.sourceRows[0].Amount='SENSITIVE_98765';
  a.sourceRows[1]['Finance ID']='';
  a.sourceHeaders.push('PRIVATE HEADER');
  const r=check(a),output=JSON.stringify(r);
  assert.equal(r.offlineExportComplete,false);
  assert.doesNotMatch(output,/FIN-TX-001|FIN-001|Synthetic Name|SENSITIVE|98765|PRIVATE HEADER|"Amount"|"Person ID"/);
  assert.ok(r.issues.every(x=>Object.keys(x).sort().join(',')==='code,count'));
});
test('the report is metadata only: no approval, account posting or production import claims',()=>{
  const r=check();
  assert.equal(Object.hasOwn(r,'productionReady'),false);
  assert.equal(Object.hasOwn(r,'approvedGroups'),false);
  assert.equal(Object.hasOwn(r,'grossCurrentTotalsMinor'),false);
  assert.equal(Object.hasOwn(r,'cashMovementMinor'),false);
});
