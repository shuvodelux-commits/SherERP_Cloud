#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessM11CutoverOrder} from './check-m11-cutover-order.mjs';

/**
 * M11-11: pure offline authority-window review over operator-supplied metadata.
 * Neither verifies real writer state nor acts on Workers, D1 or legacy Sheets.
 */
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SHA40=/^[a-f0-9]{40}$/i,SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[A-Za-z0-9][A-Za-z0-9._/-]{5,127}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const M11_WRITER_PATTERNS=Object.freeze({
  activation:Object.freeze(['legacy','frozen','d1']),
  'rollback-to-legacy':Object.freeze(['legacy','frozen','d1','frozen','legacy']),
  'hold-d1-readonly':Object.freeze(['legacy','frozen','d1','frozen'])
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Reflect.ownKeys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k))&&Reflect.ownKeys(x).every(k=>typeof k==='string');
const count=x=>Number.isSafeInteger(x)&&x>=0;
const record=x=>typeof x==='string'&&REF.test(x);
function instant(x){
  if(typeof x!=='string'||!UTC.test(x))return NaN;
  const ms=Date.parse(x);
  return Number.isFinite(ms)&&new Date(ms).toISOString().replace('.000Z','Z')===x?ms:NaN;
}
const CAUTION='Offline, operator-supplied metadata only. Independently verify actual legacy and D1 writer fences, server journals, source snapshot, every committed operation, replay and account/stock reconciliation. This report does not authorize production deployment, a source freeze, traffic switching, database restore or resuming writes.';

