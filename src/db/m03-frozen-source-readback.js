/**
 * M03 private source-shaped D1 readback PROOF, not public or production D1.
 * The two m03_private_source_* archive tables are synthetic, not deployed.
 * Preserves all 49 frozen Config.gs source groups and all 659 original headers.
 * Values may contain credentials. Never log or return via Worker/RPC.
 */
import {requireD1Binding} from './d1-binding.js';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT} from './m03-frozen-source-headers.js';

const GROUP_NAMES=Object.freeze(Object.keys(FROZEN_SOURCE_COLUMNS));
const GROUP_LIMIT=GROUP_NAMES.length+1;
const PAGE_ROWS=256;
const MAX_GROUP_ROWS=250000;
const MAX_TOTAL_ROWS=250000;
const MAX_SOURCE_BYTES=8*1024*1024;
const MAX_DURATION_MS=20000;
// Original physical row is a keyset cursor, not a generated database ID.
// Every identifier is fixed SQL, and every user/source value is bound.
const READ_SEALS='SELECT source_group,source_commit,headers_json,expected_rows,source_digest,status '+
 'FROM m03_private_source_seals WHERE source_commit = ? ORDER BY source_group ASC LIMIT ?';
const READ_ROWS='SELECT legacy_sheet_row,cells_json FROM m03_private_source_rows '+
 'WHERE source_commit = ? AND source_group = ? AND legacy_sheet_row > ? '+
 'ORDER BY legacy_sheet_row ASC LIMIT ?';
const SEAL_FIELDS=Object.freeze([
 'source_group','source_commit','headers_json','expected_rows','source_digest','status'
]);
const ROW_FIELDS=Object.freeze(['legacy_sheet_row','cells_json']);
const INVALID='Invalid or incomplete private M03 source archive';
const SHA=/^[0-9a-f]{64}$/;
const encoder=new TextEncoder();
const error=()=>new Error(INVALID);

