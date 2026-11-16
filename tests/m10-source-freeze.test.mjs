import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10SourceFreeze} from '../src/migration/m10-source-freeze.js';
import {assessM10RehearsalEvidence} from '../src/migration/m10-rehearsal-gate.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const digest=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map((x,i)=>({
  sheetKey:x.sheetKey,rowCount:i===0?0:i+1,
  rowDigest:digest(i+1),idDigest:digest(i+1000)
}));
const pass=(id,date,rows=groups())=>({
  snapshotId:id,capturedAt:date,sourceCommit:pin,groups:rows
});
const captures=()=>({
  firstPass:pass('OFFLINE-PASS-001','2026-11-16T10:00:00.000Z'),
  secondPass:pass('OFFLINE-PASS-002','2026-11-16T10:01:00.000Z')
});
const run=(x={})=>assessM10SourceFreeze({
  inventory,finalSourceSummary:groups(),...captures(),...x
});
const issue=(r,code)=>r.issues.find(i=>i.code===code)?.count||0;

test('M10 two independently identified complete 49-group captures can establish summary stability only',()=>{
  assert.equal(inventory.tables.length,49);
  const r=run();
  assert.deepEqual(Object.keys(r).sort(),['comparisonsComplete','formatVersion','issues','stable']);
  assert.equal(r.formatVersion,1);
  assert.equal(r.comparisonsComplete,true);
  assert.equal(r.stable,true);
  assert.deepEqual(r.issues,[]);
  assert.doesNotMatch(JSON.stringify(r),/OFFLINE-PASS|rowDigest|idDigest|snapshotId|capturedAt/);
});

test('source row count, source content and original-ID changes across captures are separately rejected',()=>{
  for(const [key,code,value] of [
    ['rowCount','SOURCE_FREEZE_ROW_COUNT_CHANGED',200],
    ['rowDigest','SOURCE_FREEZE_ROW_DIGEST_CHANGED',digest(777)],
    ['idDigest','SOURCE_FREEZE_ID_DIGEST_CHANGED',digest(888)]
  ]){
    const x=captures();
    x.secondPass.groups[0][key]=value;
    const r=run(x);
    assert.equal(r.stable,false,key);
    assert.equal(issue(r,code),1,key);
  }
});

test('a final D1 comparison against stale first pass is rejected even if original captures were ordered',()=>{
  const x=captures();
  x.secondPass.groups[0].rowDigest=digest(999);
  const r=run({...x,finalSourceSummary:groups()});
  assert.equal(r.stable,false);
  assert.equal(issue(r,'SOURCE_FREEZE_FINAL_SOURCE_MISMATCH'),1);
});

test('reordered group arrays remain stable but missing, extra and duplicate groups cannot pass',()=>{
  const x=captures();x.secondPass.groups.reverse();
  assert.equal(run(x).stable,true);
  const missing=captures();missing.secondPass.groups.pop();
  const a=run(missing);assert.equal(a.stable,false);
  assert.equal(issue(a,'SOURCE_FREEZE_INCOMPLETE_GROUPS'),1);
  const extra=captures();
  extra.firstPass.groups.push({
    sheetKey:'UNREVIEWED_SOURCE',rowCount:1,rowDigest:digest(1),idDigest:digest(2)
  });
  assert.equal(issue(run(extra),'SOURCE_FREEZE_UNREVIEWED_GROUP'),1);
  const duplicate=captures();
  duplicate.secondPass.groups.push({...duplicate.secondPass.groups[0]});
  assert.equal(issue(run(duplicate),'SOURCE_FREEZE_DUPLICATE_GROUP'),1);
});

test('missing capture or missing final source summary never establishes stability',()=>{
  assert.equal(issue(run({firstPass:undefined}),'SOURCE_FREEZE_EVIDENCE_MISSING'),1);
  assert.equal(issue(run({secondPass:undefined}),'SOURCE_FREEZE_EVIDENCE_MISSING'),1);
  assert.equal(issue(run({finalSourceSummary:undefined}),'SOURCE_FREEZE_FINAL_SOURCE_MISSING'),1);
});

