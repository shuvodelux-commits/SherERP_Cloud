import {requireD1Binding} from '../db/d1-binding.js';
import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

/**
 * Internal M03/M04, ONE BUSINESS PER D1, NONDEPLOYABLE contract.
 *
 * The authorization predicates are part of the SAME D1 INSERT that fires
 * the local-only atomic M03 master-create trigger. Never substitute a JS
 * preflight as authority, register public RPC or treat the synthetic DDL
 * as an approved live database migration.
 */
const GROUP=Object.freeze({
  category:Object.freeze({
    idKey:'PRODUCT_CATEGORIES',id:'Category ID',label:'Category Name',
    prefix:'PCAT',required:'Category name is required.',
    duplicate:'A category with this name already exists.'
  }),
  unit:Object.freeze({
    idKey:'PRODUCT_UNITS',id:'Unit ID',label:'Unit Name',
    prefix:'PUNT',required:'Unit name is required.',
    duplicate:'A unit with this name already exists.'
  })
});
const BUSINESS=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const OPERATION=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const BEARER=/^[0-9a-f]{64}$/;

// M04 proposed auth_sessions/auth_users/auth_roles schema: never use Party
// roles or Allowed Modules display metadata to infer staff permission.
const AUTH_FROM='FROM auth_sessions AS s '+
  'JOIN auth_users AS u ON u.user_id=s.user_id '+
  'LEFT JOIN auth_roles AS r ON r.role_name=u.role_name ';
const AUTH_WHERE='WHERE s.token_hash=? '+
  'AND s.revoked_at_ms IS NULL '+
  'AND s.created_at_ms<=? AND s.expires_at_ms>? '+
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=? '+
  "AND u.status='Active' AND u.credential_state='Modern' "+
  'AND u.auth_version=s.user_auth_version '+
  'AND u.credential_version=s.credential_version '+
  'AND ( '+
    "(u.role_name='Administrator' AND s.role_auth_version IS NULL) "+
    'OR ( '+
      "u.role_name<>'Administrator' AND r.status='Active' "+
      'AND r.auth_version=s.role_auth_version '+
      'AND length(r.permissions_json)<=65536 '+
      'AND CASE WHEN json_valid(r.permissions_json) THEN '+
        "json_type(r.permissions_json)='object' "+
        "AND json_type(r.permissions_json,'$.products')='object' "+
        "AND json_type(r.permissions_json,'$.products.add')='true' "+
      'ELSE 0 END '+
    ') '+
  ') ';

const AUTH_RECEIPT=
  'SELECT u.user_id AS actor_id, receipt.actor_id AS receipt_actor_id, '+
    'receipt.intent_hash,receipt.name,receipt.result_id '+
  AUTH_FROM+
  'LEFT JOIN synthetic_m03_master_intents AS receipt '+
    'ON receipt.tenant_id=? AND receipt.id_key=? AND receipt.operation_id=? '+
  AUTH_WHERE+' LIMIT 2';

const AUTH_CLAIM='INSERT INTO synthetic_m03_master_intents '+
  '(tenant_id,id_key,operation_id,intent_hash,name,snapshot_json,cleanup_json,created_at,actor_id) '+
  'SELECT ?,?,?,?,?,?,?,?,u.user_id '+AUTH_FROM+AUTH_WHERE+
  'ON CONFLICT(tenant_id,id_key,operation_id) DO NOTHING';

