import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10EvidencePacket} from '../src/migration/m10-evidence-packet.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'
));
const hash=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},i)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:i+1,rowDigest:hash(i+1),
    positionDigest:hash(i+1001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:i+1,rowDigest:hash(i+1),idDigest:hash(i+1001)}
);
const domainPairs=[
  ['CUSTOMERS','SOURCE_CURRENT'],['CUSTOMERS','HISTORICAL_OPENING'],
  ['SUPPLIERS','SOURCE_CURRENT'],['SUPPLIERS','HISTORICAL_OPENING'],
  ['VENDORS','SOURCE_CURRENT'],['FINANCE_PERSONS','SOURCE_CURRENT']
];
const domains=()=>domainPairs.map(([sourceGroup,basis])=>({sourceGroup,basis}));
const snap=(captureId,capturedAt)=>({captureId,capturedAt,sourceCommit:PIN,
  domains:domains(),accounts:[{
    sourceGroup:'CUSTOMERS',legacyIdDigest:hash(901),accountKind:'CUSTOMER_ADVANCE',
    sourceField:'Opening Balance',basis:'HISTORICAL_OPENING',
    currency:'BDT',amountMinor:'25000'
  }]
});
const gross=()=>({
  sourcePlanReviewed:true,identityReviewsPending:0,
  source:snap('GROSS-SOURCE-001','2026-11-17T06:00:00.000Z'),
  d1:snap('GROSS-D1-00001','2026-11-17T06:05:00.000Z')
});
const grossParity=()=>({
  sourcePlanValid:true,readbackChecked:true,currentMatch:true,openingMatch:true,
  offlineCheckpointParity:true,issues:[],
  counts:{expectedCurrent:7,observedCurrent:7,
    expectedOpening:2,observedOpening:2}
});
const sourceFreeze=()=>({
  firstPass:{snapshotId:'FROZEN-PASS-001',
    capturedAt:'2026-11-16T10:00:00.000Z',sourceCommit:PIN,groups:groups()},
  secondPass:{snapshotId:'FROZEN-PASS-002',
    capturedAt:'2026-11-16T10:01:00.000Z',sourceCommit:PIN,groups:groups()}
});
const rehearsal=()=>({
  inventory,coverage:{
    formatVersion:1,sourceCommit:PIN,
    summary:{sourceGroups:49,fullyReconciled:49},
    rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))
  },
  sourceSummary:groups(),d1Summary:groups(),grossParity:grossParity(),
  pendingIdentityReviews:0,sourceFreeze:sourceFreeze()
});
const restore=()=>({
  inventory,
  backup:{captureId:'BACKUP-001',capturedAt:'2026-11-17T06:10:00.000Z',
    sourceCommit:PIN,groups:groups()},
  restored:{captureId:'RESTORE-001',capturedAt:'2026-11-17T06:20:00.000Z',
    sourceCommit:PIN,groups:groups()},
  receipt:{attemptId:'DRILL-0001',backupCaptureId:'BACKUP-001',
    restoredCaptureId:'RESTORE-001',isolatedTarget:true,
    completedAt:'2026-11-17T06:15:00.000Z'}
});
const performance=()=>({
  policy:{formatVersion:1,reviewRef:'SYNTH-REVIEW-001',reviewed:true,
    workloads:[{workloadId:'PARTY_LEDGER',latencyP95MaxMs:100,
      latencyP99MaxMs:120,cpuP95MaxMs:20,
      d1QueriesP95Max:5,d1RowsReadP95Max:40}]},
  recording:{sourceCommit:PIN,environment:'LOCAL_SYNTHETIC',
    datasetRef:'SYNTH-DATA-001',captureId:'SYNTH-PERF-001',
    capturedAt:'2026-11-17T07:00:00.000Z',
    workloads:[{workloadId:'PARTY_LEDGER',
      samples:Array.from({length:100},()=>({
        latencyMs:80,cpuMs:10,d1Queries:2,d1RowsRead:30
      }))}]}
});
const packet=()=>({rehearsal:rehearsal(),restore:restore(),
  gross:gross(),performance:performance()});