export function assessM11SingleWriterTimeline(manifest,options={}) {
  const blockers=new Set(),fail=code=>blockers.add(code);
  const result=()=>({
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,authorizesWriteResumption:false,
    blockers:[...blockers],caution:CAUTION
  });
  if(!object(manifest)){
    fail('M11_TIMELINE_MANIFEST_REQUIRED');
    return result();
  }
  if(!exact(manifest,[
    'schemaVersion','releaseSha','sourceSha','sourceSnapshotSha256',
    'mode','epochs','checkpoint'
  ])||manifest.schemaVersion!==1){
    fail('M11_TIMELINE_SCHEMA_INVALID');
  }
  const release=options?.expectedReleaseSha,source=options?.expectedSourceSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  if(!SHA40.test(release??'')||!SHA256.test(snapshot??'')||source!==SOURCE||
    manifest.releaseSha!==release||manifest.sourceSha!==source||
    manifest.sourceSnapshotSha256!==snapshot||
    !SHA40.test(manifest.releaseSha??'')||
    !SHA40.test(manifest.sourceSha??'')||
    !SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_TIMELINE_PIN_MISMATCH');
  }
  const pattern=Object.hasOwn(M11_WRITER_PATTERNS,manifest.mode)?
    M11_WRITER_PATTERNS[manifest.mode]:null;
  if(!pattern)fail('M11_TIMELINE_MODE_INVALID');
  if(manifest.mode==='activation'&&options?.deltaEvidence!==undefined){
    fail('M11_TIMELINE_DELTA_UNEXPECTED');
  }
  // The existing documentary cutover check owns approval order and write-delta
  // coverage. Never accept a plausible timeline while those references disagree.
  try{
    const sequence=options?.cutoverEvidence;
    const order=assessM11CutoverOrder(sequence,{
      expectedReleaseSha:release,expectedSourceSha:source,
      expectedSourceSnapshotSha256:snapshot,
      releaseEvidence:options?.releaseEvidence,
      deltaEvidence:options?.deltaEvidence
    });
    if(sequence?.path!==manifest.mode||!order.documentaryComplete){
      fail('M11_TIMELINE_CUTOVER_UNVERIFIED');
    }
  }catch{
    fail('M11_TIMELINE_CUTOVER_UNVERIFIED');
  }
  if(!Array.isArray(manifest.epochs)||!pattern||
    manifest.epochs.length!==pattern.length){
    fail('M11_TIMELINE_SEQUENCE_INVALID');
  }
  const epochs=Array.isArray(manifest.epochs)?manifest.epochs:[];
  const seen=new Set();
  let priorEnd=null,d1Commits=0n;
  for(let i=0;i<epochs.length;i++){
    const e=epochs[i];
    if(!exact(e,[
      'startedAt','endedAt','authority','legacyCommits','d1Commits',
      'record','releaseSha'
    ])||!record(e.record)||seen.has(e.record)||e.releaseSha!==release||
      !count(e.legacyCommits)||!count(e.d1Commits)){
      fail('M11_TIMELINE_EPOCH_INVALID');
    }
    if(record(e?.record))seen.add(e.record);
    const started=instant(e?.startedAt),ended=instant(e?.endedAt);
    if(!Number.isFinite(started)||!Number.isFinite(ended)||
      ended<=started||ended-started>24*60*60*1000||
      (priorEnd!==null&&started!==priorEnd)){
      fail('M11_TIMELINE_CLOCK_INVALID');
    }
    priorEnd=Number.isFinite(ended)?ended:null;
    if(!pattern||e?.authority!==pattern[i]){
      fail('M11_TIMELINE_SEQUENCE_INVALID');
    }
    if(e?.authority==='frozen'&&
      ((count(e.legacyCommits)&&e.legacyCommits>0)||
       (count(e.d1Commits)&&e.d1Commits>0))) {
      fail('M11_TIMELINE_UNAUTHORIZED_COMMIT');
    }
    if(e?.authority==='legacy'&&count(e.d1Commits)&&e.d1Commits>0){
      fail('M11_TIMELINE_UNAUTHORIZED_COMMIT');
    }
    if(e?.authority==='d1'&&count(e.legacyCommits)&&e.legacyCommits>0){
      fail('M11_TIMELINE_UNAUTHORIZED_COMMIT');
    }
    if(e?.authority==='d1'&&count(e.d1Commits)){
      d1Commits+=BigInt(e.d1Commits);
    }
  }
  const events=Array.isArray(options?.cutoverEvidence?.events)?
    options.cutoverEvidence.events:[];
  const links=[
    [1,'legacy-writes-frozen'],
    [2,'traffic-switched-to-d1'],
    ...(manifest.mode!=='activation'?[[3,'worker-writes-frozen']]:[]),
    ...(manifest.mode==='rollback-to-legacy'?[[4,'traffic-restored-to-legacy']]:[])
  ];
  for(const [index,eventName] of links){
    if(epochs[index]?.record!==events.find(x=>x?.event===eventName)?.record){
      fail('M11_TIMELINE_EVENT_MISMATCH');
    }
  }
  if(pattern&&manifest.mode!=='activation'){
    const delta=options?.deltaEvidence;
    if(delta?.freeze?.legacy?.record!==epochs[1]?.record||
      delta?.freeze?.d1?.record!==epochs[3]?.record){
      fail('M11_TIMELINE_DELTA_FREEZE_MISMATCH');
    }
    if(!count(delta?.checkpoints?.committed?.count)||
      BigInt(delta.checkpoints.committed.count)!==d1Commits){
      fail('M11_TIMELINE_DELTA_COUNT_MISMATCH');
    }
  }
  const cp=manifest.checkpoint;
  if(!exact(cp,[
    'status','record','releaseSha','unreconciledAcknowledgedOperations',
    'duplicateOperationEffects','grossPartyDiscrepancies',
    'inventoryDiscrepancies','legacyWritesAfterFreeze'
  ])||cp.status!=='verified'||!record(cp.record)||seen.has(cp.record)||
    cp.releaseSha!==release||
    !['unreconciledAcknowledgedOperations','duplicateOperationEffects',
      'grossPartyDiscrepancies','inventoryDiscrepancies',
      'legacyWritesAfterFreeze'].every(k=>cp[k]===0)){
    fail('M11_TIMELINE_CHECKPOINT_INVALID');
  }
  return result();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==5&&args.length!==6){
    console.error('Usage: node scripts/check-m11-single-writer-timeline.mjs <PRIVATE_TIMELINE_JSON> <PRIVATE_CUTOVER_JSON> <PRIVATE_RELEASE_JSON> <RELEASE_SHA> <SOURCE_SNAPSHOT_SHA256> [PRIVATE_WRITE_DELTA_JSON]');
    process.exitCode=2;
  }else{
    try{
      const [timelineFile,sequenceFile,releaseFile,releaseSha,snapshotSha,deltaFile]=args;
      const read=file=>JSON.parse(readFileSync(resolve(file),'utf8'));
      const report=assessM11SingleWriterTimeline(read(timelineFile),{
        expectedReleaseSha:releaseSha,expectedSourceSha:SOURCE,
        expectedSourceSnapshotSha256:snapshotSha,
        cutoverEvidence:read(sequenceFile),releaseEvidence:read(releaseFile),
        ...(deltaFile?{deltaEvidence:read(deltaFile)}:{})
      });
      console.log('M11 single-writer timeline: '+(report.documentaryComplete?
        'DOCUMENTARY_COMPLETE':'BLOCKED'));
      if(report.blockers.length)console.error('Blocker codes: '+report.blockers.join(', '));
      console.log(report.caution);
      if(!report.documentaryComplete)process.exitCode=1;
    }catch{
      // Do not print confidential input, path, operation ID, or exception text.
      console.error('M11 single-writer timeline: BLOCKED (private input invalid or missing)');
      process.exitCode=1;
    }
  }
}
