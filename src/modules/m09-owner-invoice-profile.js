/**
 * M09 private, Shop-scoped Invoice Studio preview preferences.
 * Integrator: M03. Not imported by public RPC or hosted Owner Worker.
 * One strictly validated inert preview record in existing settings table.
 * Printer behavior, financial data, logo, roles and staff are not changed.
 * Owner token lease is checked in the SAME Shop D1 statement as the write.
 */
import {hashOpaqueSessionToken} from '../auth/session-token.js';

export const INVOICE_PROFILE_KEY='HisabIQ Invoice Studio v1';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PRESETS=['Standard','Classic','Compact'];
const PAPERS=['A4','80 mm','58 mm','Business Pad'];
const LANGUAGES=['English','English + বাংলা','Bangla'];
const FLAGS=['business','customer','sku','discount','payments','due','words','signature','warranty'];
const AUTH=[
  'EXISTS(SELECT 1 FROM shop_identity i',
  'JOIN shop_owner_write_grant g ON g.singleton=i.singleton',
  'WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?',
  'AND g.enabled=1 AND g.token_hash=?',
  "AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER))"
].join(' ');
const READ='WITH authorized AS (SELECT 1 AS ok WHERE '+AUTH+') '+
  'SELECT EXISTS(SELECT 1 FROM authorized) AS allowed, '+
  '(SELECT s.value FROM authorized JOIN settings s ON s.key=?) AS value';
const CREATE='INSERT INTO settings(key,value) SELECT ?,? WHERE '+AUTH+
  ' AND NOT EXISTS(SELECT 1 FROM settings WHERE key=?) RETURNING key,value';
const REPLACE='UPDATE settings SET value=? WHERE key=? AND value=? AND '+AUTH+
  ' RETURNING key,value';

function validatedPlain(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))throw new TypeError('Invalid invoice profile object');
  const desc=Object.getOwnPropertyDescriptors(value);
  const names=Reflect.ownKeys(desc);
  if(names.length!==keys.length || names.some(key=>
     typeof key!=='string'||!keys.includes(key)||
     !desc[key].enumerable||!Object.hasOwn(desc[key],'value')))
    throw new TypeError('Invalid invoice profile fields');
  return Object.fromEntries(keys.map(key=>[key,desc[key].value]));
}

export function defaultInvoiceProfile(){
  return {template:'Standard',paper:'A4',language:'English + বাংলা',
    checks:Object.fromEntries(FLAGS.map(flag=>[flag,true]))};
}
/** Fresh canonical object, never executes input accessors or trusts role keys. */
export function normalizeInvoiceProfile(input){
  const row=validatedPlain(input,['template','paper','language','checks']);
  if(!PRESETS.includes(row.template)||!PAPERS.includes(row.paper)||
    !LANGUAGES.includes(row.language))
    throw new TypeError('Invalid or unsupported invoice preview design');
  const checks=validatedPlain(row.checks,FLAGS);
  if(FLAGS.some(flag=>typeof checks[flag]!=='boolean'))
    throw new TypeError('Invalid invoice preview visibility toggle');
  return {template:row.template,paper:row.paper,language:row.language,
    checks:Object.fromEntries(FLAGS.map(flag=>[flag,checks[flag]]))};
}

function scopeTuple(scope){
  if(!scope||typeof scope.shopDb?.prepare!=='function' ||
     ![scope.shopId,scope.databaseId,scope.databaseMarker].every(x=>
       typeof x==='string'&&UUID.test(x)))
    throw new TypeError('Trusted verified Shop D1 scope required');
  return [scope.shopId,scope.databaseId,scope.databaseMarker];
}
async function authority(scope,token){
  const tuple=scopeTuple(scope);
  const hash=await hashOpaqueSessionToken(token);
  return hash?[...tuple,hash]:null;
}
function decode(raw){
  if(typeof raw!=='string'||raw.length>4096)throw new Error('Invoice profile storage unavailable');
  try{
    const parsed=normalizeInvoiceProfile(JSON.parse(raw));
    if(JSON.stringify(parsed)!==raw)throw new Error('Noncanonical profile');
    return parsed;
  }catch{
    throw new Error('Invoice profile storage unavailable');
  }
}
/** A read-time SQL permission guard, not a JS check followed by unguarded read. */
export async function readOwnerInvoiceProfile(scope,{token}={}){
  const auth=await authority(scope,token);
  if(!auth)return {status:'denied'};
  let row;
  try{row=await scope.shopDb.prepare(READ).bind(...auth,INVOICE_PROFILE_KEY).first();}
  catch{return {status:'unavailable'};}
  if(!row||row.allowed!==1)return {status:'denied'};
  if(row.value===null)return {status:'ok',profile:defaultInvoiceProfile(),revision:null};
  try{return {status:'ok',profile:decode(row.value),revision:row.value};}
  catch{return {status:'unavailable'};}
}

/**
 * Single D1 statement checks Shop, token and live lease with compare-and-set.
 * expectedRevision=null means no row existed. Transport uncertainty must
 * trigger a fresh read, never claim save or silently replace the new value.
 */
export async function saveOwnerInvoiceProfile(scope,{token,expectedRevision,profile}={}){
  let canonical;
  try{canonical=JSON.stringify(normalizeInvoiceProfile(profile));}
  catch{return {status:'invalid'};}
  if(expectedRevision!==null && typeof expectedRevision!=='string')
    return {status:'invalid'};
  if(typeof expectedRevision==='string'){
    try{decode(expectedRevision);}
    catch{return {status:'invalid'};}
  }
  const auth=await authority(scope,token);
  if(!auth)return {status:'denied'};
  const sql=expectedRevision===null?CREATE:REPLACE;
  const params=expectedRevision===null
    ?[INVOICE_PROFILE_KEY,canonical,...auth,INVOICE_PROFILE_KEY]
    :[canonical,INVOICE_PROFILE_KEY,expectedRevision,...auth];
  let row;
  try{row=await scope.shopDb.prepare(sql).bind(...params).first();}
  catch{return {status:'unavailable'};}
  if(!row)return {status:'denied-or-stale'};
  if(row.key!==INVOICE_PROFILE_KEY||row.value!==canonical)
    return {status:'unavailable'};
  return {status:'saved',profile:normalizeInvoiceProfile(profile),revision:canonical};
}
