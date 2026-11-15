/**
 * M04 internal, NONBINDING users.edit RBAC eligibility preview.
 *
 * Frozen UserManagement.gs requires users.edit for updateUser,
 * resetPassword, and setUserStatus. This is not a write boundary:
 * actual account/password changes need atomic current-authority checks,
 * target-specific Administrator controls and session revocation.
 * NOT wired to the public Worker RPC registry.
 */
import {AUTH_POLICY,validateSessionWithD1} from './d1-auth-core.js';
import {roleMetadata,tokenFingerprint} from './d1-legacy-rpc.js';

const USER_EDIT_METHODS=new Set([
  'updateUser','resetPassword','setUserStatus',
]);
const deny=()=>({eligible:false});

/** Trusted server-only read-time eligibility, never commit-time authority. */
export async function previewUsersEditWithD1(db,{token,methodName,nowMs}={}){
  if(typeof methodName!=='string' || !USER_EDIT_METHODS.has(methodName))
    return deny();
  if(!db || typeof db.prepare!=='function')
    throw new TypeError('Trusted D1 authentication storage required');

  const session=await validateSessionWithD1(db,{token,nowMs});
  if(!session.authenticated)return deny();
  const hash=await tokenFingerprint(token);
  if(!hash)return deny();

  // Cross-check the active actor, session and role authority versions against
  // persisted D1, not submitted UI claims or any caller-provided target.
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
    const rights=Object.getOwnPropertyDescriptor(role.permissions,'users')?.value;
    if(!rights || Object.getOwnPropertyDescriptor(rights,'edit')?.value!==true)
      return deny();
  }
  return {eligible:true,actor:{id:row.user_id,role:row.role_name}};
}
