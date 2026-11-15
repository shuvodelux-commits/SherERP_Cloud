import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';
import {validatePartyImportCandidate} from '../src/party/import-validation-bundle.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const source=read('./fixtures/party-import.synthetic.json');
const inventory=read('../docs/baseline/schema-inventory.json');
const approvals=read('./fixtures/party-approved.synthetic.json');
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const complete=()=>{
  const sourceHeaders=Object.fromEntries(groups.map(group=>[
    group,[...inventory.tables.find(t=>t.sheetKey===group).columns]
  ]));
  const sourceRows=structuredClone(source);
  for(const group of groups){
    sourceRows[group]=sourceRows[group].map(row=>({
      ...Object.fromEntries(sourceHeaders[group].map(column=>[column,''])),
      ...row
    }));
  }
  return {sourceRows,sourceHeaders};
};
const inspect=data=>validatePartyExportCompleteness(data);
const moneyIssue=(report,group)=>report.issues.find(issue=>
  issue.code==='UNSAFE_VALUE'&&issue.sourceGroup===group);
function assertUnsafe(group,field,value){
  const data=complete();
  data.sourceRows[group][0][field]=value;
  const before=structuredClone(data);
  const report=inspect(data);
  assert.equal(report.schemaMatches,true);
  assert.equal(report.offlineExportComplete,false,
    group+' '+field+' must not pass source export coverage');
  assert.equal(moneyIssue(report,group)?.count,1,
    group+' '+field+' must contribute one fixed-code invalid value');
  assert.deepEqual(data,before,'offline validation cannot alter source data');
  assert.doesNotMatch(JSON.stringify(report),
    /CUS-001|SUP-001|VEN-001|01700000000|Rahim|90071992547409|999999/);
}

test('Customer current due rejects more than two decimals from number or text',()=>{
  for(const amount of [1.234,'1.234','-1.234','12.3456']){
    assertUnsafe('CUSTOMERS','Current Due',amount);
  }
});

test('Customer and Supplier historical opening balances reject non-paisa precision',()=>{
  assertUnsafe('CUSTOMERS','Opening Balance',-0.001);
  assertUnsafe('SUPPLIERS','Opening Balance','-16.999');
});

test('Vendor current payable and separate receivable independently reject unsafe precision',()=>{
  assertUnsafe('VENDORS','Current Due','0.001');
  assertUnsafe('VENDORS','Current Receivable',17.999);
});

test('boolean and exponent-text amounts cannot slip past generic cell-type validation',()=>{
  assertUnsafe('CUSTOMERS','Current Due',true);
  assertUnsafe('SUPPLIERS','Opening Balance',false);
  assertUnsafe('VENDORS','Current Receivable','1e3');
});

test('values that exceed safe integer minor units cannot be imported as exact balances',()=>{
  for(const amount of ['90071992547409.92',90071992547410,'99999999999999999999999999']){
    assertUnsafe('CUSTOMERS','Current Due',amount);
  }
});

test('valid signed two-decimal balances and safe minor-unit boundary remain source-valid',()=>{
  const data=complete();
  data.sourceRows.CUSTOMERS[0]['Opening Balance']='-500.25';
  data.sourceRows.CUSTOMERS[0]['Current Due']='90071992547409.91';
  data.sourceRows.SUPPLIERS[0]['Opening Balance']=-100.1;
  data.sourceRows.SUPPLIERS[0]['Current Due']=null;
  data.sourceRows.VENDORS[0]['Current Due']='0';
  data.sourceRows.VENDORS[0]['Current Receivable']='12.34';
  const before=structuredClone(data);
  const result=inspect(data);
  assert.equal(result.offlineExportComplete,true);
  assert.equal(result.counts.unsafeValues,0);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(data,before);
});

test('empty balance cells preserve original frozen export blank and null semantics',()=>{
  const data=complete();
  data.sourceRows.CUSTOMERS[0]['Opening Balance']='';
  data.sourceRows.CUSTOMERS[0]['Current Due']=null;
  data.sourceRows.SUPPLIERS[0]['Opening Balance']='';
  data.sourceRows.SUPPLIERS[0]['Current Due']='0.00';
  data.sourceRows.VENDORS[0]['Current Due']=0;
  data.sourceRows.VENDORS[0]['Current Receivable']='';
  assert.equal(inspect(data).offlineExportComplete,true);
});

test('two identically unsafe full exports cannot pass source review replay',()=>{
  const reviewed=complete(),candidate=complete();
  reviewed.sourceRows.CUSTOMERS[0]['Current Due']='1.234';
  candidate.sourceRows.CUSTOMERS[0]['Current Due']='1.234';
  const result=validatePartyImportCandidate({
    reviewedRows:reviewed.sourceRows,reviewedHeaders:reviewed.sourceHeaders,
    candidateRows:candidate.sourceRows,candidateHeaders:candidate.sourceHeaders,
    approvedGroups:structuredClone(approvals)
  });
  assert.equal(result.reviewedExportComplete,false);
  assert.equal(result.candidateExportComplete,false);
  assert.equal(result.offlineValidationClear,false);
  assert.equal(result.identityReviewClear,null);
  assert.equal(result.sourceUnchanged,null);
  assert.equal(result.counts.unsafeValues,2);
  assert.ok(result.issues.some(issue=>issue.stage==='REVIEWED_EXPORT'&&
    issue.sourceGroup==='CUSTOMERS'&&issue.code==='UNSAFE_VALUE'));
  assert.ok(result.issues.some(issue=>issue.stage==='CANDIDATE_EXPORT'&&
    issue.sourceGroup==='CUSTOMERS'&&issue.code==='UNSAFE_VALUE'));
  assert.doesNotMatch(JSON.stringify(result),/Rahim|CUS-001|01700000000|1.234/);
});
