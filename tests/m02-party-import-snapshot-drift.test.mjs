import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyImportSnapshot} from '../src/party/import-snapshot-guard.js';

const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const source=()=>fixture('party-import.synthetic.json');
const approvals=()=>fixture('party-approved.synthetic.json');
const review=(reviewedSnapshot=source(),candidateSnapshot=source(),approvedGroups=approvals())=>
  validatePartyImportSnapshot({reviewedSnapshot,candidateSnapshot,approvedGroups});
const codes=report=>report.issues.map(i=>i.code);
const groupIssues=(report,group,code)=>report.issues.filter(i=>i.sourceGroup===group&&i.code===code);
const expectChange=(group,change)=>{
  const original=source(),candidate=source();
  change(candidate[group][0]);
  const result=review(original,candidate);
  assert.equal(result.sourceSnapshotMatches,false);
  assert.equal(result.offlineRehearsalClear,false);
  assert.deepEqual(groupIssues(result,group,'SOURCE_ROW_CHANGED'),[
    {sourceGroup:group,code:'SOURCE_ROW_CHANGED',count:1}
  ]);
  return result;
};

test('identical reviewed and candidate export passes offline-only snapshot and plan check',()=>{
  const report=review();
  assert.equal(report.formatVersion,1);
  assert.equal(report.sourceSnapshotMatches,true);
  assert.equal(report.offlineRehearsalClear,true);
  assert.deepEqual(report.counts,{
    reviewedRows:5,candidateRows:5,changedRows:0,addedRows:0,removedRows:0,
    quarantinedRows:0,pendingIdentityReviews:0
  });
  assert.deepEqual(report.issues,[]);
});
test('changing input row order and JSON property order cannot change snapshot equivalence',()=>{
  const a=source(),b=source();
  b.CUSTOMERS=[...b.CUSTOMERS].reverse();
  b.FINANCE_PERSONS=b.FINANCE_PERSONS.map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(review(a,b).sourceSnapshotMatches,true);
});
test('changing original Customer ID without replacing approved position is detectable',()=>{
  expectChange('CUSTOMERS',row=>{row['Customer ID']='CUS-NEW';});
});
test('source name mutation is an identity review drift, not an automatic merge',()=>{
  expectChange('CUSTOMERS',row=>{row['Customer Name']='Another person';});
});
test('phone formatting changes are also raw source changes; never infer shared legal identity',()=>{
  expectChange('SUPPLIERS',row=>{row.Phone='+8801700000000';});
});
test('Vendor payable and receivable movement are independently visible and never netted',()=>{
  expectChange('VENDORS',row=>{row['Current Due']=350;});
  expectChange('VENDORS',row=>{row['Current Receivable']=350;});
});
test('historical signed Customer opening change blocks offline rehearsal',()=>{
  const a=source(),b=source();
  a.CUSTOMERS[0]['Opening Balance']=-50;
  b.CUSTOMERS[0]['Opening Balance']=50;
  const result=review(a,b);
  assert.equal(result.sourceSnapshotMatches,false);
  assert.equal(result.offlineRehearsalClear,false);
  assert.equal(groupIssues(result,'CUSTOMERS','SOURCE_ROW_CHANGED').length,1);
});
test('Finance Person Owner/Lender/Borrower roles are compared exactly, not combined',()=>{
  expectChange('FINANCE_PERSONS',row=>{row.Roles='Owner,Lender';});
});
test('retired/active status drift is detected',()=>{
  expectChange('EXPENSE_PAYEES',row=>{row.Status='Active';});
});
test('a changed legacy sheet row number is not silently reidentified by phone',()=>{
  const a=source(),b=source();
  b.CUSTOMERS[0]._rowIndex=5;
  const result=review(a,b);
  assert.equal(result.sourceSnapshotMatches,false);
  assert.equal(result.counts.addedRows,1);
  assert.equal(result.counts.removedRows,1);
});
test('missing source row is reported without identifying its details',()=>{
  const candidate=source();candidate.VENDORS=[];
  const result=review(source(),candidate);
  assert.equal(result.sourceSnapshotMatches,false);
  assert.equal(result.counts.removedRows,1);
  assert.deepEqual(groupIssues(result,'VENDORS','SOURCE_ROW_REMOVED'),[
    {sourceGroup:'VENDORS',code:'SOURCE_ROW_REMOVED',count:1}
  ]);
});
test('added source row is blocked even if it shares a name with another group',()=>{
  const candidate=source();
  candidate.CUSTOMERS.push({'Customer ID':'CUS-002','Customer Name':'Rahim Enterprise',Phone:'01700000000',_rowIndex:4});
  const result=review(source(),candidate);
  assert.equal(result.sourceSnapshotMatches,false);
  assert.equal(result.counts.addedRows,1);
  assert.equal(result.offlineRehearsalClear,false);
});
test('same original ID reused in two different groups is not duplicate within source group',()=>{
  const a=source(),b=source();
  a.SUPPLIERS[0]['Supplier ID']='CUS-001';
  b.SUPPLIERS[0]['Supplier ID']='CUS-001';
  assert.equal(review(a,b,[]).sourceSnapshotMatches,true);
});
test('duplicated legacy ID with an unnamed row cannot be missed',()=>{
  const current=source();
  current.CUSTOMERS.push({'Customer ID':'CUS-001','Customer Name':'',Phone:'01700000000',_rowIndex:7});
  const result=review(source(),current);
  assert.equal(result.offlineRehearsalClear,false);
  assert.deepEqual(groupIssues(result,'CUSTOMERS','DUPLICATE_SOURCE_ID'),[
    {sourceGroup:'CUSTOMERS',code:'DUPLICATE_SOURCE_ID',count:1}
  ]);
});
test('blank legacy ID is reported, even if physical row provenance exists',()=>{
  const current=source();
  current.SUPPLIERS.push({'Supplier ID':'','Supplier Name':'Missing','Phone':'',_rowIndex:4});
  const result=review(source(),current);
  assert.equal(result.offlineRehearsalClear,false);
  assert.equal(groupIssues(result,'SUPPLIERS','MISSING_SOURCE_ID')[0].count,1);
  assert.ok(codes(result).includes('QUARANTINED_SOURCE_ROWS'));
});
test('unreviewed shared name/phone suggestions block rehearsal despite equal snapshots',()=>{
  const result=review(source(),source(),[]);
  assert.equal(result.sourceSnapshotMatches,true);
  assert.equal(result.offlineRehearsalClear,false);
  assert.ok(codes(result).includes('PENDING_IDENTITY_REVIEW'));
});
test('duplicate physical positions fail closed rather than picking an arbitrary source row',()=>{
  const current=source();
  current.CUSTOMERS.push({'Customer ID':'CUS-002','Customer Name':'Other',Phone:'01800000000',_rowIndex:2});
  assert.throws(()=>review(source(),current),/Party source row provenance/);
});
test('blank ID and no row index lacks stable provenance and is rejected',()=>{
  const current=source();
  current.CUSTOMERS.push({'Customer ID':'','Customer Name':'Unknown',Phone:''});
  assert.throws(()=>review(source(),current),/Party source row provenance/);
});
test('missing or unknown groups, invalid rows and unsupported values fail closed',()=>{
  const missing=source();delete missing.CUSTOMERS;
  assert.throws(()=>review(source(),missing),/Invalid Party import snapshot/);
  const extra=source();extra.SECRET_GROUP=[];
  assert.throws(()=>review(source(),extra),/Invalid Party import snapshot/);
  const invalid=source();invalid.CUSTOMERS=[null];
  assert.throws(()=>review(source(),invalid),/Invalid Party import snapshot/);
  const unsupported=source();unsupported.CUSTOMERS[0].extra=undefined;
  assert.throws(()=>review(source(),unsupported),/Invalid Party import snapshot/);
});
test('unverified or malformed human approval claim is rejected without exposing IDs',()=>{
  const invalid=approvals();invalid[0].approvalRef='BAD REF ';
  assert.throws(()=>review(source(),source(),invalid),/Invalid Party review evidence/);
});
test('rehearsal report redacts all original names, phones, IDs, money and review refs',()=>{
  const original=source(),current=source();
  current.CUSTOMERS[0]['Opening Balance']='-1234567.89';
  current.SUPPLIERS[0].Phone='01911111111';
  const result=review(original,current);
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/Rahim|01700000000|01911111111|CUS-001|SUP-001|VEN-001|FIN-001|PAY-001|REVIEW-001|admin-01|1234567/);
});
test('snapshot validation never mutates reviewed/candidate data or approval evidence',()=>{
  const old=source(),now=source(),approval=approvals();
  const before=structuredClone({old,now,approval});
  review(old,now,approval);
  assert.deepEqual({old,now,approval},before);
});
