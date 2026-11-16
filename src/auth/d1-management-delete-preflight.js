/**
 * M04 internal, NONBINDING management-delete RBAC preview.
 *
 * Frozen Auth.gs::requireManagementDeletePermission_ checks the 'users' or
 * 'roles' delete grant, but real deleteUser/deleteRole also require target-
 * specific rules and atomic D1 writes. This function authorizes NOTHING:
 * a true "eligible" result must never trigger a mutation directly.
 * It is NOT registered as a public Worker RPC.
 */
import {AUTH_POLICY,validateSessionWithD1} from './d1-auth-core.js';
import {roleMetadata,roleNavigationConsistent,tokenFingerprint} from './d1-legacy-rpc.js';

const DELETE_METHODS=Object.freeze(Object.assign(Object.create(null),{
  deleteUser:'users',
  deleteRole:'roles',
}));
const deny=()=>({eligible:false});

/**
 * Trusted server-side only; no caller-provided actor, permissions or target.
 * Rechecks persisted D1 session epochs and current role metadata.
 */
export async function previewManagementDeleteWithD1(db,{token,methodName,nowMs}={}){
  if(typeof methodName!=='string' || !Object.hasOwn(DELETE_METHODS,methodName))
    return deny();
  if(!db || typeof db.prepare!=='function')
    throw new TypeError('Trusted D1 authentication storage required');

  const session=await validateSessionWithD1(db,{token,nowMs});
  if(!session.authenticated)return deny();
  const hash=await tokenFingerprint(token);
  if(!hash)return deny();

  // Permission and actor authority are read from the SAME current D1
  // snapshot, not from client metadata, a submitted staff ID or UI nav.
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
    const rights=Object.getOwnPropertyDescriptor(
      role.permissions,DELETE_METHODS[methodName])?.value;
    if(!rights || Object.getOwnPropertyDescriptor(rights,'delete')?.value!==true)
      return deny();
  }
  return {eligible:true,actor:{id:row.user_id,role:row.role_name}};
}
