#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Offline documentary preflight only. Does not verify evidence authenticity,
 * grant launch permission, contact Cloudflare or mutate any source/target data.
 */
const prepare = Object.freeze([
  'm10-owner-signoff',
  'full-gross-account-stock-and-report-parity',
  'security-auth-and-performance-review',
  'party-identity-reviews-resolved',
  'restore-and-new-write-replay-drill',
  'freeze-window-and-source-write-policy',
  'owner-cutover-and-rollback-plan',
  'monitoring-and-incident-rota'
]);
const switching = Object.freeze([
  ...prepare,
  'source-write-frozen',
  'last-source-snapshot-privately-backed-up',
  'target-d1-restore-point-recorded',
  'final-import-gross-reconciliation',
  'owner-switch-go'
]);
export const M11_PHASE_CHECKS = Object.freeze({
  prepare,
  switch:switching,
  handover:Object.freeze([
    ...switching,
    'postlaunch-smoke-and-handover',
    'postlaunch-d1-write-and-account-reconciliation',
    'owner-handover-acceptance'
  ])
});

const SHA40=/^[0-9a-f]{40}$/i;
const SHA256=/^[0-9a-f]{64}$/i;
const RECORD=/^[A-Za-z0-9][A-Za-z0-9._/-]{5,127}$/;
const isRecord=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const allChecks=new Set(M11_PHASE_CHECKS.handover);
const caution='Documentary references only. Verify each record independently; passing this check never authorizes or performs a production launch.';

export function assessM11Evidence(manifest, {phase='prepare',expectedReleaseSha,expectedSourceSha}={}) {
  if (!Object.hasOwn(M11_PHASE_CHECKS,phase)) throw new Error('Unsupported M11 phase');
  const blockers=[];
  if (!isRecord(manifest)) {
    return {phase,documentaryComplete:false,blockers:['manifest missing or malformed'],caution};
  }
  for(const key of Object.keys(manifest)){
    if(!['schemaVersion','releaseSha','sourceSha','sourceSnapshotSha256','checks'].includes(key)){
      blockers.push('unknown manifest field: '+key);
    }
  }
  if(manifest.schemaVersion!==1) blockers.push('schemaVersion must be 1');
  if(!SHA40.test(expectedReleaseSha??'')) blockers.push('expectedReleaseSha must be a pinned 40-character commit');
  if(!SHA40.test(expectedSourceSha??'')) blockers.push('expectedSourceSha must be a pinned 40-character commit');
  if(!SHA40.test(manifest.releaseSha??'') || manifest.releaseSha!==expectedReleaseSha){
    blockers.push('releaseSha does not match the reviewed target commit');
  }
  if(!SHA40.test(manifest.sourceSha??'') || manifest.sourceSha!==expectedSourceSha){
    blockers.push('sourceSha does not match the frozen source manifest');
  }
  if(phase!=='prepare' || manifest.sourceSnapshotSha256!==undefined){
    if(!SHA256.test(manifest.sourceSnapshotSha256??'')){
      blockers.push('sourceSnapshotSha256 is required and must be a SHA-256 hex digest');
    }
  }
  if(!isRecord(manifest.checks)){
    blockers.push('checks missing or malformed');
  }else{
    for(const id of Object.keys(manifest.checks)){
      if(!allChecks.has(id)) blockers.push('unknown check: '+id);
    }
    for(const id of M11_PHASE_CHECKS[phase]){
      const item=manifest.checks[id];
      if(!isRecord(item)){
        blockers.push(id+': evidence missing');
        continue;
      }
      const unknown=Object.keys(item).filter(k=>!['status','record','releaseSha'].includes(k));
      if(unknown.length) blockers.push(id+': unexpected evidence fields');
      if(item.status!=='verified' || !RECORD.test(item.record??'') ||
        item.releaseSha!==expectedReleaseSha){
        blockers.push(id+': requires verified record pinned to release SHA');
      }
    }
  }
  return {phase,documentaryComplete:blockers.length===0,blockers,caution};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [path,expectedReleaseSha,phase='prepare']=process.argv.slice(2);
  if(!path || !expectedReleaseSha){
    console.error('Usage: node scripts/check-m11-release-evidence.mjs <PRIVATE_MANIFEST_PATH> <TARGET_COMMIT_SHA> [prepare|switch|handover]');
    process.exitCode=2;
  }else{
    try{
      const source=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8'));
      const manifest=JSON.parse(readFileSync(resolve(path),'utf8'));
      const result=assessM11Evidence(manifest,{phase,expectedReleaseSha,expectedSourceSha:source.source.commit});
      if(!result.documentaryComplete){
        console.error('M11 documentary gate BLOCKED: '+result.blockers.join('; '));
        process.exitCode=1;
      }else{
        console.log('M11 '+phase+' references structurally complete. '+result.caution);
      }
    }catch(error){
      // Never print the submitted manifest, snapshot contents or credentials.
      console.error('M11 documentary gate BLOCKED: invalid/unavailable input ('+error.name+')');
      process.exitCode=1;
    }
  }
}
