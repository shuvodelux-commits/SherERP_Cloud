import {assessM10SourceFreeze} from './m10-source-freeze.js';

/**
 * M10-01: a REDACTED, OFFLINE comparison of *supplied* rehearsal evidence.
 * This is NOT a source exporter, D1 reader or approval to import/cut over.
 * Canonical row/ID digests must be independently specified and verified by
 * future source and D1 adapters before using this with private snapshots.
 */
const SOURCE_COMMIT='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const DIGEST=/^[0-9a-f]{64}$/;
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const INVALID='M10 rehearsal evidence invalid';

const fail=()=>{throw new Error(INVALID)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;

function checkedInventory(inventory,coverage) {
  if(!object(inventory)||inventory.formatVersion!==1||
    !Array.isArray(inventory.tables)||inventory.tables.length!==49)fail();
  const keys=inventory.tables.map(r=>r?.sheetKey);
  if(keys.some(k=>typeof k!=='string'||!GROUP.test(k))||
    new Set(keys).size!==49)fail();
  if(!object(coverage)||coverage.formatVersion!==1||
    coverage.sourceCommit!==SOURCE_COMMIT||
    !object(coverage.summary)||coverage.summary.sourceGroups!==49||
    !count(coverage.summary.fullyReconciled)||
    coverage.summary.fullyReconciled>49||
    !Array.isArray(coverage.rows)||coverage.rows.length!==49)fail();
  const observed=new Set();
  let reconciled=0;
  for(const row of coverage.rows){
    if(!object(row)||typeof row.sheetKey!=='string'||
      !keys.includes(row.sheetKey)||observed.has(row.sheetKey)||
      typeof row.sourceImportReconciled!=='boolean')fail();
    observed.add(row.sheetKey);
    if(row.sourceImportReconciled)reconciled++;
  }
  if(reconciled!==coverage.summary.fullyReconciled)fail();
  return {keys,reconciled};
}

function exactSummary(row,fields){
  if(!object(row)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(row)))return false;
  const keys=Reflect.ownKeys(row);
  return keys.length===fields.length&&
    keys.every(k=>typeof k==='string'&&fields.includes(k))&&
    fields.every(k=>{
      const d=Object.getOwnPropertyDescriptor(row,k);
      return d?.enumerable===true&&Object.hasOwn(d,'value');
    });
}

function checkedSummary(rows){
  if(!Array.isArray(rows))fail();
  const index=new Map();
  let duplicates=0;
  for(const row of rows){
    // Read sheetKey only from an own *data* descriptor. An id-less LOGS
    // physical position must never be disguised as a source business ID.
    const descriptor=object(row)?
      Object.getOwnPropertyDescriptor(row,'sheetKey'):null;
    const key=descriptor&&Object.hasOwn(descriptor,'value')?
      descriptor.value:null;
    if(typeof key!=='string'||!GROUP.test(key))fail();
    const positional=key==='LOGS';
    const fields=positional?
      ['sheetKey','rowCount','rowDigest','positionDigest','identityKind']:
      ['sheetKey','rowCount','rowDigest','idDigest'];
    if(!exactSummary(row,fields)||
      !count(row.rowCount)||typeof row.rowDigest!=='string'||
      !DIGEST.test(row.rowDigest)||
      (positional?row.identityKind!=='SOURCE_ROW_POSITION_ONLY'||
        typeof row.positionDigest!=='string'||!DIGEST.test(row.positionDigest):
        typeof row.idDigest!=='string'||!DIGEST.test(row.idDigest)))fail();
    if(index.has(key))duplicates++;
    else index.set(key,row);
  }
  return {index,duplicates};
}

function grossMatched(gross){
  if(!object(gross)||!object(gross.counts)||!Array.isArray(gross.issues))return false;
  const c=gross.counts;
  if(![c.expectedCurrent,c.observedCurrent,c.expectedOpening,c.observedOpening].every(count))
    return false;
  return gross.sourcePlanValid===true&&gross.readbackChecked===true&&
    gross.currentMatch===true&&gross.openingMatch===true&&
    gross.offlineCheckpointParity===true&&gross.issues.length===0&&
    c.expectedCurrent===c.observedCurrent&&
    c.expectedOpening===c.observedOpening;
}