const issue=(r,code)=>r.issues.find(x=>x.code===code)?.count||0;

test('all four synthetic gates provide candidate-only report, never a production GO',()=>{
  const r=assessM10EvidencePacket(packet());
  assert.deepEqual(r,{
    formatVersion:1,phase:'M10_OFFLINE_EVIDENCE_PACKET',
    chainCandidate:true,grossCandidate:true,performanceCandidate:true,
    candidateEvidenceComplete:true,
    authorizesImport:false,authorizesPosting:false,
    authorizesRestore:false,authorizesCutover:false,productionReady:false,
    issues:[],limitations:'Supplied offline evidence cannot prove authorized source capture, actual D1 import, independent account/security review or production release'
  });
});

test('all missing evidence is blocked with three fixed redacted codes',()=>{
  const r=assessM10EvidencePacket({});
  assert.equal(issue(r,'PACKET_CHAIN_EVIDENCE_MISSING'),1);
  assert.equal(issue(r,'PACKET_GROSS_EVIDENCE_MISSING'),1);
  assert.equal(issue(r,'PACKET_PERFORMANCE_EVIDENCE_MISSING'),1);
  assert.equal(r.candidateEvidenceComplete,false);
  assert.equal(r.productionReady,false);
});

test('one missing restore breaks chain even if source and Party/perf evidence are green',()=>{
  const x=packet();delete x.restore;
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_CHAIN_EVIDENCE_MISSING'),1);
  assert.equal(r.chainCandidate,false);
  assert.equal(r.grossCandidate,true);
});

test('two individually positive gross and performance gates cannot override D1 row-content drift',()=>{
  const x=packet();
  x.restore.backup.groups[0].rowDigest=hash(999);
  x.restore.restored.groups[0].rowDigest=hash(999);
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_CHAIN_NOT_READY'),1);
  assert.equal(r.grossCandidate,true);
  assert.equal(r.performanceCandidate,true);
  assert.equal(r.candidateEvidenceComplete,false);
});

test('one-cent gross original-account drift blocks whole packet despite matching 49 group hashes',()=>{
  const x=packet();x.gross.d1.accounts[0].amountMinor='25001';
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_GROSS_NOT_READY'),1);
  assert.equal(r.chainCandidate,true);
  assert.equal(r.grossCandidate,false);
});

test('latency p99 over budget blocks whole packet without leaking samples',()=>{
  const x=packet();x.performance.recording.workloads[0].samples.slice(98)
    .forEach(s=>{s.latencyMs=121;});
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_PERFORMANCE_NOT_READY'),1);
  assert.equal(r.chainCandidate,true);
  assert.equal(r.performanceCandidate,false);
});

test('cross-gate identity-review count inconsistency blocks candidate independently',()=>{
  const x=packet();
  x.gross.identityReviewsPending=2;
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_IDENTITY_REVIEW_COUNT_CONFLICT'),1);
  assert.equal(issue(r,'PACKET_GROSS_NOT_READY'),1);
});

test('Party source/D1 captures may not be newer than the backup they purport to reconcile',()=>{
  const x=packet();
  x.gross.d1.capturedAt='2026-11-17T06:12:00.000Z';
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_GROSS_CAPTURE_AFTER_BACKUP'),1);
  assert.equal(r.grossCandidate,true);
  assert.equal(r.candidateEvidenceComplete,false);
});

test('both Party captures after backup count separately and cannot be hidden by matching amounts',()=>{
  const x=packet();
  x.gross.source.capturedAt='2026-11-17T06:30:00.000Z';
  x.gross.d1.capturedAt='2026-11-17T06:40:00.000Z';
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_GROSS_CAPTURE_AFTER_BACKUP'),2);
});

