import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM11MonitoringWindow} from '../scripts/check-m11-monitoring.mjs';

const RELEASE='a'.repeat(40);
const SOURCE_SNAPSHOT='b'.repeat(64);
const pinned={expectedReleaseSha:RELEASE,expectedSourceSnapshotSha256:SOURCE_SNAPSHOT};
const metrics=()=>({
  workerRequests:1000,worker5xx:1,workerP95LatencyMs:200,d1Errors:0,
  unauthorizedAcceptedWrites:0,duplicatePostingEffects:0,
  grossLedgerDiscrepancies:0,inventoryDiscrepancies:0,
  legacyWritesAfterFreeze:0,unreconciledAcknowledgedOperations:0
});
function windowReport(){
  return {
    schemaVersion:1,releaseSha:RELEASE,sourceSnapshotSha256:SOURCE_SNAPSHOT,
    window:{startedAt:'2026-11-16T10:00:00Z',endedAt:'2026-11-16T10:15:00Z'},
    thresholds:{
      http5xxRateBps:100,workerP95LatencyMs:750,
      status:'verified',record:'audit/slo-approval',releaseSha:RELEASE
    },
    observations:{
      worker:'audit/worker-dashboard',d1:'audit/d1-dashboard',
      financial:'audit/gross-account-audit',inventory:'audit/lot-stock-audit',
      legacy:'audit/legacy-write-watch',operation:'audit/acknowledged-ops',
      reviewStatus:'verified',releaseSha:RELEASE
    },
    metrics:metrics()
  };
}
const inspect=(r,opts=pinned)=>assessM11MonitoringWindow(r,opts);

