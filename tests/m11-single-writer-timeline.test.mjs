import test from 'node:test';
import assert from 'node:assert/strict';
import {M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';
import {M11_CUTOVER_EVENT_ORDER} from '../scripts/check-m11-cutover-order.mjs';
import {assessM11SingleWriterTimeline} from '../scripts/check-m11-single-writer-timeline.mjs';

const RELEASE='a'.repeat(40),SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SNAPSHOT='b'.repeat(64),DIGEST='c'.repeat(64);
const verified=id=>({status:'verified',record:'audit/'+id,releaseSha:RELEASE});
const PATTERNS={
  activation:['legacy','frozen','d1'],
  'rollback-to-legacy':['legacy','frozen','d1','frozen','legacy'],
  'hold-d1-readonly':['legacy','frozen','d1','frozen']
};
function releaseEvidence(){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,
   sourceSnapshotSha256:SNAPSHOT,
   checks:Object.fromEntries(M11_PHASE_CHECKS.switch.map(id=>[id,verified(id)]))};
}
function sequence(mode='activation'){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,
   sourceSnapshotSha256:SNAPSHOT,path:mode,
   events:M11_CUTOVER_EVENT_ORDER[mode].map((event,i)=>({
     seq:i+1,event,record:'audit/'+event,releaseSha:RELEASE
   }))};
}
function delta(mode='rollback-to-legacy'){
 const disposition=mode==='rollback-to-legacy'?'replayed-to-legacy':'retained-on-d1';
 return {
   schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,
   mode:mode==='rollback-to-legacy'?'resume-legacy':'roll-forward',
   freeze:{legacy:verified('legacy-writes-frozen'),d1:verified('worker-writes-frozen')},
   checkpoints:{committed:{count:1,record:'audit/committed-journal',releaseSha:RELEASE},
     acknowledged:{count:1,record:'audit/acknowledged-journal',releaseSha:RELEASE}},
   writes:[{operationId:'sale-001',canonicalDigest:DIGEST}],
   acknowledgments:['sale-001'],
   dispositions:[{operationId:'sale-001',action:disposition,canonicalDigest:DIGEST,
     record:'audit/operation-disposition'}]
 };
}
function timeline(mode='activation'){
 const pattern=PATTERNS[mode],events=M11_CUTOVER_EVENT_ORDER[mode];
 const linked=['audit/prior-legacy-authority','audit/legacy-writes-frozen',
   'audit/traffic-switched-to-d1','audit/worker-writes-frozen',
   'audit/traffic-restored-to-legacy'];
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,
   sourceSnapshotSha256:SNAPSHOT,mode,
   epochs:pattern.map((authority,i)=>{
     const start=Date.UTC(2026,10,17,10,0,0)+i*300000;
     return {startedAt:new Date(start).toISOString().replace('.000Z','Z'),
       endedAt:new Date(start+300000).toISOString().replace('.000Z','Z'),
       authority,legacyCommits:authority==='legacy'?2:0,
       d1Commits:authority==='d1'?1:0,record:linked[i],releaseSha:RELEASE};
   }),
   checkpoint:{status:'verified',record:'audit/single-writer-parity',
     releaseSha:RELEASE,unreconciledAcknowledgedOperations:0,
     duplicateOperationEffects:0,grossPartyDiscrepancies:0,
     inventoryDiscrepancies:0,legacyWritesAfterFreeze:0}
 };
}
const opts=(mode='activation')=>({
 expectedReleaseSha:RELEASE,expectedSourceSha:SOURCE,
 expectedSourceSnapshotSha256:SNAPSHOT,
 releaseEvidence:releaseEvidence(),cutoverEvidence:sequence(mode),
 ...(mode!=='activation'?{deltaEvidence:delta(mode)}:{})
});
const check=(m=timeline(),o=opts())=>assessM11SingleWriterTimeline(m,o);
function blocked(m,o,code){
 const x=check(m,o);
 assert.equal(x.documentaryComplete,false,JSON.stringify(x));
 assert.ok(x.blockers.includes(code),JSON.stringify(x.blockers));
 assert.equal(x.authorizesTrafficSwitch,false);
 assert.equal(x.authorizesWriteResumption,false);
}
test('missing timeline fails closed; no automatic route or write authority',()=>{
 blocked(null,opts(),'M11_TIMELINE_MANIFEST_REQUIRED');
});
test('synthetic activation has one fenced authority transfer, but grants no GO',()=>{
 const x=check();
 assert.equal(x.documentaryComplete,true);
 assert.deepEqual(x.blockers,[]);
 assert.equal(x.authorizesTrafficSwitch,false);
 assert.equal(x.authorizesWriteResumption,false);
 assert.match(x.caution,/not.*authoriz|independently/i);
});
test('synthetic rollback requires complete D1 delta and reviewed replay before legacy authority',()=>{
 const x=check(timeline('rollback-to-legacy'),opts('rollback-to-legacy'));
 assert.equal(x.documentaryComplete,true,JSON.stringify(x.blockers));
 const o=opts('rollback-to-legacy');delete o.deltaEvidence;
 blocked(timeline('rollback-to-legacy'),o,'M11_TIMELINE_CUTOVER_UNVERIFIED');
});
test('read-only D1 incident hold requires freeze, never reactivates either writer',()=>{
 const x=check(timeline('hold-d1-readonly'),opts('hold-d1-readonly'));
 assert.equal(x.documentaryComplete,true,JSON.stringify(x.blockers));
 const m=timeline('hold-d1-readonly');m.epochs[3].authority='d1';
 blocked(m,opts('hold-d1-readonly'),'M11_TIMELINE_SEQUENCE_INVALID');
});
test('no overlap: an epoch cannot claim simultaneous D1 and legacy authority',()=>{
 const m=timeline();m.epochs[2].authority='both';
 blocked(m,opts(),'M11_TIMELINE_SEQUENCE_INVALID');
 const n=timeline();n.epochs[1].authority='legacy';
 blocked(n,opts(),'M11_TIMELINE_SEQUENCE_INVALID');
});
test('writes during a freeze are blockers even if the cutover sequence is approved',()=>{
 const m=timeline();m.epochs[1].legacyCommits=1;
 blocked(m,opts(),'M11_TIMELINE_UNAUTHORIZED_COMMIT');
 const n=timeline();n.epochs[1].d1Commits=1;
 blocked(n,opts(),'M11_TIMELINE_UNAUTHORIZED_COMMIT');
});
test('D1 commits before source freeze, and legacy commits after the D1 switch, fail closed',()=>{
 const m=timeline();m.epochs[0].d1Commits=1;
 blocked(m,opts(),'M11_TIMELINE_UNAUTHORIZED_COMMIT');
 const n=timeline();n.epochs[2].legacyCommits=1;
 blocked(n,opts(),'M11_TIMELINE_UNAUTHORIZED_COMMIT');
});
test('the chronological epoch intervals cannot overlap, skip time, reverse or use noncanonical UTC',()=>{
 const m=timeline();m.epochs[1].startedAt='2026-11-17T10:04:00Z';
 blocked(m,opts(),'M11_TIMELINE_CLOCK_INVALID');
 const n=timeline();n.epochs[1].startedAt='2026-11-17T10:06:00Z';
 blocked(n,opts(),'M11_TIMELINE_CLOCK_INVALID');
 const x=timeline();x.epochs[2].endedAt='2026-11-17T10:09:00Z';
 blocked(x,opts(),'M11_TIMELINE_CLOCK_INVALID');
 const y=timeline();y.epochs[0].startedAt='2026-11-17T10:00:00+00:00';
 blocked(y,opts(),'M11_TIMELINE_CLOCK_INVALID');
});
test('epoch counts and source pins must be independently valid',()=>{
 const m=timeline();m.epochs[2].d1Commits=-1;
 blocked(m,opts(),'M11_TIMELINE_EPOCH_INVALID');
 const n=timeline();n.epochs[0].legacyCommits=1.5;
 blocked(n,opts(),'M11_TIMELINE_EPOCH_INVALID');
 const x=timeline();x.sourceSnapshotSha256='e'.repeat(64);
 blocked(x,opts(),'M11_TIMELINE_PIN_MISMATCH');
 blocked(timeline(),{},'M11_TIMELINE_PIN_MISMATCH');
});
test('freeze and transition references must match the independently reviewed cutover evidence',()=>{
 const m=timeline();m.epochs[1].record='audit/unrelated-freeze';
 blocked(m,opts(),'M11_TIMELINE_EVENT_MISMATCH');
 const n=timeline('rollback-to-legacy');
 n.epochs[4].record='audit/early-resume';
 blocked(n,opts('rollback-to-legacy'),'M11_TIMELINE_EVENT_MISMATCH');
});
test('rollback D1 epoch committed count must match the independently reviewed committed-write checkpoint',()=>{
 const m=timeline('rollback-to-legacy');m.epochs[2].d1Commits=2;
 blocked(m,opts('rollback-to-legacy'),'M11_TIMELINE_DELTA_COUNT_MISMATCH');
 const n=timeline('hold-d1-readonly');n.epochs[2].d1Commits=0;
 blocked(n,opts('hold-d1-readonly'),'M11_TIMELINE_DELTA_COUNT_MISMATCH');
});
test('rollback freeze references must exactly match the delta proof, not merely a plausible second document',()=>{
 const o=opts('rollback-to-legacy');o.deltaEvidence.freeze.d1.record='audit/different-d1-freeze';
 blocked(timeline('rollback-to-legacy'),o,'M11_TIMELINE_DELTA_FREEZE_MISMATCH');
});
test('a rollback with roll-forward dispositions is never sufficient for resumed legacy writes',()=>{
 const m=timeline('rollback-to-legacy'),o=opts('rollback-to-legacy');
 o.deltaEvidence=delta('hold-d1-readonly');
 blocked(m,o,'M11_TIMELINE_CUTOVER_UNVERIFIED');
});
test('final reconciliation must have no unexplained accounting, stock, duplicate or acknowledged gaps',()=>{
 for(const key of ['unreconciledAcknowledgedOperations','duplicateOperationEffects',
   'grossPartyDiscrepancies','inventoryDiscrepancies','legacyWritesAfterFreeze']){
   const m=timeline();m.checkpoint[key]=1;
   blocked(m,opts(),'M11_TIMELINE_CHECKPOINT_INVALID');
 }
});
test('unknown fields, secret payloads, duplicate references and stale event reviews fail closed',()=>{
 const m=timeline();m.secret='never commit';
 blocked(m,opts(),'M11_TIMELINE_SCHEMA_INVALID');
 const n=timeline();n.epochs[1].apiToken='should-not-include';
 blocked(n,opts(),'M11_TIMELINE_EPOCH_INVALID');
 const x=timeline();x.epochs[0].record=x.epochs[1].record;
 blocked(x,opts(),'M11_TIMELINE_EPOCH_INVALID');
 const y=timeline();y.checkpoint.status='pending';
 blocked(y,opts(),'M11_TIMELINE_CHECKPOINT_INVALID');
});
test('missing owner switch GO, wrong mode and unexpected activation delta all fail closed',()=>{
 const o=opts();delete o.releaseEvidence.checks['owner-switch-go'];
 blocked(timeline(),o,'M11_TIMELINE_CUTOVER_UNVERIFIED');
 const m=timeline();m.mode='unapproved';
 blocked(m,opts(),'M11_TIMELINE_MODE_INVALID');
 const n=opts();n.deltaEvidence=delta('rollback-to-legacy');
 blocked(timeline(),n,'M11_TIMELINE_DELTA_UNEXPECTED');
});
