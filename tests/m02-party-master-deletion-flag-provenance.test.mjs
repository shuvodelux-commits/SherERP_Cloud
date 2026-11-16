import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';
import {validatePartyImportCandidate} from '../src/party/import-validation-bundle.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const baseline=JSON.parse(readFileSync(
  new URL('./fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const withDelete=['CUSTOMERS','SUPPLIERS','VENDORS','EXPENSE_PAYEES'];
function example(){
  const sourceHeaders=Object.fromEntries(groups.map(g=>[
    g,[...inventory.tables.find(t=>t.sheetKey===g).columns]
  ]));
  const sourceRows=structuredClone(baseline);
  for(const group of groups){
    sourceRows[group]=sourceRows[group].map(row=>({
      ...Object.fromEntries(sourceHeaders[group].map(field=>[field,''])),...row
    }));
  }
  return {sourceRows,sourceHeaders};
}
const inspect=input=>validatePartyExportCompleteness(input);
const badFlag=(report,group)=>report.issues.find(x=>
  x.sourceGroup===group&&x.code==='UNSAFE_VALUE');

test('each deleted-capable Party master rejects numeric soft-delete markers',()=>{
  for(const group of withDelete)for(const flag of [0,1,2,1.5]){
    const input=example();
    input.sourceRows[group][0]['Is Deleted']=flag;
    const before=structuredClone(input),report=inspect(input);
    assert.equal(report.schemaMatches,true,group);
    assert.equal(report.rowCoverageComplete,false,group+':'+flag);
    assert.equal(report.offlineExportComplete,false,group+':'+flag);
    assert.deepEqual(badFlag(report,group),{
      sourceGroup:group,code:'UNSAFE_VALUE',count:1
    });
    assert.equal(report.counts.unsafeValues,1);
    assert.deepEqual(input,before,'validation must not coerce original deletion evidence');
  }
});

test('unknown Party deletion text is not silently interpreted as active',()=>{
  for(const group of withDelete)for(const flag of ['1','0','YES','No','DELETED','true-ish']){
    const input=example();
    input.sourceRows[group][0]['Is Deleted']=flag;
    const report=inspect(input);
    assert.equal(report.offlineExportComplete,false,group+':'+flag);
    assert.deepEqual(badFlag(report,group),{
      sourceGroup:group,code:'UNSAFE_VALUE',count:1
    });
  }
});

test('all four independent ambiguous deletion flags are counted and redacted',()=>{
  const input=example();
  for(const [index,group] of withDelete.entries()){
    input.sourceRows[group][0]['Is Deleted']=[1,'YES',0,'DELETED'][index];
  }
  const before=structuredClone(input),report=inspect(input);
  assert.equal(report.schemaMatches,true);
  assert.equal(report.rowCoverageComplete,false);
  assert.equal(report.counts.unsafeValues,4);
  assert.equal(report.offlineExportComplete,false);
  assert.deepEqual(report.issues,withDelete.map(group=>({
    sourceGroup:group,code:'UNSAFE_VALUE',count:1
  })).sort((a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)));
  assert.deepEqual(input,before);
  assert.doesNotMatch(JSON.stringify(report),
    /CUS-001|SUP-001|VEN-001|PAY-001|Rahim|01700000000|DELETED|Current Due/);
  assert.ok(report.issues.every(x=>
    Object.keys(x).sort().join(',')==='code,count,sourceGroup'));
});

test('original blank, null, boolean and TRUE/FALSE deletion markers remain valid',()=>{
  const flags=[null,false,true,'',' ', 'TRUE',' true ','\tTrue\n',
    'FALSE',' false ','\tFALSE\n'];
  for(const flag of flags){
    const input=example();
    for(const group of withDelete)input.sourceRows[group][0]['Is Deleted']=flag;
    const before=structuredClone(input),report=inspect(input);
    assert.equal(report.offlineExportComplete,true,JSON.stringify(flag));
    assert.equal(report.counts.unsafeValues,0);
    assert.deepEqual(report.issues,[]);
    assert.deepEqual(input,before);
  }
});

test('Finance Persons has no original Is Deleted column, and monetary cells stay exact',()=>{
  const input=example();
  assert.equal(input.sourceHeaders.FINANCE_PERSONS.includes('Is Deleted'),false);
  input.sourceRows.CUSTOMERS[0]['Opening Balance']='-10.50';
  input.sourceRows.SUPPLIERS[0]['Current Due']=25.50;
  input.sourceRows.VENDORS[0]['Current Receivable']=9.25;
  assert.equal(inspect(input).offlineExportComplete,true);
  const extra=structuredClone(input);
  extra.sourceRows.FINANCE_PERSONS[0]['Is Deleted']='FALSE';
  const report=inspect(extra);
  assert.equal(report.offlineExportComplete,false);
  assert.deepEqual(report.issues.find(x=>
    x.sourceGroup==='FINANCE_PERSONS'&&x.code==='UNEXPECTED_FIELD'),
    {sourceGroup:'FINANCE_PERSONS',code:'UNEXPECTED_FIELD',count:1});
});

test('Party import composition does not reuse identity approvals after bad deletion evidence',()=>{
  const input=example();
  input.sourceRows.CUSTOMERS[0]['Is Deleted']='YES';
  const before=structuredClone(input);
  const result=validatePartyImportCandidate({
    reviewedRows:input.sourceRows,reviewedHeaders:input.sourceHeaders,
    candidateRows:input.sourceRows,candidateHeaders:input.sourceHeaders,
    approvedGroups:[]
  });
  assert.equal(result.reviewedExportComplete,false);
  assert.equal(result.candidateExportComplete,false);
  assert.equal(result.sourceUnchanged,null);
  assert.equal(result.identityReviewClear,null);
  assert.equal(result.offlineValidationClear,false);
  assert.equal(result.counts.unsafeValues,2);
  assert.ok(result.issues.some(x=>x.stage==='VALIDATION'&&
    x.code==='VALIDATION_SKIPPED'));
  assert.equal(Object.hasOwn(result,'productionReady'),false);
  assert.equal(Object.hasOwn(result,'cashMovementMinor'),false);
  assert.deepEqual(input,before);
});
