import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {reconcileReviewedPartyImport} from '../src/party/import-evidence-gate.js';

const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
function full(){
  const headers=Object.fromEntries(groups.map(g=>[
    g,[...inventory.tables.find(t=>t.sheetKey===g).columns]
  ]));
  const rows=fixture('party-import.synthetic.json');
  for(const group of groups)rows[group]=rows[group].map(row=>({
    ...Object.fromEntries(headers[group].map(field=>[field,''])),...row
  }));
  return {rows,headers};
}
function rowsFrom(plan,{persistedApproval=true}={}){
  return {
    parties:plan.parties.map(p=>({
      party_id:p.partyId,display_name:p.displayName,phone:p.phone||null,
      party_kind:p.partyKind,status:p.status
    })),
    party_roles:plan.roles.map(r=>({party_id:r.partyId,role:r.role,status:r.status})),
    party_legacy_links:plan.links.map(l=>({
      party_id:l.partyId,source_group:l.sourceGroup,source_id:l.sourceId,
      legacy_sheet_row:l.legacySheetRow,link_basis:l.linkBasis,
      reviewed_by:l.reviewedBy,reviewed_at:l.reviewedAt,status:l.status,
      ...(persistedApproval?{approval_ref:l.approvalRef}:{})
    }))
  };
}
function input(){
  const a=full(),b=full(),approvedGroups=fixture('party-approved.synthetic.json');
  return {
    reviewedRows:a.rows,reviewedHeaders:a.headers,
    candidateRows:b.rows,candidateHeaders:b.headers,
    approvedGroups,readback:rowsFrom(planPartyImport(b.rows,approvedGroups))
  };
}
const run=(x=input())=>reconcileReviewedPartyImport(x);
const resultIssue=(r,stage,scope,code)=>
  r.issues.find(i=>i.stage===stage&&i.scope===scope&&i.code===code);

