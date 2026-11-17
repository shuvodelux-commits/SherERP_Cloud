/**
 * M10-16 — OFFLINE source→first-import→replay→rejected-retry evidence only.
 *
 * All receipts and group summaries are caller-supplied assertions, NOT proof
 * of actual D1 execution, source authorization, transaction atomicity, or GO.
 * Never access Sheets, D1, networks, private source rows, or posting code.
 */
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const BAD='M10 import replay evidence invalid';
const LIMITATIONS='Supplied source, D1 and retry receipts cannot prove an actual import, rejection rollback, source provenance or release authorization';
const HASH=/^[0-9a-f]{64}$/;
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const TOKEN=/^[A-Za-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const TOP=['inventory','coverage','source','firstImport','replayedImport',
  'rejectedRetryReadback','receipts'];
const CAPTURE=['captureId','capturedAt','sourceCommit','groups'];
const ID_FIELDS=['sheetKey','rowCount','rowDigest','idDigest'];
const POSITION_FIELDS=['sheetKey','rowCount','rowDigest',
  'positionDigest','identityKind'];
const RECEIPT_FIELDS=['attemptId','readbackCaptureId','outcome',
  'recordedAt','isolatedTarget'];
const fail=()=>{throw new Error(BAD);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const validTime=t=>typeof t==='string'&&UTC.test(t)&&
  !Number.isNaN(Date.parse(t))&&new Date(t).toISOString()===t;
const token=t=>typeof t==='string'&&TOKEN.test(t);

/** Require only own, enumerable data descriptors. Never run untrusted getters. */
function data(obj,fields,partial=false){
  if(obj===null||typeof obj!=='object'||Array.isArray(obj)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(obj)))fail();
  const keys=Reflect.ownKeys(obj);
  if((!partial&&keys.length!==fields.length)||
    keys.some(k=>typeof k!=='string'||!fields.includes(k)))fail();
  for(const k of partial?keys:fields){
    const d=Object.getOwnPropertyDescriptor(obj,k);
    if(d?.enumerable!==true||!Object.hasOwn(d,'value'))fail();
  }
  return obj;
}
function readOwn(obj,k){
  if(obj===null||typeof obj!=='object')fail();
  const d=Object.getOwnPropertyDescriptor(obj,k);
  if(d?.enumerable!==true||!Object.hasOwn(d,'value'))fail();
  return d.value;
}
function groupsFromInventory(inventory){
  const tables=readOwn(inventory,'tables');
  if(readOwn(inventory,'formatVersion')!==1||
    !Array.isArray(tables)||tables.length!==49)fail();
  const keys=tables.map(row=>readOwn(row,'sheetKey'));
  if(keys.some(k=>typeof k!=='string'||!GROUP.test(k))||
    new Set(keys).size!==49||!keys.includes('LOGS'))fail();
  return new Set(keys);
}
function parseCoverage(value,keys,add){
  if(value===undefined){
    add('REPLAY_COVERAGE_MISSING');
    return false;
  }
  if(readOwn(value,'formatVersion')!==1||
    readOwn(value,'sourceCommit')!==PIN)fail();
  const rows=readOwn(value,'rows'),summary=readOwn(value,'summary');
  if(!Array.isArray(rows)||rows.length!==49||
    readOwn(summary,'sourceGroups')!==49||
    !count(readOwn(summary,'fullyReconciled'))||
    summary.fullyReconciled>49)fail();
  const seen=new Set();let reconciled=0;
  for(const row of rows){
    const key=readOwn(row,'sheetKey');
    const yes=readOwn(row,'sourceImportReconciled');
    if(typeof key!=='string'||!keys.has(key)||seen.has(key)||
      typeof yes!=='boolean')fail();
    seen.add(key);
    if(yes)reconciled++;
  }
  if(seen.size!==49||reconciled!==summary.fullyReconciled)fail();
  add('REPLAY_COVERAGE_UNRECONCILED',49-reconciled);
  return reconciled===49;
}
function parseCapture(value,stage,keys,add){
  if(value===undefined){
    add('REPLAY_'+stage+'_EVIDENCE_MISSING');
    return null;
  }
  data(value,CAPTURE);
  if(!token(value.captureId)||!validTime(value.capturedAt)||
    value.sourceCommit!==PIN||!Array.isArray(value.groups)||
    value.groups.length>150)fail();
  const map=new Map();
  for(const raw of value.groups){
    const sheetKey=readOwn(raw,'sheetKey');
    if(typeof sheetKey!=='string'||!GROUP.test(sheetKey))fail();
    const positional=sheetKey==='LOGS';
    data(raw,positional?POSITION_FIELDS:ID_FIELDS);
    if(!count(raw.rowCount)||typeof raw.rowDigest!=='string'||
      !HASH.test(raw.rowDigest)||
      (positional?
        raw.identityKind!=='SOURCE_ROW_POSITION_ONLY'||
        typeof raw.positionDigest!=='string'||!HASH.test(raw.positionDigest):
        typeof raw.idDigest!=='string'||!HASH.test(raw.idDigest)))fail();
    if(!keys.has(sheetKey)){
      add('REPLAY_'+stage+'_GROUP_UNEXPECTED');
      continue;
    }
    if(map.has(sheetKey)){
      add('REPLAY_'+stage+'_GROUP_DUPLICATE');
      continue;
    }
    map.set(sheetKey,raw);
  }
  for(const key of keys)if(!map.has(key))add('REPLAY_'+stage+'_GROUP_MISSING');
  return {id:value.captureId,time:value.capturedAt,groups:map};
}
function checkReceipts(value,captures,add){
  if(value===undefined){
    add('REPLAY_RECEIPTS_MISSING');
    return false;
  }
  data(value,['first','replay','rejected']);
  const labels=['first','replay','rejected'];
  const stages=[captures[1],captures[2],captures[3]];
  const outcomes=['COMMITTED','REPLAYED','REJECTED'];
  const receipts=labels.map(k=>data(value[k],RECEIPT_FIELDS));
  for(const item of receipts){
    if(!token(item.attemptId)||!token(item.readbackCaptureId)||
      !validTime(item.recordedAt)||
      !['COMMITTED','REPLAYED','REJECTED'].includes(item.outcome)||
      typeof item.isolatedTarget!=='boolean')fail();
    if(!item.isolatedTarget)add('REPLAY_TARGET_NOT_ISOLATED');
  }
  if(new Set(receipts.map(x=>x.attemptId)).size!==3)
    add('REPLAY_ATTEMPT_NOT_DISTINCT');
  for(let i=0;i<3;i++){
    const attempt=receipts[i],capture=stages[i];
    if(attempt.outcome!==outcomes[i])
      add('REPLAY_RECEIPT_OUTCOME_MISMATCH');
    if(capture&&attempt.readbackCaptureId!==capture.id)
      add('REPLAY_RECEIPT_CAPTURE_MISMATCH');
    const prior=captures[i];
    if((prior&&attempt.recordedAt<=prior.time)||
      (capture&&attempt.recordedAt>capture.time))
      add('REPLAY_RECEIPT_CHRONOLOGY_INVALID');
  }
  return true;
}
function compare(source,target,stage,keys,add){
  if(!source||!target)return;
  for(const key of keys){
    const a=source.groups.get(key),b=target.groups.get(key);
    if(!a||!b)continue;
    if(a.rowCount!==b.rowCount)add('REPLAY_'+stage+'_ROW_COUNT_MISMATCH');
    if(a.rowDigest!==b.rowDigest)add('REPLAY_'+stage+'_ROW_DIGEST_MISMATCH');
    if(key==='LOGS'){
      if(a.positionDigest!==b.positionDigest)
        add('REPLAY_'+stage+'_POSITION_DIGEST_MISMATCH');
    }else if(a.idDigest!==b.idDigest)
      add('REPLAY_'+stage+'_ID_DIGEST_MISMATCH');
  }
}
/** Candidate-only metadata, fixed issue codes and counts; no private IDs. */
export function assessM10ImportReplayEvidence(input={}){
  try{
    const evidence=data(input,TOP,true);
    const keys=groupsFromInventory(readOwn(evidence,'inventory'));
    const issues=new Map();
    const add=(code,n=1)=>{if(n>0)issues.set(code,(issues.get(code)||0)+n)};
    const coverageReconciled=parseCoverage(evidence.coverage,keys,add);
    const captures=[
      parseCapture(evidence.source,'SOURCE',keys,add),
      parseCapture(evidence.firstImport,'FIRST',keys,add),
      parseCapture(evidence.replayedImport,'REPEAT',keys,add),
      parseCapture(evidence.rejectedRetryReadback,'REJECTED',keys,add)
    ];
    if(captures.every(Boolean)){
      if(new Set(captures.map(c=>c.id)).size!==4)
        add('REPLAY_CAPTURE_NOT_DISTINCT');
      if(captures.some((capture,i)=>i>0&&capture.time<=captures[i-1].time))
        add('REPLAY_CAPTURE_NOT_ORDERED');
    }
    checkReceipts(evidence.receipts,captures,add);
    for(let i=1;i<4;i++)
      compare(captures[0],captures[i],
        ['','FIRST','REPEAT','REJECTED'][i],keys,add);
    const structural=[...issues.keys()].some(k=>
      /_GROUP_(MISSING|UNEXPECTED|DUPLICATE)$/.test(k));
    const groupsComparedComplete=captures.every(c=>c&&c.groups.size===49)&&
      !structural;
    const baseBlock=[...issues.keys()].some(k=>
      k==='REPLAY_CAPTURE_NOT_DISTINCT'||
      k==='REPLAY_CAPTURE_NOT_ORDERED'||
      k.startsWith('REPLAY_RECEIPT_')||
      k==='REPLAY_RECEIPTS_MISSING'||
      k==='REPLAY_ATTEMPT_NOT_DISTINCT'||
      k==='REPLAY_TARGET_NOT_ISOLATED');
    const firstAndRepeatMismatch=[...issues.keys()].some(k=>
      k.startsWith('REPLAY_FIRST_')||k.startsWith('REPLAY_REPEAT_'));
    const rejectedMismatch=[...issues.keys()].some(k=>
      k.startsWith('REPLAY_REJECTED_'));
    const candidateIdempotentReplay=groupsComparedComplete&&!baseBlock&&
      !firstAndRepeatMismatch;
    const candidateRejectedRetryRollback=groupsComparedComplete&&!baseBlock&&
      !rejectedMismatch;
    const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,n])=>({code,count:n}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_IMPORT_REPLAY',
      groupsComparedComplete,coverageReconciled,
      candidateIdempotentReplay,candidateRejectedRetryRollback,
      candidateReplayEvidence:coverageReconciled&&candidateIdempotentReplay&&
        candidateRejectedRetryRollback&&sorted.length===0,
      authorizesImport:false,authorizesPosting:false,authorizesRollback:false,
      authorizesCutover:false,productionReady:false,
      issues:sorted,limitations:LIMITATIONS
    };
  }catch{
    // Data, source IDs, Party amounts, capture IDs and hostile exceptions stay private.
    throw new Error(BAD);
  }
}
