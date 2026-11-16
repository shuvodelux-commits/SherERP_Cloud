import test from 'node:test';
import assert from 'node:assert/strict';
import {M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';
import {M11_CUTOVER_EVENT_ORDER} from '../scripts/check-m11-cutover-order.mjs';
import {
  M11_SMOKE_READS,M11_SMOKE_WRITES,assessM11ProductionSmoke
} from '../scripts/check-m11-production-smoke.mjs';

const RELEASE='a'.repeat(40),SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SNAPSHOT='b'.repeat(64);
const reviewed=(id)=>({status:'verified',record:'audit/'+id,releaseSha:RELEASE});
function release(){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
    checks:Object.fromEntries(M11_PHASE_CHECKS.switch.map(id=>[id,reviewed(id)]))
  };
}
function cutover(path='activation'){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
    path,events:M11_CUTOVER_EVENT_ORDER[path].map((event,i)=>({
      seq:i+1,event,record:'audit/'+event,releaseSha:RELEASE
    }))
  };
}
function evidence(){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,sourceSnapshotSha256:SNAPSHOT,
    deployment:{
      status:'verified',record:'audit/production-deployment',releaseSha:RELEASE,
      deployedSha:RELEASE,environment:'private-production',workerName:'shererp-business-production'
    },
    reads:Object.fromEntries(M11_SMOKE_READS.map(id=>[id,reviewed('read-'+id)])),
    writes:Object.fromEntries(M11_SMOKE_WRITES.map((id,i)=>[id,{
      status:'verified',operationId:'smoke-op-'+String(i).padStart(3,'0')+'-0001',
      receiptRecord:'audit/receipt-'+id,
      verificationRecord:'audit/verification-'+id,
      unexplainedDifferences:0,releaseSha:RELEASE
    }])),
    postSmoke:{
      status:'verified',record:'audit/independent-post-smoke-reconciliation',
      releaseSha:RELEASE,unreconciledAcknowledgedOperations:0,
      grossPartyDiscrepancies:0,inventoryDiscrepancies:0,cashBankDiscrepancies:0
    },
    writerBoundary:{
      status:'verified',record:'audit/single-authoritative-writer',
      releaseSha:RELEASE,authority:'d1-only',activeWriters:1,legacyWritesAfterFreeze:0
    }
  };
}
const opts=(override={})=>({
  expectedReleaseSha:RELEASE,expectedSourceSha:SOURCE,expectedSourceSnapshotSha256:SNAPSHOT,
  releaseEvidence:release(),cutoverEvidence:cutover(),...override
});
const check=(input=evidence(),options=opts())=>assessM11ProductionSmoke(input,options);
const blocked=(input,options,code)=>{
  const x=check(input,options);
  assert.equal(x.documentaryComplete,false);
  assert.ok(x.blockers.includes(code),JSON.stringify(x.blockers));
  assert.equal(x.authorizesTrafficSwitch,false);
  assert.equal(x.authorizesWriteResumption,false);
};

