import test from 'node:test';
import assert from 'node:assert/strict';
import {M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';
import {M11_CUTOVER_EVENT_ORDER} from '../scripts/check-m11-cutover-order.mjs';
import {M11_SMOKE_READS,M11_SMOKE_WRITES} from '../scripts/check-m11-production-smoke.mjs';
import {assessM11HandoverEvidence} from '../scripts/check-m11-handover-evidence.mjs';

const RELEASE='a'.repeat(40),SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SNAPSHOT='b'.repeat(64);
const pin={expectedReleaseSha:RELEASE,expectedSourceSha:SOURCE,expectedSourceSnapshotSha256:SNAPSHOT};
const verified=id=>({status:'verified',record:'audit/'+id,releaseSha:RELEASE});

function release(){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
   checks:Object.fromEntries(M11_PHASE_CHECKS.handover.map(id=>[id,verified(id)]))};
}
function cutover(){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
   path:'activation',events:M11_CUTOVER_EVENT_ORDER.activation.map((event,i)=>({
     seq:i+1,event,record:'audit/'+event,releaseSha:RELEASE
   }))};
}
function smoke(){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
   deployment:{...verified('production-deployment'),deployedSha:RELEASE,
     environment:'private-production',workerName:'shererp-business-production'},
   reads:Object.fromEntries(M11_SMOKE_READS.map(k=>[k,verified('read-'+k)])),
   writes:Object.fromEntries(M11_SMOKE_WRITES.map((k,i)=>[k,{
     status:'verified',operationId:'smoke-op-'+String(i).padStart(3,'0')+'-0001',
     receiptRecord:'audit/receipt-'+k,verificationRecord:'audit/verified-'+k,
     unexplainedDifferences:0,releaseSha:RELEASE
   }])),
   postSmoke:{...verified('post-smoke-reconciliation'),
     unreconciledAcknowledgedOperations:0,grossPartyDiscrepancies:0,
     inventoryDiscrepancies:0,cashBankDiscrepancies:0},
   writerBoundary:{...verified('single-writer'),authority:'d1-only',
     activeWriters:1,legacyWritesAfterFreeze:0}
 };
}
function monitor(i=0){
 const start=Date.UTC(2026,10,16,10,i*15,0),t=n=>new Date(n).toISOString().replace('.000Z','Z');
 return {schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,
   window:{startedAt:t(start),endedAt:t(start+900000)},
   thresholds:{http5xxRateBps:100,workerP95LatencyMs:750,
     status:'verified',record:'audit/approved-threshold',releaseSha:RELEASE},
   observations:{worker:'audit/worker',d1:'audit/d1',financial:'audit/financial',
     inventory:'audit/inventory',legacy:'audit/legacy',operation:'audit/operations',
     reviewStatus:'verified',releaseSha:RELEASE},
   metrics:{workerRequests:1000,worker5xx:0,workerP95LatencyMs:200,
     d1Errors:0,unauthorizedAcceptedWrites:0,duplicatePostingEffects:0,
     grossLedgerDiscrepancies:0,inventoryDiscrepancies:0,
     legacyWritesAfterFreeze:0,unreconciledAcknowledgedOperations:0}
 };
}
function continuity(){return {schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SNAPSHOT,
  windows:[monitor(0),monitor(1)],recoveryReviews:[]};
}
function handover(){
 return {schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
  observationsEndedAt:'2026-11-16T10:30:00Z',
  reviewedAt:'2026-11-16T10:45:00Z',
  custody:{
    backupCustodian:verified('backup-custody'),
    restoreDrill:verified('restoration-drill'),
    sourceArchive:verified('source-retention'),
    incidentOnCall:verified('incident-on-call'),
    monitoringAlerts:verified('alert-routing'),
    supportHandoff:verified('support-handoff'),
    accountingAcceptance:verified('postlaunch-d1-write-and-account-reconciliation'),
    ownerBusinessAcceptance:verified('owner-handover-acceptance')
  }
 };
}
function opts(){
 return {...pin,releaseEvidence:release(),cutoverEvidence:cutover(),
   smokeEvidence:smoke(),continuityEvidence:continuity()};
}
const check=(m=handover(),o=opts())=>assessM11HandoverEvidence(m,o);
const blocked=(m,o,code)=>{
 const res=check(m,o);
 assert.equal(res.documentaryComplete,false);
 assert.ok(res.blockers.includes(code),JSON.stringify(res.blockers));
 assert.equal(res.authorizesTrafficSwitch,false);
 assert.equal(res.authorizesWriteResumption,false);
};

