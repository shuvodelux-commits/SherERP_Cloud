/**
 * Internal-only M04 audit of complete, owner-approved legacy USERS / ROLES
 * export snapshots. This module never performs an import or authenticates.
 *
 * Only fixed issue codes and counts leave this function. Neither credentials
 * nor names, phones, role metadata or source IDs are returned or logged.
 * SESSIONS bearer tokens are intentionally out of scope.
 */
import {normalizeLegacyStaffPhoneSearch} from './staff-phone-identity.js';

const STAFF_PHONE_KEY=/^01[3-9][0-9]{8}$/;
const SHA256_HEX=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_FIELDS=[
  'User ID','Full Name','Mobile Number','Password Hash','Password Salt',
  'Role','Status',
];
const ROLE_FIELDS=[
  'Role ID','Role Name','Allowed Modules','Permissions','Status',
];
// The standalone structural audit is used before the full protected
// provenance importer. Its only optional fields are approved frozen source
// provenance, never arbitrary export extensions or hidden secret columns.
const USER_ALLOWED_FIELDS=new Set([
  ...USER_FIELDS,'Created By','Created At','Last Login',
]);
const ROLE_ALLOWED_FIELDS=new Set([...ROLE_FIELDS,'Created At']);
const filled=value=>typeof value==='string' && value.trim().length>0;
const validStatus=value=>value==='Active' || value==='Inactive';
const validMobile=value=>filled(value) ||
  (typeof value==='number' && Number.isSafeInteger(value) && value>0);

