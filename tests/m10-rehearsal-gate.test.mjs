import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10RehearsalEvidence} from '../src/migration/m10-rehearsal-gate.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const pin=(n)=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map((row,index)=>({
  sheetKey:row.sheetKey,rowCount:index+1,rowDigest:pin(index+1),idDigest:pin(index+1001)
}));
const coverage=(reconciled=true)=>({
  formatVersion:1,sourceCommit,
  summary:{sourceGroups:inventory.tables.length,fullyReconciled:reconciled?inventory.tables.length:0},
  rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:reconciled}))
});
const gross=()=>({
  sourcePlanValid:true,readbackChecked:true,currentMatch:true,openingMatch:true,
  offlineCheckpointParity:true,issues:[],
  counts:{expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2}
});
const sourceFreeze=()=>({
  firstPass:{snapshotId:'OFFLINE-PASS-001',capturedAt:'2026-11-16T10:00:00.000Z',
    sourceCommit,groups:groups()},
  secondPass:{snapshotId:'OFFLINE-PASS-002',capturedAt:'2026-11-16T10:01:00.000Z',
    sourceCommit,groups:groups()}
});
const evidence=()=>({
  inventory,coverage:coverage(),sourceSummary:groups(),d1Summary:groups(),
  grossParity:gross(),pendingIdentityReviews:0,sourceFreeze:sourceFreeze()
});
const issue=(report,code)=>report.issues.find(item=>item.code===code)?.count||0;

test('M10 comparator never grants remote import or cutover, even with complete synthetic matching evidence',()=>{
  assert.equal(inventory.tables.length,49);
  const r=assessM10RehearsalEvidence(evidence());
  assert.equal(r.formatVersion,1);
  assert.equal(r.phase,'M10_OFFLINE_PREFLIGHT');
  assert.equal(r.groupComparisonsComplete,true);
  assert.equal(r.groupsMatched,true);
  assert.equal(r.grossPartyParityMatched,true);
  assert.equal(r.candidateDataParity,true);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.authorizesImport,false);
  assert.equal(r.productionReady,false);
  assert.match(r.limitations,/not.*approval|not.*proof/i);
});

test('real migration coverage has zero reconciled source groups and blocks M10',()=>{
  const x=evidence();
  x.coverage=coverage(false);
  const r=assessM10RehearsalEvidence(x);
  assert.equal(r.candidateDataParity,false);
  assert.equal(r.productionReady,false);
  assert.equal(issue(r,'MIGRATION_COVERAGE_INCOMPLETE'),49);
});

test('missing private source and D1 readback evidence fails closed',()=>{
  const r=assessM10RehearsalEvidence({inventory,coverage:coverage(false)});
  assert.equal(r.groupComparisonsComplete,false);
  assert.equal(r.candidateDataParity,false);
  assert.equal(issue(r,'SOURCE_SNAPSHOT_MISSING'),1);
  assert.equal(issue(r,'D1_READBACK_MISSING'),1);
  assert.equal(issue(r,'GROSS_PARTY_PARITY_UNVERIFIED'),1);
  assert.equal(issue(r,'IDENTITY_REVIEW_EVIDENCE_MISSING'),1);
});

test('all 49 source groups require matching row counts, row hashes and original-ID hashes',()=>{
  for(const [field,code,value] of [
    ['rowCount','GROUP_ROW_COUNT_MISMATCH',999],
    ['rowDigest','GROUP_ROW_DIGEST_MISMATCH',pin(5555)],
    ['idDigest','GROUP_ID_DIGEST_MISMATCH',pin(6666)]
  ]){
    const x=evidence();
    x.d1Summary[0][field]=value;
    const r=assessM10RehearsalEvidence(x);
    assert.equal(r.candidateDataParity,false,field);
    assert.equal(issue(r,code),1,field);
  }
});

test('missing, extra and duplicate groups are rejected rather than inferred from total counts',()=>{
  const missing=evidence();
  missing.d1Summary.pop();
  assert.equal(issue(assessM10RehearsalEvidence(missing),'GROUP_MISSING_D1'),1);
  const extra=evidence();
  extra.d1Summary.push({sheetKey:'UNREVIEWED',rowCount:1,rowDigest:pin(1),idDigest:pin(1)});
  assert.equal(issue(assessM10RehearsalEvidence(extra),'GROUP_UNEXPECTED_D1'),1);
  const duplicate=evidence();
  duplicate.sourceSummary.push({...duplicate.sourceSummary[0]});
  assert.equal(issue(assessM10RehearsalEvidence(duplicate),'GROUP_DUPLICATE_SOURCE'),1);
});

test('gross current and historical balances must be checked independently and unresolved Party identity reviews block parity',()=>{
  const x=evidence();
  x.grossParity.openingMatch=false;
  x.grossParity.offlineCheckpointParity=false;
  x.pendingIdentityReviews=2;
  const r=assessM10RehearsalEvidence(x);
  assert.equal(r.candidateDataParity,false);
  assert.equal(issue(r,'GROSS_PARTY_PARITY_UNVERIFIED'),1);
  assert.equal(issue(r,'IDENTITY_REVIEW_PENDING'),2);
});

test('invalid evidence throws only fixed redacted error, never IDs, amounts, raw hashes or private fields',()=>{
  for(const alteration of [
    x=>{x.coverage.sourceCommit='PRIVATE-SOURCE-SECRET';},
    x=>{x.sourceSummary[0].rowCount=-1;},
    x=>{x.d1Summary[0].rowDigest='SECRET-CUSTOMER';},
    x=>{x.inventory.tables=x.inventory.tables.slice(1);},
    x=>{x.pendingIdentityReviews=-1;}
  ]){
    const x=evidence();
    x.inventory=structuredClone(x.inventory);
    alteration(x);
    assert.throws(()=>assessM10RehearsalEvidence(x),
      err=>err.message==='M10 rehearsal evidence invalid' &&
        !/PRIVATE|SECRET|CUSTOMER/.test(err.message));
  }
  const x=evidence();
  x.d1Summary[0].idDigest=pin(9999);
  const report=JSON.stringify(assessM10RehearsalEvidence(x));
  assert.doesNotMatch(report,/9999|PRIVATE|SECRET|rowDigest|idDigest|sourceId|amountMinor/);
});

test('inputs remain immutable and issue ordering is deterministic',()=>{
  const x=evidence();
  x.d1Summary[0].rowCount=0;
  x.pendingIdentityReviews=1;
  const before=structuredClone(x);
  const a=assessM10RehearsalEvidence(x);
  const b=assessM10RehearsalEvidence(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,before);
  assert.deepEqual(a.issues.map(i=>i.code),[...a.issues.map(i=>i.code)].sort());
});
