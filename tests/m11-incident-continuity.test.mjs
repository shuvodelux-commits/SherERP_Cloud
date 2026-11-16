import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM11IncidentContinuity} from '../scripts/check-m11-incident-continuity.mjs';

const RELEASE='a'.repeat(40);
const SNAPSHOT='b'.repeat(64);
const pinned={expectedReleaseSha:RELEASE,expectedSourceSnapshotSha256:SNAPSHOT};
const quiet=(index=0)=>{
  const start=Date.UTC(2026,10,16,10,0,0)+index*15*60*1000;
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,
    window:{
      startedAt:new Date(start).toISOString().replace('.000Z','Z'),
      endedAt:new Date(start+15*60*1000).toISOString().replace('.000Z','Z')
    },
    thresholds:{
      http5xxRateBps:100,workerP95LatencyMs:750,status:'verified',
      record:'audit/approved-slo',releaseSha:RELEASE
    },
    observations:{
      worker:'audit/worker-health',d1:'audit/d1-health',
      financial:'audit/gross-accounts',inventory:'audit/inventory-lots',
      legacy:'audit/legacy-writer-watch',operation:'audit/operation-journal',
      reviewStatus:'verified',releaseSha:RELEASE
    },
    metrics:{
      workerRequests:1000,worker5xx:0,workerP95LatencyMs:200,d1Errors:0,
      unauthorizedAcceptedWrites:0,duplicatePostingEffects:0,
      grossLedgerDiscrepancies:0,inventoryDiscrepancies:0,
      legacyWritesAfterFreeze:0,unreconciledAcknowledgedOperations:0
    }
  };
};
const manifest=(n=2)=>({
  schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,
  windows:Array.from({length:n},(_,i)=>quiet(i)),
  recoveryReviews:[]
});
const review=(incidentWindow=0,throughWindow=1)=>({
  incidentWindow,throughWindow,status:'verified',releaseSha:RELEASE,
  sourceSnapshotSha256:SNAPSHOT,
  evidence:{
    legacyFreeze:'audit/verified-legacy-freeze',
    d1Freeze:'audit/verified-worker-freeze',
    committedWriteJournal:'audit/complete-journal',
    grossPartyAccounts:'audit/gross-party-accounts',
    inventoryLots:'audit/reconciled-inventory-lots',
    ownerReview:'audit/owner-incident-review'
  }
});
const assess=(m,o=pinned)=>assessM11IncidentContinuity(m,o);
const incident=m=>{m.windows[0].metrics.grossLedgerDiscrepancies=1;return m;};

