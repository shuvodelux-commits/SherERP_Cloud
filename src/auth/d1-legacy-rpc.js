/**
 * M04 internal bridge from D1 identity/session semantics to the original
 * Auth.gs login / validateSession / logout payloads. NOT a public RPC registry.
 * UI role metadata is never authority for a protected backend operation.
 */
import {
  AUTH_POLICY,loginWithD1, validateSessionWithD1, revokeSessionWithD1,
} from './d1-auth-core.js';

const PHONE=/^01[3-9][0-9]{8}$/;
const TOKEN=/^[0-9a-f]{64}$/;
const MODULES=new Set([
  'dashboard','pos','sales','returns','purchase','suppliers','vendors',
  'products','customers','bank','expense','finance','daybook',
  'cashReconciliation','reports','settings','users','roles',
  'openingBalance','settlementDiscount','posCost',
]);
const WINDOWS=new Set(['disabled','same','1','3','7','15','30','unlimited']);
const MANAGEMENT=new Set(['users','roles']);
const failure=message=>({success:false,message});
const EXPIRED='Session expired. Please sign in again.';
const LOGIN_FAILED='Invalid mobile number or password.';
const ROLE_UNAVAILABLE='Sign-in role configuration is unavailable.';
const ok=data=>({success:true,data});

export function roleMetadata(row){
  if(row.role_name==='Administrator'){
    return {allowedModules:null,permissions:null};
  }
  if(typeof row.allowed_modules!=='string' || row.allowed_modules.length>4096 ||
     typeof row.permissions_json!=='string' || row.permissions_json.length>65536)
    return null;
  const entries=row.allowed_modules.trim()
    ?row.allowed_modules.split(',').map(v=>v.trim()):[];
  const unique=new Set(entries);
  if(entries.some(x=>!MODULES.has(x)) || unique.size!==entries.length) return null;
  let permissions;
  try {
    permissions=JSON.parse(row.permissions_json);
  } catch {
    return null;
  }
  if(!permissions || typeof permissions!=='object' || Array.isArray(permissions) ||
     Object.getPrototypeOf(permissions)!==Object.prototype)
    return null;
  // Frozen GAS RoleManagement stores JSON.stringify(permissions). Reject
  // noncanonical/duplicate-key text: SQLite JSON1 and JS JSON.parse can
  // otherwise disagree about which action was actually granted.
  if(JSON.stringify(permissions)!==row.permissions_json)return null;
  for(const [module,actions] of Object.entries(permissions)){
    if(!MODULES.has(module) || !actions || typeof actions!=='object' ||
       Array.isArray(actions) || Object.getPrototypeOf(actions)!==Object.prototype)
      return null;
    for(const [action,value] of Object.entries(actions)){
      if(action==='delete') {
        if(MANAGEMENT.has(module)){
          if(typeof value!=='boolean') return null;
        } else if(!WINDOWS.has(value)) return null;
      } else if(action==='backdate') {
        if(!WINDOWS.has(value)) return null;
      } else if(['view','add','edit'].includes(action)){
        if(typeof value!=='boolean') return null;
      } else return null;
    }
  }
  return {allowedModules:entries,permissions};
}

/**
 * Strict role navigation consistency for internal D1 permission gates.
 * Keep schema parsing separate: the protected staff-import auditor must
 * report navigation mismatch instead of permission-schema corruption.
 */
export function roleNavigationConsistent(role){
  if(!role || !role.permissions || !Array.isArray(role.allowedModules))
    return false;
  const visible=Object.entries(role.permissions)
    .filter(([,actions])=>actions.view===true)
    .map(([module])=>module);
  return visible.length===role.allowedModules.length &&
    visible.every(module=>role.allowedModules.includes(module));
}

