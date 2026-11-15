/**
 * M03/M04 INTERNAL compatibility contract; not an activated Settings RPC.
 *
 * Uses M04's proposed auth_sessions/auth_users test schema and the existing
 * M02 Settings table. M04 sessions have no tenant ID: ONLY valid for a single
 * business in its own isolated D1. No shared-tenant, production or preview
 * binding can use this until schema, RBAC and cutover approval.
 */
import {requireD1Binding} from './d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

const TOKEN=/^[0-9a-f]{64}$/;
const SHELL_KEYS=new Set(['Shop Name','Currency Symbol']);

// Current session authorization and old-value CAS are checked INSIDE the
// same D1 UPDATE. A separate JavaScript auth preflight can race revocation.
// Non-Administrator users require the current active role epoch and an actual
// JSON boolean 'settings.edit' grant (not Allowed Modules display metadata).
const AUTHORIZED_UPDATE=`UPDATE settings SET value=?
  WHERE key=? AND value=?
    AND EXISTS(
      SELECT 1 FROM auth_sessions AS s
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
              AND json_type(r.permissions_json,'$.settings.edit')='true'
            ELSE 0 END
          )
        )
    )
  RETURNING key,value`;

function validated(request){
  if(!request || typeof request!=='object' || Array.isArray(request) ||
    (Object.getPrototypeOf(request)!==Object.prototype &&
     Object.getPrototypeOf(request)!==null)){
    throw new TypeError('Invalid authorized Settings request');
  }
  const keys=Reflect.ownKeys(request);
  const allowed=['token','nowMs','key','newValue','expectedValue'];
  if(keys.length!==allowed.length ||
    keys.some(k=>typeof k!=='string'||!allowed.includes(k))){
    throw new TypeError('Invalid authorized Settings request fields');
  }
  const input={};
  for(const key of allowed){
    const desc=Object.getOwnPropertyDescriptor(request,key);
    if(!desc?.enumerable || !Object.hasOwn(desc,'value')){
      throw new TypeError('Invalid authorized Settings request descriptor');
    }
    input[key]=desc.value;
  }
  const {token,nowMs,key,newValue,expectedValue}=input;
  if(typeof token!=='string' || !TOKEN.test(token) ||
    !Number.isSafeInteger(nowMs) || nowMs<0 ||
    !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs) ||
    typeof key!=='string' || !SHELL_KEYS.has(key) ||
    typeof newValue!=='string' || typeof expectedValue!=='string'){
    throw new TypeError('Invalid authorized Settings token, time, key or values');
  }
  const value=newValue.trim(); // pinned Utils.gs:sanitizeInput_
  if(key==='Shop Name' && !value){
    throw new TypeError('Shop Name is required');
  }
  return {token,nowMs,key,value,expectedValue};
}

async function sha256OpaqueBearer(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function'){
    throw new Error('NEEDS_REVIEW: Web Crypto unavailable');
  }
  // M04 stores SHA-256 over the 32 random bytes, not UTF-8 hex characters.
  const bytes=new Uint8Array(32);
  for(let i=0;i<bytes.length;i++){
    bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
  }
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

/**
 * Intended only for a trusted server caller supplying a real M04 bearer and
 * trusted server clock, never user-controlled actor/role/SQL identifiers.
 * Does not heartbeat the session. No cache, preflight read or automatic retry.
 */
export function createM04AuthorizedShellSettingsUpdateAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async updateExisting_(request){
      const x=validated(request);
      const digest=await sha256OpaqueBearer(x.token);
      let updated;
      try{
        updated=await DB.prepare(AUTHORIZED_UPDATE).bind(
          x.value,x.key,x.expectedValue,
          digest,x.nowMs,x.nowMs,
          x.nowMs-AUTH_POLICY.sessionIdleMs,x.nowMs
        ).first();
      }catch(cause){
        throw new Error('NEEDS_REVIEW: M04 authorized Settings write uncertain',{cause});
      }
      if(updated===null){
        // Do not reveal whether the key exists, token was revoked, role was
        // changed or another user won the compare-and-set race.
        throw new Error('Denied or stale Settings precondition');
      }
      if(!updated || updated.key!==x.key || updated.value!==x.value){
        throw new Error('NEEDS_REVIEW: malformed authorized Settings write result');
      }
      return {updated:true};
    }
  });
}
