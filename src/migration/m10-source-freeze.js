/**
 * M10-03 — compare externally provided, distinct source snapshot summaries.
 * Does NOT capture Sheets, read D1, enforce a live GAS freeze or approve import.
 * Fixed diagnostic counts only: never return source IDs, amounts, hash bytes or
 * snapshot provenance identifiers.
 */
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const BAD='M10 source freeze evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const HASH=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const fail=()=>{throw new Error(BAD);};
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const timestamp=x=>typeof x==='string'&&UTC.test(x)&&
  !Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;

function parseGroups(rows,expected,add){
  if(!Array.isArray(rows))fail();
  const map=new Map();
  for(const row of rows){
    if(!exact(row,['sheetKey','rowCount','rowDigest','idDigest'])||
      typeof row.sheetKey!=='string'||!GROUP.test(row.sheetKey)||
      !nonnegative(row.rowCount)||typeof row.rowDigest!=='string'||!HASH.test(row.rowDigest)||
      typeof row.idDigest!=='string'||!HASH.test(row.idDigest))fail();
    if(!expected.has(row.sheetKey)){add('SOURCE_FREEZE_UNREVIEWED_GROUP');continue;}
    if(map.has(row.sheetKey)){add('SOURCE_FREEZE_DUPLICATE_GROUP');continue;}
    map.set(row.sheetKey,row);
  }
  for(const key of expected)if(!map.has(key))add('SOURCE_FREEZE_INCOMPLETE_GROUPS');
  return map;
}
function parsePass(snapshot,expected,add){
  if(!exact(snapshot,['snapshotId','capturedAt','sourceCommit','groups'])||
     typeof snapshot.snapshotId!=='string'||!ID.test(snapshot.snapshotId)||
     !timestamp(snapshot.capturedAt)||snapshot.sourceCommit!==PIN)fail();
  return {id:snapshot.snapshotId,at:snapshot.capturedAt,
    groups:parseGroups(snapshot.groups,expected,add)};
}

/**
 * @returns {{formatVersion:1,comparisonsComplete:boolean,stable:boolean,
 *  issues:Array<{code:string,count:number}>}}
 */
export function assessM10SourceFreeze({
  inventory,firstPass,secondPass,finalSourceSummary
}={}){
  if(!object(inventory)||inventory.formatVersion!==1||
    !Array.isArray(inventory.tables)||inventory.tables.length!==49)fail();
  const keys=inventory.tables.map(x=>x?.sheetKey);
  if(keys.some(k=>typeof k!=='string'||!GROUP.test(k))||
    new Set(keys).size!==49)fail();
  const expected=new Set(keys), issues=new Map();
  const add=(code,count=1)=>{if(count>0)issues.set(code,(issues.get(code)||0)+count);};
  if(firstPass===undefined||secondPass===undefined)
    add('SOURCE_FREEZE_EVIDENCE_MISSING');
  if(finalSourceSummary===undefined)
    add('SOURCE_FREEZE_FINAL_SOURCE_MISSING');

  const first=firstPass===undefined?null:parsePass(firstPass,expected,add);
  const second=secondPass===undefined?null:parsePass(secondPass,expected,add);
  const final=finalSourceSummary===undefined?null:parseGroups(finalSourceSummary,expected,add);

  if(first&&second){
    if(first.id===second.id)add('SOURCE_FREEZE_CAPTURE_NOT_DISTINCT');
    if(second.at<=first.at)add('SOURCE_FREEZE_CAPTURE_NOT_ORDERED');
    for(const key of expected){
      const a=first.groups.get(key),b=second.groups.get(key);
      if(a&&b){
        if(a.rowCount!==b.rowCount)add('SOURCE_FREEZE_ROW_COUNT_CHANGED');
        if(a.rowDigest!==b.rowDigest)add('SOURCE_FREEZE_ROW_DIGEST_CHANGED');
        if(a.idDigest!==b.idDigest)add('SOURCE_FREEZE_ID_DIGEST_CHANGED');
      }
    }
  }
  if(second&&final)for(const key of expected){
    const b=second.groups.get(key),c=final.get(key);
    if(b&&c&&(b.rowCount!==c.rowCount||b.rowDigest!==c.rowDigest||
      b.idDigest!==c.idDigest))add('SOURCE_FREEZE_FINAL_SOURCE_MISMATCH');
  }
  const full=m=>m!==null&&m.size===49;
  const comparisonsComplete=full(first?.groups??null)&&full(second?.groups??null)&&full(final);
  const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([code,count])=>({code,count}));
  return {formatVersion:1,comparisonsComplete,
    stable:comparisonsComplete&&sorted.length===0,issues:sorted};
}