test('reused capture ID and reversed/equal timestamps cannot claim independent ordered captures',()=>{
  const same=captures();same.secondPass.snapshotId=same.firstPass.snapshotId;
  assert.equal(issue(run(same),'SOURCE_FREEZE_CAPTURE_NOT_DISTINCT'),1);
  const reversed=captures();reversed.secondPass.capturedAt='2026-11-16T09:59:59.000Z';
  assert.equal(issue(run(reversed),'SOURCE_FREEZE_CAPTURE_NOT_ORDERED'),1);
  const equal=captures();equal.secondPass.capturedAt=equal.firstPass.capturedAt;
  assert.equal(issue(run(equal),'SOURCE_FREEZE_CAPTURE_NOT_ORDERED'),1);
});

test('invalid pin, noncanonical UTC timestamps, illegal keys or malformed SHA are rejected with fixed message',()=>{
  const failures=[
    x=>{x.firstPass.sourceCommit='PRIVATE-BAD-PIN';},
    x=>{x.firstPass.capturedAt='2026-11-16T10:00:00+06:00';},
    x=>{x.secondPass.capturedAt='2026-02-30T10:00:00.000Z';},
    x=>{x.firstPass.snapshotId='PRIVATE SOURCE SECRET';},
    x=>{x.firstPass.groups[0].rowDigest='PRIVATE_HASH';},
    x=>{x.secondPass.groups[0].idDigest='UPPERCASE-SECRET';},
    x=>{x.secondPass.groups[0].extraToken='LEAK';},
    x=>{x.firstPass.privateDetails='LEAK';},
  ];
  for(const mutation of failures){
    const x=captures();mutation(x);
    assert.throws(()=>run(x),e=>
      e.message==='M10 source freeze evidence invalid' && !/PRIVATE|LEAK|HASH/.test(e.message));
  }
});

test('source capture comparison never mutates caller-owned evidence; issues sorted by fixed code',()=>{
  const x=captures();
  x.firstPass.groups[0].rowCount=3;
  x.secondPass.groups[1].idDigest=digest(775);
  const before=structuredClone(x);
  const r=run(x);
  assert.deepEqual(x,before);
  assert.deepEqual(r.issues.map(y=>y.code),[...r.issues.map(y=>y.code)].sort());
  assert.equal(r.stable,false);
});

test('M10 master gate rejects fully matching source/D1 snapshots without stable two-pass freeze',()=>{
  const coverage={formatVersion:1,sourceCommit:pin,
    summary:{sourceGroups:49,fullyReconciled:49},
    rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))};
  const grossParity={sourcePlanValid:true,readbackChecked:true,
    currentMatch:true,openingMatch:true,offlineCheckpointParity:true,issues:[],
    counts:{expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2}};
  const common={inventory,coverage,sourceSummary:groups(),d1Summary:groups(),
    grossParity,pendingIdentityReviews:0};
  const without=assessM10RehearsalEvidence(common);
  assert.equal(without.candidateDataParity,false);
  assert.equal(issue(without,'SOURCE_FREEZE_EVIDENCE_MISSING'),1);
  const evidence=captures();
  const matched=assessM10RehearsalEvidence({...common,sourceFreeze:evidence});
  assert.equal(matched.candidateDataParity,true);
  assert.equal(matched.authorizesImport,false);
  assert.equal(matched.productionReady,false);
  const drifted=captures();
  drifted.secondPass.groups[0].rowDigest=digest(999);
  const broken=assessM10RehearsalEvidence({...common,sourceFreeze:drifted});
  assert.equal(broken.candidateDataParity,false);
  assert.equal(issue(broken,'SOURCE_FREEZE_ROW_DIGEST_CHANGED'),1);
  assert.equal(issue(broken,'SOURCE_FREEZE_FINAL_SOURCE_MISMATCH'),1);
});

test('accessor-backed snapshot evidence is rejected before reading private getter side effects',()=>{
  for(const key of ['rowDigest','idDigest']){
    const x=captures();
    Object.defineProperty(x.firstPass.groups[0],key,{
      enumerable:true,configurable:true,
      get(){throw new Error('PRIVATE_BUSINESS_VALUE_EXPOSED');}
    });
    assert.throws(()=>run(x),error=>
      error.message==='M10 source freeze evidence invalid' &&
      !error.message.includes('PRIVATE_BUSINESS_VALUE_EXPOSED'));
  }
  const x=captures();
  Object.defineProperty(x.firstPass,'snapshotId',{
    enumerable:true,configurable:true,
    get(){throw new Error('PRIVATE_SNAPSHOT_TOKEN_EXPOSED');}
  });
  assert.throws(()=>run(x),error=>
    error.message==='M10 source freeze evidence invalid' &&
    !error.message.includes('PRIVATE_SNAPSHOT_TOKEN_EXPOSED'));
});