test('missing evidence blocks and does not grant write or traffic authority',()=>{
  const x=assess();
  assert.equal(x.continuityStatus,'INSUFFICIENT_EVIDENCE');
  assert.equal(x.authorizesWriteResumption,false);
  assert.equal(x.authorizesTrafficSwitch,false);
  assert.ok(x.blockers.length);
});
test('all quiet consecutive windows are OBSERVE only',()=>{
  const x=assess(manifest(3));
  assert.equal(x.continuityStatus,'OBSERVE');
  assert.equal(x.documentaryComplete,true);
  assert.deepEqual(x.blockers,[]);
  assert.equal(x.authorizesWriteResumption,false);
  assert.match(x.caution,/not.*authoriz|independently/i);
});
test('an incident hold stays active across later quiet windows',()=>{
  const m=incident(manifest(3));
  const x=assess(m);
  assert.equal(x.continuityStatus,'INCIDENT_HOLD');
  assert.ok(x.alerts.includes('M11_INCIDENT_HOLD_PERSISTS'));
  assert.equal(x.authorizesWriteResumption,false);
});
test('verified private reviewed recovery after clean window yields documentary RECOVERY_REVIEWED, never GO',()=>{
  const m=incident(manifest(3));
  m.recoveryReviews=[review(0,1)];
  const x=assess(m);
  assert.equal(x.continuityStatus,'RECOVERY_REVIEWED');
  assert.equal(x.documentaryComplete,true);
  assert.deepEqual(x.blockers,[]);
  assert.equal(x.authorizesWriteResumption,false);
  assert.equal(x.authorizesTrafficSwitch,false);
});
test('a second incident reopens hold and cannot be covered by stale earlier review',()=>{
  const m=incident(manifest(4));
  m.recoveryReviews=[review(0,1)];
  m.windows[2].metrics.d1Errors=1;
  const x=assess(m);
  assert.equal(x.continuityStatus,'INCIDENT_HOLD');
  m.recoveryReviews.push(review(2,3));
  assert.equal(assess(m).continuityStatus,'RECOVERY_REVIEWED');
});
test('recovery review must follow a quiet window, not incident or escalation',()=>{
  const m=incident(manifest(2));
  m.recoveryReviews=[review(0,0)];
  assert.ok(assess(m).blockers.includes('M11_INCIDENT_REVIEW_NOT_APPLICABLE'));
  const q=incident(manifest(2));
  q.windows[1].metrics.worker5xx=30;
  q.recoveryReviews=[review(0,1)];
  assert.ok(assess(q).blockers.includes('M11_INCIDENT_REVIEW_NOT_APPLICABLE'));
});
test('spurious review, duplicate or out-of-order review cannot clear a hold',()=>{
  const empty=manifest(2);
  empty.recoveryReviews=[review(0,1)];
  assert.ok(assess(empty).blockers.includes('M11_INCIDENT_REVIEW_NOT_APPLICABLE'));
  const dup=incident(manifest(3));
  dup.recoveryReviews=[review(0,1),review(0,1)];
  assert.ok(assess(dup).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
  const out=incident(manifest(4));
  out.recoveryReviews=[review(0,3),review(0,1)];
  assert.ok(assess(out).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
});
test('unexplained time gaps, overlaps and reordered windows fail closed',()=>{
  const gap=manifest(2);
  gap.windows[1].window.startedAt='2026-11-16T10:20:00Z';
  assert.ok(assess(gap).blockers.includes('M11_INCIDENT_WINDOW_CONTINUITY_INVALID'));
  const overlap=manifest(2);
  overlap.windows[1].window.startedAt='2026-11-16T10:05:00Z';
  assert.ok(assess(overlap).blockers.includes('M11_INCIDENT_WINDOW_CONTINUITY_INVALID'));
  const swap=manifest(2);
  swap.windows.reverse();
  assert.ok(assess(swap).blockers.includes('M11_INCIDENT_WINDOW_CONTINUITY_INVALID'));
});
test('a single malformed monitoring window invalidates the entire collection',()=>{
  const m=manifest(3);
  m.windows[2].metrics.workerRequests=0;
  assert.ok(assess(m).blockers.includes('M11_INCIDENT_MONITOR_EVIDENCE_INVALID'));
  assert.equal(assess(m).continuityStatus,'INSUFFICIENT_EVIDENCE');
  const q=manifest(3);
  q.windows[1].sourceSnapshotSha256='c'.repeat(64);
  assert.ok(assess(q).blockers.includes('M11_INCIDENT_MONITOR_EVIDENCE_INVALID'));
});
test('release and source snapshot pins cannot be replaced in review or manifest',()=>{
  const m=manifest(2);m.releaseSha='d'.repeat(40);
  assert.ok(assess(m).blockers.includes('M11_INCIDENT_PIN_MISMATCH'));
  const q=incident(manifest(2));
  const c=review(0,1);c.sourceSnapshotSha256='d'.repeat(64);
  q.recoveryReviews=[c];
  assert.ok(assess(q).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
  assert.ok(assess(manifest(2),{}).blockers.includes('M11_INCIDENT_PIN_MISMATCH'));
});
test('independent freeze, journal and parity proof IDs must be present and distinct',()=>{
  const m=incident(manifest(2));
  m.recoveryReviews=[review()];
  delete m.recoveryReviews[0].evidence.grossPartyAccounts;
  assert.ok(assess(m).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
  const n=incident(manifest(2));
  n.recoveryReviews=[review()];
  n.recoveryReviews[0].evidence.d1Freeze=n.recoveryReviews[0].evidence.legacyFreeze;
  assert.ok(assess(n).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
  const x=incident(manifest(2));
  x.recoveryReviews=[review()];
  x.recoveryReviews[0].evidence.ownerReview='https://secrets.invalid/token';
  assert.ok(assess(x).blockers.includes('M11_INCIDENT_REVIEW_INVALID'));
});
test('unexpected data payloads, no windows or too many windows fail closed',()=>{
  const m=manifest(2);m.staffPassword='never';
  assert.ok(assess(m).blockers.includes('M11_INCIDENT_SCHEMA_INVALID'));
  const q=manifest(0);
  assert.ok(assess(q).blockers.includes('M11_INCIDENT_WINDOWS_INVALID'));
  const big=manifest(49);
  assert.ok(assess(big).blockers.includes('M11_INCIDENT_WINDOWS_INVALID'));
});
test('ordinary operational escalation does not masquerade as a financial incident',()=>{
  const m=manifest(2);m.windows[1].metrics.worker5xx=20;
  const x=assess(m);
  assert.equal(x.continuityStatus,'ESCALATE');
  assert.equal(x.documentaryComplete,true);
});