function tokenToBytes(token){
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++)bytes[i]=parseInt(token.slice(i*2,i*2+2),16);
  return bytes;
}
export async function tokenFingerprint(token){
  if(typeof token!=='string' || !TOKEN.test(token))return null;
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('Web Crypto required');
  const raw=await globalThis.crypto.subtle.digest('SHA-256',tokenToBytes(token));
  return Array.from(new Uint8Array(raw),x=>x.toString(16).padStart(2,'0')).join('');
}

async function sourceProfile(db,token,nowMs){
  const digest=await tokenFingerprint(token);
  if(!digest) return null;
  const row=await db.prepare(`SELECT u.user_id,u.full_name,u.phone_key,u.role_name,
        r.allowed_modules,r.permissions_json
    FROM auth_sessions s
    JOIN auth_users u ON u.user_id=s.user_id
    LEFT JOIN auth_roles r ON r.role_name=u.role_name
    WHERE s.token_hash=? AND s.revoked_at_ms IS NULL
      AND s.created_at_ms<=? AND s.expires_at_ms>?
      AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?
      AND u.status='Active' AND u.auth_version=s.user_auth_version
      AND u.credential_version=s.credential_version
      AND ((u.role_name='Administrator' AND s.role_auth_version IS NULL)
        OR (r.role_name IS NOT NULL AND r.status='Active'
          AND r.auth_version=s.role_auth_version))`)
    .bind(digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs).first();
  if(!row || typeof row.phone_key!=='string' || !PHONE.test(row.phone_key))
    return null;
  const role=roleMetadata(row);
  if(!role) return null;
  if(row.role_name!=='Administrator'){
    // Frozen RoleManagement.gs derives Allowed Modules *only* from
    // permissions[module].view === true. This is a fresh D1-role integrity
    // check at each source-shaped profile read, not an authorization grant.
    // The protected offline staff import validates the same source relation,
    // but later local role edits/drift must also fail closed at login.
    const visible=Object.entries(role.permissions)
      .filter(([,actions])=>actions.view===true)
      .map(([module])=>module);
    if(visible.length!==role.allowedModules.length ||
       visible.some(module=>!role.allowedModules.includes(module)))
      return null;
  }
  return {
    token,
    user:{id:row.user_id,name:row.full_name,mobile:row.phone_key,role:row.role_name},
    allowedModules:role.allowedModules,
    permissions:role.permissions,
  };
}

/**
 * Trusted server bootstrap. The phone normalizer MUST be server-owned,
 * e.g. source-reviewed M04 staff phone compatibility helper.
 */
export function createD1LegacyAuthRpc(db,{now=Date.now,normalizeMobile}={}){
  if(!db || typeof db.prepare!=='function' ||
     typeof now!=='function' || typeof normalizeMobile!=='function')
    throw new TypeError('Trusted M04 auth dependencies required');

  return Object.freeze({
    async login(mobile,password){
      let key;
      try { key=normalizeMobile(mobile); } catch { return failure(LOGIN_FAILED); }
      if(typeof key!=='string' || !PHONE.test(key) ||
         typeof password!=='string' || !password.length)
        return failure(LOGIN_FAILED);
      const time=now();
      const result=await loginWithD1(db,{phoneKey:key,password,nowMs:time});
      if(!result.authenticated)return failure(LOGIN_FAILED);
      const verified=await validateSessionWithD1(db,{token:result.token,nowMs:time});
      const profile=verified.authenticated
        ?await sourceProfile(db,result.token,time):null;
      if(!profile){
        await revokeSessionWithD1(db,{token:result.token,nowMs:time});
        return failure(ROLE_UNAVAILABLE);
      }
      return ok(profile);
    },
    async validateSession(token){
      const time=now();
      const verified=await validateSessionWithD1(db,{token,nowMs:time});
      if(!verified.authenticated)return failure(EXPIRED);
      const profile=await sourceProfile(db,token,time);
      return profile?ok(profile):failure(EXPIRED);
    },
    async logout(token){
      const time=now();
      await revokeSessionWithD1(db,{token,nowMs:time});
      return ok('logged out');
    },
  });
}
