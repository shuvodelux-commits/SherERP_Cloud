import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10RehearsalRestoreChain} from '../src/migration/m10-rehearsal-restore-chain.js';
import {assessM10RehearsalEvidence} from '../src/migration/m10-rehearsal-gate.js';
import {assessM10RestoreIntegrity} from '../src/migration/m10-restore-integrity.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const digest=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},index)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:index+1,rowDigest:digest(index+1),
    positionDigest:digest(index+1001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:index+1,rowDigest:digest(index+1),idDigest:digest(index+1001)}
);
const coverage=()=>({
  formatVersion:1,sourceCommit,
  summary:{sourceGroups:49,fullyReconciled:49},
  rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))
});
const gross=()=>({
  sourcePlanValid:true,readbackChecked:true,currentMatch:true,openingMatch:true,
  offlineCheckpointParity:true,issues:[],
  counts:{expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2}
});
const freshEvidence=()=>{
  const rehearsal={
    inventory,coverage:coverage(),sourceSummary:groups(),d1Summary:groups(),
    grossParity:gross(),pendingIdentityReviews:0,
    sourceFreeze:{
      firstPass:{snapshotId:'SOURCE-A0001',capturedAt:'2026-11-16T10:00:00.000Z',
        sourceCommit,groups:groups()},
      secondPass:{snapshotId:'SOURCE-A0002',capturedAt:'2026-11-16T10:01:00.000Z',
        sourceCommit,groups:groups()}
    }
  };
  const restore={
    inventory,
    backup:{captureId:'BACKUP-A0001',capturedAt:'2026-11-17T06:10:00.000Z',
      sourceCommit,groups:groups()},
    restored:{captureId:'RESTORE-A0002',capturedAt:'2026-11-17T06:20:00.000Z',
      sourceCommit,groups:groups()},
    receipt:{attemptId:'DRILL-LOCAL-001',backupCaptureId:'BACKUP-A0001',
      restoredCaptureId:'RESTORE-A0002',isolatedTarget:true,
      completedAt:'2026-11-17T06:15:00.000Z'}
  };
  return {rehearsal,restore};
};
const issues=(report,code)=>report.issues.find(item=>item.code===code)?.count||0;
const disconnected=(field,value,sheetKey)=>{
  const x=freshEvidence();
  for(const capture of [x.restore.backup,x.restore.restored]){
    const row=sheetKey?capture.groups.find(r=>r.sheetKey===sheetKey):
      capture.groups.find(r=>r.sheetKey!=='LOGS');
    row[field]=value;
  }
  return x;
};

test('matching synthetic source→D1→backup→restore evidence is only candidate, never release authorization',()=>{
  assert.equal(inventory.tables.length,49);
  const x=freshEvidence();
  assert.equal(assessM10RehearsalEvidence(x.rehearsal).candidateDataParity,true);
  assert.equal(assessM10RestoreIntegrity(x.restore).candidateRestoreParity,true);
  assert.deepEqual(assessM10RehearsalRestoreChain(x),{
    formatVersion:1,phase:'M10_OFFLINE_REHEARSAL_RESTORE_CHAIN',
    rehearsalCandidate:true,restoreCandidate:true,
    groupsLinked:true,candidateChainParity:true,
    authorizesImport:false,authorizesRestore:false,productionReady:false,
    issues:[],
    limitations:'Supplied summaries cannot prove independent source provenance, an actual D1 restore, private-data reconciliation or cutover approval'
  });
});

test('independently green restoration with changed row count is disconnected from D1 pre-backup',()=>{
  const x=disconnected('rowCount',999);
  assert.equal(assessM10RehearsalEvidence(x.rehearsal).candidateDataParity,true);
  assert.equal(assessM10RestoreIntegrity(x.restore).candidateRestoreParity,true);
  const r=assessM10RehearsalRestoreChain(x);
  assert.equal(issues(r,'CHAIN_D1_BACKUP_ROW_COUNT_MISMATCH'),1);
  assert.equal(r.candidateChainParity,false);
});

test('independently green restoration with changed row content is disconnected',()=>{
  const x=disconnected('rowDigest',digest(998));
  const r=assessM10RehearsalRestoreChain(x);
  assert.equal(issues(r,'CHAIN_D1_BACKUP_ROW_DIGEST_MISMATCH'),1);
  assert.equal(r.groupsLinked,false);
});

