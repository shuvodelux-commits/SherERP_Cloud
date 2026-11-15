/**
 * INTERNAL M03/M04 read-only shell projection, not a public Settings RPC.
 *
 * The M04 auth_sessions schema here is still a nondeployable test proposal
 * without tenant_id. Only a single business on an isolated D1 may use this
 * contract. This is not safe for shared-tenant databases or public previews.
 */
import {requireD1Binding} from './d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

const TOKEN=/^[0-9a-f]{64}$/;
const SHELL_KEYS=new Set(['Shop Name','Currency Symbol']);
const DEFAULT_APP_NAME='Hardware Store ERP'; // pinned Config.gs CONFIG.APP_NAME
const MAX_SETTINGS_ROWS=256;
const FORBIDDEN_KEYS=new Set(['__proto__','constructor','prototype']);

// Authorization and safe two-key projection are one D1 SELECT. A JS
// permissions preflight followed by a separate unprotected Settings query
// could disclose rows after a revocation. The current role version and
// literal boolean settings.view grant are checked in the same statement.
const AUTH_CTE=`WITH authorized AS (
  SELECT 1 AS allowed
  FROM auth_sessions AS s
  JOIN auth_users AS u ON u.user_id=s.user_id
  LEFT JOIN auth_roles AS r ON r.role_name=u.role_name
  WHERE s.token_hash=?
    AND s.revoked_at_ms IS NULL
    AND s.created_at_ms<=? AND s.expires_at_ms>?
    AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?
    AND u.status='Active' AND u.credential_state='Modern'
    AND u.auth_version=s.user_auth_version
    AND u.credential_version=s.credential_version
    AND (
      (u.role_name='Administrator' AND s.role_auth_version IS NULL)
      OR (
        u.role_name<>'Administrator'
        AND r.status='Active'
        AND r.auth_version=s.role_auth_version
        AND length(r.permissions_json)<=65536
        AND CASE WHEN json_valid(r.permissions_json) THEN
          json_type(r.permissions_json)='object'
          AND json_type(r.permissions_json,'$.settings')='object'
          AND json_type(r.permissions_json,'$.settings.view')='true'
        ELSE 0 END
      )
    )
  LIMIT 1
)`;
const READ_SHELL=`${AUTH_CTE}
SELECT v.key,v.value
FROM authorized AS a
LEFT JOIN settings AS v ON v.key IN ('Shop Name','Currency Symbol')
ORDER BY v.row_id ASC
LIMIT 3`;
const READ_MAP=`${AUTH_CTE}
SELECT v.key,v.value
FROM authorized AS a
LEFT JOIN settings AS v ON 1=1
ORDER BY v.row_id ASC
LIMIT 257`;

function validate(request){
  if(!request || typeof request!=='object' || Array.isArray(request) ||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null)){
    throw new TypeError('Invalid M04 Settings view request');
  }
  const keys=Reflect.ownKeys(request);
  if(keys.length!==2 || keys.some(key=>typeof key!=='string' ||
    (key!=='token' && key!=='nowMs'))){
    throw new TypeError('Invalid M04 Settings view request fields');
  }
  const tokenDesc=Object.getOwnPropertyDescriptor(request,'token');
  const timeDesc=Object.getOwnPropertyDescriptor(request,'nowMs');
  if(!tokenDesc?.enumerable || !Object.hasOwn(tokenDesc,'value') ||
     !timeDesc?.enumerable || !Object.hasOwn(timeDesc,'value')){
    throw new TypeError('Invalid M04 Settings view request descriptor');
  }
  const token=tokenDesc.value,nowMs=timeDesc.value;
  if(typeof token!=='string' || !TOKEN.test(token) ||
     !Number.isSafeInteger(nowMs) || nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs)){
    throw new TypeError('Invalid M04 Settings view bearer or server time');
  }
  return {token,nowMs};
}

