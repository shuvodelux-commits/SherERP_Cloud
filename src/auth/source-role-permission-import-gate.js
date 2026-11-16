/**
 * M04 offline-only source ROLES authority gate.
 *
 * Called after obtaining a trusted complete USERS/ROLES export, BEFORE any
 * private D1 import. No SQL, RPC, filesystem/network, secrets or raw-row
 * output. Does not grant any staff authority or replace an approved importer.
 */
import {auditLegacyStaffImport} from './staff-import-audit.js';
import {roleMetadata} from './d1-legacy-rpc.js';

const issue=(row,code)=>({scope:'role',row,code});

function ownRoleFields(rows,index){
  try{
    const entry=Object.getOwnPropertyDescriptor(rows,String(index));
    if(!entry || !Object.hasOwn(entry,'value'))return null;
    const row=entry.value;
    if(!row || typeof row!=='object' || Array.isArray(row))return null;
    const names=['Role Name','Allowed Modules','Permissions'];
    const data=Object.create(null);
    for(const key of names){
      const descriptor=Object.getOwnPropertyDescriptor(row,key);
      if(!descriptor || !Object.hasOwn(descriptor,'value'))return null;
      data[key]=descriptor.value;
    }
    return data;
  }catch{
    // A source snapshot must not run getters or expose Proxy error text.
    return null;
  }
}

/**
 * Produces only fixed codes, safe row indices and structural counts.
 * A pass is an IMPORT PREFLIGHT, never permission to write D1 or enable RPC.
 */
export function auditLegacyStaffRoleAuthority(users,roles){
  const structural=auditLegacyStaffImport(users,roles);
  if(!structural.preflightPass)return structural;

  const issues=[];
  for(let i=0;i<roles.length;i++){
    const row=ownRoleFields(roles,i);
    if(!row){
      issues.push(issue(i,'ROLE_PERMISSION_SCHEMA_INVALID'));
      continue;
    }
    const name=row['Role Name'];
    if(typeof name!=='string' || name!==name.trim() || name.length>100){
      issues.push(issue(i,'ROLE_NAME_NOT_CANONICAL'));
      continue;
    }
    // Existing source-shaped M04 parser rejects unsupported modules, grant
    // types, duplicate modules and invalid delete/backdate windows.
    const reviewed=roleMetadata({
      role_name:name,
      allowed_modules:row['Allowed Modules'],
      permissions_json:row.Permissions,
    });
    if(!reviewed){
      issues.push(issue(i,'ROLE_PERMISSION_SCHEMA_INVALID'));
      continue;
    }
    // Frozen RoleManagement.gs derives Allowed Modules from view===true.
    // Other grants (add/edit/delete) must not fabricate a visible module.
    const visible=Object.entries(reviewed.permissions)
      .filter(([,actions])=>actions.view===true)
      .map(([module])=>module);
    const actual=reviewed.allowedModules;
    if(visible.length!==actual.length ||
       visible.some(module=>!actual.includes(module))){
      issues.push(issue(i,'ROLE_ALLOWED_MODULES_MISMATCH'));
    }
  }
  return {
    preflightPass:issues.length===0,
    counts:structural.counts,
    issues,
  };
}
