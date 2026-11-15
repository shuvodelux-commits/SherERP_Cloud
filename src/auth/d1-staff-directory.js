/**
 * M04 internal read-only PARTIAL projection of the frozen Users bootstrap.
 *
 * The local auth schema has no Created By / Created At / Last Login columns.
 * This is NOT a full getUsersBootstrap implementation, an RPC handler, or a
 * production data contract. Public auth/Users management remains disabled.
 */
import {authorizeStaffReadWithD1} from './d1-staff-read-gate.js';

const denied=()=>({authorized:false});

/**
 * Read only approved staff-directory fields after a fresh D1 users.view check.
 * No row-wide SELECT and no stored credential/authority metadata in results.
 * The final recheck reduces but cannot eliminate non-transactional read races.
 */
export async function readStaffDirectoryPreviewWithD1(db,{token,nowMs}={}){
  const first=await authorizeStaffReadWithD1(db,{
    token,nowMs,methodName:'getUsersBootstrap',
  });
  if(!first.authorized)return denied();

  // Enumerate every user, including inactive staff, matching the frozen
  // Users screen's listing. Only five reconciled fields exist in this
  // NONDEPLOYABLE local auth schema; never silently fill missing source data.
  const users=await db.prepare(`SELECT
    user_id AS id,full_name AS name,phone_key AS mobile,
    role_name AS role,status FROM auth_users
    ORDER BY user_id COLLATE BINARY`).all();
  const roles=await db.prepare(`SELECT role_name AS name FROM auth_roles
    WHERE status='Active' ORDER BY role_name COLLATE BINARY`).all();

  // Fail closed if the active actor's D1 permission/role/session changed
  // while reading. No browser actor, role or permissions are accepted.
  const again=await authorizeStaffReadWithD1(db,{
    token,nowMs,methodName:'getUsersBootstrap',
  });
  if(!again.authorized || again.actor.id!==first.actor.id ||
    again.actor.role!==first.actor.role)return denied();
  return {
    authorized:true,
    partial:true,
    users:users.results.map(({id,name,mobile,role,status})=>({id,name,mobile,role,status})),
    roles:roles.results.map(({name})=>({name})),
  };
}
