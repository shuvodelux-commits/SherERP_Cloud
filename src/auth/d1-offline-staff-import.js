/**
 * M04 INTERNAL OFFLINE-ONLY staff/role import into a clean, privately owned D1.
 * Not a Worker RPC, not a deployment command, and not a source data exporter.
 * Frozen Mohim_ERP IDs and legacy password verifiers remain separate.
 *
 * IMPORTANT: Original source Created By/At and Last Login provenance is not
 * represented by the current M04 schema. Do not authorize live import or
 * cutover until a reviewed provenance migration and export are approved.
 */
import {auditLegacyStaffRoleAuthority} from './source-role-permission-import-gate.js';
import {normalizeLegacyStaffPhoneSearch} from './staff-phone-identity.js';
import {AUTH_POLICY} from './d1-auth-core.js';

const USER_FIELDS=[
  'User ID','Full Name','Mobile Number','Password Hash','Password Salt','Role','Status',
];
const ROLE_FIELDS=[
  'Role ID','Role Name','Allowed Modules','Permissions','Status',
];
const HASH=/^[0-9a-f]{64}$/;
const SALT=/^[0-9a-f]{48}$/;
const error=message=>new Error(message);
const rejected=()=>error('Offline staff import rejected');
const unavailable=()=>error('Offline staff import unavailable');
const readbackUnavailable=()=>error('Offline staff import readback unavailable');
const recordIssue=(scope,row,code)=>({scope,row,code});

function requireD1(db,needsBatch=false){
  if(!db || typeof db.prepare!=='function' ||
     (needsBatch && typeof db.batch!=='function'))
    throw unavailable();
}

/** Capture only own data properties, never execute legacy/proxy getters. */
function captureRows(rows,fields){
  try {
    if(!Array.isArray(rows) || rows.length>10000)return null;
    const captured=[];
    for(let i=0;i<rows.length;i++){
      const at=Object.getOwnPropertyDescriptor(rows,String(i));
      if(!at || !Object.hasOwn(at,'value'))return null;
      const row=at.value;
      if(!row || typeof row!=='object' || Array.isArray(row))return null;
      const prototype=Object.getPrototypeOf(row);
      if(prototype!==Object.prototype && prototype!==null)return null;
      for(const key of Reflect.ownKeys(row)){
        if(typeof key!=='string')return null;
        const descriptor=Object.getOwnPropertyDescriptor(row,key);
        if(!descriptor || !Object.hasOwn(descriptor,'value'))return null;
      }
      const output=Object.create(null);
      for(const field of fields){
        const descriptor=Object.getOwnPropertyDescriptor(row,field);
        if(!descriptor || !Object.hasOwn(descriptor,'value'))return null;
        output[field]=descriptor.value;
      }
      captured.push(output);
    }
    return captured;
  } catch {
    return null;
  }
}

function captureVerifiedSnapshot({users,roles}={}){
  const capturedUsers=captureRows(users,USER_FIELDS);
  const capturedRoles=captureRows(roles,ROLE_FIELDS);
  if(!capturedUsers || !capturedRoles)throw rejected();
  const report=auditLegacyStaffRoleAuthority(capturedUsers,capturedRoles);
  if(!report.preflightPass)throw rejected();
  if(capturedRoles.some(row=>row['Role ID']!==row['Role ID'].trim() ||
     row['Role ID'].length>128))
    throw rejected();
  return {users:capturedUsers,roles:capturedRoles};
}

