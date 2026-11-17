/**
 * M03 internal source-shaped D1 readback PROOF. No deployed migration creates
 * these fixed-named private archive tables. Only explicitly sanctioned private
 * staging could eventually populate a reviewed equivalent; this is not a
 * production import, a public RPC handler, or financial posting authorization.
 *
 * All 49 groups and all 659 headers are compile-time pinned from Config.gs.
 * Source rows can include secrets. Do NOT return this reader from a public API,
 * or log its successful private output.
 */
import {requireD1Binding} from './d1-binding.js';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT} from './m03-frozen-source-headers.js';

const GROUP_NAMES=Object.freeze(Object.keys(FROZEN_SOURCE_COLUMNS));
const GROUP_LIMIT=GROUP_NAMES.length+1;
const MAX_GROUP_ROWS=1000;
// SQL identifiers are hardcoded. No client/group-controlled SQL identifiers.
const READ_SEALS='SELECT source_group,source_commit,headers_json,expected_rows,source_digest,status '+
 'FROM m03_private_source_seals WHERE source_commit = ? ORDER BY source_group ASC LIMIT ?';
const READ_ROWS='SELECT legacy_sheet_row,cells_json FROM m03_private_source_rows '+
 'WHERE source_commit = ? AND source_group = ? ORDER BY legacy_sheet_row ASC LIMIT ?';
const EXPECTED_SEAL=Object.freeze([
 'source_group','source_commit','headers_json','expected_rows','source_digest','status'
]);
const EXPECTED_ROW=Object.freeze(['legacy_sheet_row','cells_json']);
const INVALID='Invalid or incomplete private M03 source archive';
const SHA=/^[0-9a-f]{64}$/;

function reject(){throw new Error(INVALID);}
function exactOwn(record,headers){
 if(!record||typeof record!=='object'||Array.isArray(record)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(record)))reject();
 const props=Object.getOwnPropertyDescriptors(record);
 const keys=Reflect.ownKeys(props);
 if(keys.length!==headers.length||
    keys.some(key=>typeof key!=='string'||!headers.includes(key))||
    headers.some(k=>!props[k]?.enumerable||!Object.hasOwn(props[k],'value')))
  reject();
 return Object.fromEntries(headers.map(k=>[k,props[k].value]));
}
async function query(DB,sql,args){
 const result=await DB.prepare(sql).bind(...args).all();
 if(result?.success!==true||!Array.isArray(result.results))
  reject();
 return result.results;
}
function parseExactHeaders(json,expected){
 if(typeof json!=='string')reject();
 const result=JSON.parse(json);
 if(!Array.isArray(result)||result.length!==expected.length||
    result.some((name,i)=>name!==expected[i]))reject();
}
function parseExactCells(json,length){
 if(typeof json!=='string')reject();
 const cells=JSON.parse(json);
 if(!Array.isArray(cells)||cells.length!==length||
    cells.some(s=>typeof s!=='string'))reject();
 return cells;
}
async function exactDigest(sheetKey,headers,rows){
 // Use the same v1 canonical digest as merged M02 offline source parity.
 const canonical=JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',
  sheetKey,headers,rows.map(row=>[row.sheetRow,row.cells])
 ]);
 const source=new TextEncoder().encode(canonical);
 const digest=await globalThis.crypto.subtle.digest('SHA-256',source);
 return [...new Uint8Array(digest)]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function readValidated(DB){
 const sealed=await query(DB,READ_SEALS,[FROZEN_SOURCE_COMMIT,GROUP_LIMIT]);
 if(sealed.length!==GROUP_NAMES.length)reject();
 const seals=new Map();
 for(const item of sealed){
  const row=exactOwn(item,EXPECTED_SEAL);
  if(typeof row.source_group!=='string'||!
     Object.hasOwn(FROZEN_SOURCE_COLUMNS,row.source_group)||
     seals.has(row.source_group)||
     row.source_commit!==FROZEN_SOURCE_COMMIT||
     row.status!=='SEALED'||
     !Number.isSafeInteger(row.expected_rows)||row.expected_rows<0||
     row.expected_rows>MAX_GROUP_ROWS||
     typeof row.source_digest!=='string'||!SHA.test(row.source_digest))
   reject();
  parseExactHeaders(row.headers_json,FROZEN_SOURCE_COLUMNS[row.source_group]);
  seals.set(row.source_group,row);
 }
 const groups={};
 for(const name of GROUP_NAMES){
  if(!seals.has(name))reject();
  const headers=FROZEN_SOURCE_COLUMNS[name];
  const records=await query(DB,READ_ROWS,
   [FROZEN_SOURCE_COMMIT,name,MAX_GROUP_ROWS+1]);
  if(records.length!==seals.get(name).expected_rows)reject();
  const rows=[];
  let last=1;
  for(const item of records){
   const data=exactOwn(item,EXPECTED_ROW);
   if(!Number.isSafeInteger(data.legacy_sheet_row)||
      data.legacy_sheet_row<=last)reject();
   const cells=parseExactCells(data.cells_json,headers.length);
   last=data.legacy_sheet_row;
   rows.push({sheetRow:last,cells});
  }
  if(await exactDigest(name,headers,rows)!==seals.get(name).source_digest)
   reject();
  groups[name]={headers:[...headers],rows};
 }
 return {formatVersion:1,sourceCommit:FROZEN_SOURCE_COMMIT,groups};
}

/**
 * Fail-closed internal readback. A successful result is source-shaped *test
 * evidence* only; its original independent source counts and D1 migration
 * authority must be checked separately by M02/M10.
 */
export function createFrozenSourceReadback(env){
 const DB=requireD1Binding(env);
 return Object.freeze({
  authorizesImport:false,publicRpcEnabled:false,productionReady:false,
  async readAllSourceGroups(...args){
   if(args.length!==0)reject();
   try{return await readValidated(DB);}
   catch{throw new Error(INVALID);}
  }
 });
}
