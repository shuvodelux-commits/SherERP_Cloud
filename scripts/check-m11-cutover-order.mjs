#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessM11Evidence} from './check-m11-release-evidence.mjs';
import {assessM11WriteDelta} from './check-m11-write-delta.mjs';

/** Offline order review only: references do not prove real events or authorize routing. */
const START=Object.freeze([
  'legacy-writes-frozen',
  'final-source-snapshot-signed',
  'production-d1-restore-point-recorded',
  'final-import-and-parity-verified',
  'owner-live-go-recorded',
  'traffic-switched-to-d1'
]);
export const M11_CUTOVER_EVENT_ORDER=Object.freeze({
  activation:Object.freeze([...START,'production-smoke-verified','single-writer-d1-verified']),
  'rollback-to-legacy':Object.freeze([
    ...START,
    'worker-writes-frozen',
    'delta-journal-captured',
    'legacy-replay-reconciled',
    'owner-rollback-go-recorded',
    'traffic-restored-to-legacy',
    'single-writer-legacy-verified'
  ]),
  'hold-d1-readonly':Object.freeze([
    ...START,
    'worker-writes-frozen',
    'delta-journal-captured',
    'd1-retention-reconciled',
    'owner-incident-hold-go-recorded',
    'd1-readonly-incident-mode-verified'
  ])
});
const SHA40=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const RECORD=/^[a-zA-Z0-9][a-zA-Z0-9._/-]{5,127}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const keys=(x,expected)=>object(x)&&Object.keys(x).length===expected.length&&
  expected.every(k=>Object.hasOwn(x,k));
const caution='Structural rehearsal only: independently verify every event and private artifact. This report does not authorize a deployment, traffic switch, source write freeze or database restore.';

export function assessM11CutoverOrder(manifest,options={}) {
  const blockers=new Set();
  const fail=code=>blockers.add(code);
  const result=()=>({
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,
    blockers:[...blockers],
    caution
  });
  if(!object(manifest)){
    fail('M11_SEQUENCE_MANIFEST_REQUIRED');
    return result();
  }
  const {expectedReleaseSha,expectedSourceSha,expectedSourceSnapshotSha256,
    releaseEvidence,deltaEvidence}=options??{};
  if(!keys(manifest,[
    'schemaVersion','releaseSha','sourceSha','sourceSnapshotSha256','path','events'
  ])||manifest.schemaVersion!==1){
    fail('M11_SEQUENCE_SCHEMA_INVALID');
  }
  if(!SHA40.test(expectedReleaseSha??'')||!SHA40.test(expectedSourceSha??'')||
    !SHA256.test(expectedSourceSnapshotSha256??'')||
    manifest.releaseSha!==expectedReleaseSha||manifest.sourceSha!==expectedSourceSha||
    manifest.sourceSnapshotSha256!==expectedSourceSnapshotSha256||
    !SHA40.test(manifest.releaseSha??'')||
    !SHA40.test(manifest.sourceSha??'')||
    !SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_SEQUENCE_PIN_INVALID');
  }
  if(!Object.hasOwn(M11_CUTOVER_EVENT_ORDER,manifest.path)){
    fail('M11_SEQUENCE_PATH_INVALID');
  }else{
    const expected=M11_CUTOVER_EVENT_ORDER[manifest.path];
    if(!Array.isArray(manifest.events)||manifest.events.length!==expected.length){
      fail('M11_SEQUENCE_ORDER_INVALID');
    }else{
      for(let i=0;i<expected.length;i++){
        const e=manifest.events[i];
        if(!keys(e,['seq','event','record','releaseSha'])||
          !Number.isSafeInteger(e.seq)||e.seq!==i+1||
          typeof e.event!=='string'||!RECORD.test(e.record??'')||
          e.releaseSha!==expectedReleaseSha){
          fail('M11_SEQUENCE_EVENT_INVALID');
        }
        if(e?.event!==expected[i]) fail('M11_SEQUENCE_ORDER_INVALID');
      }
    }
  }
  const releaseReport=assessM11Evidence(releaseEvidence,{
    phase:'switch',
    expectedReleaseSha,
    expectedSourceSha
  });
  if(!releaseReport.documentaryComplete||
    releaseEvidence?.sourceSnapshotSha256!==expectedSourceSnapshotSha256){
    fail('M11_SEQUENCE_RELEASE_GATE_BLOCKED');
  }
  if(manifest.path==='rollback-to-legacy'||manifest.path==='hold-d1-readonly'){
    const mode=manifest.path==='rollback-to-legacy'?'resume-legacy':'roll-forward';
    const deltaReport=assessM11WriteDelta(deltaEvidence,{
      expectedReleaseSha,
      expectedSourceSnapshotSha256
    });
    if(deltaEvidence?.mode!==mode||!deltaReport.documentaryComplete){
      fail('M11_SEQUENCE_DELTA_GATE_BLOCKED');
    }
  }
  return result();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [sequenceFile,releaseFile,expectedReleaseSha,expectedSourceSnapshotSha256,deltaFile]=process.argv.slice(2);
  if(!sequenceFile||!releaseFile||!expectedReleaseSha||!expectedSourceSnapshotSha256){
    console.error('Usage: node scripts/check-m11-cutover-order.mjs <PRIVATE_SEQUENCE> <PRIVATE_RELEASE_EVIDENCE> <RELEASE_SHA> <SOURCE_SNAPSHOT_SHA256> [PRIVATE_DELTA_EVIDENCE]');
    process.exitCode=2;
  }else{
    try{
      const source=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8'));
      const sequence=JSON.parse(readFileSync(resolve(sequenceFile),'utf8'));
      const releaseEvidence=JSON.parse(readFileSync(resolve(releaseFile),'utf8'));
      const deltaEvidence=deltaFile?JSON.parse(readFileSync(resolve(deltaFile),'utf8')):undefined;
      const report=assessM11CutoverOrder(sequence,{
        expectedReleaseSha,
        expectedSourceSha:source.source.commit,
        expectedSourceSnapshotSha256,
        releaseEvidence,
        deltaEvidence
      });
      if(!report.documentaryComplete){
        console.error('M11 cutover order BLOCKED: '+report.blockers.join(', '));
        process.exitCode=1;
      }else{
        console.log('M11 cutover order metadata structurally complete. '+report.caution);
      }
    }catch{
      // Never echo operator-supplied evidence, IDs, secret paths or source data.
      console.error('M11 cutover order BLOCKED: invalid or unavailable private evidence');
      process.exitCode=1;
    }
  }
}
