/**
 * M04/M09 INTERNAL source-shaped Reports bootstrap; NOT a public RPC.
 * Trust server-derived token/time only; this test-schema SQL assumes one
 * separately isolated business D1 and has no tenant boundary yet.
 */
import {requireD1Binding} from '../db/d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {reportDefaultRange} from './report-date-range.js';
import {projectReportsBootstrap} from './reports-bootstrap-read.js';

const TOKEN=/^[0-9a-f]{64}$/;
const KEYS=new Set(['Shop Name','Currency Symbol']);

// One database read both checks current M04 authority and projects the two
// explicitly allowed Settings keys. Never perform a separate auth preflight
// followed by an unguarded Settings read (revocation race).
const READ=`WITH authorized AS (
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
        u.role_name<>'Administrator' AND r.status='Active'
        AND r.auth_version=s.role_auth_version
        AND length(r.permissions_json)<=65536
        AND CASE WHEN json_valid(r.permissions_json) THEN
          json_type(r.permissions_json)='object'
          AND json_type(r.permissions_json,'$.reports')='object'
          AND json_type(r.permissions_json,'$.reports.view')='true'
        ELSE 0 END
      )
    )
  LIMIT 1
)
SELECT v.key,v.value
FROM authorized AS a
LEFT JOIN settings AS v ON v.key IN ('Shop Name','Currency Symbol')
ORDER BY v.row_id ASC
LIMIT 3`;

function validate(request){
  try{
    if(!request || typeof request!=='object' || Array.isArray(request) ||
      (Object.getPrototypeOf(request)!==Object.prototype &&
       Object.getPrototypeOf(request)!==null))
      throw new TypeError('Invalid trusted Reports request');
    const required=['token','nowMs','today'];
    const actual=Reflect.ownKeys(request);
    if(actual.length!==required.length || actual.some(k=>!required.includes(k)))
      throw new TypeError('Invalid trusted Reports request fields');
    const values={};
    for(const key of required){
      const d=Object.getOwnPropertyDescriptor(request,key);
      if(!d?.enumerable || !Object.hasOwn(d,'value'))
        throw new TypeError('Invalid trusted Reports descriptor');
      values[key]=d.value;
    }
    if(typeof values.token!=='string' || !TOKEN.test(values.token) ||
      !Number.isSafeInteger(values.nowMs) || values.nowMs<0 ||
      !Number.isSafeInteger(values.nowMs+AUTH_POLICY.sessionMaxMs))
      throw new TypeError('Invalid trusted Reports bearer or time');
    reportDefaultRange(values.today); // Validate before querying D1.
    return values;
  }catch{
    throw new TypeError('Invalid trusted Reports request');
  }
}

async function bearerHash(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('NEEDS_REVIEW: Web Crypto unavailable');
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++)bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
  const hashed=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hashed,x=>x.toString(16).padStart(2,'0')).join('');
}

function decode(rows){
  if(rows.length===0)throw new Error('Denied: Reports view permission unavailable');
  if(rows.length>2)throw new Error('NEEDS_REVIEW: malformed Reports Settings rows');
  const settings=Object.create(null);
  if(rows.length===1 && rows[0]?.key===null && rows[0]?.value===null)
    return settings; // Authorized staff, no Settings configured.
  for(const row of rows){
    if(!row || typeof row!=='object' || Array.isArray(row))
      throw new Error('NEEDS_REVIEW: invalid Reports Settings row');
    const key=Object.getOwnPropertyDescriptor(row,'key');
    const value=Object.getOwnPropertyDescriptor(row,'value');
    if(!key || !value || !Object.hasOwn(key,'value') ||
       !Object.hasOwn(value,'value') || typeof key.value!=='string' ||
       !KEYS.has(key.value) || typeof value.value!=='string' ||
       Object.hasOwn(settings,key.value))
      throw new Error('NEEDS_REVIEW: invalid or unsafe Reports Settings');
    settings[key.value]=value.value;
  }
  return settings;
}

/** This reader never registers or authorizes any public HTTP/RPC path. */
export function createM04AuthorizedReportsBootstrapReader(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getBootstrap(request){
      const {token,nowMs,today}=validate(request);
      const hash=await bearerHash(token);
      let response;
      try{
        response=await DB.prepare(READ)
          .bind(hash,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs)
          .all();
      }catch(cause){
        throw new Error('NEEDS_REVIEW: Reports authorization read unavailable',{cause});
      }
      if(response?.success!==true || !Array.isArray(response.results) ||
         response.results.length>3)
        throw new Error('NEEDS_REVIEW: invalid Reports authorization result');
      return projectReportsBootstrap(decode(response.results),today);
    }
  });
}