function strictInput(request){
  if(!request||typeof request!=='object'||Array.isArray(request) ||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null)){
    throw new TypeError('Invalid trusted Product master request');
  }
  const wanted=['token','nowMs','operationId','name'];
  const keys=Reflect.ownKeys(request);
  if(keys.length!==wanted.length ||
     keys.some(key=>typeof key!=='string'||!wanted.includes(key))){
    throw new TypeError('Invalid Product master request fields');
  }
  const x={};
  for(const key of wanted){
    const d=Object.getOwnPropertyDescriptor(request,key);
    if(!d?.enumerable||!Object.hasOwn(d,'value')){
      throw new TypeError('Invalid Product master request descriptor');
    }
    x[key]=d.value;
  }
  if(typeof x.token!=='string'||!BEARER.test(x.token) ||
     !Number.isSafeInteger(x.nowMs)||x.nowMs<0 ||
     !Number.isSafeInteger(x.nowMs+AUTH_POLICY.sessionMaxMs) ||
     typeof x.operationId!=='string'||!OPERATION.test(x.operationId) ||
     typeof x.name!=='string'){
    throw new TypeError('Invalid Product master bearer, clock, operation or name');
  }
  x.name=x.name.trim();
  return x;
}
async function bearerHash(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function'){
    throw new Error('NEEDS_REVIEW: Web Crypto required for M04 authority');
  }
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++){
    bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
  }
  const hashed=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hashed,b=>b.toString(16).padStart(2,'0')).join('');
}
async function intentHash(businessId,idKey,name){
  const bytes=new TextEncoder().encode(JSON.stringify([businessId,idKey,name]));
  const hashed=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hashed,b=>b.toString(16).padStart(2,'0')).join('');
}
function authParams(digest,nowMs){
  return [digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs];
}
function decideReceipt(row,expectedHash,name,prefix){
  if(row.receipt_actor_id!==row.actor_id){
    throw new Error('Denied: original Product master actor mismatch');
  }
  if(row.intent_hash!==expectedHash||row.name!==name){
    throw new Error('Original Product master operation intent collision');
  }
  if(typeof row.result_id!=='string' ||
     !new RegExp('^'+prefix+'-[0-9]{6,}$').test(row.result_id)){
    throw new Error('NEEDS_REVIEW: invalid source master receipt');
  }
  return {success:true,data:{id:row.result_id,name}};
}
function sourceSnapshot(rows,group,name){
  const seen=new Set(),snapshot=[],cleanup=[];
  let duplicate=false;
  const folded=name.toLowerCase();
  for(const row of rows){
    const id=row?.[group.id],label=row?.[group.label],status=row?.Status;
    if(typeof id!=='string'||!id.trim()||seen.has(id)||
       typeof label!=='string'||!label.trim()||typeof status!=='string'||
       typeof row['Created At']!=='string'||
       !Number.isInteger(row._rowIndex)||row._rowIndex<2){
      throw new Error('NEEDS_REVIEW: unsafe Product master source preimage');
    }
    seen.add(id);
    snapshot.push([row._rowIndex,id,label,status,row['Created At']]);
    if(label.trim().toLowerCase()===folded){
      if(String(status||'Active').toLowerCase()==='active')duplicate=true;
      else cleanup.push(id);
    }
  }
  return {duplicate,snapshot,cleanup};
}

export function createM04AuthorizedProductMasterCreator(env,{businessId}={}){
  if(typeof businessId!=='string'||!BUSINESS.test(businessId)){
    throw new TypeError('Invalid trusted single-business D1 context');
  }
  const DB=requireD1Binding(env);
  const catalog=createLegacyCatalogReadAdapter(env);

  const create=async(group,input)=>{
    const {token,nowMs,operationId,name}=strictInput(input);
    // This is a security *read* gate for no name disclosure, not permission
    // to write. SQL validates the same current authority again at INSERT.
    const digest=await bearerHash(token);
    const params=authParams(digest,nowMs);
    const readCurrent=()=>DB.prepare(AUTH_RECEIPT)
      .bind(businessId,group.idKey,operationId,...params).all();
    const current=await readCurrent();
    if(current?.success!==true || !Array.isArray(current.results) ||
       current.results.length!==1 || typeof current.results[0]?.actor_id!=='string'){
      throw new Error('Denied: Product master authorization unavailable');
    }
    const initial=current.results[0];
    if(!name)return {success:false,message:group.required};
    const hash=await intentHash(businessId,group.idKey,name);
    if(initial.receipt_actor_id!==null){
      return decideReceipt(initial,hash,name,group.prefix);
    }

    const rows=await catalog.getAllRows_(group.idKey);
    const {duplicate,snapshot,cleanup}=sourceSnapshot(rows,group,name);
    if(duplicate)return {success:false,message:group.duplicate};

    // One SQL statement owns CURRENT M04 authority, M03 snapshot CAS,
    // inactive-row cleanup, source-ID receipt, and Active catalog append.
    const result=await DB.prepare(AUTH_CLAIM).bind(
      businessId,group.idKey,operationId,hash,name,
      JSON.stringify(snapshot),JSON.stringify(cleanup),
      new Date().toISOString(),...params
    ).run();
    if(result?.success!==true){
      throw new Error('Unknown authorized master D1 outcome; reconcile by stable operation ID');
    }
    const afterward=await readCurrent();
    if(afterward?.success!==true || !Array.isArray(afterward.results) ||
       afterward.results.length!==1 || typeof afterward.results[0]?.actor_id!=='string' ||
       afterward.results[0].receipt_actor_id===null){
      throw new Error('Denied: Product master authorization or immutable receipt unavailable');
    }
    return decideReceipt(afterward.results[0],hash,name,group.prefix);
  };
  return Object.freeze({
    createCategory_(input){return create(GROUP.category,input);},
    createUnit_(input){return create(GROUP.unit,input);}
  });
}