test('missing smoke document fails closed with no action permission',()=>{
  blocked(null,opts(),'M11_SMOKE_INPUT_REQUIRED');
});
test('canonical private synthetic smoke matrix can be documented but never authorizes launch',()=>{
  const a=check();
  assert.equal(M11_SMOKE_READS.length,7);
  assert.equal(M11_SMOKE_WRITES.length,7);
  assert.equal(a.documentaryComplete,true);
  assert.deepEqual(a.blockers,[]);
  assert.equal(a.authorizesTrafficSwitch,false);
  assert.equal(a.authorizesWriteResumption,false);
  assert.match(a.caution,/independently|not.*authoriz/i);
});
test('release switch approval and exact source snapshot must be present',()=>{
  const o=opts(); delete o.releaseEvidence.checks['owner-switch-go'];
  blocked(evidence(),o,'M11_SMOKE_CUTOVER_UNVERIFIED');
  const p=opts();p.expectedSourceSnapshotSha256='c'.repeat(64);
  blocked(evidence(),p,'M11_SMOKE_PIN_MISMATCH');
});
test('a rollback or read-only hold is never a valid post-activation smoke',()=>{
  const o=opts({cutoverEvidence:cutover('hold-d1-readonly')});
  blocked(evidence(),o,'M11_SMOKE_ACTIVATION_REQUIRED');
});
test('missing, reordered or forged source freeze and parity cutover events block',()=>{
  const o=opts();o.cutoverEvidence.events.splice(3,1);
  blocked(evidence(),o,'M11_SMOKE_CUTOVER_UNVERIFIED');
  const p=opts();p.cutoverEvidence.events[4].record='https://example.invalid/secrets';
  blocked(evidence(),p,'M11_SMOKE_CUTOVER_UNVERIFIED');
});
test('stale observed deployment, public preview worker and wrong environment fail closed',()=>{
  const a=evidence();a.deployment.deployedSha='f'.repeat(40);
  blocked(a,opts(),'M11_SMOKE_DEPLOYMENT_INVALID');
  const b=evidence();b.deployment.workerName='shererp-cloud-preview';
  blocked(b,opts(),'M11_SMOKE_DEPLOYMENT_INVALID');
  const c=evidence();c.deployment.environment='public-preview';
  blocked(c,opts(),'M11_SMOKE_DEPLOYMENT_INVALID');
});
test('missing or unreviewed read-path evidence blocks, even if other checks pass',()=>{
  const a=evidence();delete a.reads['invoice-print'];
  blocked(a,opts(),'M11_SMOKE_READS_INVALID');
  const b=evidence();b.reads['rbac-denial'].status='pending';
  blocked(b,opts(),'M11_SMOKE_READS_INVALID');
  const c=evidence();c.reads['health-deployed'].record='https://x.test/private?token=x';
  blocked(c,opts(),'M11_SMOKE_READS_INVALID');
});
test('all seven write-path receipts and parity evidence are individually required',()=>{
  const a=evidence();delete a.writes['split-payment'];
  blocked(a,opts(),'M11_SMOKE_WRITES_INVALID');
  const b=evidence();b.writes['sales-return'].status='pending';
  blocked(b,opts(),'M11_SMOKE_WRITES_INVALID');
  const c=evidence();c.writes['purchase'].unexplainedDifferences=1;
  blocked(c,opts(),'M11_SMOKE_WRITES_INVALID');
});
test('a single receipt or operation reused for two different smoke workflows is rejected',()=>{
  const a=evidence();
  a.writes['purchase'].operationId=a.writes['pos-sale'].operationId;
  blocked(a,opts(),'M11_SMOKE_WRITES_INVALID');
  const b=evidence();b.writes['sales-return'].receiptRecord=b.writes['purchase-return'].receiptRecord;
  blocked(b,opts(),'M11_SMOKE_WRITES_INVALID');
  const c=evidence();c.writes['cash-bank'].verificationRecord=c.writes['cash-session'].receiptRecord;
  blocked(c,opts(),'M11_SMOKE_WRITES_INVALID');
});
test('post-smoke unresolved acknowledgments or gross Party, inventory, cash-bank discrepancies block',()=>{
  for(const field of [
    'unreconciledAcknowledgedOperations','grossPartyDiscrepancies',
    'inventoryDiscrepancies','cashBankDiscrepancies']){
    const a=evidence();a.postSmoke[field]=1;
    blocked(a,opts(),'M11_SMOKE_RECONCILIATION_INVALID');
  }
});
test('writer boundary requires exactly one D1 writer and no post-freeze legacy writes',()=>{
  const a=evidence();a.writerBoundary.activeWriters=2;
  blocked(a,opts(),'M11_SMOKE_WRITER_BOUNDARY_INVALID');
  const b=evidence();b.writerBoundary.authority='legacy';
  blocked(b,opts(),'M11_SMOKE_WRITER_BOUNDARY_INVALID');
  const c=evidence();c.writerBoundary.legacyWritesAfterFreeze=1;
  blocked(c,opts(),'M11_SMOKE_WRITER_BOUNDARY_INVALID');
});
test('missing signer, release or source checksum cannot validate arbitrary synthetic smoke',()=>{
  const a=evidence();a.releaseSha='c'.repeat(40);
  blocked(a,opts(),'M11_SMOKE_PIN_MISMATCH');
  const b=evidence();b.sourceSha='d'.repeat(40);
  blocked(b,opts(),'M11_SMOKE_PIN_MISMATCH');
  blocked(evidence(),{},'M11_SMOKE_PIN_MISMATCH');
});
test('unreviewed accounts, injection fields or unsafe operation ID shapes fail closed',()=>{
  const a=evidence();a.staffPassword='not-a-field';
  blocked(a,opts(),'M11_SMOKE_SCHEMA_INVALID');
  const b=evidence();b.writes['purchase'].sql='DELETE FROM invoices';
  blocked(b,opts(),'M11_SMOKE_WRITES_INVALID');
  const c=evidence();c.writes['purchase'].operationId='short';
  blocked(c,opts(),'M11_SMOKE_WRITES_INVALID');
  const d=evidence();d.postSmoke.status='pending';
  blocked(d,opts(),'M11_SMOKE_RECONCILIATION_INVALID');
});
