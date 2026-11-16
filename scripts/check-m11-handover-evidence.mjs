#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessM11Evidence} from './check-m11-release-evidence.mjs';
import {assessM11ProductionSmoke} from './check-m11-production-smoke.mjs';
import {assessM11IncidentContinuity} from './check-m11-incident-continuity.mjs';

/**
 * M11-10: linked, PRIVATE, operator-supplied handover evidence preflight.
 * No cloud access, secrets, production actions or approval authority.
 */
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SHA40=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[A-Za-z0-9][A-Za-z0-9._/-]{5,127}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CUSTODY=Object.freeze([
  'backupCustodian','restoreDrill','sourceArchive','incidentOnCall',
  'monitoringAlerts','supportHandoff','accountingAcceptance',
  'ownerBusinessAcceptance'
]);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
   Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>obj(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const reviewed=(x,sha)=>exact(x,['status','record','releaseSha'])&&
  x.status==='verified'&&typeof x.record==='string'&&REF.test(x.record)&&
  x.releaseSha===sha;
function utc(x){
  if(typeof x!=='string'||!UTC.test(x))return NaN;
  const n=Date.parse(x);
  return Number.isFinite(n)&&new Date(n).toISOString().replace('.000Z','Z')===x?n:NaN;
}
const CAUTION='Linked operator-supplied metadata only, never authenticated operational evidence. Independently verify all M10 source/D1 reconciliation, real backup restore, authorized release, private smoke, monitoring history, incident resolution, accounting and owner approval. This check does not authorize production deployment, traffic switching, database restore, or resuming legacy/D1 writes.';

export function assessM11HandoverEvidence(manifest,options={}) {
  const blockers=new Set();
  const fail=code=>blockers.add(code);
  const result=()=>({
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,authorizesWriteResumption:false,
    blockers:[...blockers],caution:CAUTION
  });
  if(!obj(manifest)){
    fail('M11_HANDOVER_INPUT_REQUIRED');
    return result();
  }
  if(!exact(manifest,[
    'schemaVersion','releaseSha','sourceSha','sourceSnapshotSha256',
    'observationsEndedAt','reviewedAt','custody'
  ])||manifest.schemaVersion!==1){
    fail('M11_HANDOVER_SCHEMA_INVALID');
  }
  const release=options?.expectedReleaseSha;
  const source=options?.expectedSourceSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  if(!SHA40.test(release??'')||source!==SOURCE||
    !SHA256.test(snapshot??'')||
    manifest.releaseSha!==release||
    manifest.sourceSha!==source||manifest.sourceSnapshotSha256!==snapshot||
    !SHA40.test(manifest.releaseSha??'')||
    !SHA40.test(manifest.sourceSha??'')||
    !SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_HANDOVER_PIN_MISMATCH');
  }

  let approvedRelease=false;
  try{
    approvedRelease=assessM11Evidence(options?.releaseEvidence,{
      phase:'handover',expectedReleaseSha:release,expectedSourceSha:source
    }).documentaryComplete&&
    options?.releaseEvidence?.sourceSnapshotSha256===snapshot;
  }catch{}
  if(!approvedRelease)fail('M11_HANDOVER_RELEASE_UNVERIFIED');

  let completeSmoke=false;
  try{
    completeSmoke=assessM11ProductionSmoke(options?.smokeEvidence,{
      expectedReleaseSha:release,expectedSourceSha:source,
      expectedSourceSnapshotSha256:snapshot,
      releaseEvidence:options?.releaseEvidence,
      cutoverEvidence:options?.cutoverEvidence
    }).documentaryComplete;
  }catch{}
  if(!completeSmoke)fail('M11_HANDOVER_SMOKE_UNVERIFIED');

  const continuity=options?.continuityEvidence;
  let monitorReport=null;
  try{
    monitorReport=assessM11IncidentContinuity(continuity,{
      expectedReleaseSha:release,
      expectedSourceSnapshotSha256:snapshot
    });
  }catch{}
  if(!monitorReport?.documentaryComplete||
    !Array.isArray(continuity?.windows)||continuity.windows.length<2||
    !['OBSERVE','RECOVERY_REVIEWED','INCIDENT_HOLD'].includes(
      monitorReport?.continuityStatus
    )){
    fail('M11_HANDOVER_MONITOR_UNVERIFIED');
  }
  // A reviewed critical event is still an operational incident, not an
  // automatic approval to hand over. A separate human response is required.
  if(monitorReport?.documentaryComplete&&(
    ['INCIDENT_HOLD','RECOVERY_REVIEWED'].includes(monitorReport.continuityStatus)||
    (Array.isArray(continuity?.recoveryReviews)&&continuity.recoveryReviews.length>0)
  )){
    fail('M11_HANDOVER_RECOVERY_REVIEW_REQUIRED');
  }
  const observed=utc(manifest.observationsEndedAt);
  const approvedAt=utc(manifest.reviewedAt);
  const last=Array.isArray(continuity?.windows)?
    continuity.windows.at(-1)?.window?.endedAt:undefined;
  if(!Number.isFinite(observed)||!Number.isFinite(approvedAt)||
    !Number.isFinite(utc(last))||
    manifest.observationsEndedAt!==last||approvedAt<=observed){
    fail('M11_HANDOVER_TIMELINE_INVALID');
  }

  if(!exact(manifest.custody,CUSTODY)){
    fail('M11_HANDOVER_CUSTODY_INVALID');
  }else{
    const seen=new Set();
    for(const key of CUSTODY){
      const entry=manifest.custody[key];
      if(!reviewed(entry,release)||seen.has(entry.record)){
        fail('M11_HANDOVER_CUSTODY_INVALID');
      }else{
        seen.add(entry.record);
      }
    }
    if(manifest.custody.accountingAcceptance?.record!==
      options?.releaseEvidence?.checks?.[
        'postlaunch-d1-write-and-account-reconciliation'
      ]?.record||
      manifest.custody.ownerBusinessAcceptance?.record!==
      options?.releaseEvidence?.checks?.['owner-handover-acceptance']?.record){
      fail('M11_HANDOVER_ACCEPTANCE_MISMATCH');
    }
  }
  return result();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [handoverFile,releaseFile,cutoverFile,smokeFile,continuityFile,
    releaseSha,snapshotSha]=process.argv.slice(2);
  if(process.argv.length!==9){
    console.error('Usage: node scripts/check-m11-handover-evidence.mjs <PRIVATE_HANDOVER_JSON> <PRIVATE_RELEASE_JSON> <PRIVATE_ACTIVATION_JSON> <PRIVATE_SMOKE_JSON> <PRIVATE_MONITORING_JSON> <RELEASE_SHA> <SOURCE_SNAPSHOT_SHA256>');
    process.exitCode=2;
  }else{
    try{
      const read=file=>JSON.parse(readFileSync(resolve(file),'utf8'));
      const result=assessM11HandoverEvidence(read(handoverFile),{
        expectedReleaseSha:releaseSha,expectedSourceSha:SOURCE,
        expectedSourceSnapshotSha256:snapshotSha,
        releaseEvidence:read(releaseFile),cutoverEvidence:read(cutoverFile),
        smokeEvidence:read(smokeFile),continuityEvidence:read(continuityFile)
      });
      console.log('M11 handover: '+(result.documentaryComplete?
        'DOCUMENTARY_COMPLETE':'BLOCKED'));
      if(result.blockers.length)console.error('Evidence blockers: '+result.blockers.join(', '));
      console.log(result.caution);
      if(!result.documentaryComplete)process.exitCode=1;
    }catch{
      console.error('M11 handover: BLOCKED (private input missing or malformed)');
      process.exitCode=1;
    }
  }
}
