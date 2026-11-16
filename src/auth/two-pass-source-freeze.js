/**
 * M04 internal read-only two-pass source freeze audit.
 *
 * Two caller-supplied protected, complete source snapshots must both pass
 * strict historical staff/role validation and be byte-for-byte equivalent
 * in their original source FIELD VALUES (not JSON object serialization).
 * This proves only consistency of the supplied values; it cannot attest
 * that exports were independently captured or authorize live-data cutover.
 *
 * No network, filesystem, SQL, D1, logs, authentication or public RPC.
 * Report contains only fixed issue codes, safe row indices and counts.
 */
import {auditLegacyStaffProvenance} from './staff-provenance-preflight.js';

const USER_FIELDS=[
  'User ID','Full Name','Mobile Number','Password Hash','Password Salt',
  'Role','Status','Created By','Created At','Last Login',
];
const ROLE_FIELDS=[
  'Role ID','Role Name','Allowed Modules','Permissions','Status','Created At',
];
const issue=(scope,row,code)=>({scope,row,code});
const invalid=()=>({
  freezeMatch:false,
  counts:{users:0,roles:0},
  issues:[issue('snapshot',null,'SOURCE_PREFLIGHT_FAILED')],
});

function sourceArrays(snapshot){
  try{
    if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot))
      return null;
    const user=Object.getOwnPropertyDescriptor(snapshot,'users');
    const role=Object.getOwnPropertyDescriptor(snapshot,'roles');
    if(!user || !role || !Object.hasOwn(user,'value') ||
       !Object.hasOwn(role,'value') ||
       !Array.isArray(user.value) || !Array.isArray(role.value))
      return null;
    return {users:user.value,roles:role.value};
  }catch{
    return null;
  }
}

function ownValue(row,key){
  try{
    if(!row || typeof row!=='object' || Array.isArray(row))
      return {safe:false};
    const proto=Object.getPrototypeOf(row);
    if(proto!==Object.prototype && proto!==null)
      return {safe:false};
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    if(!descriptor || !Object.hasOwn(descriptor,'value'))
      return {safe:false};
    return {safe:true,value:descriptor.value};
  }catch{
    return {safe:false};
  }
}

function ownRow(rows,index){
  try{
    const descriptor=Object.getOwnPropertyDescriptor(rows,String(index));
    return descriptor && Object.hasOwn(descriptor,'value')
      ? descriptor.value : null;
  }catch{
    return null;
  }
}

function differentRows(first,second,fields,index){
  const a=ownRow(first,index),b=ownRow(second,index);
  for(const field of fields){
    const av=ownValue(a,field),bv=ownValue(b,field);
    if(!av.safe || !bv.safe || !Object.is(av.value,bv.value))
      return true;
  }
  return false;
}

/**
 * Strict consistency check for two independently obtained trusted source
 * snapshots. The calling operator, not this helper, must ensure that two
 * protected reads actually occurred and that exports are securely handled.
 */
export function auditStableLegacyStaffFreeze(first,confirmation){
  if(first===confirmation)return invalid();
  const a=sourceArrays(first),b=sourceArrays(confirmation);
  if(!a || !b)return invalid();
  try{
    const firstAudit=auditLegacyStaffProvenance(first);
    const secondAudit=auditLegacyStaffProvenance(confirmation);
    if(!firstAudit.preflightPass || !secondAudit.preflightPass)
      return invalid();

    const counts={users:a.users.length,roles:a.roles.length},issues=[];
    if(a.users.length!==b.users.length)
      issues.push(issue('snapshot',null,'USERS_COUNT_CHANGED'));
    if(a.roles.length!==b.roles.length)
      issues.push(issue('snapshot',null,'ROLES_COUNT_CHANGED'));
    if(issues.length)return {freezeMatch:false,counts,issues};

    for(let i=0;i<a.users.length;i++)
      if(differentRows(a.users,b.users,USER_FIELDS,i))
        issues.push(issue('user',i,'USER_SOURCE_CHANGED'));
    for(let i=0;i<a.roles.length;i++)
      if(differentRows(a.roles,b.roles,ROLE_FIELDS,i))
        issues.push(issue('role',i,'ROLE_SOURCE_CHANGED'));
    return {freezeMatch:issues.length===0,counts,issues};
  }catch{
    return invalid();
  }
}
