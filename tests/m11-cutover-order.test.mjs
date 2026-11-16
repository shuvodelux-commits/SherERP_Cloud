import test from 'node:test';
import assert from 'node:assert/strict';
import {M11_CUTOVER_EVENT_ORDER, assessM11CutoverOrder} from '../scripts/check-m11-cutover-order.mjs';
import {M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';

const RELEASE='a'.repeat(40);
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SNAPSHOT='b'.repeat(64);
const OP_DIGEST='c'.repeat(64);
const verified=id=>({status:'verified',record:'audit/'+id,releaseSha:RELEASE});
const releaseEvidence=()=>({
  schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
  checks:Object.fromEntries(M11_PHASE_CHECKS.switch.map(id=>[id,verified(id)]))
});
function delta(mode='resume-legacy',empty=false){
  const operationId='sale/001';
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,mode,
    freeze:{legacy:verified('legacy-freeze'),d1:verified('d1-freeze')},
    checkpoints:{
      committed:{count:empty?0:1,record:'audit/commit-journal',releaseSha:RELEASE},
      acknowledged:{count:empty?0:1,record:'audit/client-acks',releaseSha:RELEASE}
    },
    writes:empty?[]:[{operationId,canonicalDigest:OP_DIGEST}],
    acknowledgments:empty?[]:[operationId],
    dispositions:empty?[]:[{
      operationId,
      action:mode==='resume-legacy'?'replayed-to-legacy':'retained-on-d1',
      canonicalDigest:OP_DIGEST,record:'audit/operation-reconciled'
    }]
  };
}
function sequence(path='activation'){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,
    sourceSnapshotSha256:SNAPSHOT,path,
    events:M11_CUTOVER_EVENT_ORDER[path].map((event,i)=>({
      seq:i+1,event,record:'audit/'+event,releaseSha:RELEASE
    }))
  };
}
const options=(mode)=>({
  expectedReleaseSha:RELEASE,expectedSourceSha:SOURCE,
  expectedSourceSnapshotSha256:SNAPSHOT,
  releaseEvidence:releaseEvidence(),
  ...(mode?{deltaEvidence:delta(mode)}:{})
});
const check=(manifest,opts=options())=>assessM11CutoverOrder(manifest,opts);

test('missing sequence blocks and never grants live switch authority',()=>{
  const result=check(undefined);
  assert.equal(result.documentaryComplete,false);
  assert.equal(result.authorizesTrafficSwitch,false);
  assert.ok(result.blockers.length);
});

test('activation requires frozen source, final snapshot, target backup, parity, GO, route and smoke order',()=>{
  const result=check(sequence('activation'));
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.documentaryComplete,true);
  assert.equal(result.authorizesTrafficSwitch,false);
  assert.match(result.caution,/not.*authoriz|independently/i);
  const order=M11_CUTOVER_EVENT_ORDER.activation;
  assert.ok(order.indexOf('owner-live-go-recorded')<order.indexOf('traffic-switched-to-d1'));
  assert.ok(order.indexOf('final-import-and-parity-verified')<order.indexOf('owner-live-go-recorded'));
});

test('swapping owner GO with final parity cannot be accepted',()=>{
  const m=sequence();
  [m.events[3],m.events[4]]=[m.events[4],m.events[3]];
  assert.ok(check(m).blockers.includes('M11_SEQUENCE_ORDER_INVALID'));
});

test('duplicated events, unreviewed record and extra event all fail closed',()=>{
  const m=sequence();
  m.events[1].event=m.events[0].event;
  assert.ok(check(m).blockers.includes('M11_SEQUENCE_ORDER_INVALID'));
  const n=sequence();
  n.events[1].record='https://example.test/?token=secret';
  assert.ok(check(n).blockers.includes('M11_SEQUENCE_EVENT_INVALID'));
  const x=sequence();
  x.events.push({seq:10,event:'unknown',record:'audit/unknown',releaseSha:RELEASE});
  assert.ok(check(x).blockers.includes('M11_SEQUENCE_ORDER_INVALID'));
});

test('release evidence cannot be skipped or contradicted',()=>{
  const m=sequence();
  const without=options();
  delete without.releaseEvidence;
  assert.ok(check(m,without).blockers.includes('M11_SEQUENCE_RELEASE_GATE_BLOCKED'));
  const stale=options();
  delete stale.releaseEvidence.checks['final-import-gross-reconciliation'];
  assert.ok(check(m,stale).blockers.includes('M11_SEQUENCE_RELEASE_GATE_BLOCKED'));
});

test('pinned source, target and final snapshot must match independently provided values',()=>{
  const m=sequence();
  m.releaseSha='d'.repeat(40);
  m.sourceSha='e'.repeat(40);
  m.sourceSnapshotSha256='f'.repeat(64);
  assert.ok(check(m).blockers.includes('M11_SEQUENCE_PIN_INVALID'));
  assert.ok(check(sequence(),{}).blockers.includes('M11_SEQUENCE_PIN_INVALID'));
});

test('emergency rollback cannot move traffic without complete legacy replay delta',()=>{
  const m=sequence('rollback-to-legacy');
  assert.ok(check(m).blockers.includes('M11_SEQUENCE_DELTA_GATE_BLOCKED'));
  assert.equal(check(m,options('resume-legacy')).documentaryComplete,true);
  assert.equal(check(m,options('roll-forward')).documentaryComplete,false);
});

test('D1 read-only incident hold must retain commits rather than replay legacy',()=>{
  const m=sequence('hold-d1-readonly');
  assert.equal(check(m,options('roll-forward')).documentaryComplete,true);
  assert.ok(check(m,options('resume-legacy')).blockers.includes('M11_SEQUENCE_DELTA_GATE_BLOCKED'));
  const order=M11_CUTOVER_EVENT_ORDER['hold-d1-readonly'];
  assert.ok(order.indexOf('worker-writes-frozen')<order.indexOf('d1-readonly-incident-mode-verified'));
});

test('verified zero-write delta still needs freeze and journal checkpoints',()=>{
  const m=sequence('rollback-to-legacy');
  const o=options('resume-legacy');
  o.deltaEvidence=delta('resume-legacy',true);
  assert.equal(check(m,o).documentaryComplete,true);
  delete o.deltaEvidence.freeze.d1;
  assert.ok(check(m,o).blockers.includes('M11_SEQUENCE_DELTA_GATE_BLOCKED'));
});

test('unlisted fields, malformed sequence and unknown recovery path are rejected',()=>{
  const m=sequence();m.secret='never-include-source-data';
  assert.ok(check(m).blockers.includes('M11_SEQUENCE_SCHEMA_INVALID'));
  const n=sequence();n.events[0].notes='staff credentials';
  assert.ok(check(n).blockers.includes('M11_SEQUENCE_EVENT_INVALID'));
  const q=sequence();q.path='deploy-without-go';
  assert.ok(check(q).blockers.includes('M11_SEQUENCE_PATH_INVALID'));
});
