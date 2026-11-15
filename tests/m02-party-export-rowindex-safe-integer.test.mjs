import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';
import {validatePartyImportCandidate} from '../src/party/import-validation-bundle.js';

const file=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const source=file('./fixtures/party-import.synthetic.json');
const inventory=file('../docs/baseline/schema-inventory.json');
const approvals=file('./fixtures/party-approved.synthetic.json');
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];

function complete(){
  const headers=Object.fromEntries(groups.map(group=>[
    group,[...inventory.tables.find(t=>t.sheetKey===group).columns]
  ]));
  const rows=structuredClone(source);
  for(const group of groups){
    rows[group]=rows[group].map(row=>({
      ...Object.fromEntries(headers[group].map(field=>[field,''])),
      ...row
    }));
  }
  return {sourceRows:rows,sourceHeaders:headers};
}
const inspect=arg=>validatePartyExportCompleteness(arg);
const unsafe=(report,group)=>report.issues.find(x=>x.sourceGroup===group&&x.code==='UNSAFE_VALUE');

test('2**53 Party source row position is unsafe in every original master export group',()=>{
  for(const group of groups){
    const data=complete(),before=structuredClone(data);
    data.sourceRows[group][0]._rowIndex=2**53;
    const sourceBefore=structuredClone(data);
    const r=inspect(data);
    assert.equal(r.schemaMatches,true);
    assert.equal(r.offlineExportComplete,false,group+' cannot accept a rounded source row number');
    assert.equal(unsafe(r,group)?.count,1);
    assert.equal(r.counts.unsafeValues,1);
    assert.deepEqual(data,sourceBefore,'validator never mutates export values');
    assert.notDeepEqual(data,before,'test fixture must exercise real invalid value');
  }
});

test('finite huge integers beyond safe JS precision must be rejected, not truncated',()=>{
  for(const value of [Number.MAX_SAFE_INTEGER+1,Number.MAX_VALUE,1e30]){
    const data=complete();
    data.sourceRows.CUSTOMERS[0]._rowIndex=value;
    const report=inspect(data);
    assert.equal(report.offlineExportComplete,false);
    assert.equal(unsafe(report,'CUSTOMERS')?.count,1);
  }
});

test('legitimate row 2 and highest safe row number remain accepted without normalization',()=>{
  const data=complete();
  data.sourceRows.CUSTOMERS[0]._rowIndex=2;
  data.sourceRows.VENDORS[0]._rowIndex=Number.MAX_SAFE_INTEGER;
  const before=structuredClone(data);
  const r=inspect(data);
  assert.equal(r.offlineExportComplete,true);
  assert.equal(r.counts.unsafeValues,0);
  assert.deepEqual(r.issues,[]);
  assert.deepEqual(data,before);
});

test('optional original source position may be omitted without inventing a row number',()=>{
  const data=complete();
  delete data.sourceRows.CUSTOMERS[0]._rowIndex;
  delete data.sourceRows.FINANCE_PERSONS[0]._rowIndex;
  const before=structuredClone(data);
  assert.equal(inspect(data).offlineExportComplete,true);
  assert.deepEqual(data,before);
  assert.equal(Object.hasOwn(data.sourceRows.CUSTOMERS[0],'_rowIndex'),false);
});

test('fractional, textual, negative and empty row indices keep existing fail-closed checks',()=>{
  for(const value of [1,0,-10,1.5,'2',null,NaN,Infinity]){
    const data=complete();
    data.sourceRows.SUPPLIERS[0]._rowIndex=value;
    assert.equal(inspect(data).offlineExportComplete,false);
    assert.equal(unsafe(inspect(data),'SUPPLIERS')?.count,1);
  }
});

test('two identical lossy row-index exports are rejected before identity review replay',()=>{
  const reviewed=complete(),candidate=complete();
  reviewed.sourceRows.CUSTOMERS[0]._rowIndex=2**53;
  candidate.sourceRows.CUSTOMERS[0]._rowIndex=2**53;
  const args={
    reviewedRows:reviewed.sourceRows,reviewedHeaders:reviewed.sourceHeaders,
    candidateRows:candidate.sourceRows,candidateHeaders:candidate.sourceHeaders,
    approvedGroups:structuredClone(approvals)
  };
  const before=structuredClone(args);
  const r=validatePartyImportCandidate(args);
  assert.equal(r.reviewedExportComplete,false);
  assert.equal(r.candidateExportComplete,false);
  assert.equal(r.offlineValidationClear,false);
  assert.equal(r.sourceUnchanged,null,'source drift stage must not run');
  assert.equal(r.identityReviewClear,null,'human approval must not be trusted');
  assert.equal(r.counts.unsafeValues,2);
  assert.ok(r.issues.some(x=>x.stage==='REVIEWED_EXPORT'&&x.sourceGroup==='CUSTOMERS'&&x.code==='UNSAFE_VALUE'));
  assert.ok(r.issues.some(x=>x.stage==='CANDIDATE_EXPORT'&&x.sourceGroup==='CUSTOMERS'&&x.code==='UNSAFE_VALUE'));
  assert.ok(r.issues.some(x=>x.stage==='VALIDATION'&&x.code==='VALIDATION_SKIPPED'));
  assert.deepEqual(args,before);
  assert.doesNotMatch(JSON.stringify(r),/CUS-001|SUP-001|Rahim|01700000000|REVIEW-001|9007199254740992/);
});

test('row provenance errors disclose only group and code, never original identity or balance',()=>{
  const data=complete();
  data.sourceRows.CUSTOMERS[0]._rowIndex=2**53;
  data.sourceRows.CUSTOMERS[0]['Current Due']='900.00';
  const r=inspect(data);
  assert.equal(r.offlineExportComplete,false);
  assert.ok(r.issues.every(x=>groups.includes(x.sourceGroup) &&
    Object.keys(x).sort().join(',')==='code,count,sourceGroup'));
  assert.doesNotMatch(JSON.stringify(r),/CUS-001|SUP-001|Rahim|01700000000|REVIEW-001|900.00|9007199254740992/);
});
