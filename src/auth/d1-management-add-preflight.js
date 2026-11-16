/**
 * M04 internal, NONBINDING management-add RBAC eligibility preview.
 *
 * Frozen UserManagement.gs::createUser requires users.add;
 * RoleManagement.gs::addRole requires roles.add. This does not create staff
 * or roles and is NEVER a permission to execute a write. Future handlers
 * must enforce target/role restrictions and authority atomically at commit.
 * NOT registered in the public Worker RPC allowlist.
 */
import {AUTH_POLICY,validateSessionWithD1} from './d1-auth-core.js';
import {roleMetadata,roleNavigationConsistent,tokenFingerprint} from './d1-legacy-rpc.js';

const ADD_METHODS=Object.freeze(Object.assign(Object.create(null),{
  createUser:'users',
  addRole:'roles',
}));
const deny=()=>({eligible:false});

/** Trusted server-side D1 eligibility check; never use client actor claims. */
export async function previewManagementAddWithD1(db,{token,methodName,nowMs}={}){
  if(typeof methodName!=='string' || !Object.hasOwn(ADD_METHODS,methodName))
    return deny();
  if(!db || typeof db.prepare!=='function')
    throw new TypeError('Trusted D1 authentication storage required');

  const session=await validateSessionWithD1(db,{token,nowMs});
  if(!session.authenticated)return deny();
  const hash=await tokenFingerprint(token);
  if(!hash)return deny();

  // Current active actor and role authority epochs come from persisted D1.
  // Display modules or browser claims cannot substitute for live rights.
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
    if(!role || !role.permissions || !roleNavigationConsistent(role))return deny();
    const rights=Object.getOwnPropertyDescriptor(role.permissions,ADD_METHODS[methodName])?.value;
    if(!rights || Object.getOwnPropertyDescriptor(rights,'add')?.value!==true)
      return deny();
  }
  return {eligible:true,actor:{id:row.user_id,role:row.role_name}};
}
