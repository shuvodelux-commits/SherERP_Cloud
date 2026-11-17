/**
 * M10-11: OFFLINE backup-versus-restored readback metadata preflight.
 *
 * This consumes externally supplied data, never captures a backup, reads D1,
 * proves restore custody, calls a remote service or authorizes a restore.
 * Report only fixed diagnostics: never return source rows, capture IDs or
 * digests. The special legacy LOGS group has physical-row provenance only.
 */
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const BAD='M10 restore evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const HASH=/^[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const ID_FIELDS=Object.freeze(['sheetKey','rowCount','rowDigest','idDigest']);
const POSITION_FIELDS=Object.freeze([
  'sheetKey','rowCount','rowDigest','positionDigest','identityKind'
]);
const SNAPSHOT_FIELDS=Object.freeze([
  'captureId','capturedAt','sourceCommit','groups'
]);
const RECEIPT_FIELDS=Object.freeze([
  'attemptId','backupCaptureId','restoredCaptureId','isolatedTarget','completedAt'
]);
const fail=()=>{throw new Error(BAD);};
const count=x=>Number.isSafeInteger(x)&&x>=0;
const timestamp=x=>typeof x==='string'&&UTC.test(x)&&
  !Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;
const token=x=>typeof x==='string'&&TOKEN.test(x);

// No property access before checking own data descriptors: caller-supplied
// accessors or inherited values must not run, including in error handling.
function dataObject(value,fields){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const names=Reflect.ownKeys(value);
  if(names.length!==fields.length||
    names.some(name=>typeof name!=='string'||!fields.includes(name)))fail();
  for(const name of fields){
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  return value;
}
function ownData(value,key){
  if(value===null||typeof value!=='object')fail();
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  return descriptor.value;
}
function inventoryKeys(inventory){
  if(inventory===null||typeof inventory!=='object'||Array.isArray(inventory)||
    ownData(inventory,'formatVersion')!==1)fail();
  const tables=ownData(inventory,'tables');
  if(!Array.isArray(tables)||tables.length!==49)fail();
  const keys=tables.map(item=>ownData(item,'sheetKey'));
  if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
    new Set(keys).size!==49||!keys.includes('LOGS'))fail();
  return new Set(keys);
}
function groupRows(rows,expected,add){
  if(!Array.isArray(rows))fail();
  const found=new Map();
  for(const row of rows){
    const sheetKey=ownData(row,'sheetKey');
    if(typeof sheetKey!=='string'||!GROUP.test(sheetKey))fail();
    const positional=sheetKey==='LOGS';
    dataObject(row,positional?POSITION_FIELDS:ID_FIELDS);
    if(!count(row.rowCount)||typeof row.rowDigest!=='string'||
      !HASH.test(row.rowDigest))fail();
    if(positional){
      if(row.identityKind!=='SOURCE_ROW_POSITION_ONLY'||
        typeof row.positionDigest!=='string'||!HASH.test(row.positionDigest))
        fail();
    }else if(typeof row.idDigest!=='string'||!HASH.test(row.idDigest))fail();
    if(!expected.has(sheetKey)){
      add('RESTORE_GROUP_UNEXPECTED');
      continue;
    }
    if(found.has(sheetKey)){
      add('RESTORE_GROUP_DUPLICATE');
      continue;
    }
    found.set(sheetKey,row);
  }
  for(const key of expected)if(!found.has(key))add('RESTORE_GROUP_MISSING');
  return found;
}
function parseCapture(capture,expected,missingCode,add){
  if(capture===undefined){
    add(missingCode);
    return null;
  }
  dataObject(capture,SNAPSHOT_FIELDS);
  if(!token(capture.captureId)||!timestamp(capture.capturedAt)||
     capture.sourceCommit!==PIN)fail();
  return {
    id:capture.captureId,at:capture.capturedAt,
    rows:groupRows(capture.groups,expected,add)
  };
}
function parseReceipt(receipt,add){
  if(receipt===undefined){
    add('RESTORE_RECEIPT_MISSING');
    return null;
  }
  dataObject(receipt,RECEIPT_FIELDS);
  if(!token(receipt.attemptId)||!token(receipt.backupCaptureId)||
     !token(receipt.restoredCaptureId)||!timestamp(receipt.completedAt)||
     typeof receipt.isolatedTarget!=='boolean')fail();
  if(!receipt.isolatedTarget)add('RESTORE_TARGET_NOT_ISOLATED');
  return receipt;
}

/** Supply only private/offline evidence summaries; NEVER pass source business rows. */
export function assessM10RestoreIntegrity({
  inventory,backup,restored,receipt
}={}){
  try{
    const expected=inventoryKeys(inventory);
    const issues=new Map();
    const add=(code,n=1)=>issues.set(code,(issues.get(code)||0)+n);
    const a=parseCapture(backup,expected,'RESTORE_BACKUP_EVIDENCE_MISSING',add);
    const b=parseCapture(restored,expected,'RESTORE_READBACK_EVIDENCE_MISSING',add);
    const drill=parseReceipt(receipt,add);

    if(a&&b){
      if(a.id===b.id)add('RESTORE_CAPTURE_NOT_DISTINCT');
      if(b.at<=a.at)add('RESTORE_CAPTURE_NOT_ORDERED');
      for(const sheetKey of expected){
        const old=a.rows.get(sheetKey),now=b.rows.get(sheetKey);
        if(!old||!now)continue;
        if(old.rowCount!==now.rowCount)add('RESTORE_ROW_COUNT_MISMATCH');
        if(old.rowDigest!==now.rowDigest)add('RESTORE_ROW_DIGEST_MISMATCH');
        if(sheetKey==='LOGS'){
          if(old.positionDigest!==now.positionDigest)
            add('RESTORE_POSITION_PROVENANCE_MISMATCH');
        }else if(old.idDigest!==now.idDigest){
          add('RESTORE_ORIGINAL_ID_MISMATCH');
        }
      }
    }

    if(drill){
      if((a&&drill.backupCaptureId!==a.id)||
        (b&&drill.restoredCaptureId!==b.id))
        add('RESTORE_RECEIPT_CAPTURE_MISMATCH');
      if((a&&drill.completedAt<=a.at)||
        (b&&drill.completedAt>b.at))
        add('RESTORE_RECEIPT_CHRONOLOGY_INVALID');
    }
    const groupsComparedComplete=Boolean(a&&b&&
      a.rows.size===expected.size&&b.rows.size===expected.size);
    const sorted=[...issues].sort(([nameA],[nameB])=>
      nameA<nameB?-1:nameA>nameB?1:0)
      .map(([code,n])=>({code,count:n}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_RESTORE_PREFLIGHT',
      groupsComparedComplete,
      candidateRestoreParity:groupsComparedComplete&&Boolean(drill)&&sorted.length===0,
      authorizesRestore:false,authorizesImport:false,productionReady:false,
      issues:sorted,
      limitations:'Supplied snapshot hashes and receipt do not prove an actual D1 restore, verified backup custody, or release authorization'
    };
  }catch{
    // Do not propagate secrets embedded in thrown accessor/Proxy errors.
    throw new Error(BAD);
  }
}