test('missing monitoring evidence is insufficient, never a healthy verdict',()=>{
  const a=inspect(undefined);
  assert.equal(a.monitorStatus,'INSUFFICIENT_EVIDENCE');
  assert.equal(a.authorizesTrafficSwitch,false);
  assert.equal(a.authorizesWriteResumption,false);
  assert.ok(a.blockers.length);
});
test('synthetic complete quiet monitoring window is OBSERVE only, not live authorization',()=>{
  const a=inspect(windowReport());
  assert.equal(a.monitorStatus,'OBSERVE');
  assert.deepEqual(a.blockers,[]);
  assert.deepEqual(a.alerts,[]);
  assert.equal(a.authorizesTrafficSwitch,false);
  assert.equal(a.authorizesWriteResumption,false);
  assert.match(a.caution,/independently|not.*authoriz/i);
});
test('any security, finance, inventory, legacy or ack invariant issue demands INCIDENT_HOLD',()=>{
  const critical=[
    'unauthorizedAcceptedWrites','duplicatePostingEffects','grossLedgerDiscrepancies',
    'inventoryDiscrepancies','legacyWritesAfterFreeze','unreconciledAcknowledgedOperations'
  ];
  for(const k of critical){
    const w=windowReport();w.metrics[k]=1;
    const a=inspect(w);
    assert.equal(a.monitorStatus,'INCIDENT_HOLD',k);
    assert.ok(a.alerts.includes('M11_MONITOR_CRITICAL_INVARIANT'),k);
    assert.equal(a.authorizesWriteResumption,false);
  }
});
test('D1 errors require incident hold even with otherwise quiet business counters',()=>{
  const w=windowReport();w.metrics.d1Errors=1;
  const a=inspect(w);
  assert.equal(a.monitorStatus,'INCIDENT_HOLD');
  assert.ok(a.alerts.includes('M11_MONITOR_D1_ERROR'));
});
test('HTTP error budget exceedance escalates without granting an automatic rollback',()=>{
  const w=windowReport();w.metrics.worker5xx=11;
  const a=inspect(w);
  assert.equal(a.monitorStatus,'ESCALATE');
  assert.ok(a.alerts.includes('M11_MONITOR_5XX_BUDGET'));
  assert.equal(a.authorizesTrafficSwitch,false);
});
test('p95 threshold exceedance escalates',()=>{
  const w=windowReport();w.metrics.workerP95LatencyMs=751;
  const a=inspect(w);
  assert.equal(a.monitorStatus,'ESCALATE');
  assert.ok(a.alerts.includes('M11_MONITOR_LATENCY_BUDGET'));
});
test('security/accounting incident outranks HTTP escalation',()=>{
  const w=windowReport();w.metrics.duplicatePostingEffects=1;w.metrics.worker5xx=600;
  assert.equal(inspect(w).monitorStatus,'INCIDENT_HOLD');
});
test('zero traffic, impossible error counters, fractional and negative inputs fail closed',()=>{
  const zero=windowReport();zero.metrics.workerRequests=0;
  assert.equal(inspect(zero).monitorStatus,'INSUFFICIENT_EVIDENCE');
  const impossible=windowReport();impossible.metrics.worker5xx=1001;
  assert.ok(inspect(impossible).blockers.includes('M11_MONITOR_METRICS_INVALID'));
  const frac=windowReport();frac.metrics.d1Errors=0.5;
  assert.ok(inspect(frac).blockers.includes('M11_MONITOR_METRICS_INVALID'));
  const neg=windowReport();neg.metrics.inventoryDiscrepancies=-1;
  assert.ok(inspect(neg).blockers.includes('M11_MONITOR_METRICS_INVALID'));
});
test('release SHA and source snapshot checksum must match caller pinned evidence',()=>{
  const stale=windowReport();stale.releaseSha='c'.repeat(40);
  assert.ok(inspect(stale).blockers.includes('M11_MONITOR_PIN_MISMATCH'));
  const checksum=windowReport();checksum.sourceSnapshotSha256='d'.repeat(64);
  assert.ok(inspect(checksum).blockers.includes('M11_MONITOR_PIN_MISMATCH'));
  assert.ok(inspect(windowReport(),{}).blockers.includes('M11_MONITOR_PIN_MISMATCH'));
});
test('missing operator-approved thresholds or private observation references is insufficient',()=>{
  const w=windowReport();w.thresholds.status='pending';
  assert.ok(inspect(w).blockers.includes('M11_MONITOR_THRESHOLDS_INVALID'));
  const x=windowReport();delete x.observations.financial;
  assert.ok(inspect(x).blockers.includes('M11_MONITOR_OBSERVATIONS_INVALID'));
  const y=windowReport();y.observations.d1='https://private.example?token=unsafe';
  assert.ok(inspect(y).blockers.includes('M11_MONITOR_OBSERVATIONS_INVALID'));
});
test('invalid window order, timestamps or unbounded duration cannot pass',()=>{
  const w=windowReport();w.window.endedAt='2026-11-16T09:00:00Z';
  assert.ok(inspect(w).blockers.includes('M11_MONITOR_WINDOW_INVALID'));
  const x=windowReport();x.window.endedAt='2026-11-17T12:00:00Z';
  assert.ok(inspect(x).blockers.includes('M11_MONITOR_WINDOW_INVALID'));
  const y=windowReport();y.window.startedAt='yesterday';
  assert.ok(inspect(y).blockers.includes('M11_MONITOR_WINDOW_INVALID'));
});
test('unexpected source fields, secret payloads and unapproved SLO values are rejected',()=>{
  const w=windowReport();w.apiToken='not allowed';
  assert.ok(inspect(w).blockers.includes('M11_MONITOR_SCHEMA_INVALID'));
  const x=windowReport();x.metrics.rawInvoices=['secret'];
  assert.ok(inspect(x).blockers.includes('M11_MONITOR_METRICS_INVALID'));
  const y=windowReport();y.thresholds.http5xxRateBps=10001;
  assert.ok(inspect(y).blockers.includes('M11_MONITOR_THRESHOLDS_INVALID'));
  const z=windowReport();z.observations.staffPassword='never';
  assert.ok(inspect(z).blockers.includes('M11_MONITOR_OBSERVATIONS_INVALID'));
});