test('clean reviewed source plus future approval-ref-preserving readback matches all identity rows',()=>{
  const r=run();
  assert.deepEqual({
    version:r.formatVersion,source:r.sourceValidationClear,
    checked:r.readbackChecked,matched:r.readbackMatches,
    persistent:r.approvalEvidencePersistent,offline:r.offlineEvidenceMatches
  },{version:1,source:true,checked:true,matched:true,persistent:true,offline:true});
  assert.deepEqual(r.counts.readback.expected,{
    parties:4,party_roles:7,party_legacy_links:5
  });
  assert.deepEqual(r.counts.readback.actual,r.counts.readback.expected);
  assert.equal(r.counts.source.candidateRows,5);
  assert.deepEqual(r.issues,[]);
});
test('current 0002 D1 readback lacking approval_ref must never pass reviewed identity evidence',()=>{
  const x=input();
  x.readback=rowsFrom(planPartyImport(x.candidateRows,x.approvedGroups),{
    persistedApproval:false
  });
  const r=run(x);
  assert.equal(r.sourceValidationClear,true);
  assert.equal(r.readbackChecked,true);
  assert.equal(r.readbackMatches,false);
  assert.equal(r.approvalEvidencePersistent,false);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.equal(resultIssue(r,'READBACK','party_legacy_links','APPROVAL_REF_NOT_PERSISTED').count,1);
});
test('tampered reviewer changes approval evidence even if original source IDs remain',()=>{
  const x=input();
  const link=x.readback.party_legacy_links.find(l=>l.link_basis==='HUMAN_VERIFIED');
  link.reviewed_by='different-reviewer';
  const r=run(x);
  assert.equal(r.approvalEvidencePersistent,false);
  assert.equal(r.readbackMatches,false);
  assert.equal(resultIssue(r,'READBACK','party_legacy_links','FIELD_MISMATCH').count,1);
});
test('tampered reviewed timestamp blocks full evidence',()=>{
  const x=input();
  const l=x.readback.party_legacy_links.find(row=>row.link_basis==='HUMAN_VERIFIED');
  l.reviewed_at='2026-11-15T00:00:00Z';
  assert.equal(run(x).offlineEvidenceMatches,false);
});
test('tampered approval reference cannot pass even with unchanged reviewer and time',()=>{
  const x=input();
  const link=x.readback.party_legacy_links.find(l=>l.link_basis==='HUMAN_VERIFIED');
  link.approval_ref='UNRELATED-REF';
  const r=run(x);
  assert.equal(r.approvalEvidencePersistent,false);
  assert.equal(r.offlineEvidenceMatches,false);
});
test('changed human-reviewed link basis blocks approval evidence',()=>{
  const x=input();
  const link=x.readback.party_legacy_links.find(l=>l.link_basis==='HUMAN_VERIFIED');
  link.link_basis='ORIGINAL_RECORD';
  assert.equal(run(x).approvalEvidencePersistent,false);
});
test('changed original source ID in D1 legacy link is not auto-matched by phone/name',()=>{
  const x=input();
  x.readback.party_legacy_links[0].source_id='OTHER-SOURCE-ID';
  const r=run(x);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.ok(resultIssue(r,'READBACK','party_legacy_links','MISSING_ROW'));
  assert.ok(resultIssue(r,'READBACK','party_legacy_links','EXTRA_ROW'));
});
test('missing persisted Party identity row is flagged without exposing Party ID',()=>{
  const x=input();x.readback.parties.pop();
  const r=run(x);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.equal(r.counts.readback.actual.parties,3);
  assert.ok(resultIssue(r,'READBACK','parties','MISSING_ROW'));
});
test('unexpected persisted Party record causes a mismatch despite all expected rows remaining',()=>{
  const x=input();x.readback.parties.push({
    ...x.readback.parties[0],party_id:'PT-UNEXPECTED'
  });
  assert.ok(resultIssue(run(x),'READBACK','parties','EXTRA_ROW'));
});
test('duplicate D1 identity rows fail closed instead of counting as valid',()=>{
  const x=input();x.readback.parties.push({...x.readback.parties[0]});
  const r=run(x);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.ok(resultIssue(r,'READBACK','parties','DUPLICATE_ROW'));
});
test('one missing Owner/Lender/Borrower role membership fails independently of master identity',()=>{
  const x=input();
  x.readback.party_roles=x.readback.party_roles.filter(l=>l.role!=='Lender');
  assert.equal(run(x).offlineEvidenceMatches,false);
  assert.ok(resultIssue(run(x),'READBACK','party_roles','MISSING_ROW'));
});
test('inactive Payee role status cannot silently become active in readback',()=>{
  const x=input();
  const l=x.readback.party_roles.find(r=>r.role==='Payee');l.status='ACTIVE';
  assert.equal(run(x).offlineEvidenceMatches,false);
});
test('invalid Customer signed opening change blocks before D1 readback regardless of matching identities',()=>{
  const x=input();
  x.candidateRows.CUSTOMERS[0]['Opening Balance']=-300;
  const r=run(x);
  assert.equal(r.sourceValidationClear,false);
  assert.equal(r.readbackChecked,false);
  assert.equal(r.readbackMatches,null);
  assert.equal(r.approvalEvidencePersistent,null);
  assert.equal(r.counts.readback,null);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.ok(resultIssue(r,'SOURCE','CUSTOMERS','SOURCE_ROW_CHANGED'));
});
test('incomplete reviewed original master header blocks readback evaluation even if stored Party IDs match',()=>{
  const x=input();x.reviewedHeaders.CUSTOMERS.pop();
  const r=run(x);
  assert.equal(r.sourceValidationClear,false);
  assert.equal(r.readbackChecked,false);
  assert.equal(r.counts.readback,null);
  assert.ok(resultIssue(r,'SOURCE','CUSTOMERS','HEADER_MISMATCH'));
});
test('both equally incomplete reviewed and candidate exports never pass on matching snapshots',()=>{
  const x=input();
  delete x.reviewedRows.VENDORS[0]['Current Receivable'];
  delete x.candidateRows.VENDORS[0]['Current Receivable'];
  const r=run(x);
  assert.equal(r.sourceValidationClear,false);
  assert.equal(r.readbackChecked,false);
  assert.equal(r.offlineEvidenceMatches,false);
  assert.ok(resultIssue(r,'SOURCE','VENDORS','MISSING_FIELD'));
});
test('unapproved same-name/phone identities block readback regardless of D1 snapshot',()=>{
  const x=input();x.approvedGroups=[];
  const r=run(x);
  assert.equal(r.sourceValidationClear,false);
  assert.equal(r.readbackMatches,null);
  assert.equal(r.readbackChecked,false);
  assert.ok(resultIssue(r,'SOURCE','PLAN','PENDING_IDENTITY_REVIEW'));
});
test('changed source identity or finance role blocks before reading stored identities',()=>{
  for(const [group,key,value] of [
    ['CUSTOMERS','Customer ID','CUS-OTHER'],
    ['FINANCE_PERSONS','Roles','Owner,Lender']
  ]){
    const x=input();x.candidateRows[group][0][key]=value;
    const r=run(x);
    assert.equal(r.offlineEvidenceMatches,false);
    assert.equal(r.readbackChecked,false);
  }
});
test('skipped readback does not examine malformed D1-snapshot-shaped data at all',()=>{
  const x=input();
  delete x.candidateRows.SUPPLIERS[0]['Current Due'];
  x.readback=new Proxy({},{
    get(){throw new Error('Do not read stored rows when source validation is blocked');}
  });
  const r=run(x);
  assert.equal(r.readbackChecked,false);
  assert.equal(r.offlineEvidenceMatches,false);
});
test('a missing readback group throws a single non-identifying error when source clear',()=>{
  const x=input();delete x.readback.party_legacy_links;
  assert.throws(()=>run(x),/^Error: Party import evidence unavailable$/);
});
test('malformed stored readback record throws a generic error without source values',()=>{
  const x=input();x.readback.parties[0]=null;
  assert.throws(()=>run(x),/^Error: Party import evidence unavailable$/);
});
test('unverified human approval claim is not converted to success',()=>{
  const x=input();x.approvedGroups[0].reviewedAt='not-utc';
  assert.throws(()=>run(x),/^Error: Party import evidence unavailable$/);
});
test('source names, phones, original IDs, reviewer claims, money and readback values never appear in report',()=>{
  const x=input();x.readback.parties[0].display_name='PRIVATE NAME';
  x.readback.party_legacy_links[1].reviewed_by='private-reviewer';
  const r=run(x);
  const output=JSON.stringify(r);
  assert.doesNotMatch(output,/Rahim|01700000000|CUS-001|SUP-001|VEN-001|FIN-001|PAY-001|REVIEW-001|admin-01|PRIVATE NAME|private-reviewer|Current Due|300/);
  assert.ok(r.issues.every(x=>Object.keys(x).sort().join(',')==='code,count,scope,stage'));
  assert.equal(r.offlineEvidenceMatches,false);
});
test('issue ordering and counts are deterministic independent of D1 readback row order',()=>{
  const x=input();
  x.readback.party_roles.reverse();
  x.readback.party_legacy_links.reverse();
  assert.equal(run(x).offlineEvidenceMatches,true);
});
test('the source, approved claims, and readback snapshots remain unchanged by evaluation',()=>{
  const x=input(),before=structuredClone(x);
  run(x);
  assert.deepEqual(x,before);
});
test('no synthetic offline result implies production cutover, money netting or auth approval',()=>{
  const r=run();
  assert.equal(Object.hasOwn(r,'productionReady'),false);
  assert.equal(Object.hasOwn(r,'accounts'),false);
  assert.equal(Object.hasOwn(r,'settlements'),false);
  assert.equal(Object.hasOwn(r,'reviewerAuthorized'),false);
});