test('original business ID digest may not drift between D1 and backup even if restore is self-consistent',()=>{
  const x=disconnected('idDigest',digest(997));
  assert.equal(issues(assessM10RehearsalRestoreChain(x),
    'CHAIN_D1_BACKUP_ORIGINAL_ID_MISMATCH'),1);
});

test('LOGS must chain physical row positions, not fabricated Log IDs',()=>{
  const x=disconnected('positionDigest',digest(996),'LOGS');
  assert.equal(issues(assessM10RehearsalRestoreChain(x),
    'CHAIN_D1_BACKUP_POSITION_MISMATCH'),1);
  const forged=freshEvidence();
  forged.restore.backup.groups.find(r=>r.sheetKey==='LOGS').idDigest=digest(1);
  assert.throws(()=>assessM10RehearsalRestoreChain(forged),
    {message:'M10 rehearsal restore chain invalid'});
});

test('backup capture cannot precede frozen source even when both isolated checks pass',()=>{
  const x=freshEvidence();
  x.restore.backup.capturedAt='2026-11-16T09:00:00.000Z';
  x.restore.receipt.completedAt='2026-11-16T09:30:00.000Z';
  x.restore.restored.capturedAt='2026-11-16T10:00:00.000Z';
  assert.equal(assessM10RestoreIntegrity(x.restore).candidateRestoreParity,true);
  const r=assessM10RehearsalRestoreChain(x);
  assert.equal(issues(r,'CHAIN_BACKUP_BEFORE_SOURCE_FREEZE'),1);
  assert.equal(r.candidateChainParity,false);
});

test('blocked source migration rehearsal blocks chained proof regardless of restore parity',()=>{
  const x=freshEvidence();
  x.rehearsal.coverage.summary.fullyReconciled=0;
  x.rehearsal.coverage.rows.forEach(r=>{r.sourceImportReconciled=false;});
  const r=assessM10RehearsalRestoreChain(x);
  assert.equal(r.rehearsalCandidate,false);
  assert.equal(issues(r,'CHAIN_REHEARSAL_NOT_READY'),1);
  assert.equal(r.candidateChainParity,false);
});

test('blocked restore drill receipt blocks chain regardless of source-to-D1 parity',()=>{
  const x=freshEvidence();
  x.restore.receipt.isolatedTarget=false;
  const r=assessM10RehearsalRestoreChain(x);
  assert.equal(r.restoreCandidate,false);
  assert.equal(issues(r,'CHAIN_RESTORE_NOT_READY'),1);
  assert.equal(r.candidateChainParity,false);
});

test('omitted prerequisite inputs fail closed without claiming evidence completeness',()=>{
  const r=assessM10RehearsalRestoreChain({});
  assert.equal(r.rehearsalCandidate,false);
  assert.equal(r.restoreCandidate,false);
  assert.equal(r.groupsLinked,false);
  assert.equal(issues(r,'CHAIN_REHEARSAL_EVIDENCE_MISSING'),1);
  assert.equal(issues(r,'CHAIN_RESTORE_EVIDENCE_MISSING'),1);
  assert.equal(r.productionReady,false);
});

test('invalid nested evidence or malicious getters yield only a fixed redacted error',()=>{
  for(const change of [
    x=>{x.restore.backup.sourceCommit='PRIVATE-CUSTOMER-SECRET';},
    x=>{x.rehearsal.inventory={formatVersion:1,tables:[]};},
    x=>{x.restore.backup.groups[0].idDigest='PRIVATE-CUSTOMER-SECRET';},
    x=>Object.defineProperty(x.restore.backup.groups[0],'sheetKey',{
      enumerable:true,get(){throw new Error('PRIVATE-CUSTOMER-SECRET');}
    })
  ]){
    const x=freshEvidence();
    change(x);
    assert.throws(()=>assessM10RehearsalRestoreChain(x),
      error=>error.message==='M10 rehearsal restore chain invalid' &&
        !/PRIVATE|CUSTOMER|SECRET/.test(error.message));
  }
});

test('issues are sorted, diagnostics remain redacted and inputs are never mutated',()=>{
  const x=disconnected('rowDigest',digest(901));
  x.restore.receipt.isolatedTarget=false;
  const before=structuredClone(x);
  const a=assessM10RehearsalRestoreChain(x);
  const b=assessM10RehearsalRestoreChain(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,before);
  const codes=a.issues.map(v=>v.code);
  assert.deepEqual(codes,[...codes].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /BACKUP-A0001|RESTORE-A0002|DRILL-LOCAL-001|PRIVATE|rowDigest|idDigest|positionDigest|amountMinor|\b901\b/);
});