test('missing private handover evidence blocks and never authorizes actions',()=>{
 blocked(null,opts(),'M11_HANDOVER_INPUT_REQUIRED');
});
test('a fully pinned synthetic handover is documentary only, never production GO',()=>{
 const x=check();
 assert.equal(x.documentaryComplete,true);
 assert.deepEqual(x.blockers,[]);
 assert.equal(x.authorizesTrafficSwitch,false);
 assert.equal(x.authorizesWriteResumption,false);
 assert.match(x.caution,/independent|not.*authoriz/i);
});
test('missing handover-phase owner signoff or account reconciliation blocks',()=>{
 const a=opts();delete a.releaseEvidence.checks['owner-handover-acceptance'];
 blocked(handover(),a,'M11_HANDOVER_RELEASE_UNVERIFIED');
 const b=opts();delete b.releaseEvidence.checks['postlaunch-d1-write-and-account-reconciliation'];
 blocked(handover(),b,'M11_HANDOVER_RELEASE_UNVERIFIED');
});
test('every signed handover item binds to one exact release and source snapshot',()=>{
 const m=handover();m.sourceSnapshotSha256='c'.repeat(64);
 blocked(m,opts(),'M11_HANDOVER_PIN_MISMATCH');
 const n=handover();n.releaseSha='d'.repeat(40);
 blocked(n,opts(),'M11_HANDOVER_PIN_MISMATCH');
 blocked(handover(),{},'M11_HANDOVER_PIN_MISMATCH');
});
test('failed business smoke or activation chronology cannot be hidden by handover references',()=>{
 const a=opts();a.smokeEvidence.writes['purchase'].unexplainedDifferences=1;
 blocked(handover(),a,'M11_HANDOVER_SMOKE_UNVERIFIED');
 const b=opts();b.cutoverEvidence.events[4].event='traffic-switched-to-d1';
 blocked(handover(),b,'M11_HANDOVER_SMOKE_UNVERIFIED');
});
test('handovers require at least two contiguous monitoring windows and no escalation',()=>{
 const a=opts();a.continuityEvidence.windows.pop();
 blocked(handover(),a,'M11_HANDOVER_MONITOR_UNVERIFIED');
 const b=opts();b.continuityEvidence.windows[1].window.startedAt='2026-11-16T10:18:00Z';
 blocked(handover(),b,'M11_HANDOVER_MONITOR_UNVERIFIED');
 const c=opts();c.continuityEvidence.windows[1].metrics.worker5xx=20;
 blocked(handover(),c,'M11_HANDOVER_MONITOR_UNVERIFIED');
});
test('any critical incident blocks ordinary handover even after a quiet follow-up',()=>{
 const a=opts();a.continuityEvidence.windows[0].metrics.d1Errors=1;
 blocked(handover(),a,'M11_HANDOVER_RECOVERY_REVIEW_REQUIRED');
 const b=opts();b.continuityEvidence.windows[1].metrics.duplicatePostingEffects=1;
 blocked(handover(),b,'M11_HANDOVER_RECOVERY_REVIEW_REQUIRED');
});
test('reviewed recovery remains an incident handover needing separate owner escalation',()=>{
 const a=opts();
 a.continuityEvidence.windows[0].metrics.inventoryDiscrepancies=1;
 a.continuityEvidence.recoveryReviews=[{
   incidentWindow:0,throughWindow:1,status:'verified',releaseSha:RELEASE,
   sourceSnapshotSha256:SNAPSHOT,evidence:{
     legacyFreeze:'audit/review-legacy-freeze',d1Freeze:'audit/review-d1-freeze',
     committedWriteJournal:'audit/review-journal',
     grossPartyAccounts:'audit/review-accounts',inventoryLots:'audit/review-stock',
     ownerReview:'audit/review-owner'
   }
 }];
 blocked(handover(),a,'M11_HANDOVER_RECOVERY_REVIEW_REQUIRED');
});
test('handovers reviewed before the last monitoring observation or with falsified end are refused',()=>{
 const a=handover();a.reviewedAt='2026-11-16T10:20:00Z';
 blocked(a,opts(),'M11_HANDOVER_TIMELINE_INVALID');
 const b=handover();b.observationsEndedAt='2026-11-16T10:15:00Z';
 blocked(b,opts(),'M11_HANDOVER_TIMELINE_INVALID');
 const c=handover();c.reviewedAt='2026-11-16T10:45:00+00:00';
 blocked(c,opts(),'M11_HANDOVER_TIMELINE_INVALID');
});
test('backup, restore, source retention, paging, alerts and support custody all required',()=>{
 const missing=handover();delete missing.custody.restoreDrill;
 blocked(missing,opts(),'M11_HANDOVER_CUSTODY_INVALID');
 const bad=handover();bad.custody.monitoringAlerts.status='pending';
 blocked(bad,opts(),'M11_HANDOVER_CUSTODY_INVALID');
 const unsafe=handover();unsafe.custody.sourceArchive.record='https://private.invalid/token';
 blocked(unsafe,opts(),'M11_HANDOVER_CUSTODY_INVALID');
});
test('no same evidence record may serve two distinct handover owners',()=>{
 const x=handover();
 x.custody.backupCustodian.record=x.custody.supportHandoff.record;
 blocked(x,opts(),'M11_HANDOVER_CUSTODY_INVALID');
 const y=handover();y.custody.ownerBusinessAcceptance.record=y.custody.accountingAcceptance.record;
 blocked(y,opts(),'M11_HANDOVER_CUSTODY_INVALID');
});
test('final accounting and owner approvals must match separately retained release evidence',()=>{
 const x=handover();x.custody.accountingAcceptance.record='audit/other-accountant';
 blocked(x,opts(),'M11_HANDOVER_ACCEPTANCE_MISMATCH');
 const y=handover();y.custody.ownerBusinessAcceptance.record='audit/other-owner';
 blocked(y,opts(),'M11_HANDOVER_ACCEPTANCE_MISMATCH');
});
test('unknown fields and input secrets fail closed without exposing their contents',()=>{
 const x=handover();x.privateKeys=['secret'];
 blocked(x,opts(),'M11_HANDOVER_SCHEMA_INVALID');
 const y=handover();y.custody.ownerBusinessAcceptance.apiToken='bad';
 blocked(y,opts(),'M11_HANDOVER_CUSTODY_INVALID');
});
test('missing continuity evidence and mismatched source pins cannot pass',()=>{
 const a=opts();delete a.continuityEvidence;
 blocked(handover(),a,'M11_HANDOVER_MONITOR_UNVERIFIED');
 const b=opts();b.continuityEvidence.sourceSnapshotSha256='c'.repeat(64);
 blocked(handover(),b,'M11_HANDOVER_MONITOR_UNVERIFIED');
});
