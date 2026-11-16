#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * M11-05: offline review of operator-supplied, redacted monitoring summaries.
 * Not a telemetry collector, live alert, incident command or launch authority.
 */
const SHA40=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[a-zA-Z0-9][a-zA-Z0-9._/-]{5,127}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const reference=x=>typeof x==='string'&&REF.test(x);
const METRICS=Object.freeze([
  'workerRequests','worker5xx','workerP95LatencyMs','d1Errors',
  'unauthorizedAcceptedWrites','duplicatePostingEffects',
  'grossLedgerDiscrepancies','inventoryDiscrepancies',
  'legacyWritesAfterFreeze','unreconciledAcknowledgedOperations'
]);
const CAUTION='Offline, operator-supplied metrics only: independently verify live Cloudflare/D1 evidence, financial reconciliation, source freeze and actual alerts. This report does not authorize production deployment, traffic switching, rollback or write resumption.';

function utcMs(x){
  if(typeof x!=='string'||!UTC.test(x))return NaN;
  const ms=Date.parse(x);
  if(!Number.isFinite(ms))return NaN;
  return new Date(ms).toISOString().slice(0,19)+'Z'===x?ms:NaN;
}

export function assessM11MonitoringWindow(manifest,options={}) {
  const blockers=new Set(),alerts=new Set();
  const fail=code=>blockers.add(code),alert=code=>alerts.add(code);
  const report=()=>{
    let monitorStatus='OBSERVE';
    if(blockers.size) monitorStatus='INSUFFICIENT_EVIDENCE';
    else if(alerts.has('M11_MONITOR_CRITICAL_INVARIANT')||
      alerts.has('M11_MONITOR_D1_ERROR')) monitorStatus='INCIDENT_HOLD';
    else if(alerts.size) monitorStatus='ESCALATE';
    return {
      monitorStatus,documentaryComplete:blockers.size===0,
      authorizesTrafficSwitch:false,authorizesWriteResumption:false,
      blockers:[...blockers],alerts:[...alerts],caution:CAUTION
    };
  };
  if(!object(manifest)){
    fail('M11_MONITOR_INPUT_REQUIRED');
    return report();
  }
  if(!exact(manifest,[
    'schemaVersion','releaseSha','sourceSnapshotSha256',
    'window','thresholds','observations','metrics'
  ])||manifest.schemaVersion!==1){
    fail('M11_MONITOR_SCHEMA_INVALID');
  }
  const target=options?.expectedReleaseSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  if(!SHA40.test(target??'')||!SHA256.test(snapshot??'')||
    manifest.releaseSha!==target||manifest.sourceSnapshotSha256!==snapshot||
    !SHA40.test(manifest.releaseSha??'')||
    !SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_MONITOR_PIN_MISMATCH');
  }
  const {window,thresholds,observations,metrics}=manifest;
  const started=utcMs(window?.startedAt),ended=utcMs(window?.endedAt);
  if(!exact(window,['startedAt','endedAt'])||
    !Number.isFinite(started)||!Number.isFinite(ended)||
    ended<=started||ended-started>24*60*60*1000){
    fail('M11_MONITOR_WINDOW_INVALID');
  }
  if(!exact(thresholds,[
    'http5xxRateBps','workerP95LatencyMs','status','record','releaseSha'
  ])||!nonnegative(thresholds.http5xxRateBps)||thresholds.http5xxRateBps>10000||
    !Number.isSafeInteger(thresholds.workerP95LatencyMs)||
    thresholds.workerP95LatencyMs<=0||thresholds.workerP95LatencyMs>60000||
    thresholds.status!=='verified'||!reference(thresholds.record)||
    thresholds.releaseSha!==target){
    fail('M11_MONITOR_THRESHOLDS_INVALID');
  }
  if(!exact(observations,[
    'worker','d1','financial','inventory','legacy','operation','reviewStatus','releaseSha'
  ])||!['worker','d1','financial','inventory','legacy','operation']
    .every(k=>reference(observations[k]))||
    observations.reviewStatus!=='verified'||observations.releaseSha!==target){
    fail('M11_MONITOR_OBSERVATIONS_INVALID');
  }
  if(!exact(metrics,METRICS)||!METRICS.every(k=>nonnegative(metrics[k]))||
    metrics.workerRequests<1||metrics.worker5xx>metrics.workerRequests){
    fail('M11_MONITOR_METRICS_INVALID');
  }
  // Never interpret missing/malformed windows as healthy even when counters look quiet.
  if(blockers.size)return report();
  if([
    metrics.unauthorizedAcceptedWrites,metrics.duplicatePostingEffects,
    metrics.grossLedgerDiscrepancies,metrics.inventoryDiscrepancies,
    metrics.legacyWritesAfterFreeze,metrics.unreconciledAcknowledgedOperations
  ].some(x=>x>0)){
    alert('M11_MONITOR_CRITICAL_INVARIANT');
  }
  if(metrics.d1Errors>0)alert('M11_MONITOR_D1_ERROR');
  // Multiply with BigInt to avoid overflow/rounding on large, safe integer counters.
  if(BigInt(metrics.worker5xx)*10000n>
    BigInt(metrics.workerRequests)*BigInt(thresholds.http5xxRateBps)){
    alert('M11_MONITOR_5XX_BUDGET');
  }
  if(metrics.workerP95LatencyMs>thresholds.workerP95LatencyMs){
    alert('M11_MONITOR_LATENCY_BUDGET');
  }
  return report();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file,expectedReleaseSha,expectedSourceSnapshotSha256]=process.argv.slice(2);
  if(!file||!expectedReleaseSha||!expectedSourceSnapshotSha256){
    console.error('Usage: node scripts/check-m11-monitoring.mjs <PRIVATE_MONITORING_JSON> <RELEASE_SHA> <FINAL_SOURCE_SNAPSHOT_SHA256>');
    process.exitCode=2;
  }else{
    try{
      const evidence=JSON.parse(readFileSync(resolve(file),'utf8'));
      const result=assessM11MonitoringWindow(evidence,{
        expectedReleaseSha,expectedSourceSnapshotSha256
      });
      // Fixed codes only. Never reveal private paths, values, IDs or operator notes.
      console.log('M11 monitoring: '+result.monitorStatus);
      if(result.blockers.length)console.error('Evidence blockers: '+result.blockers.join(', '));
      if(result.alerts.length)console.error('Incident codes: '+result.alerts.join(', '));
      console.log(result.caution);
      if(result.monitorStatus!=='OBSERVE')process.exitCode=1;
    }catch{
      console.error('M11 monitoring: INSUFFICIENT_EVIDENCE (private input invalid or unavailable)');
      process.exitCode=1;
    }
  }
}