function requireCrypto(){
  if(typeof globalThis.crypto?.getRandomValues!=='function')throw unavailable();
  return globalThis.crypto;
}
function randomHex(length){
  const bytes=requireCrypto().getRandomValues(new Uint8Array(length));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

async function authCounts(db){
  const row=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM auth_roles) AS roles,
    (SELECT COUNT(*) FROM auth_users) AS users,
    (SELECT COUNT(*) FROM auth_legacy_credentials) AS legacyCredentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions,
    (SELECT COUNT(*) FROM auth_login_throttle) AS throttle`).first();
  if(!row || Object.values(row).some(n=>!Number.isSafeInteger(n)||n<0))
    throw readbackUnavailable();
  return row;
}

/**
 * Exact imported identity/RBAC/legacy verifier check, with only redacted
 * aggregate counts and stable issue codes in the returned report.
 * Execute immediately after import, BEFORE any first-login password upgrade.
 */
export async function reconcileLegacyStaffSnapshotWithD1(db,source){
  requireD1(db);
  const {users,roles}=captureVerifiedSnapshot(source);
  try {
    const counts=await authCounts(db),issues=[];
    if(counts.users!==users.length || counts.roles!==roles.length ||
       counts.legacyCredentials!==users.length || counts.sessions!==0 ||
       counts.throttle!==0)
      issues.push(recordIssue('snapshot',null,'AUTH_COUNTS_MISMATCH'));

    for(let i=0;i<roles.length;i++){
      const sourceRole=roles[i];
      const row=await db.prepare(`SELECT role_name,source_role_id,status,
        allowed_modules,permissions_json FROM auth_roles WHERE source_role_id=?`)
        .bind(sourceRole['Role ID']).first();
      if(!row ||
         row.source_role_id!==sourceRole['Role ID'] ||
         row.role_name!==sourceRole['Role Name'] ||
         row.status!==sourceRole.Status ||
         row.allowed_modules!==sourceRole['Allowed Modules'] ||
         row.permissions_json!==sourceRole.Permissions)
        issues.push(recordIssue('role',i,'ROLE_READBACK_MISMATCH'));
    }

    for(let i=0;i<users.length;i++){
      const sourceUser=users[i];
      const row=await db.prepare(`SELECT user_id,full_name,phone_key,role_name,status,
        credential_state,password_algo,password_hash,password_salt,password_iterations
        FROM auth_users WHERE user_id=?`)
        .bind(sourceUser['User ID']).first();
      const secret=await db.prepare(`SELECT legacy_hash,legacy_salt FROM
        auth_legacy_credentials WHERE user_id=?`)
        .bind(sourceUser['User ID']).first();
      const userMatch=!!row &&
        row.user_id===sourceUser['User ID'] &&
        row.full_name===sourceUser['Full Name'] &&
        row.phone_key===normalizeLegacyStaffPhoneSearch(sourceUser['Mobile Number']) &&
        row.role_name===sourceUser.Role &&
        row.status===sourceUser.Status &&
        row.credential_state==='LegacyPending' &&
        row.password_algo==='pbkdf2-sha256' &&
        Number(row.password_iterations)===AUTH_POLICY.passwordIterations &&
        typeof row.password_hash==='string' && HASH.test(row.password_hash) &&
        row.password_hash!==sourceUser['Password Hash'] &&
        typeof row.password_salt==='string' && SALT.test(row.password_salt) &&
        row.password_salt!==sourceUser['Password Salt'];
      if(!userMatch)
        issues.push(recordIssue('user',i,'USER_READBACK_MISMATCH'));
      if(!secret || secret.legacy_hash!==sourceUser['Password Hash'] ||
         secret.legacy_salt!==sourceUser['Password Salt'])
        issues.push(recordIssue('user',i,'LEGACY_VERIFIER_MISMATCH'));
    }
    return {
      match:issues.length===0,
      counts:{
        users:counts.users,roles:counts.roles,
        legacyCredentials:counts.legacyCredentials,
      },
      issues,
    };
  } catch {
    throw readbackUnavailable();
  }
}

/**
 * One-shot offline rehearsal for a clean D1, called by an offline trusted
 * process. No caller-controlled SQL identifiers and no separate per-row
 * commits; D1.batch gives all-or-nothing inserts on the same database.
 */
export async function importLegacyStaffSnapshotWithD1(db,source){
  requireD1(db,true);
  const {users,roles}=captureVerifiedSnapshot(source);
  try {
    const counts=await authCounts(db);
    if(Object.values(counts).some(n=>n!==0))
      throw error('Offline staff import store not empty');

    const statements=[];
    for(const role of roles){
      statements.push(db.prepare(`INSERT INTO auth_roles
        (role_name,source_role_id,status,allowed_modules,permissions_json)
        VALUES (?,?,?,?,?)`).bind(
        role['Role Name'],role['Role ID'],role.Status,
        role['Allowed Modules'],role.Permissions
      ));
    }
    for(const user of users){
      // Random placeholders cannot be verified from the source's weak hash:
      // their PBKDF2 output and salt are unrelated to any source password.
      const placeholderHash=randomHex(32);
      const placeholderSalt=randomHex(24);
      statements.push(db.prepare(`INSERT INTO auth_users
        (user_id,full_name,phone_key,role_name,status,credential_state,
         password_algo,password_hash,password_salt,password_iterations)
        VALUES (?,?,?,?,?,'LegacyPending','pbkdf2-sha256',?,?,?)`).bind(
        user['User ID'],user['Full Name'],
        normalizeLegacyStaffPhoneSearch(user['Mobile Number']),
        user.Role,user.Status,
        placeholderHash,placeholderSalt,AUTH_POLICY.passwordIterations
      ));
      statements.push(db.prepare(`INSERT INTO auth_legacy_credentials
        (user_id,legacy_hash,legacy_salt) VALUES (?,?,?)`).bind(
        user['User ID'],user['Password Hash'],user['Password Salt']
      ));
    }

    const results=await db.batch(statements);
    if(!Array.isArray(results) || results.length!==statements.length ||
       results.some(x=>x?.success===false || x?.meta?.changes!==1))
      throw error('Offline staff import batch result invalid');
  } catch (err) {
    if(err?.message==='Offline staff import store not empty')throw err;
    // Database errors and SQL statements may contain sensitive values:
    // do not reflect backend messages to any caller.
    throw error('Offline staff import rejected');
  }

  const proof=await reconcileLegacyStaffSnapshotWithD1(db,source);
  if(!proof.match)throw error('Offline staff import reconciliation failed');
  return {imported:true,counts:proof.counts,readbackMatch:true};
}
