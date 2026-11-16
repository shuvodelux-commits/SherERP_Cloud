#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessM11CutoverOrder} from './check-m11-cutover-order.mjs';

/**
 * M11-09: offline structural verification of operator-supplied post-cutover
 * business smoke references. Does not perform a smoke, authenticate evidence,
 * query D1 or source GAS, authorize a deployment, or alter either writer.
 */
export const M11_SMOKE_READS=Object.freeze([
  'health-deployed','staff-login-logout','rbac-denial',
  'products-stock-fifo','invoice-print','daybook-reports','settings-team'
]);
export const M11_SMOKE_WRITES=Object.freeze([
  'pos-sale','split-payment','purchase','sales-return',
  'purchase-return','cash-session','cash-bank'
]);
const SOURCE_SHA='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const SHA40=/^[a-f0-9]{40}$/i,SHA256=/^[a-f0-9]{64}$/i;
const REF=/^[A-Za-z0-9][A-Za-z0-9._/-]{5,127}$/;
const OPERATION=/^[A-Za-z0-9][A-Za-z0-9_:/-]{11,99}$/;
const WORKER=/^[a-z0-9][a-z0-9-]{3,63}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>object(x)&&Reflect.ownKeys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k))&&
  Reflect.ownKeys(x).every(k=>typeof k==='string');
const ref=x=>typeof x==='string'&&REF.test(x);
const zero=x=>Number.isSafeInteger(x)&&x===0;
const verified=(x,release)=>exact(x,['status','record','releaseSha'])&&
  x.status==='verified'&&ref(x.record)&&x.releaseSha===release;
const CAUTION='Operator-supplied documentary references only. Independently authenticate every private receipt, Worker/D1 operation, gross Party/stock/cash-bank parity, source freeze and staff permissions. This check never authorizes production deployment, traffic switching, database restore or resuming writes.';

