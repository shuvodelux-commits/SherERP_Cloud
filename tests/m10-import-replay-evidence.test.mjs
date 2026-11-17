import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10ImportReplayEvidence} from '../src/migration/m10-import-replay-evidence.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const hex=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},i)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:i+1,rowDigest:hex(i+1),
    positionDigest:hex(i+2001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:i+1,rowDigest:hex(i+1),idDigest:hex(i+2001)});
const snap=(captureId,capturedAt)=>({captureId,capturedAt,sourceCommit:PIN,groups:groups()});
const coverage=(reconciled=49)=>({
  formatVersion:1,sourceCommit:PIN,
  summary:{sourceGroups:49,fullyReconciled:reconciled},
  rows:inventory.tables.map(({sheetKey},i)=>({
    sheetKey,sourceImportReconciled:i<reconciled
  }))
});
const receipt=(attemptId,readbackCaptureId,outcome,recordedAt)=>({
  attemptId,readbackCaptureId,outcome,recordedAt,isolatedTarget:true
});
const input=()=>({
  inventory,coverage:coverage(),
  source:snap('SOURCE-ORIGINAL-001','2026-11-17T06:00:00.000Z'),
  firstImport:snap('D1-FIRST-IMPORT-001','2026-11-17T06:02:00.000Z'),
  replayedImport:snap('D1-REPLAY-IMPORT01','2026-11-17T06:04:00.000Z'),
  rejectedRetryReadback:snap('D1-REJECT-RETRY01','2026-11-17T06:06:00.000Z'),
  receipts:{
    first:receipt('ATTEMPT-FIRST01','D1-FIRST-IMPORT-001',
      'COMMITTED','2026-11-17T06:01:00.000Z'),
    replay:receipt('ATTEMPT-REPLAY01','D1-REPLAY-IMPORT01',
      'REPLAYED','2026-11-17T06:03:00.000Z'),
    rejected:receipt('ATTEMPT-REJECT01','D1-REJECT-RETRY01',
      'REJECTED','2026-11-17T06:05:00.000Z')
  }
});
const get=(r,k)=>r.issues.find(i=>i.code===k)?.count??0;
const run=fn=>{const x=input();fn(x);return assessM10ImportReplayEvidence(x);};

test('all 49 synthetic source→first→replay→rejected readbacks only form a no-GO candidate',()=>{
  const a=assessM10ImportReplayEvidence(input());
  assert.deepEqual(a,{
    formatVersion:1,phase:'M10_OFFLINE_IMPORT_REPLAY',
    groupsComparedComplete:true,coverageReconciled:true,
    candidateIdempotentReplay:true,candidateRejectedRetryRollback:true,
    candidateReplayEvidence:true,
    authorizesImport:false,authorizesPosting:false,authorizesRollback:false,
    authorizesCutover:false,productionReady:false,issues:[],
    limitations:'Supplied source, D1 and retry receipts cannot prove an actual import, rejection rollback, source provenance or release authorization'
  });
});

test('real M02 zero-fully-reconciled coverage blocks even identical synthetic source snapshots',()=>{
  const r=run(x=>{x.coverage=coverage(0);});
  assert.equal(r.groupsComparedComplete,true);
  assert.equal(r.candidateIdempotentReplay,true);
  assert.equal(r.coverageReconciled,false);
  assert.equal(get(r,'REPLAY_COVERAGE_UNRECONCILED'),49);
  assert.equal(r.candidateReplayEvidence,false);
});

test('one unreviewed source group blocks total without fake blanket 49-group permission',()=>{
  const r=run(x=>{x.coverage=coverage(48);});
  assert.equal(get(r,'REPLAY_COVERAGE_UNRECONCILED'),1);
  assert.equal(r.coverageReconciled,false);
});

test('mismatched reported coverage count rejects a self-contradictory source contract',()=>{
  const x=input();x.coverage.summary.fullyReconciled=49;
  x.coverage.rows[0].sourceImportReconciled=false;
  assert.throws(()=>assessM10ImportReplayEvidence(x),
    {message:'M10 import replay evidence invalid'});
});

