#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessM11MonitoringWindow} from './check-m11-monitoring.mjs';

/**
 * M11-08: sticky, documentary incident hold over supplied monitoring windows.
 * The operator must separately authenticate evidence and approve all actions.
 * This module never changes either writer, the Worker, D1 or source Sheets.
 */
const SHA40=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[a-zA-Z0-9][a-zA-Z0-9._/-]{5,127}$/;
const EVIDENCE=Object.freeze([
  'legacyFreeze','d1Freeze','committedWriteJournal',
  'grossPartyAccounts','inventoryLots','ownerReview'
]);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>isObject(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const safeIndex=x=>Number.isSafeInteger(x)&&x>=0;
const caution='Review of caller-supplied, redacted metadata only. Independently verify incident recovery, source/D1 write freezes, journals, gross Party accounts, stock and owner authorization. This report does not authorize a traffic switch, database restore or resuming writes.';

function validReview(x,release,snapshot){
  if(!exact(x,[
    'incidentWindow','throughWindow','status','releaseSha',
    'sourceSnapshotSha256','evidence'
  ])||!safeIndex(x.incidentWindow)||!safeIndex(x.throughWindow)||
    x.throughWindow<=x.incidentWindow||x.status!=='verified'||
    x.releaseSha!==release||x.sourceSnapshotSha256!==snapshot||
    !exact(x.evidence,EVIDENCE))return false;
  const refs=EVIDENCE.map(k=>x.evidence[k]);
  return refs.every(v=>typeof v==='string'&&REF.test(v))&&
    new Set(refs).size===refs.length;
}

export function assessM11IncidentContinuity(manifest,options={}) {
  const blockers=new Set();
  const alerts=new Set();
  const fail=code=>blockers.add(code);
  const output=(status)=>({
    continuityStatus:blockers.size?'INSUFFICIENT_EVIDENCE':status,
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,
    authorizesWriteResumption:false,
    blockers:[...blockers],
    alerts:[...alerts],
    caution
  });
  if(!isObject(manifest)){
    fail('M11_INCIDENT_INPUT_REQUIRED');
    return output('INSUFFICIENT_EVIDENCE');
  }
  if(!exact(manifest,[
    'schemaVersion','releaseSha','sourceSnapshotSha256','windows','recoveryReviews'
  ])||manifest.schemaVersion!==1){
    fail('M11_INCIDENT_SCHEMA_INVALID');
  }
  const release=options?.expectedReleaseSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  if(!SHA40.test(release??'')||!SHA256.test(snapshot??'')||
    manifest.releaseSha!==release||manifest.sourceSnapshotSha256!==snapshot||
    !SHA40.test(manifest.releaseSha??'')||!SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_INCIDENT_PIN_MISMATCH');
  }
  if(!Array.isArray(manifest.windows)||manifest.windows.length<1||
    manifest.windows.length>48){
    fail('M11_INCIDENT_WINDOWS_INVALID');
  }
  if(!Array.isArray(manifest.recoveryReviews)||
    (Array.isArray(manifest.windows)&&
    manifest.recoveryReviews.length>manifest.windows.length)){
    fail('M11_INCIDENT_REVIEW_INVALID');
  }
  if(blockers.size)return output('INSUFFICIENT_EVIDENCE');

  const reviews=new Map();
  let precedingThroughWindow=-1;
  for(const rev of manifest.recoveryReviews){
    if(!validReview(rev,release,snapshot)||
      rev.throughWindow>=manifest.windows.length||
      rev.throughWindow<=precedingThroughWindow||
      reviews.has(rev.throughWindow)){
      fail('M11_INCIDENT_REVIEW_INVALID');
      continue;
    }
    reviews.set(rev.throughWindow,rev);
    precedingThroughWindow=rev.throughWindow;
  }

  let priorEnd=null;
  let activeHold=false;
  let lastIncidentWindow=-1;
  let recovered=false;
  let latestStatus='OBSERVE';
  for(let i=0;i<manifest.windows.length;i++){
    const item=manifest.windows[i];
    let result;
    try{
      result=assessM11MonitoringWindow(item,{
        expectedReleaseSha:release,
        expectedSourceSnapshotSha256:snapshot
      });
    }catch{
      fail('M11_INCIDENT_MONITOR_EVIDENCE_INVALID');
      continue;
    }
    if(!result.documentaryComplete||
      result.monitorStatus==='INSUFFICIENT_EVIDENCE'){
      fail('M11_INCIDENT_MONITOR_EVIDENCE_INVALID');
    }
    const started=Date.parse(item?.window?.startedAt??'');
    const ended=Date.parse(item?.window?.endedAt??'');
    if(priorEnd!==null&&(!Number.isFinite(started)||started!==priorEnd)){
      fail('M11_INCIDENT_WINDOW_CONTINUITY_INVALID');
    }
    if(Number.isFinite(ended))priorEnd=ended;
    else fail('M11_INCIDENT_MONITOR_EVIDENCE_INVALID');
    latestStatus=result.monitorStatus;
    if(result.monitorStatus==='INCIDENT_HOLD'){
      activeHold=true;
      lastIncidentWindow=i;
      recovered=false;
    }

    const rev=reviews.get(i);
    if(rev){
      if(!activeHold||result.monitorStatus!=='OBSERVE'||
        lastIncidentWindow!==rev.incidentWindow){
        fail('M11_INCIDENT_REVIEW_NOT_APPLICABLE');
      }else{
        activeHold=false;
        recovered=true;
      }
    }
  }

  if(activeHold){
    alerts.add('M11_INCIDENT_HOLD_PERSISTS');
    return output('INCIDENT_HOLD');
  }
  if(latestStatus==='ESCALATE')return output('ESCALATE');
  if(recovered)return output('RECOVERY_REVIEWED');
  return output('OBSERVE');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file,expectedReleaseSha,expectedSourceSnapshotSha256]=process.argv.slice(2);
  if(!file||!expectedReleaseSha||!expectedSourceSnapshotSha256){
    console.error('Usage: node scripts/check-m11-incident-continuity.mjs <PRIVATE_CONTINUITY_JSON> <RELEASE_SHA> <SOURCE_SNAPSHOT_SHA256>');
    process.exitCode=2;
  }else{
    try{
      const manifest=JSON.parse(readFileSync(resolve(file),'utf8'));
      const result=assessM11IncidentContinuity(manifest,{
        expectedReleaseSha,expectedSourceSnapshotSha256
      });
      console.log('M11 incident continuity: '+result.continuityStatus);
      if(result.blockers.length)console.error('Evidence blockers: '+result.blockers.join(', '));
      if(result.alerts.length)console.error('Incident alerts: '+result.alerts.join(', '));
      console.log(result.caution);
      if(!['OBSERVE','RECOVERY_REVIEWED'].includes(result.continuityStatus)){
        process.exitCode=1;
      }
    }catch{
      console.error('M11 incident continuity: INSUFFICIENT_EVIDENCE');
      process.exitCode=1;
    }
  }
}
