/**
 * M04 internal PARTIAL staff Roles directory preview (read-only).
 *
 * The frozen RoleManagement.gs::getRolesBootstrap also includes source role
 * IDs, Created At and full Permissions. Verified source ID/time and strict
 * display-only module names are projected; this stays PARTIAL, not public RPC.
 */
import {authorizeStaffReadWithD1} from './d1-staff-read-gate.js';
import {roleBootstrapOptions} from '../modules/auth/permission-policy.js';
import {roleMetadata,roleNavigationConsistent} from './d1-legacy-rpc.js';

const deny=()=>({authorized:false});

/**
 * Return role name/status and both stored source provenance fields, only
 * when complete, for an authorized roles.view session. Not Unified Party roles.
 */
export async function readRoleDirectoryPreviewWithD1(db,{token,nowMs}={}){
  const first=await authorizeStaffReadWithD1(db,{
    token,nowMs,methodName:'getRolesBootstrap',
  });
  if(!first.authorized)return deny();

  // List inactive roles too, as the source getRolesBootstrap reads all ROLES.
  // Validate stored module metadata, but do not return action grants or epochs.
  const result=await db.prepare(`SELECT role_name AS name,status,
      source_role_id AS sourceRoleId,source_created_at_iso AS sourceCreatedAt,
      allowed_modules,permissions_json
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
    roles:result.results.map(({name,status,sourceRoleId,sourceCreatedAt,
      allowed_modules,permissions_json})=>{
      const base={name,status};
      if(typeof sourceRoleId!=='string' || typeof sourceCreatedAt!=='string')
        return base;
      const source={...base,sourceRoleId,sourceCreatedAt};
      const reviewed=roleMetadata({role_name:name,allowed_modules,permissions_json});
      return reviewed && roleNavigationConsistent(reviewed)
        ? {...source,allowedModules:[...reviewed.allowedModules]}
        : source;
    }),
    ...roleBootstrapOptions(),
  };
}