test('initial import missing one original row refuses first-import equivalence',()=>{
  const r=run(x=>{x.firstImport.groups[2].rowCount++;});
  assert.equal(get(r,'REPLAY_FIRST_ROW_COUNT_MISMATCH'),1);
  assert.equal(r.candidateIdempotentReplay,false);
});

test('a successful first import followed by an altered replay row fails idempotency',()=>{
  const r=run(x=>{x.replayedImport.groups[3].rowDigest=hex(99999);});
  assert.equal(get(r,'REPLAY_REPEAT_ROW_DIGEST_MISMATCH'),1);
  assert.equal(r.candidateIdempotentReplay,false);
});

test('a partial write after a rejected retry is detected even if initial and replay match',()=>{
  const r=run(x=>{x.rejectedRetryReadback.groups[4].rowCount++;});
  assert.equal(r.candidateIdempotentReplay,true);
  assert.equal(get(r,'REPLAY_REJECTED_ROW_COUNT_MISMATCH'),1);
  assert.equal(r.candidateRejectedRetryRollback,false);
});

test('original legacy business ID digest drift can never be treated as a successful replay',()=>{
  const r=run(x=>{x.replayedImport.groups[0].idDigest=hex(100099);});
  assert.equal(get(r,'REPLAY_REPEAT_ID_DIGEST_MISMATCH'),1);
  assert.equal(r.candidateReplayEvidence,false);
});

test('LOGS source position drift is detected; fabricated LOGS ID must be rejected',()=>{
  const r=run(x=>x.rejectedRetryReadback.groups.find(v=>v.sheetKey==='LOGS')
    .positionDigest=hex(90900));
  assert.equal(get(r,'REPLAY_REJECTED_POSITION_DIGEST_MISMATCH'),1);
  const x=input();x.firstImport.groups.find(v=>v.sheetKey==='LOGS').idDigest=hex(1);
  assert.throws(()=>assessM10ImportReplayEvidence(x),
    {message:'M10 import replay evidence invalid'});
});

test('a missing replay group yields a fixed count without disclosing the group name',()=>{
  const r=run(x=>{x.replayedImport.groups.pop();});
  assert.equal(get(r,'REPLAY_REPEAT_GROUP_MISSING'),1);
  assert.equal(r.groupsComparedComplete,false);
});

test('an unexpected group is not silently ignored as an imported source master',()=>{
  const r=run(x=>x.replayedImport.groups.push({
    sheetKey:'UNLISTED_PRIVATE',rowCount:1,
    rowDigest:hex(10),idDigest:hex(11)
  }));
  assert.equal(get(r,'REPLAY_REPEAT_GROUP_UNEXPECTED'),1);
  assert.equal(r.groupsComparedComplete,false);
});

test('duplicate original source IDs per group evidence cannot pass via Map overwrite',()=>{
  const r=run(x=>x.firstImport.groups.push({...x.firstImport.groups[0]}));
  assert.equal(get(r,'REPLAY_FIRST_GROUP_DUPLICATE'),1);
  assert.equal(r.groupsComparedComplete,false);
});

test('missing captures and receipts always return incomplete and no-GO metadata',()=>{
  const r=assessM10ImportReplayEvidence({inventory});
  assert.equal(get(r,'REPLAY_COVERAGE_MISSING'),1);
  assert.equal(get(r,'REPLAY_SOURCE_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'REPLAY_FIRST_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'REPLAY_REPEAT_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'REPLAY_REJECTED_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'REPLAY_RECEIPTS_MISSING'),1);
  assert.equal(r.candidateReplayEvidence,false);
});

test('out-of-order readbacks and repeated capture IDs block replay even for identical data',()=>{
  const r=run(x=>{
    x.replayedImport.captureId=x.firstImport.captureId;
    x.replayedImport.capturedAt='2026-11-17T06:01:00.000Z';
  });
  assert.equal(get(r,'REPLAY_CAPTURE_NOT_DISTINCT'),1);
  assert.equal(get(r,'REPLAY_CAPTURE_NOT_ORDERED'),1);
  assert.equal(r.candidateReplayEvidence,false);
});

