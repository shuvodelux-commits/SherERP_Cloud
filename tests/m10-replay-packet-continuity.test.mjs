import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10ReplayPacketContinuity} from '../src/migration/m10-replay-packet-continuity.js';
import {assessM10EvidencePacket} from '../src/migration/m10-evidence-packet.js';
import {assessM10ImportReplayEvidence} from '../src/migration/m10-import-replay-evidence.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const hex=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},i)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:i+1,rowDigest:hex(i+1),
    positionDigest:hex(i+2001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:i+1,rowDigest:hex(i+1),idDigest:hex(i+2001)});
const archive=(captureId,capturedAt)=>({captureId,capturedAt,sourceCommit:PIN,groups:groups()});
const coverage=()=>({formatVersion:1,sourceCommit:PIN,
  summary:{sourceGroups:49,fullyReconciled:49},
  rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))});
const accountDomains=()=>[
  {sourceGroup:'CUSTOMERS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'CUSTOMERS',basis:'HISTORICAL_OPENING'},
  {sourceGroup:'SUPPLIERS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'SUPPLIERS',basis:'HISTORICAL_OPENING'},
  {sourceGroup:'VENDORS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'FINANCE_PERSONS',basis:'SOURCE_CURRENT'}
];
const grossSnap=(captureId,capturedAt)=>({captureId,capturedAt,sourceCommit:PIN,
  domains:accountDomains(),accounts:[{
    sourceGroup:'CUSTOMERS',legacyIdDigest:hex(901),accountKind:'CUSTOMER_ADVANCE',
    sourceField:'Opening Balance',basis:'HISTORICAL_OPENING',
    currency:'BDT',amountMinor:'25000'
  }]
});
const packet=()=>({
  rehearsal:{
    inventory,coverage:coverage(),sourceSummary:groups(),d1Summary:groups(),
    grossParity:{sourcePlanValid:true,readbackChecked:true,currentMatch:true,
      openingMatch:true,offlineCheckpointParity:true,issues:[],
      counts:{expectedCurrent:7,observedCurrent:7,
        expectedOpening:2,observedOpening:2}},
    pendingIdentityReviews:0,
    sourceFreeze:{
      firstPass:{snapshotId:'FREEZE-SOURCE-001',
        capturedAt:'2026-11-16T10:00:00.000Z',sourceCommit:PIN,groups:groups()},
      secondPass:{snapshotId:'FREEZE-SOURCE-002',
        capturedAt:'2026-11-16T10:01:00.000Z',sourceCommit:PIN,groups:groups()}
    }
  },
  restore:{
    inventory,
    backup:archive('BACKUP-PACKET-001','2026-11-17T06:10:00.000Z'),
    restored:archive('RESTORED-PACKET1','2026-11-17T06:20:00.000Z'),
    receipt:{attemptId:'RESTORE-DRILL-01',backupCaptureId:'BACKUP-PACKET-001',
      restoredCaptureId:'RESTORED-PACKET1',isolatedTarget:true,
      completedAt:'2026-11-17T06:15:00.000Z'}
  },
  gross:{
    sourcePlanReviewed:true,identityReviewsPending:0,
    source:grossSnap('GROSS-SOURCE-001','2026-11-17T06:00:00.000Z'),
    d1:grossSnap('GROSS-D1-00001','2026-11-17T06:05:00.000Z')
  },
  performance:{
    policy:{formatVersion:1,reviewRef:'SYNTH-REVIEW-001',reviewed:true,
      workloads:[{workloadId:'PARTY_LEDGER',latencyP95MaxMs:100,
        latencyP99MaxMs:120,cpuP95MaxMs:20,d1QueriesP95Max:5,d1RowsReadP95Max:40}]},
    recording:{sourceCommit:PIN,environment:'LOCAL_SYNTHETIC',
      datasetRef:'SYNTH-DATA-001',captureId:'SYNTH-PERF-001',
      capturedAt:'2026-11-17T07:00:00.000Z',
      workloads:[{workloadId:'PARTY_LEDGER',
        samples:Array.from({length:100},()=>({
          latencyMs:80,cpuMs:10,d1Queries:2,d1RowsRead:30
        }))}]}
  }
});
const receipt=(attemptId,readbackCaptureId,outcome,recordedAt)=>({
  attemptId,readbackCaptureId,outcome,recordedAt,isolatedTarget:true
});
const replay=()=>({
  inventory,coverage:coverage(),
  source:archive('SOURCE-REPLAY-001','2026-11-17T06:00:00.000Z'),
  firstImport:archive('D1-FIRST-REPLAY1','2026-11-17T06:02:00.000Z'),
  replayedImport:archive('D1-SECOND-REPLAY','2026-11-17T06:04:00.000Z'),
  rejectedRetryReadback:archive('D1-REJECT-READ01','2026-11-17T06:06:00.000Z'),
  receipts:{
    first:receipt('ATTEMPT-FIRST01','D1-FIRST-REPLAY1','COMMITTED','2026-11-17T06:01:00.000Z'),
    replay:receipt('ATTEMPT-REPLAY01','D1-SECOND-REPLAY','REPLAYED','2026-11-17T06:03:00.000Z'),
    rejected:receipt('ATTEMPT-REJECT01','D1-REJECT-READ01','REJECTED','2026-11-17T06:05:00.000Z')
  }
});
const fixture=()=>({packet:packet(),replay:replay()});
const issue=(result,name)=>result.issues.find(x=>x.code===name)?.count||0;
const mutate=edit=>{const value=fixture();edit(value);return assessM10ReplayPacketContinuity(value);};
const packetGroupArrays=p=>[
  p.rehearsal.sourceSummary,p.rehearsal.d1Summary,
  p.rehearsal.sourceFreeze.firstPass.groups,p.rehearsal.sourceFreeze.secondPass.groups,
  p.restore.backup.groups,p.restore.restored.groups
];

test('same synthetic 49-group dataset across Run 1 and Run 2 is candidate only, never GO',()=>{
  const x=fixture();
  assert.equal(assessM10EvidencePacket(x.packet).candidateEvidenceComplete,true);
  assert.equal(assessM10ImportReplayEvidence(x.replay).candidateReplayEvidence,true);
  assert.deepEqual(assessM10ReplayPacketContinuity(x),{
    formatVersion:1,phase:'M10_OFFLINE_REPLAY_PACKET_CONTINUITY',
    packetCandidate:true,replayCandidate:true,
    groupsLinked:true,candidateCrossGateContinuity:true,
    authorizesImport:false,authorizesPosting:false,
    authorizesRestore:false,authorizesCutover:false,productionReady:false,
    issues:[],limitations:'Two individually matching supplied evidence sets cannot independently prove real source custody, D1 execution, rollback or production readiness'
  });
});

test('individually passing source→D1 chain and replay with disjoint 49-group content must fail',()=>{
  const x=fixture();
  for(const array of packetGroupArrays(x.packet)){
    array[0].rowDigest=hex(99988);
  }
  assert.equal(assessM10EvidencePacket(x.packet).candidateEvidenceComplete,true);
  assert.equal(assessM10ImportReplayEvidence(x.replay).candidateReplayEvidence,true);
  const r=assessM10ReplayPacketContinuity(x);
  assert.equal(issue(r,'CONTINUITY_SOURCE_ROW_DIGEST_MISMATCH'),1);
  assert.equal(issue(r,'CONTINUITY_D1_ROW_DIGEST_MISMATCH'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
  assert.equal(r.productionReady,false);
});

test('LOGS physical-position commitments must agree between two otherwise green chains',()=>{
  const x=fixture();
  for(const array of packetGroupArrays(x.packet)){
    array.find(v=>v.sheetKey==='LOGS').positionDigest=hex(987654);
  }
  assert.equal(assessM10EvidencePacket(x.packet).candidateEvidenceComplete,true);
  assert.equal(assessM10ImportReplayEvidence(x.replay).candidateReplayEvidence,true);
  const r=assessM10ReplayPacketContinuity(x);
  assert.equal(issue(r,'CONTINUITY_SOURCE_POSITION_DIGEST_MISMATCH'),1);
  assert.equal(issue(r,'CONTINUITY_D1_POSITION_DIGEST_MISMATCH'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
});

test('all-49 valid first/replay readback cannot be dated before its second source-freeze pass',()=>{
  const r=mutate(x=>{
    x.replay.source.capturedAt='2026-11-16T09:00:00.000Z';
  });
  assert.equal(issue(r,'CONTINUITY_REPLAY_SOURCE_BEFORE_FREEZE'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
});

test('rejected retry readback must occur before backup claimed to include it',()=>{
  const r=mutate(x=>{
    x.replay.rejectedRetryReadback.capturedAt='2026-11-17T06:11:00.000Z';
    x.replay.receipts.rejected.recordedAt='2026-11-17T06:10:30.000Z';
  });
  assert.equal(issue(r,'CONTINUITY_BACKUP_BEFORE_REJECTED_READBACK'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
});

test('reusing the backup capture ID for a replay readback is rejected across gates',()=>{
  const r=mutate(x=>{
    const same=x.packet.restore.backup.captureId;
    x.replay.rejectedRetryReadback.captureId=same;
    x.replay.receipts.rejected.readbackCaptureId=same;
  });
  assert.equal(issue(r,'CONTINUITY_CAPTURE_ID_REUSED'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
});

test('a valid replay cannot override missing or failed complete packet evidence',()=>{
  const a=mutate(x=>delete x.packet.restore);
  assert.equal(issue(a,'CONTINUITY_PACKET_NOT_READY'),1);
  assert.equal(a.replayCandidate,true);
  assert.equal(a.candidateCrossGateContinuity,false);
  const b=mutate(x=>x.packet.gross.d1.accounts[0].amountMinor='25001');
  assert.equal(issue(b,'CONTINUITY_PACKET_NOT_READY'),1);
  assert.equal(b.candidateCrossGateContinuity,false);
});

test('packet candidate cannot override rejected retry drift or unmapped source coverage',()=>{
  const a=mutate(x=>x.replay.rejectedRetryReadback.groups[4].rowCount++);
  assert.equal(issue(a,'CONTINUITY_REPLAY_NOT_READY'),1);
  assert.equal(a.packetCandidate,true);
  const b=mutate(x=>{
    x.replay.coverage.summary.fullyReconciled=0;
    x.replay.coverage.rows.forEach(v=>v.sourceImportReconciled=false);
  });
  assert.equal(issue(b,'CONTINUITY_REPLAY_NOT_READY'),1);
});

test('missing one or both supplied gates returns fixed blocker codes',()=>{
  const r=assessM10ReplayPacketContinuity({});
  assert.equal(issue(r,'CONTINUITY_PACKET_MISSING'),1);
  assert.equal(issue(r,'CONTINUITY_REPLAY_MISSING'),1);
  assert.equal(r.candidateCrossGateContinuity,false);
});

test('untrusted getters and additional fields fail closed with redacted generic errors',()=>{
  for(const change of [
    x=>Object.defineProperty(x,'replay',{get(){throw Error('PRIVATE-SOURCE-ROW-123');},enumerable:true}),
    x=>{x.privatePhone='PRIVATE-PHONE-0170000';},
    x=>{x.packet.rehearsal.sourceSummary[0].privateId='PRIVATE-ID';}
  ]){
    const x=fixture();change(x);
    assert.throws(()=>assessM10ReplayPacketContinuity(x),
      e=>e.message==='M10 replay packet continuity invalid'&&
        !/PRIVATE|SOURCE|PHONE/.test(e.message));
  }
});

test('returned issues are sorted, immutable input is preserved, no group IDs/rows/amounts leaked',()=>{
  const x=fixture();x.replay.source.capturedAt='2026-11-16T09:00:00.000Z';
  x.replay.rejectedRetryReadback.capturedAt='2026-11-17T06:11:00.000Z';
  x.replay.receipts.rejected.recordedAt='2026-11-17T06:10:30.000Z';
  const original=structuredClone(x);
  const a=assessM10ReplayPacketContinuity(x),b=assessM10ReplayPacketContinuity(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,original);
  assert.deepEqual(a.issues.map(v=>v.code),[...a.issues.map(v=>v.code)].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /FREEZE-SOURCE|D1-FIRST|SOURCE-REPLAY|BACKUP-PACKET|SYNTH-DATA|legacyIdDigest|sourceGroup|amountMinor|rowDigest|positionDigest|sheetKey|25000/);
});
