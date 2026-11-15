/**
 * M04 internal PARTIAL staff Roles directory preview (read-only).
 *
 * The frozen RoleManagement.gs::getRolesBootstrap also includes source role
 * IDs, Created At, full Permissions and labeled UI options. These are NOT
 * represented/reconciled by this M04 local schema; no public RPC may use it.
 */
import {authorizeStaffReadWithD1} from './d1-staff-read-gate.js';
import {roleBootstrapOptions} from '../modules/auth/permission-policy.js';

const deny=()=>({authorized:false});

/**
 * Return only source-known role name/status for a currently authorized
 * roles.view session. Staff role names never represent Unified Party roles.
 */
export async function readRoleDirectoryPreviewWithD1(db,{token,nowMs}={}){
  const first=await authorizeStaffReadWithD1(db,{
    token,nowMs,methodName:'getRolesBootstrap',
  });
  if(!first.authorized)return deny();

  // List inactive roles too, as the source getRolesBootstrap reads all ROLES.
  // Avoid returning permission configuration, authority epochs or credentials.
  const result=await db.prepare(`SELECT role_name AS name,status
    FROM auth_roles ORDER BY role_name COLLATE BINARY`).all();

  // D1 authorization recheck after the read; no client identity or role claims.
  const again=await authorizeStaffReadWithD1(db,{
    token,nowMs,methodName:'getRolesBootstrap',
  });
  if(!again.authorized || again.actor.id!==first.actor.id ||
     again.actor.role!==first.actor.role)return deny();
  return {
    authorized:true,
    partial:true,
    roles:result.results.map(({name,status})=>({name,status})),
    ...roleBootstrapOptions(),
  };
}
