import {createFrozenSourceReadback} from './m03-frozen-source-readback.js';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT}
  from './m03-frozen-source-headers.js';

/**
 * M03 Run 2: private, asynchronous Database.gs lookup compatibility over
 * the *already sealed and digest-checked* synthetic source archive.
 *
 * No raw SQL, source field inference, active inventory/ledger authority,
 * deployable source archive, or public RPC is created here.
 * A snapshot is scoped to ONE trusted call and never cached globally.
 * All 49 frozen source groups and 659 headers are source-pinned.
 * Historical Sheets cell values are exact TEXT evidence, not reconstructed
 * GAS Date/number objects or current financial/stock balances.
 */
const INVALID='Invalid or incomplete private M03 source archive';
const reject=()=>{throw new Error(INVALID);};
const isSafeLookupValue=value=>
 value===null || value===undefined ||
 typeof value==='string'||typeof value==='boolean'||
 (typeof value==='number'&&Number.isFinite(value));

function originalGroup(groups,key){
 if(typeof key!=='string'||!Object.hasOwn(FROZEN_SOURCE_COLUMNS,key)||
    !Object.hasOwn(groups,key))reject();
 const group=groups[key],headers=FROZEN_SOURCE_COLUMNS[key];
 if(!group||!Array.isArray(group.rows)||!Array.isArray(group.headers)||
    group.headers.length!==headers.length||
    headers.some((col,i)=>group.headers[i]!==col))reject();
 return {headers,rows:group.rows};
}
function originalColumn(headers,column){
 if(typeof column!=='string'||!headers.includes(column))reject();
}
function textMatchValue(value){
 if(!isSafeLookupValue(value))reject();
 return String(value);
}
function copyRow(headers,item){
 if(!item||!Number.isSafeInteger(item.sheetRow)||item.sheetRow<2||
    !Array.isArray(item.cells)||item.cells.length!==headers.length||
    item.cells.some(cell=>typeof cell!=='string'))reject();
 return Object.fromEntries([
   ...headers.map((col,i)=>[col,item.cells[i]]),
   ['_rowIndex',item.sheetRow]
 ]);
}
function snapshotMethods(groups){
 const getSheetHeaders_=async(key)=>{
  const group=originalGroup(groups,key);
  return [...group.headers];
 };
 const getAllRows_=async(key)=>{
  const group=originalGroup(groups,key);
  return group.rows.map(item=>copyRow(group.headers,item));
 };
 const findRows_=async(key,column,value)=>{
  const group=originalGroup(groups,key);
  originalColumn(group.headers,column);
  const wanted=textMatchValue(value);
  const index=group.headers.indexOf(column);
  return group.rows.filter(item=>item.cells[index]===wanted)
   .map(item=>copyRow(group.headers,item));
 };
 const findFirstRow_=async(key,column,value)=>{
  const found=await findRows_(key,column,value);
  return found[0]??null;
 };
 const findRow_=async(key,column,value)=>{
  const row=await findFirstRow_(key,column,value);
  return row===null?null:{row,rowIndex:row._rowIndex};
 };
 const findRowIndex_=async(key,column,value)=>{
  const result=await findRow_(key,column,value);
  return result===null?-1:result.rowIndex;
 };
 return Object.freeze({
  getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_
 });
}

/**
 * Trusted internal-only composition. The underlying private source readback
 * first verifies ALL 49 seal counts, header lists, SHA-256 row digests and
 * keyset pages; no lazy per-group read can bypass those integrity checks.
 * A new openSnapshot_ call re-reads D1 to avoid persistent stale caches.
 */
export function createSealedSourceLookup(env){
 const archive=createFrozenSourceReadback(env);
 return Object.freeze({
  async openSnapshot_(...args){
   if(args.length!==0)reject();
   try{
    const source=await archive.readAllSourceGroups();
    if(source?.formatVersion!==1||
       source.sourceCommit!==FROZEN_SOURCE_COMMIT||
       !source.groups||typeof source.groups!=='object'||
       Object.keys(source.groups).length!==
         Object.keys(FROZEN_SOURCE_COLUMNS).length)reject();
    return snapshotMethods(source.groups);
   }catch{reject();}
  }
 });
}