/** Strict metadata-only preflight; a successful result is NOT a production GO. */
export function assessM11ProductionSmoke(manifest,options={}) {
  const blockers=new Set();
  const fail=code=>blockers.add(code);
  const result=()=>({
    documentaryComplete:blockers.size===0,
    authorizesTrafficSwitch:false,authorizesWriteResumption:false,
    blockers:[...blockers],caution:CAUTION
  });
  if(!object(manifest)){
    fail('M11_SMOKE_INPUT_REQUIRED');
    return result();
  }
  if(!exact(manifest,[
    'schemaVersion','releaseSha','sourceSha','sourceSnapshotSha256',
    'deployment','reads','writes','postSmoke','writerBoundary'
  ])||manifest.schemaVersion!==1){
    fail('M11_SMOKE_SCHEMA_INVALID');
  }
  const release=options?.expectedReleaseSha;
  const snapshot=options?.expectedSourceSnapshotSha256;
  const source=options?.expectedSourceSha;
  if(!SHA40.test(release??'')||!SHA256.test(snapshot??'')||
    source!==SOURCE_SHA||manifest.releaseSha!==release||
    manifest.sourceSha!==source||manifest.sourceSnapshotSha256!==snapshot||
    !SHA40.test(manifest.releaseSha??'')||
    !SHA40.test(manifest.sourceSha??'')||
    !SHA256.test(manifest.sourceSnapshotSha256??'')){
    fail('M11_SMOKE_PIN_MISMATCH');
  }

  // Structural activation event order and reviewed M10/switch references are
  // necessary documentary prerequisites, never authority to switch live traffic.
  if(options?.cutoverEvidence?.path!=='activation'){
    fail('M11_SMOKE_ACTIVATION_REQUIRED');
  }
  try{
    const order=assessM11CutoverOrder(options?.cutoverEvidence,{
      expectedReleaseSha:release,expectedSourceSha:source,
      expectedSourceSnapshotSha256:snapshot,
      releaseEvidence:options?.releaseEvidence
    });
    if(!order.documentaryComplete)fail('M11_SMOKE_CUTOVER_UNVERIFIED');
  }catch{
    fail('M11_SMOKE_CUTOVER_UNVERIFIED');
  }

  const d=manifest.deployment;
  if(!exact(d,[
    'status','record','releaseSha','deployedSha','environment','workerName'
  ])||d.status!=='verified'||!ref(d.record)||d.releaseSha!==release||
    d.deployedSha!==release||d.environment!=='private-production'||
    !WORKER.test(d.workerName??'')||
    /preview|staging|test/.test(d.workerName??'')){
    fail('M11_SMOKE_DEPLOYMENT_INVALID');
  }

  const usedRecords=new Set();
  const acceptRecord=value=>{
    if(!ref(value)||usedRecords.has(value))return false;
    usedRecords.add(value);
    return true;
  };
  if(!exact(manifest.reads,M11_SMOKE_READS)){
    fail('M11_SMOKE_READS_INVALID');
  }else{
    for(const key of M11_SMOKE_READS){
      const item=manifest.reads[key];
      if(!verified(item,release)||!acceptRecord(item.record)){
        fail('M11_SMOKE_READS_INVALID');
      }
    }
  }
  if(!exact(manifest.writes,M11_SMOKE_WRITES)){
    fail('M11_SMOKE_WRITES_INVALID');
  }else{
    const operations=new Set();
    for(const key of M11_SMOKE_WRITES){
      const item=manifest.writes[key];
      if(!exact(item,[
        'status','operationId','receiptRecord','verificationRecord',
        'unexplainedDifferences','releaseSha'
      ])||item.status!=='verified'||item.releaseSha!==release||
        typeof item.operationId!=='string'||!OPERATION.test(item.operationId)||
        operations.has(item.operationId)||!zero(item.unexplainedDifferences)||
        !acceptRecord(item.receiptRecord)||!acceptRecord(item.verificationRecord)){
        fail('M11_SMOKE_WRITES_INVALID');
      }
      if(typeof item?.operationId==='string')operations.add(item.operationId);
    }
  }
  const p=manifest.postSmoke;
  if(!exact(p,[
    'status','record','releaseSha','unreconciledAcknowledgedOperations',
    'grossPartyDiscrepancies','inventoryDiscrepancies','cashBankDiscrepancies'
  ])||p.status!=='verified'||p.releaseSha!==release||
    !acceptRecord(p.record)||
    !zero(p.unreconciledAcknowledgedOperations)||
    !zero(p.grossPartyDiscrepancies)||!zero(p.inventoryDiscrepancies)||
    !zero(p.cashBankDiscrepancies)){
    fail('M11_SMOKE_RECONCILIATION_INVALID');
  }
  const w=manifest.writerBoundary;
  if(!exact(w,[
    'status','record','releaseSha','authority','activeWriters','legacyWritesAfterFreeze'
  ])||w.status!=='verified'||w.releaseSha!==release||!acceptRecord(w.record)||
    w.authority!=='d1-only'||w.activeWriters!==1||
    !zero(w.legacyWritesAfterFreeze)){
    fail('M11_SMOKE_WRITER_BOUNDARY_INVALID');
  }
  return result();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [smokeFile,cutoverFile,releaseFile,releaseSha,snapshotSha]=process.argv.slice(2);
  if(!smokeFile||!cutoverFile||!releaseFile||!releaseSha||!snapshotSha||
    process.argv.length!==7){
    console.error('Usage: node scripts/check-m11-production-smoke.mjs <PRIVATE_SMOKE_JSON> <PRIVATE_CUTOVER_JSON> <PRIVATE_RELEASE_JSON> <RELEASE_SHA> <FINAL_SOURCE_SNAPSHOT_SHA256>');
    process.exitCode=2;
  }else{
    try{
      const parse=file=>JSON.parse(readFileSync(resolve(file),'utf8'));
      const report=assessM11ProductionSmoke(parse(smokeFile),{
        expectedReleaseSha:releaseSha,expectedSourceSha:SOURCE_SHA,
        expectedSourceSnapshotSha256:snapshotSha,
        cutoverEvidence:parse(cutoverFile),releaseEvidence:parse(releaseFile)
      });
      console.log('M11 post-cutover smoke: '+(report.documentaryComplete?
        'DOCUMENTARY_COMPLETE':'BLOCKED'));
      if(report.blockers.length)console.error('Evidence blockers: '+report.blockers.join(', '));
      console.log(report.caution);
      if(!report.documentaryComplete)process.exitCode=1;
    }catch{
      // Never print evidence contents, paths, IDs, credentials or raw errors.
      console.error('M11 post-cutover smoke: BLOCKED (private input missing or malformed)');
      process.exitCode=1;
    }
  }
}