/**
 * Never return source rows, hashes, original IDs, Party IDs, amounts or error
 * strings; fixed diagnostic codes and counts are all that may leave memory.
 */
export function assessM10RehearsalEvidence({
  inventory,coverage,sourceSummary,d1Summary,grossParity,pendingIdentityReviews,sourceFreeze
}={}){
  const {keys,reconciled}=checkedInventory(inventory,coverage);
  const issues=new Map();
  const add=(code,n=1)=>{if(n>0)issues.set(code,(issues.get(code)||0)+n)};
  if(reconciled!==49)add('MIGRATION_COVERAGE_INCOMPLETE',49-reconciled);

  if(pendingIdentityReviews===undefined)add('IDENTITY_REVIEW_EVIDENCE_MISSING');
  else {
    if(!count(pendingIdentityReviews))fail();
    add('IDENTITY_REVIEW_PENDING',pendingIdentityReviews);
  }

  const partyPass=grossMatched(grossParity);
  if(!partyPass)add('GROSS_PARTY_PARITY_UNVERIFIED');

  if(sourceSummary===undefined)add('SOURCE_SNAPSHOT_MISSING');
  if(d1Summary===undefined)add('D1_READBACK_MISSING');

  // A single apparent source/D1 match is not stable-source evidence.
  // Two separately captured source summaries plus the final compared source
  // must agree before even offline candidate parity can be considered.
  let freeze;
  try{
    freeze=assessM10SourceFreeze({
      inventory,
      firstPass:sourceFreeze?.firstPass,
      secondPass:sourceFreeze?.secondPass,
      finalSourceSummary:sourceSummary
    });
  }catch{
    fail(); // Never reveal a source row or private snapshot metadata.
  }
  for(const {code,count} of freeze.issues)add(code,count);

  let complete=false,matched=false;
  if(sourceSummary!==undefined&&d1Summary!==undefined){
    const source=checkedSummary(sourceSummary);
    const d1=checkedSummary(d1Summary);
    const expected=new Set(keys);
    add('GROUP_DUPLICATE_SOURCE',source.duplicates);
    add('GROUP_DUPLICATE_D1',d1.duplicates);
    const sourceExtras=[...source.index.keys()].filter(k=>!expected.has(k));
    const d1Extras=[...d1.index.keys()].filter(k=>!expected.has(k));
    add('GROUP_UNEXPECTED_SOURCE',sourceExtras.length);
    add('GROUP_UNEXPECTED_D1',d1Extras.length);
    for(const sheetKey of keys){
      const a=source.index.get(sheetKey),b=d1.index.get(sheetKey);
      if(!a)add('GROUP_MISSING_SOURCE');
      if(!b)add('GROUP_MISSING_D1');
      if(!a||!b)continue;
      if(a.rowCount!==b.rowCount)add('GROUP_ROW_COUNT_MISMATCH');
      if(a.rowDigest!==b.rowDigest)add('GROUP_ROW_DIGEST_MISMATCH');
      if(sheetKey==='LOGS'){
        if(a.positionDigest!==b.positionDigest)
          add('GROUP_POSITION_PROVENANCE_MISMATCH');
      }else if(a.idDigest!==b.idDigest)add('GROUP_ID_DIGEST_MISMATCH');
    }
    complete=source.duplicates===0&&d1.duplicates===0&&
      sourceExtras.length===0&&d1Extras.length===0&&
      keys.every(k=>source.index.has(k)&&d1.index.has(k));
    matched=complete&&![...issues.keys()].some(k=>k.startsWith('GROUP_'));
  }
  const candidateDataParity=matched&&freeze.stable&&reconciled===49&&partyPass&&
    pendingIdentityReviews===0;
  return {
    formatVersion:1,phase:'M10_OFFLINE_PREFLIGHT',
    groupComparisonsComplete:complete,groupsMatched:matched,
    grossPartyParityMatched:partyPass,candidateDataParity,
    authorizesImport:false,productionReady:false,
    issues:[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,n])=>({code,count:n})),
    limitations:'Supplied hashes and gross reports are not independent source/D1 proof; this is not import, production or cutover approval'
  };
}
