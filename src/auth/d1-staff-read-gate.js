/**
 * M04 internal-only D1 authorization preflight for the two source-defined
 * read-only staff bootstrap methods. NOT a public RPC registry or a dispatch
 * mechanism. No client-supplied actor or permission map is consulted.
 *
 * IMPORTANT: This is NOT a write authorization boundary. Financial writes
 * require version-fenced/atomic D1 authorization at their SQL commit.
 */
import {AUTH_POLICY,validateSessionWithD1} from './d1-auth-core.js';
import {roleMetadata,tokenFingerprint} from './d1-legacy-rpc.js';

const READ_METHODS=Object.freeze(Object.assign(Object.create(null),{
  getUsersBootstrap:'users',
  getRolesBootstrap:'roles',
}));
const deny=()=>({authorized:false});

/**
 * Trusted server-only input: methodName must come from a fixed approved
 * read-only RPC mapping. Validate active bearer and authority directly in D1.
 */
export async function authorizeStaffReadWithD1(db,{token,methodName,nowMs}={}){
  if(typeof methodName!=='string' || !Object.hasOwn(READ_METHODS,methodName))
    return deny();
  if(!db || typeof db.prepare!=='function')
    throw new TypeError('Trusted D1 authentication storage required');
  const session=await validateSessionWithD1(db,{token,nowMs});
  if(!session.authenticated)return deny();
  const hash=await tokenFingerprint(token);
  if(!hash)return deny();

  // Recheck session, user and role epochs in the SAME SELECT as the stored
  // permission JSON. UI modules/permissions and browser actor fields cannot
  // substitute for this current server-side authority.
  const row=await db.prepare(`SELECT u.user_id,u.role_name,
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
    .bind(hash,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs).first();

  if(!row || row.user_id!==session.user.id ||
     row.role_name!==session.user.role)return deny();
  if(row.role_name!=='Administrator'){
    const role=roleMetadata(row);
    if(!role || !role.permissions)return deny();
    // Frozen source derives Allowed Modules solely from view===true grants.
    // Reject role metadata drift here too: staff bootstrap is an independent
    // authorization path and must not trust a permission JSON contradiction.
    const visible=Object.entries(role.permissions)
      .filter(([,actions])=>actions.view===true)
      .map(([module])=>module);
    if(visible.length!==role.allowedModules.length ||
       visible.some(module=>!role.allowedModules.includes(module)))
      return deny();
    const entry=Object.getOwnPropertyDescriptor(role.permissions,READ_METHODS[methodName])?.value;
    if(!entry || Object.getOwnPropertyDescriptor(entry,'view')?.value!==true)
      return deny();
  }
  return {authorized:true,actor:{id:row.user_id,role:row.role_name}};
}