async function digestBearer(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function'){
    throw new Error('NEEDS_REVIEW: Web Crypto unavailable');
  }
  const bytes=new Uint8Array(32);
  for(let i=0;i<bytes.length;i++){
    bytes[i]=Number.parseInt(token.slice(2*i,2*i+2),16);
  }
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}

function decode(rows){
  if(rows.length<1 || rows.length>2){
    throw new Error('NEEDS_REVIEW: malformed authorized Settings shell rows');
  }
  const result=Object.create(null);
  if(rows.length===1 && rows[0]?.key===null && rows[0]?.value===null){
    return {shopName:DEFAULT_APP_NAME,currencySymbol:''};
  }
  for(const row of rows){
    if(!row || typeof row!=='object' || Array.isArray(row)){
      throw new Error('NEEDS_REVIEW: invalid Settings shell row');
    }
    const key=Object.getOwnPropertyDescriptor(row,'key');
    const value=Object.getOwnPropertyDescriptor(row,'value');
    if(!key || !value || !Object.hasOwn(key,'value') ||
      !Object.hasOwn(value,'value') ||
      typeof key.value!=='string' || !SHELL_KEYS.has(key.value) ||
      typeof value.value!=='string' || Object.hasOwn(result,key.value)){
      throw new Error('NEEDS_REVIEW: invalid or duplicate Settings shell key');
    }
    result[key.value]=value.value;
  }
  return {
    shopName:result['Shop Name']||DEFAULT_APP_NAME,
    currencySymbol:result['Currency Symbol']||''
  };
}


function decodeMap(rows){
  if(rows.length<1 || rows.length>MAX_SETTINGS_ROWS){
    throw new Error('NEEDS_REVIEW: Settings map exceeds safe row limit');
  }
  const map=Object.create(null);
  if(rows.length===1 && rows[0]?.key===null && rows[0]?.value===null){
    return map; // Valid M04 authority, zero actual Settings rows.
  }
  for(const row of rows){
    if(!row || typeof row!=='object' || Array.isArray(row)){
      throw new Error('NEEDS_REVIEW: invalid D1 Settings map row');
    }
    const key=Object.getOwnPropertyDescriptor(row,'key');
    const value=Object.getOwnPropertyDescriptor(row,'value');
    if(!key || !value || !Object.hasOwn(key,'value') ||
       !Object.hasOwn(value,'value') ||
       typeof key.value!=='string' || !key.value.trim() ||
       FORBIDDEN_KEYS.has(key.value) ||
       typeof value.value!=='string' || Object.hasOwn(map,key.value)){
      throw new Error('NEEDS_REVIEW: unsafe or duplicate D1 Settings key');
    }
    map[key.value]=value.value;
  }
  return map;
}

async function readAuthorized(DB,sql,request,limit){
  const {token,nowMs}=validate(request);
  const digest=await digestBearer(token);
  let response;
  try{
    response=await DB.prepare(sql).bind(
      digest,nowMs,nowMs,
      nowMs-AUTH_POLICY.sessionIdleMs,nowMs
    ).all();
  }catch(cause){
    throw new Error('NEEDS_REVIEW: authorized Settings read unavailable',{cause});
  }
  if(response?.success!==true || !Array.isArray(response.results) ||
     response.results.length>limit){
    throw new Error('NEEDS_REVIEW: malformed authorized Settings read response');
  }
  if(response.results.length===0){
    throw new Error('Denied: Settings view permission unavailable');
  }
  return response.results;
}

/**
 * No session heartbeat, unguarded read, extra auth preflight or cache.
 * getAppShellSettings_ is strictly two-key only.
 * getSettingsMap_ contains the original full Settings values, including
 * private keys, so it MUST remain internal until a reviewed secure RPC
 * implements the source's settings.view permission and transport policy.
 */
export function createM04AuthorizedShellSettingsReadAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getAppShellSettings_(request){
      return decode(await readAuthorized(DB,READ_SHELL,request,SHELL_KEYS.size));
    },
    async getSettingsMap_(request){
      return decodeMap(await readAuthorized(DB,READ_MAP,request,MAX_SETTINGS_ROWS+1));
    }
  });
}
