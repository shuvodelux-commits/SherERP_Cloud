import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFinanceTransactionExport} from '../src/party/finance-export-coverage.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const headers=()=>[
  ...inventory.tables.find(t=>t.sheetKey==='FINANCE_TRANSACTIONS').columns
];
function exportFixture(rowPosition=2){
  const sourceHeaders=headers();
  const sourceRows=[{
    ...Object.fromEntries(sourceHeaders.map(column=>[column,''])),
    'Finance ID':'FIN-SYNTH-001',
    'Person ID':'PERSON-SYNTH-001',
    Person:'Confidential Synthetic Person',
    'Transaction Type':'Owner Investment',
    Amount:'21.25',
    'Is Deleted':'FALSE',
    _rowIndex:rowPosition
  }];
  return {sourceRows,sourceHeaders,declaredRowCount:1};
}
const validate=fixture=>validateFinanceTransactionExport(fixture);
const issue=(report,code)=>report.issues.find(entry=>entry.code===code);
function assertSafeReport(report){
  const serialized=JSON.stringify(report);
  assert.doesNotMatch(serialized,
    /FIN-SYNTH-001|PERSON-SYNTH-001|Confidential Synthetic Person|21\.25/);
  assert.ok(report.issues.every(item=>Object.keys(item).sort().join(',')==='code,count'));
}

test('Finance export must reject physical Sheet row beyond maximum safe integer',()=>{
  const input=exportFixture(Number.MAX_SAFE_INTEGER+1);
  const before=structuredClone(input);
  const report=validate(input);
  assert.equal(report.offlineExportComplete,false);
  assert.deepEqual(issue(report,'INVALID_SOURCE_ROW'),{
    code:'INVALID_SOURCE_ROW',count:1
  });
  assert.equal(report.counts.observedRows,1);
  assert.deepEqual(input,before);
  assertSafeReport(report);
});

test('Finance export must reject huge integer Sheet row provenance before duplicate analysis',()=>{
  const input=exportFixture(1e20);
  const report=validate(input);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(issue(report,'INVALID_SOURCE_ROW')?.count,1);
  assert.equal(issue(report,'DUPLICATE_SOURCE_ROW'),undefined);
  assertSafeReport(report);
});

test('safe row positions preserve original export completeness and exact IDs',()=>{
  for(const index of [2,Number.MAX_SAFE_INTEGER]){
    const input=exportFixture(index),before=structuredClone(input);
    const report=validate(input);
    assert.equal(report.offlineExportComplete,true);
    assert.deepEqual(report.issues,[]);
    assert.equal(report.counts.missingIds,0);
    assert.deepEqual(input,before);
  }
});

test('fractional, negative and text row positions remain rejected',()=>{
  for(const index of [1,0,-1,2.5,'2',null]){
    const report=validate(exportFixture(index));
    assert.equal(report.offlineExportComplete,false);
    assert.equal(issue(report,'INVALID_SOURCE_ROW')?.count,1);
  }
});

test('duplicate valid source row positions still cannot be treated as independent records',()=>{
  const input=exportFixture(2);
  input.sourceRows.push({...input.sourceRows[0],'Finance ID':'FIN-SYNTH-002'});
  input.declaredRowCount=2;
  const report=validate(input);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(issue(report,'DUPLICATE_SOURCE_ROW')?.count,1);
  assertSafeReport(report);
});