function reject(){throw error();}
function exactOwn(record,headers){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(record)))
  reject();
 const descriptors=Object.getOwnPropertyDescriptors(record);
 const keys=Reflect.ownKeys(descriptors);
 if(keys.length!==headers.length||
    keys.some(k=>typeof k!=='string'||!headers.includes(k))||
    headers.some(k=>descriptors[k]?.enumerable!==true||
      !Object.hasOwn(descriptors[k],'value')))
  reject();
 return Object.fromEntries(headers.map(k=>[k,descriptors[k].value]));
}
function parseHeaders(json,expected){
 if(typeof json!=='string')reject();
 const v=JSON.parse(json);
 if(!Array.isArray(v)||v.length!==expected.length||
    v.some((name,i)=>name!==expected[i]))reject();
}
function parseCells(json,length){
 if(typeof json!=='string')reject();
 const v=JSON.parse(json);
 if(!Array.isArray(v)||v.length!==length||
    v.some(cell=>typeof cell!=='string'))reject();
 return v;
}
async function checksum(sheetKey,headers,rows){
 // Identical canonical stream as the merged M02 SHA-256 parity contract.
 const canonical=JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',
  sheetKey,headers,rows.map(r=>[r.sheetRow,r.cells])
 ]);
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(canonical));
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
function assertBudget(state){
 if(state.rows>MAX_TOTAL_ROWS||state.bytes>MAX_SOURCE_BYTES||
    Date.now()-state.start>MAX_DURATION_MS)
  reject();
}
async function select(DB,sql,parameters,state){
 assertBudget(state);
 const response=await DB.prepare(sql).bind(...parameters).all();
 assertBudget(state);
 if(response?.success!==true||!Array.isArray(response.results))reject();
 return response.results;
}
function parseSeals(records){
 if(records.length!==GROUP_NAMES.length)reject();
 const seals=new Map();
 let total=0;
 for(const item of records){
  const row=exactOwn(item,SEAL_FIELDS);
  const name=row.source_group;
  if(typeof name!=='string'||!Object.hasOwn(FROZEN_SOURCE_COLUMNS,name)||
     seals.has(name)||row.source_commit!==FROZEN_SOURCE_COMMIT||
     row.status!=='SEALED'||!Number.isSafeInteger(row.expected_rows)||
     row.expected_rows<0||row.expected_rows>MAX_GROUP_ROWS||
     typeof row.source_digest!=='string'||!SHA.test(row.source_digest))
   reject();
  parseHeaders(row.headers_json,FROZEN_SOURCE_COLUMNS[name]);
  total+=row.expected_rows;
  if(total>MAX_TOTAL_ROWS)reject();
  seals.set(name,row);
 }
 return seals;
}
function sameSeals(original,next){
 if(original.size!==next.size)reject();
 for(const name of GROUP_NAMES){
  const a=original.get(name),b=next.get(name);
  if(!a||!b||SEAL_FIELDS.some(k=>a[k]!==b[k]))reject();
 }
}
async function readGroup(DB,name,seal,state){
 const headers=FROZEN_SOURCE_COLUMNS[name];
 const rows=[];
 let cursor=1;
 while(rows.length<seal.expected_rows){
  const take=Math.min(PAGE_ROWS,seal.expected_rows-rows.length);
  const result=await select(DB,READ_ROWS,
   [FROZEN_SOURCE_COMMIT,name,cursor,take],state);
  if(result.length!==take)reject();
  for(const item of result){
   const entry=exactOwn(item,ROW_FIELDS);
   if(!Number.isSafeInteger(entry.legacy_sheet_row)||
      entry.legacy_sheet_row<=cursor)
    reject();
   const json=entry.cells_json;
   if(typeof json!=='string'||json.length>MAX_SOURCE_BYTES-state.bytes)
    reject();
   const bytes=encoder.encode(json).byteLength;
   state.bytes+=bytes+32;
   state.rows++;
   assertBudget(state);
   const cells=parseCells(json,headers.length);
   cursor=entry.legacy_sheet_row;
   rows.push({sheetRow:cursor,cells});
  }
 }
 // Never trust the declared count alone. An extra row after the last
 // expected original row would otherwise be silently discarded.
 const beyond=await select(DB,READ_ROWS,[FROZEN_SOURCE_COMMIT,name,cursor,1],state);
 if(beyond.length!==0)reject();
 if(await checksum(name,headers,rows)!==seal.source_digest)reject();
 assertBudget(state);
 return {headers:[...headers],rows};
}
async function readAll(DB){
 const state={start:Date.now(),rows:0,bytes:0};
 const initial=parseSeals(await select(DB,READ_SEALS,
  [FROZEN_SOURCE_COMMIT,GROUP_LIMIT],state));
 const groups={};
 for(const name of GROUP_NAMES){
  const seal=initial.get(name);
  if(!seal)reject();
  groups[name]=await readGroup(DB,name,seal,state);
 }
 // Re-read the entire seal manifest to catch concurrent staging changes.
 // Actual archive immutability/consistent reads require a separate M03 DDL
 // review; this check is not a substitute for a snapshot transaction.
 const final=parseSeals(await select(DB,READ_SEALS,
  [FROZEN_SOURCE_COMMIT,GROUP_LIMIT],state));
 sameSeals(initial,final);
 assertBudget(state);
 return {formatVersion:1,sourceCommit:FROZEN_SOURCE_COMMIT,groups};
}
/**
 * Internal, trusted-only and read-only. A successful result is still NOT
 * a real M02/M10 import certification, migration approval or public RPC.
 */
export function createFrozenSourceReadback(env){
 const DB=requireD1Binding(env);
 return Object.freeze({
  authorizesImport:false,publicRpcEnabled:false,productionReady:false,
  async readAllSourceGroups(...args){
   if(args.length!==0)reject();
   try{return await readAll(DB);}
   catch{throw error();}
  }
 });
}
