import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFinanceTransactionExport} from '../src/party/finance-export-coverage.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const manifest=inventory.tables.find(t=>t.sheetKey==='FINANCE_TRANSACTIONS').columns;
function fixture(){
  const sourceHeaders=[...manifest];
  const sourceRows=[{
    ...Object.fromEntries(manifest.map(field=>[field,''])),
    'Finance ID':'FIN-SYN-001',
    'Person ID':'PERSON-SYN-001',
    Person:'Synthetic Confidential Party',
    'Transaction Type':'Owner Investment',
    Amount:'8.50',
    'Is Deleted':'FALSE',
    _rowIndex:2
  }];
  return {sourceHeaders,sourceRows,declaredRowCount:1};
}
const validate=input=>validateFinanceTransactionExport(input);
const headerIssue=report=>report.issues.find(x=>x.code==='HEADER_MISMATCH');

test('a sparse hole at any original Finance header position cannot certify source coverage',()=>{
  assert.equal(manifest.length,20);
  for(const index of [0,manifest.indexOf('Amount'),manifest.length-1]){
    const input=fixture();
    delete input.sourceHeaders[index];
    assert.equal(input.sourceHeaders.length,20);
    assert.equal(Object.hasOwn(input.sourceHeaders,index),false);
    assert.equal(Object.hasOwn(input.sourceRows[0],manifest[index]),true,
      'source row completeness cannot replace missing captured header evidence');
    const before=structuredClone(input);
    const result=validate(input);
    assert.equal(result.offlineExportComplete,false,
      'missing header position must never pass: '+index);
    assert.deepEqual(headerIssue(result),{code:'HEADER_MISMATCH',count:1});
    assert.equal(result.counts.headerIssues,1);
    assert.equal(result.counts.missingFields,0);
    assert.deepEqual(input,before,'validation must never repair original header array');
    assert.doesNotMatch(JSON.stringify(result),
      /FIN-SYN-001|PERSON-SYN-001|Synthetic Confidential Party|8\.50/);
  }
});

test('fully dense exact original Finance headers and rows still pass unchanged',()=>{
  const input=fixture(),before=structuredClone(input);
  const result=validate(input);
  assert.equal(result.offlineExportComplete,true);
  assert.equal(result.counts.headerIssues,0);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(input,before);
});

test('explicit undefined Finance header does not count as a valid original column',()=>{
  const input=fixture();
  input.sourceHeaders[8]=undefined;
  const result=validate(input);
  assert.equal(result.offlineExportComplete,false);
  assert.deepEqual(headerIssue(result),{code:'HEADER_MISMATCH',count:1});
});

test('swapped and unexpected Finance headers still fail closed with one code',()=>{
  for(const kind of ['swap','append','replace']){
    const input=fixture();
    if(kind==='swap') [input.sourceHeaders[0],input.sourceHeaders[1]]=
      [input.sourceHeaders[1],input.sourceHeaders[0]];
    if(kind==='append')input.sourceHeaders.push('SENSITIVE_FUTURE_COLUMN');
    if(kind==='replace')input.sourceHeaders[2]='SENSITIVE_FUTURE_COLUMN';
    const result=validate(input);
    assert.equal(result.offlineExportComplete,false,kind);
    assert.deepEqual(headerIssue(result),{code:'HEADER_MISMATCH',count:1});
    assert.doesNotMatch(JSON.stringify(result),/SENSITIVE_FUTURE_COLUMN/);
  }
});

test('a sparse header failure exposes only fixed diagnostic codes and counts',()=>{
  const input=fixture();
  delete input.sourceHeaders[manifest.indexOf('Person ID')];
  const result=validate(input);
  assert.equal(result.sourceGroup,'FINANCE_TRANSACTIONS');
  assert.equal(Object.hasOwn(result,'sourceRows'),false);
  assert.ok(result.issues.every(x=>Object.keys(x).sort().join(',')==='code,count'));
  assert.equal(result.counts.declaredRows,1);
  assert.equal(result.counts.observedRows,1);
  assert.equal(result.offlineExportComplete,false);
});
