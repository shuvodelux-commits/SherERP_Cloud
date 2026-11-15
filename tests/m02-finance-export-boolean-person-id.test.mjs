import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFinanceTransactionExport} from '../src/party/finance-export-coverage.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const headers=()=>[...inventory.tables.find(t=>t.sheetKey==='FINANCE_TRANSACTIONS').columns];
function source(){
  const row=Object.fromEntries(headers().map(k=>[k,'']));
  Object.assign(row,{
    'Finance ID':'FIN-TEST-001',
    'Person ID':'FIN-PERSON-001',
    'Person':'Synthetic Finance Person',
    'Transaction Type':'Owner Investment',
    'Amount':'21.15',
    'Is Deleted':'FALSE',
    '_rowIndex':2
  });
  return {sourceRows:[row],sourceHeaders:headers(),declaredRowCount:1};
}
const check=input=>validateFinanceTransactionExport(input);
const count=(report,code)=>report.issues.find(i=>i.code===code)?.count??0;

for(const value of [true,false]){
  test('active Boolean Person ID '+value+' is invalid source identity even with all 20 original columns',()=>{
    const input=source();
    input.sourceRows[0]['Person ID']=value;
    const before=structuredClone(input);
    const report=check(input);
    assert.equal(report.offlineExportComplete,false);
    assert.equal(count(report,'UNSAFE_IDENTIFIER'),1);
    assert.equal(report.counts.unsafeValues,0,
      'Boolean is an otherwise allowed source cell type; identity-specific guard is required');
    assert.equal(report.counts.missingPersonIds,0,
      'Nonblank but wrong-type identity should use existing UNSAFE_IDENTIFIER code');
    assert.equal(report.counts.declaredRows,1);
    assert.equal(report.counts.observedRows,1);
    assert.deepEqual(input,before);
    assert.deepEqual(report.issues,[{code:'UNSAFE_IDENTIFIER',count:1}]);
  });
}

test('deleted row with Boolean Person ID is not certified as provenance-complete',()=>{
  const input=source();
  input.sourceRows[0]['Is Deleted']=true;
  input.sourceRows[0].Amount='';
  input.sourceRows[0]['Person ID']=true;
  const report=check(input);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(count(report,'UNSAFE_IDENTIFIER'),1);
  assert.equal(count(report,'INVALID_ACTIVE_AMOUNT'),0,
    'Deleted finance transactions retain their existing Amount exemption');
});

test('literal string Person IDs resembling Boolean values remain unchanged and shape-valid',()=>{
  for(const value of ['true','false','000123',' FIN-001 ']){
    const input=source();
    input.sourceRows[0]['Person ID']=value;
    const before=structuredClone(input);
    const report=check(input);
    assert.equal(report.offlineExportComplete,true,value);
    assert.equal(count(report,'UNSAFE_IDENTIFIER'),0);
    assert.deepEqual(input,before);
  }
});

test('numeric Person ID remains unsafe and null/blank active Person IDs remain missing',()=>{
  const numeric=source();
  numeric.sourceRows[0]['Person ID']=123;
  assert.equal(count(check(numeric),'UNSAFE_IDENTIFIER'),1);
  for(const value of [null,'','   ']){
    const missing=source();
    missing.sourceRows[0]['Person ID']=value;
    const report=check(missing);
    assert.equal(report.offlineExportComplete,false);
    assert.equal(count(report,'MISSING_PERSON_ID'),1);
  }
});

test('Boolean Is Deleted remains supported, including original valid soft-deleted empty Amount',()=>{
  const input=source();
  input.sourceRows[0]['Is Deleted']=true;
  input.sourceRows[0].Amount='';
  const report=check(input);
  assert.equal(report.offlineExportComplete,true);
  assert.deepEqual(report.issues,[]);
});

test('Boolean Finance ID still fails existing missing-identity check',()=>{
  const input=source();
  input.sourceRows[0]['Finance ID']=false;
  const report=check(input);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(count(report,'MISSING_FINANCE_ID'),1);
});

test('Finance export diagnostics stay fixed-count and never reveal sensitive fields',()=>{
  const input=source();
  input.sourceRows[0]['Person ID']=false;
  const report=check(input);
  assert.ok(report.issues.every(issue=>Object.keys(issue).sort().join(',')==='code,count'));
  assert.doesNotMatch(JSON.stringify(report),
    /FIN-TEST-001|FIN-PERSON-001|Synthetic Finance Person|21\.15|Person ID/);
});

test('frozen Finance writer saves selected Person ID as the original source field',()=>{
  const code=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.match(code,/'Person ID': personId, 'Person': personName/);
  assert.match(code,/generateId_\('FINANCE_TRANSACTIONS'\)/);
});