function extractOwnData(row, requiredFields, allowedFields) {
  // Only ordinary JSON/snapshot rows are accepted. Never execute accessors
  // or inherit data; a malicious Proxy fails closed as a malformed record.
  if (!row || typeof row!=='object' || Array.isArray(row)) return null;
  try {
    const prototype=Object.getPrototypeOf(row);
    if (prototype!==Object.prototype && prototype!==null) return null;
    for(const key of Reflect.ownKeys(row)) {
      // Reject unknown, symbol and nonenumerable fields without reading them.
      // The later D1 import already requires the exact protected schema.
      if(typeof key!=='string' || !allowedFields.has(key))return null;
      const descriptor=Object.getOwnPropertyDescriptor(row,key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value'))
        return null;
    }
    const values=Object.create(null);
    for(const field of requiredFields){
      const descriptor=Object.getOwnPropertyDescriptor(row,field);
      if (!descriptor || !Object.hasOwn(descriptor,'value')) return null;
      values[field]=descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function sheetRow(rows,index,fields,allowedFields) {
  try {
    const descriptor=Object.getOwnPropertyDescriptor(rows,String(index));
    if (!descriptor || !Object.hasOwn(descriptor,'value')) return null;
    return extractOwnData(descriptor.value,fields,allowedFields);
  } catch {
    return null;
  }
}

function validPermissions(raw) {
  if(typeof raw!=='string') return false;
  try {
    const parsed=JSON.parse(raw);
    return !!parsed && typeof parsed==='object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const addIssue=(issues,scope,row,code)=>{
  // Never add raw source objects or attacker-controlled error text here.
  issues.push({scope,row,code});
};

/**
 * @param {unknown} users Complete (successfully exported) USERS rows.
 * @param {unknown} roles Complete (successfully exported) ROLES rows.
 * @returns {{preflightPass:boolean,counts:object,issues:object[]}}
 */
export function auditLegacyStaffImport(users,roles) {
  const invalidSnapshot={
    preflightPass:false,
    counts:{users:0,roles:0,activeAdministrators:0},
    issues:[{scope:'snapshot',row:null,code:'SNAPSHOT_INVALID'}],
  };
  if(!Array.isArray(users) || !Array.isArray(roles)) return invalidSnapshot;

  let userCount,roleCount;
  try {
    userCount=users.length;
    roleCount=roles.length;
    if(!Number.isSafeInteger(userCount) || userCount<0 ||
       !Number.isSafeInteger(roleCount) || roleCount<0)
      return invalidSnapshot;
  } catch {
    return invalidSnapshot;
  }

  const counts={users:userCount,roles:roleCount,activeAdministrators:0};
  const issues=[];
  const usedRoleIds=new Set(),usedRoleNames=new Set();
  const usedUserIds=new Set(),usedStaffPhones=new Set();
  const availableRoles=new Map();

  // Build an exact source-name lookup, but detect case-folded conflicts for
  // operator review. Administrator is built in: it has no ROLES row.
  for(let i=0;i<roleCount;i++){
    const row=sheetRow(roles,i,ROLE_FIELDS,ROLE_ALLOWED_FIELDS);
    if(!row){
      addIssue(issues,'role',i,'ROW_MALFORMED');
      continue;
    }
    const id=row['Role ID'];
    const name=row['Role Name'];
    const status=row.Status;

    if(!filled(id)) addIssue(issues,'role',i,'ROLE_ID_INVALID');
    else if(usedRoleIds.has(id)) addIssue(issues,'role',i,'ROLE_ID_DUPLICATE');
    else usedRoleIds.add(id);

    if(!filled(name)) addIssue(issues,'role',i,'ROLE_NAME_INVALID');
    else {
      const folded=name.trim().toLowerCase();
      if(folded==='administrator') addIssue(issues,'role',i,'ROLE_NAME_RESERVED');
      if(usedRoleNames.has(folded)) addIssue(issues,'role',i,'ROLE_NAME_DUPLICATE');
      else usedRoleNames.add(folded);
      if(!availableRoles.has(name)) availableRoles.set(name,status);
    }
    if(!validStatus(status)) addIssue(issues,'role',i,'ROLE_STATUS_INVALID');
    if(typeof row['Allowed Modules']!=='string')
      addIssue(issues,'role',i,'ROLE_ALLOWED_MODULES_INVALID');
    if(!validPermissions(row.Permissions))
      addIssue(issues,'role',i,'ROLE_PERMISSIONS_INVALID');
  }

  for(let i=0;i<userCount;i++){
    const row=sheetRow(users,i,USER_FIELDS,USER_ALLOWED_FIELDS);
    if(!row){
      addIssue(issues,'user',i,'ROW_MALFORMED');
      continue;
    }
    const id=row['User ID'];
    const assignedRole=row.Role;
    const status=row.Status;

    if(!filled(id)) addIssue(issues,'user',i,'USER_ID_INVALID');
    else if(usedUserIds.has(id)) addIssue(issues,'user',i,'USER_ID_DUPLICATE');
    else usedUserIds.add(id);

    if(!filled(row['Full Name'])) addIssue(issues,'user',i,'USER_NAME_INVALID');
    const phone=row['Mobile Number'];
    if(!validMobile(phone)) {
      addIssue(issues,'user',i,'USER_MOBILE_INVALID');
    } else {
      // Preserve source identity; imported D1 login keys must be unambiguous.
      // Do not select a winner, modify source rows, or reveal phone values.
      const key=normalizeLegacyStaffPhoneSearch(phone);
      if(!STAFF_PHONE_KEY.test(key))
        addIssue(issues,'user',i,'USER_MOBILE_UNSUPPORTED');
      else if(usedStaffPhones.has(key))
        addIssue(issues,'user',i,'USER_MOBILE_DUPLICATE');
      else usedStaffPhones.add(key);
    }
    if(!validStatus(status)) addIssue(issues,'user',i,'USER_STATUS_INVALID');
    if(typeof row['Password Hash']!=='string' ||
       !SHA256_HEX.test(row['Password Hash']) ||
       typeof row['Password Salt']!=='string' ||
       !UUID.test(row['Password Salt']))
      addIssue(issues,'user',i,'USER_CREDENTIAL_INVALID');

    if(!filled(assignedRole)) {
      addIssue(issues,'user',i,'USER_ROLE_INVALID');
      continue;
    }
    if(assignedRole==='Administrator'){
      if(status==='Active') counts.activeAdministrators++;
    } else {
      if(!availableRoles.has(assignedRole))
        addIssue(issues,'user',i,'USER_ROLE_MISSING');
      else if(status==='Active' && availableRoles.get(assignedRole)!=='Active')
        addIssue(issues,'user',i,'USER_ROLE_INACTIVE');
    }
  }

  if(counts.activeAdministrators===0)
    addIssue(issues,'snapshot',null,'ACTIVE_ADMIN_REQUIRED');

  return {preflightPass:issues.length===0,counts,issues};
}
