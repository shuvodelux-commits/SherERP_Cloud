/**
 * M09 INTERNAL Day Book bootstrap D1 reader — no public RPC.
 *
 * Caller supplies the server-derived bearer and clock, not a role/permission.
 * This single-business M04 schema is a nondeployable local proof; there is
 * no tenant boundary. Never bind this reader to public previews.
 */
import {requireD1Binding} from '../db/d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {projectDayBookBootstrap} from './daybook-bootstrap-read.js';

const TOKEN=/^[0-9a-f]{64}$/;
const KEYS=new Set(['Currency Symbol','Day Book Editable Days']);

/**
 * One SELECT binds the current M04 session, actor role and the two
 * source-approved Settings keys. Never authorize in JS and then perform
 * a second unguarded Settings query: role revocation must be atomic
 * with the visibility decision. allowed_modules is presentation only.
 */
const READ=String.raw`WITH authorized AS (
  SELECT u.role_name AS role_name
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
          AND json_type(r.permissions_json,'$.daybook')='object'
          AND json_type(r.permissions_json,'$.daybook.view')='true'
        ELSE 0 END
      )
    )
  LIMIT 1
)
SELECT a.role_name AS role_name,v.key AS key,v.value AS value
FROM authorized AS a
LEFT JOIN settings AS v ON v.key IN ('Currency Symbol','Day Book Editable Days')
ORDER BY v.row_id ASC
LIMIT 3`;

function validate(request){
  if(!request || typeof request!=='object' || Array.isArray(request) ||
    (Object.getPrototypeOf(request)!==Object.prototype &&
     Object.getPrototypeOf(request)!==null)){
    throw new TypeError('Invalid trusted Day Book request');
  }
  const keys=Reflect.ownKeys(request);
  if(keys.length!==2 || keys.some(k=>typeof k!=='string' ||
    (k!=='token'&&k!=='nowMs'))){
    throw new TypeError('Invalid trusted Day Book request fields');
  }
  const tokenField=Object.getOwnPropertyDescriptor(request,'token');
  const timeField=Object.getOwnPropertyDescriptor(request,'nowMs');
  if(!tokenField?.enumerable || !Object.hasOwn(tokenField,'value') ||
     !timeField?.enumerable || !Object.hasOwn(timeField,'value')){
    throw new TypeError('Invalid trusted Day Book request descriptors');
  }
  const token=tokenField.value,nowMs=timeField.value;
  if(typeof token!=='string' || !TOKEN.test(token) ||
     !Number.isSafeInteger(nowMs) || nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs)){
    throw new TypeError('Invalid trusted Day Book bearer/time');
  }
  return {token,nowMs};
}

async function hashBearer(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('NEEDS_REVIEW: Web Crypto unavailable');
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++)bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
}

function decode(rows){
  if(rows.length===0)throw new Error('Denied: Day Book view permission unavailable');
  if(rows.length>2)throw new Error('NEEDS_REVIEW: malformed Day Book Settings rows');
  const settings=Object.create(null);
  let role;
  for(const row of rows){
    if(!row || typeof row!=='object' || Array.isArray(row)){
      throw new Error('NEEDS_REVIEW: invalid Day Book Settings row');
    }
    const fields=Object.getOwnPropertyDescriptors(row);
    const names=Reflect.ownKeys(fields);
    if(names.length!==3 || names.some(k=>!['role_name','key','value'].includes(k) ||
      !Object.hasOwn(fields[k],'value'))){
      throw new Error('NEEDS_REVIEW: malformed Day Book Settings row');
    }
    const currentRole=fields.role_name.value;
    const key=fields.key.value,value=fields.value.value;
    if(typeof currentRole!=='string' || !currentRole.trim() ||
      (role!==undefined && role!==currentRole)){
      throw new Error('NEEDS_REVIEW: invalid Day Book actor role');
    }
    role=currentRole;
    if(key===null && value===null && rows.length===1)continue;
    if(typeof key!=='string' || !KEYS.has(key) ||
       typeof value!=='string' || Object.hasOwn(settings,key)){
      throw new Error('NEEDS_REVIEW: invalid or duplicate Day Book Settings key');
    }
    settings[key]=value;
  }
  return {settings,actor:{Role:role}};
}

/** No heartbeat, mutation, public endpoint or cache. */
export function createM09AuthorizedDayBookBootstrapReader(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getBootstrap(request){
      const {token,nowMs}=validate(request);
      const digest=await hashBearer(token);
      let response;
      try{
        response=await DB.prepare(READ).bind(
          digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
        ).all();
      }catch(cause){
        throw new Error('NEEDS_REVIEW: Day Book authorized D1 read unavailable',{cause});
      }
      if(response?.success!==true || !Array.isArray(response.results) ||
         response.results.length>3){
        throw new Error('NEEDS_REVIEW: invalid Day Book authorized D1 result');
      }
      const {settings,actor}=decode(response.results);
      return projectDayBookBootstrap(settings,actor);
    }
  });
}