test('gross source captured before source freeze is not valid chain evidence',()=>{
  const x=packet();
  x.gross.source.capturedAt='2026-11-16T09:00:00.000Z';
  const r=assessM10EvidencePacket(x);
  assert.equal(r.grossCandidate,true);
  assert.equal(issue(r,'PACKET_GROSS_CAPTURE_BEFORE_SOURCE_FREEZE'),1);
  assert.equal(r.candidateEvidenceComplete,false);
});
test('both gross captures dated before second source freeze produce two separate blockers',()=>{
  const x=packet();
  x.gross.source.capturedAt='2026-11-16T09:00:00.000Z';
  x.gross.d1.capturedAt='2026-11-16T09:30:00.000Z';
  const r=assessM10EvidencePacket(x);
  assert.equal(issue(r,'PACKET_GROSS_CAPTURE_BEFORE_SOURCE_FREEZE'),2);
});
test('budget-compliant performance samples measured before restored readback still fail packet',()=>{
  const x=packet();
  x.performance.recording.capturedAt='2026-11-17T06:19:00.000Z';
  const r=assessM10EvidencePacket(x);
  assert.equal(r.performanceCandidate,true);
  assert.equal(issue(r,'PACKET_PERFORMANCE_CAPTURE_BEFORE_RESTORE'),1);
  assert.equal(r.candidateEvidenceComplete,false);
});

test('LOGS cannot be silently given invented source ID provenance',()=>{
  const x=packet();
  x.rehearsal.sourceSummary.find(g=>g.sheetKey==='LOGS').idDigest=hash(30);
  assert.throws(()=>assessM10EvidencePacket(x),
    {message:'M10 evidence packet invalid'});
});

test('malformed nested evidence and malicious getter errors are consistently redacted',()=>{
  for(const change of [
    x=>{x.gross.source.accounts[0].customerPhone='PRIVATE-SHOAIB-ACCOUNT';},
    x=>{x.performance.recording.sourceCommit='PRIVATE-SOURCE-SECRET';},
    x=>Object.defineProperty(x.restore.backup,'captureId',{
      enumerable:true,get(){throw new Error('PRIVATE-SHOAIB-ACCOUNT');}
    }),
    x=>Object.defineProperty(x,'rehearsal',{
      enumerable:true,get(){throw new Error('PRIVATE-SHOAIB-ACCOUNT');}
    }),
    x=>{x.unknownCustomer='PRIVATE-SHOAIB-ACCOUNT';}
  ]){
    const x=packet();change(x);
    assert.throws(()=>assessM10EvidencePacket(x),
      e=>e.message==='M10 evidence packet invalid'&&
        !/PRIVATE|SHOAIB|ACCOUNT/.test(e.message));
  }
});

test('source snapshots, receipts, Party identifiers and money never appear in packet report',()=>{
  const x=packet();
  x.performance.recording.workloads[0].samples.slice(94).forEach(s=>s.cpuMs=21);
  const original=structuredClone(x);
  const a=assessM10EvidencePacket(x),b=assessM10EvidencePacket(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,original);
  assert.deepEqual(a.issues.map(v=>v.code),[...a.issues.map(v=>v.code)].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /SOURCE-ACCOUNT|GROSS-SOURCE|GROSS-D1|BACKUP-001|SYNTH-PERF|25000|amountMinor|legacyIdDigest|rowDigest|latencyMs|cpuMs|PRIVATE/);
});

test('declared synthetic performance evidence remains nonproduction even when everything matches',()=>{
  const x=packet();
  assert.equal(x.performance.recording.environment,'LOCAL_SYNTHETIC');
  const r=assessM10EvidencePacket(x);
  assert.equal(r.candidateEvidenceComplete,true);
  assert.equal(r.authorizesImport,false);
  assert.equal(r.authorizesRestore,false);
  assert.equal(r.authorizesCutover,false);
  assert.equal(r.productionReady,false);
});
