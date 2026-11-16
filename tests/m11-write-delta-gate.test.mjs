import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM11WriteDelta} from '../scripts/check-m11-write-delta.mjs';

const RELEASE='a'.repeat(40);
const SOURCE='b'.repeat(64);
const ONE='c'.repeat(64);
const TWO='d'.repeat(64);
const pinned={expectedReleaseSha:RELEASE,expectedSourceSnapshotSha256:SOURCE};
const verified=record=>({status:'verified',record,releaseSha:RELEASE});

function evidence(){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SOURCE,
    mode:'resume-legacy',
    freeze:{legacy:verified('audit/legacy-frozen'),d1:verified('audit/d1-frozen')},
    checkpoints:{
      committed:{count:2,record:'audit/d1-commit-journal',releaseSha:RELEASE},
      acknowledged:{count:1,record:'audit/client-ack-journal',releaseSha:RELEASE}
    },
    writes:[{operationId:'sale/001',canonicalDigest:ONE},{operationId:'return/002',canonicalDigest:TWO}],
    acknowledgments:['sale/001'],
    dispositions:[
      {operationId:'sale/001',action:'replayed-to-legacy',canonicalDigest:ONE,record:'audit/replay-one'},
      {operationId:'return/002',action:'replayed-to-legacy',canonicalDigest:TWO,record:'audit/replay-two'}
    ]
  };
}
const assess=m=>assessM11WriteDelta(m,pinned);
const codes=m=>assess(m).blockers;

test('missing evidence blocks every traffic rollback and never grants authorization',()=>{
  const r=assess(undefined);
  assert.equal(r.documentaryComplete,false);
  assert.equal(r.authorizesTrafficSwitch,false);
  assert.ok(r.blockers.length);
});

test('complete synthetic legacy replay shows only structural coverage, not authorization',()=>{
  const r=assess(evidence());
  assert.equal(r.documentaryComplete,true);
  assert.deepEqual(r.blockers,[]);
  assert.equal(r.authorizesTrafficSwitch,false);
  assert.match(r.caution,/independently|not.*authoriz/i);
});

test('explicit zero-write delta needs two freezes and independent zero checkpoints',()=>{
  const m=evidence();
  m.writes=[];m.acknowledgments=[];m.dispositions=[];
  m.checkpoints.committed.count=0;m.checkpoints.acknowledged.count=0;
  assert.equal(assess(m).documentaryComplete,true);
  delete m.freeze.d1;
  assert.equal(assess(m).documentaryComplete,false);
});

test('committed writes and acknowledged requests must reconcile exactly',()=>{
  const m=evidence();
  m.checkpoints.committed.count=3;
  assert.equal(assess(m).documentaryComplete,false);
  assert.ok(codes(m).includes('M11_DELTA_COUNT_MISMATCH'));
  m.checkpoints.committed.count=2;
  m.acknowledgments=['sale/001','sale/001','uncommitted/003'];
  assert.ok(codes(m).includes('M11_DELTA_ACK_MISMATCH'));
  assert.equal(assess(m).authorizesTrafficSwitch,false);
});

test('replay requires exactly one matching disposition for every committed operation',()=>{
  const m=evidence();
  m.dispositions.pop();
  assert.ok(codes(m).includes('M11_DELTA_DISPOSITION_MISMATCH'));
  m.dispositions.push({operationId:'return/002',action:'replayed-to-legacy',canonicalDigest:ONE,record:'audit/replay-two'});
  assert.ok(codes(m).includes('M11_DELTA_DISPOSITION_MISMATCH'));
  m.dispositions.push({operationId:'sale/001',action:'replayed-to-legacy',canonicalDigest:ONE,record:'audit/duplicate'});
  assert.ok(codes(m).includes('M11_DELTA_DISPOSITION_MISMATCH'));
});

test('legacy-resume rejects retained D1 writes; roll-forward forbids legacy replay',()=>{
  const m=evidence();
  m.dispositions[0].action='retained-on-d1';
  assert.ok(codes(m).includes('M11_DELTA_MODE_MISMATCH'));
  m.mode='roll-forward';
  m.dispositions[1].action='retained-on-d1';
  assert.equal(assess(m).documentaryComplete,true);
  m.dispositions[1].action='replayed-to-legacy';
  assert.ok(codes(m).includes('M11_DELTA_MODE_MISMATCH'));
});

test('reject stale release evidence and changed final legacy snapshot',()=>{
  const m=evidence();
  m.releaseSha='e'.repeat(40);
  m.sourceSnapshotSha256='f'.repeat(64);
  m.freeze.legacy.releaseSha='f'.repeat(40);
  assert.ok(codes(m).includes('M11_DELTA_PIN_MISMATCH'));
  assert.ok(codes(m).includes('M11_DELTA_FREEZE_INVALID'));
});

test('unknown fields, free-text reference, invalid digest and duplicate commit all fail closed',()=>{
  const m=evidence();
  m.secret='not allowed';
  m.writes[0].rawInvoice={fullName:'not allowed'};
  m.writes[1].canonicalDigest='not-a-digest';
  m.writes.push({...m.writes[0]});
  m.dispositions[0].record='https://private.example/token=secret';
  assert.ok(codes(m).includes('M11_DELTA_UNKNOWN_FIELD'));
  assert.ok(codes(m).includes('M11_DELTA_WRITE_INVALID'));
  assert.ok(codes(m).includes('M11_DELTA_DISPOSITION_MISMATCH'));
});

test('invalid or missing trusted caller pins never pass, even on a valid-looking manifest',()=>{
  const m=evidence();
  assert.equal(assessM11WriteDelta(m,{}).documentaryComplete,false);
  assert.equal(assessM11WriteDelta(m,{expectedReleaseSha:RELEASE,expectedSourceSnapshotSha256:'wrong'}).documentaryComplete,false);
  m.mode='rollback-everything';
  assert.equal(assess(m).documentaryComplete,false);
});