test('receipt target identifiers must match respective independent readbacks',()=>{
  const r=run(x=>x.receipts.replay.readbackCaptureId='PRIVATE-NOT-REAL');
  assert.equal(get(r,'REPLAY_RECEIPT_CAPTURE_MISMATCH'),1);
  assert.equal(r.candidateIdempotentReplay,false);
});

test('receipts must record committed, replayed and rejected outcomes in order',()=>{
  const r=run(x=>x.receipts.rejected.outcome='COMMITTED');
  assert.equal(get(r,'REPLAY_RECEIPT_OUTCOME_MISMATCH'),1);
  assert.equal(r.candidateRejectedRetryRollback,false);
});

test('all attempt IDs must be independent even if each readback is separately named',()=>{
  const r=run(x=>{x.receipts.rejected.attemptId=x.receipts.first.attemptId;});
  assert.equal(get(r,'REPLAY_ATTEMPT_NOT_DISTINCT'),1);
});

test('receipt after readback or before previous capture cannot count as independent operation',()=>{
  const r=run(x=>x.receipts.replay.recordedAt='2026-11-17T06:05:00.000Z');
  assert.equal(get(r,'REPLAY_RECEIPT_CHRONOLOGY_INVALID'),1);
});

test('recording a rejected retry against non-isolated target fails safety boundary',()=>{
  const r=run(x=>{x.receipts.rejected.isolatedTarget=false;});
  assert.equal(get(r,'REPLAY_TARGET_NOT_ISOLATED'),1);
  assert.equal(r.candidateRejectedRetryRollback,false);
});

test('wrong original pin and source group schema are invalid, always with redacted exception',()=>{
  for(const edit of [
    x=>{x.source.sourceCommit='PRIVATE-SOURCE-CUSTOMER';},
    x=>{x.inventory.tables=[...x.inventory.tables].slice(0,48);},
    x=>{x.replayedImport.groups[0].rowDigest='NOT-HEX-SOURCE';},
    x=>{x.firstImport.groups[0].rowCount=-1;}
  ]){
    const x=input();x.inventory=structuredClone(x.inventory);
    edit(x);
    assert.throws(()=>assessM10ImportReplayEvidence(x),
      err=>err.message==='M10 import replay evidence invalid'&&
        !/PRIVATE|SOURCE-CUSTOMER/.test(err.message));
  }
});

test('unexpected private fields, inherited evidence and hostile accessors never reach output',()=>{
  for(const edit of [
    x=>{x.replayedImport.groups[0].privatePhone='PRIVATE-01700000000';},
    x=>Object.defineProperty(x.firstImport,'captureId',{
      enumerable:true,get(){throw new Error('PRIVATE-CUSTOMER-SECRET');}
    }),
    x=>Object.defineProperty(x,'coverage',{
      enumerable:true,get(){throw new Error('PRIVATE-CUSTOMER-SECRET');}
    }),
    x=>{x.receipts.replay=Object.create(x.receipts.replay);}
  ]){
    const x=input();edit(x);
    assert.throws(()=>assessM10ImportReplayEvidence(x),
      e=>e.message==='M10 import replay evidence invalid'&&
        !/PRIVATE|CUSTOMER|SECRET/.test(e.message));
  }
});

test('reports are deterministic, sorted, non-mutating and never include IDs, hashes or amounts',()=>{
  const x=input();
  x.replayedImport.groups[0].rowDigest=hex(9099);
  x.rejectedRetryReadback.groups[1].rowCount=100000;
  const before=structuredClone(x);
  const a=assessM10ImportReplayEvidence(x),b=assessM10ImportReplayEvidence(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,before);
  assert.deepEqual(a.issues.map(v=>v.code),[...a.issues.map(v=>v.code)].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /PRIVATE|ATTEMPT|D1-FIRST|D1-REPLAY|D1-REJECT|SOURCE-ORIGINAL|idDigest|positionDigest|sheetKey|rowDigest|amountMinor|9099|100000/);
});
