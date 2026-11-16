#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * Documentary, offline-only M11 post-cutover write-delta coverage.
 * Caller-supplied references/digests are not independently authenticated.
 * Never authorize a production route change or restore from this report.
 */
const SHA40=/^[a-f0-9]{40}$/i;
const SHA256=/^[a-f0-9]{64}$/i;
const REFERENCE=/^[a-zA-Z0-9][a-zA-Z0-9._/-]{5,127}$/;
const OPERATION_ID=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,79}$/;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exactKeys=(value,keys)=>isObject(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const count=value=>Number.isSafeInteger(value)&&value>=0;
const validReference=value=>typeof value==='string'&&REFERENCE.test(value);
const validId=value=>typeof value==='string'&&OPERATION_ID.test(value);
const digest=value=>typeof value==='string'&&SHA256.test(value);
const approvedRecord=(value,sha)=>exactKeys(value,['status','record','releaseSha'])&&
  value.status==='verified'&&validReference(value.record)&&value.releaseSha===sha;
const checkpoint=(value,sha)=>exactKeys(value,['count','record','releaseSha'])&&
  count(value.count)&&validReference(value.record)&&value.releaseSha===sha;
const CAUTION='Metadata-only check. Independently verify source and D1 journals, write freezes, each replay and account/stock reconciliation. This report does not authorize traffic switching, restoring backups or resuming writes.';

export function assessM11WriteDelta(manifest,options={}) {
  const blockers=new Set();
  const fail=code=>blockers.add(code);
  const summarize=()=>({
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,
    blockers:[...blockers],
    caution:CAUTION
  });
  const target=options?.expectedReleaseSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  if(!isObject(manifest)){
    fail('M11_DELTA_MANIFEST_REQUIRED');
    return summarize();
  }
  if(!exactKeys(manifest,[
    'schemaVersion','releaseSha','sourceSnapshotSha256','mode','freeze',
    'checkpoints','writes','acknowledgments','dispositions'
  ])) fail('M11_DELTA_UNKNOWN_FIELD');
  if(manifest.schemaVersion!==1) fail('M11_DELTA_SCHEMA_INVALID');
  if(!SHA40.test(target??'')||!digest(snapshot)||
     manifest.releaseSha!==target||manifest.sourceSnapshotSha256!==snapshot||
     !SHA40.test(manifest.releaseSha??'')||!digest(manifest.sourceSnapshotSha256)){
    fail('M11_DELTA_PIN_MISMATCH');
  }
  if(!['resume-legacy','roll-forward'].includes(manifest.mode)){
    fail('M11_DELTA_MODE_INVALID');
  }
  if(!exactKeys(manifest.freeze,['legacy','d1'])||
     !approvedRecord(manifest.freeze?.legacy,target)||
     !approvedRecord(manifest.freeze?.d1,target)){
    fail('M11_DELTA_FREEZE_INVALID');
  }
  const checkpoints=manifest.checkpoints;
  if(!exactKeys(checkpoints,['committed','acknowledged'])||
     !checkpoint(checkpoints?.committed,target)||
     !checkpoint(checkpoints?.acknowledged,target)){
    fail('M11_DELTA_CHECKPOINT_INVALID');
  }

  const writes=new Map();
  if(!Array.isArray(manifest.writes)){
    fail('M11_DELTA_WRITE_INVALID');
  }else{
    for(const row of manifest.writes){
      if(!exactKeys(row,['operationId','canonicalDigest'])||
         !validId(row.operationId)||!digest(row.canonicalDigest)||
         writes.has(row.operationId)){
        fail('M11_DELTA_WRITE_INVALID');
        continue;
      }
      writes.set(row.operationId,row.canonicalDigest.toLowerCase());
    }
  }
  if(checkpoint(checkpoints?.committed,target)&&
     (!Array.isArray(manifest.writes)||manifest.writes.length!==checkpoints.committed.count)){
    fail('M11_DELTA_COUNT_MISMATCH');
  }

  const ackSet=new Set();
  if(!Array.isArray(manifest.acknowledgments)){
    fail('M11_DELTA_ACK_MISMATCH');
  }else{
    for(const id of manifest.acknowledgments){
      if(!validId(id)||ackSet.has(id)||!writes.has(id)){
        fail('M11_DELTA_ACK_MISMATCH');
      }else{
        ackSet.add(id);
      }
    }
  }
  if(checkpoint(checkpoints?.acknowledged,target)&&
     (!Array.isArray(manifest.acknowledgments)||
      manifest.acknowledgments.length!==checkpoints.acknowledged.count)){
    fail('M11_DELTA_ACK_MISMATCH');
  }

  const dispositions=new Set();
  if(!Array.isArray(manifest.dispositions)){
    fail('M11_DELTA_DISPOSITION_MISMATCH');
  }else{
    for(const item of manifest.dispositions){
      if(!exactKeys(item,['operationId','action','canonicalDigest','record'])||
         !validId(item.operationId)||dispositions.has(item.operationId)||
         !writes.has(item.operationId)||!digest(item.canonicalDigest)||
         writes.get(item.operationId)!==item.canonicalDigest?.toLowerCase()||
         !validReference(item.record)||
         !['replayed-to-legacy','retained-on-d1'].includes(item.action)){
        fail('M11_DELTA_DISPOSITION_MISMATCH');
        continue;
      }
      dispositions.add(item.operationId);
      if((manifest.mode==='resume-legacy'&&item.action!=='replayed-to-legacy')||
         (manifest.mode==='roll-forward'&&item.action!=='retained-on-d1')){
        fail('M11_DELTA_MODE_MISMATCH');
      }
    }
  }
  if(dispositions.size!==writes.size||
     !Array.from(writes.keys()).every(id=>dispositions.has(id))||
     (Array.isArray(manifest.dispositions)&&manifest.dispositions.length!==writes.size)){
    fail('M11_DELTA_DISPOSITION_MISMATCH');
  }
  return summarize();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file,releaseSha,sourceSnapshotSha256]=process.argv.slice(2);
  if(!file||!releaseSha||!sourceSnapshotSha256){
    console.error('Usage: node scripts/check-m11-write-delta.mjs <PRIVATE_METADATA_FILE> <TARGET_RELEASE_SHA> <FINAL_SOURCE_SNAPSHOT_SHA256>');
    process.exitCode=2;
  }else{
    try{
      const input=JSON.parse(readFileSync(resolve(file),'utf8'));
      const report=assessM11WriteDelta(input,{
        expectedReleaseSha:releaseSha,
        expectedSourceSnapshotSha256:sourceSnapshotSha256
      });
      if(!report.documentaryComplete){
        // Print only fixed error codes, never operation IDs or evidence contents.
        console.error('M11 post-cutover delta BLOCKED: '+report.blockers.join(', '));
        process.exitCode=1;
      }else{
        console.log('M11 delta metadata structurally complete. '+report.caution);
      }
    }catch{
      console.error('M11 post-cutover delta BLOCKED: invalid or unavailable private input');
      process.exitCode=1;
    }
  }
}
