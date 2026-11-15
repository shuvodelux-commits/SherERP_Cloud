import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyImportCandidate} from '../src/party/import-validation-bundle.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const source=JSON.parse(readFileSync(new URL('./fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const approved=JSON.parse(readFileSync(new URL('./fixtures/party-approved.synthetic.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
function complete(){
  const headers=Object.fromEntries(groups.map(g=>[g,[...inventory.tables.find(t=>t.sheetKey===g).columns]]));
  const rows=structuredClone(source);
  for(const group of groups)rows[group]=rows[group].map(row=>({
    ...Object.fromEntries(headers[group].map(field=>[field,''])),...row
  }));
  return {rows,headers};
}
function input(){
  const a=complete(),b=complete();
  return {reviewedRows:a.rows,reviewedHeaders:a.headers,candidateRows:b.rows,candidateHeaders:b.headers,approvedGroups:structuredClone(approved)};
}
const run=(arg=input())=>validatePartyImportCandidate(arg);
const entry=(r,stage,group,code)=>r.issues.find(x=>x.stage===stage&&x.sourceGroup===group&&x.code===code);

test('complete unchanged reviewed source with explicit reviewed identity proof passes both offline checks',()=>{
  const r=run();
  assert.deepEqual({version:r.formatVersion,reviewed:r.reviewedExportComplete,candidate:r.candidateExportComplete,source:r.sourceUnchanged,identity:r.identityReviewClear,offline:r.offlineValidationClear},{
    version:1,reviewed:true,candidate:true,source:true,identity:true,offline:true
  });
  assert.deepEqual(r.counts,{reviewedRows:5,candidateRows:5,headerIssues:0,missingFields:0,unexpectedFields:0,unsafeValues:0,changedRows:0,addedRows:0,removedRows:0,quarantinedRows:0,pendingIdentityReviews:0});
  assert.deepEqual(r.issues,[]);
});
test('two identical truncated exports cannot pass just because snapshot drift finds no difference',()=>{
  const a=input();
  for(const rows of [a.reviewedRows,a.candidateRows])delete rows.CUSTOMERS[0]['Current Due'];
  const r=run(a);
  assert.equal(r.reviewedExportComplete,false);
  assert.equal(r.candidateExportComplete,false);
  assert.equal(r.sourceUnchanged,null);
  assert.equal(r.identityReviewClear,null);
  assert.equal(r.offlineValidationClear,false);
  assert.equal(r.counts.missingFields,2);
  assert.equal(r.counts.changedRows,null);
  assert.equal(entry(r,'VALIDATION','VALIDATION','VALIDATION_SKIPPED').count,1);
});
test('missing reviewed export field alone blocks subsequent identity approval replay',()=>{
  const a=input();delete a.reviewedRows.SUPPLIERS[0]['Opening Balance'];
  const r=run(a);
  assert.equal(r.reviewedExportComplete,false);
  assert.equal(r.candidateExportComplete,true);
  assert.equal(r.sourceUnchanged,null);
  assert.equal(entry(r,'REVIEWED_EXPORT','SUPPLIERS','MISSING_FIELD').count,1);
});
test('missing candidate vendor receivable blocks even when reviewed original had it',()=>{
  const a=input();delete a.candidateRows.VENDORS[0]['Current Receivable'];
  const r=run(a);
  assert.equal(r.reviewedExportComplete,true);
  assert.equal(r.candidateExportComplete,false);
  assert.equal(entry(r,'CANDIDATE_EXPORT','VENDORS','MISSING_FIELD').count,1);
});
test('reviewed header swapped blocks regardless of identical raw row fields',()=>{
  const a=input();a.reviewedHeaders.CUSTOMERS.reverse();
  const r=run(a);
  assert.equal(r.reviewedExportComplete,false);
  assert.equal(entry(r,'REVIEWED_EXPORT','CUSTOMERS','HEADER_MISMATCH').count,1);
});
test('candidate header truncated blocks regardless of complete reviewed header',()=>{
  const a=input();a.candidateHeaders.VENDORS.pop();
  const r=run(a);
  assert.equal(r.candidateExportComplete,false);
  assert.equal(entry(r,'CANDIDATE_EXPORT','VENDORS','HEADER_MISMATCH').count,1);
});
test('source name or phone drift is blocked only after complete headers are checked',()=>{
  for(const [group,field,value] of [['CUSTOMERS','Customer Name','Different name'],['SUPPLIERS','Phone','01800000011']]){
    const a=input();a.candidateRows[group][0][field]=value;
    const r=run(a);
    assert.equal(r.reviewedExportComplete,true);
    assert.equal(r.candidateExportComplete,true);
    assert.equal(r.sourceUnchanged,false);
    assert.equal(r.offlineValidationClear,false);
    assert.equal(entry(r,'IDENTITY_SNAPSHOT',group,'SOURCE_ROW_CHANGED').count,1);
  }
});
test('source ID edit is never auto-resolved using identical phone or display name',()=>{
  const a=input();a.candidateRows.CUSTOMERS[0]['Customer ID']='CUS-DIFFERENT';
  const r=run(a);
  assert.equal(r.offlineValidationClear,false);
  assert.equal(entry(r,'IDENTITY_SNAPSHOT','CUSTOMERS','SOURCE_ROW_CHANGED').count,1);
});
test('signed opening balance change is data drift even when identity columns match',()=>{
  const a=input();a.reviewedRows.CUSTOMERS[0]['Opening Balance']='-125.00';
  a.candidateRows.CUSTOMERS[0]['Opening Balance']='125.00';
  assert.equal(run(a).sourceUnchanged,false);
});
test('Vendor Current Due and Current Receivable remain independent drift inputs',()=>{
  for(const field of ['Current Due','Current Receivable']){
    const a=input();a.candidateRows.VENDORS[0][field]=999;
    const r=run(a);
    assert.equal(r.offlineValidationClear,false);
    assert.equal(entry(r,'IDENTITY_SNAPSHOT','VENDORS','SOURCE_ROW_CHANGED').count,1);
  }
});
test('Finance Person Owner Lender Borrower roles remain separate review-sensitive fields',()=>{
  const a=input();a.candidateRows.FINANCE_PERSONS[0].Roles='Owner,Lender';
  assert.equal(run(a).sourceUnchanged,false);
});
test('source row addition or removal is never silently accepted as same snapshot',()=>{
  const a=input();a.candidateRows.EXPENSE_PAYEES=[];
  const r=run(a);
  assert.equal(r.counts.removedRows,1);
  assert.equal(r.sourceUnchanged,false);
});
test('missing human approval keeps shared phone/name review pending even with complete identical exports',()=>{
  const a=input();a.approvedGroups=[];
  const r=run(a);
  assert.equal(r.reviewedExportComplete,true);
  assert.equal(r.candidateExportComplete,true);
  assert.equal(r.sourceUnchanged,true);
  assert.equal(r.identityReviewClear,false);
  assert.equal(r.offlineValidationClear,false);
  assert.ok(r.counts.pendingIdentityReviews>0);
  assert.ok(entry(r,'IDENTITY_SNAPSHOT','PLAN','PENDING_IDENTITY_REVIEW'));
});
test('stale or tampered approval evidence fails closed with generic non-identifying error',()=>{
  const a=input();a.approvedGroups[0].approvalRef=' REVIEW-001';
  assert.throws(()=>run(a),/^Error: Party import validation unavailable$/);
});
test('required explicit decision array cannot be omitted',()=>{
  const a=input();delete a.approvedGroups;
  assert.throws(()=>run(a),/^Error: Party import validation unavailable$/);
});
test('duplicate source ID with blank name never gets partial rehearsal clearance',()=>{
  const a=input(),extra={...a.candidateRows.CUSTOMERS[0],_rowIndex:7,'Customer Name':''};
  a.candidateRows.CUSTOMERS.push(extra);
  const r=run(a);
  assert.equal(r.offlineValidationClear,false);
  assert.equal(r.sourceUnchanged,false);
  assert.equal(r.counts.addedRows,1);
  assert.equal(entry(r,'IDENTITY_SNAPSHOT','CUSTOMERS','DUPLICATE_SOURCE_ID').count,1);
});
test('candidate numeric phone is rejected before doing identity plan checks',()=>{
  const a=input();a.candidateRows.SUPPLIERS[0].Phone=1700000000;
  const r=run(a);
  assert.equal(r.candidateExportComplete,false);
  assert.equal(r.sourceUnchanged,null);
  assert.equal(entry(r,'CANDIDATE_EXPORT','SUPPLIERS','UNSAFE_ID_OR_PHONE').count,1);
});
test('candidate source row with nonfinite financial input is blocked before drift inspection',()=>{
  const a=input();a.candidateRows.VENDORS[0]['Current Due']=Infinity;
  const r=run(a);
  assert.equal(r.sourceUnchanged,null);
  assert.equal(entry(r,'CANDIDATE_EXPORT','VENDORS','UNSAFE_VALUE').count,1);
});
test('missing master header group fails closed with fixed generic error',()=>{
  const a=input();delete a.reviewedHeaders.CUSTOMERS;
  assert.throws(()=>run(a),/^Error: Party import validation unavailable$/);
});
test('malformed candidate snapshot fails closed with fixed generic error',()=>{
  const a=input();a.candidateRows=null;
  assert.throws(()=>run(a),/^Error: Party import validation unavailable$/);
});
test('source provenance collision never produces an approval-positive report',()=>{
  const a=input();a.candidateRows.CUSTOMERS.push({...a.candidateRows.CUSTOMERS[0],'Customer ID':'CUS-NEW'});
  assert.throws(()=>run(a),/^Error: Party import validation unavailable$/);
});
test('zero-row source sheets are accepted when pinned original headers are present',()=>{
  const a=input();a.reviewedRows.VENDORS=[];a.candidateRows.VENDORS=[];
  const r=run(a);
  assert.equal(r.reviewedExportComplete,true);
  assert.equal(r.candidateExportComplete,true);
  assert.equal(r.sourceUnchanged,true);
});
test('property and row export-order changes preserve equivalence',()=>{
  const a=input();
  for(const group of groups){
    a.candidateRows[group].reverse();
    a.candidateRows[group]=a.candidateRows[group].map(row=>Object.fromEntries(Object.entries(row).reverse()));
  }
  assert.equal(run(a).offlineValidationClear,true);
});
test('source data, metadata and human review claims are never mutated',()=>{
  const a=input(),before=structuredClone(a);
  run(a);
  assert.deepEqual(a,before);
});
test('reports never expose source IDs, phone, names, signed balances, approval references or property names',()=>{
  const a=input();a.candidateRows.CUSTOMERS[0]['Opening Balance']='-987654.32';
  a.candidateRows.SUPPLIERS[0].Phone='01999999999';
  const r=run(a),s=JSON.stringify(r);
  assert.doesNotMatch(s,/Rahim|CUS-001|SUP-001|VEN-001|FIN-001|PAY-001|REVIEW-001|admin-01|01700000000|01999999999|987654|Opening Balance/);
  assert.ok(r.issues.every(x=>Object.keys(x).sort().join(',')==='code,count,sourceGroup,stage'));
});
