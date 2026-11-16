/**
 * M04 historical source provenance preflight, strictly offline and read-only.
 * Preserves source field values; it does not fabricate timestamps, link
 * Created By to an actor ID, or authorize D1 writes / public authentication.
 * A protected JSON exporter must serialize source Sheet Dates to canonical UTC
 * ISO strings (with milliseconds); never infer from the import execution time.
 */
import {auditLegacyStaffRoleAuthority} from './source-role-permission-import-gate.js';

const UTC_ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const invalidSnapshot=()=>({
  preflightPass:false,
  counts:{users:0,roles:0,activeAdministrators:0},
  issues:[{scope:'snapshot',row:null,code:'SNAPSHOT_INVALID'}],
});
const issue=(scope,row,code)=>({scope,row,code});
function canonicalUtcDate(value){
  if(typeof value!=='string' || !UTC_ISO.test(value))return false;
  const n=Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString()===value;
}
function propertyValue(row,key){
  try{
    if(!row || typeof row!=='object' || Array.isArray(row))
      return {safe:false};
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    if(!descriptor)return {safe:true,value:undefined};
    if(!Object.hasOwn(descriptor,'value'))return {safe:false};
    return {safe:true,value:descriptor.value};
  }catch{
    return {safe:false};
  }
}
function readSnapshot(source){
  try{
    if(!source || typeof source!=='object' || Array.isArray(source))return null;
    const u=Object.getOwnPropertyDescriptor(source,'users');
    const r=Object.getOwnPropertyDescriptor(source,'roles');
    if(!u || !r || !Object.hasOwn(u,'value') || !Object.hasOwn(r,'value'))
      return null;
    return {users:u.value,roles:r.value};
  }catch{
    return null;
  }
}

/** Counts and fixed codes only; source actor/time/identity values never leave. */
export function auditLegacyStaffProvenance(snapshot){
  const source=readSnapshot(snapshot);
  if(!source)return invalidSnapshot();
  let baseline;
  try{
    baseline=auditLegacyStaffRoleAuthority(source.users,source.roles);
  }catch{
    return invalidSnapshot();
  }
  if(!baseline.preflightPass)return baseline;

  const issues=[];
  for(let i=0;i<source.users.length;i++){
    const row=source.users[i];
    const createdBy=propertyValue(row,'Created By');
    const createdAt=propertyValue(row,'Created At');
    const lastLogin=propertyValue(row,'Last Login');
    if(!createdBy.safe || !createdAt.safe || !lastLogin.safe){
      issues.push(issue('user',i,'USER_PROVENANCE_MALFORMED'));
      continue;
    }
    if(typeof createdBy.value!=='string' || !createdBy.value.trim())
      issues.push(issue('user',i,'USER_CREATED_BY_MISSING'));
    if(!canonicalUtcDate(createdAt.value))
      issues.push(issue('user',i,'USER_CREATED_AT_INVALID'));
    if(lastLogin.value!=='' && !canonicalUtcDate(lastLogin.value))
      issues.push(issue('user',i,'USER_LAST_LOGIN_INVALID'));
  }
  for(let i=0;i<source.roles.length;i++){
    const created=propertyValue(source.roles[i],'Created At');
    if(!created.safe){
      issues.push(issue('role',i,'ROLE_PROVENANCE_MALFORMED'));
    }else if(!canonicalUtcDate(created.value)){
      issues.push(issue('role',i,'ROLE_CREATED_AT_INVALID'));
    }
  }
  return {preflightPass:issues.length===0,counts:baseline.counts,issues};
}
