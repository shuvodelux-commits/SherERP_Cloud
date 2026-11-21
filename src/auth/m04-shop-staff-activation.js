/**
 * M04 INTERNAL-ONLY first-login staff activation contract (issue #867).
 * Not routed, not a public invite API and not a hosted Shop D1 migration.
 * M03 must authorize Owner/Shop scope and adopt a reviewed schema separately.
 *
 * Manager = currently authenticated intrinsic Shop Administrator, NOT a
 * browser-provided role/Owner claim. Staff receives one 256-bit bearer for
 * offline delivery and sets their own password with the existing PBKDF2 core.
 */
import {AUTH_POLICY,createOfflinePasswordCredential} from './d1-auth-core.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {canonicalStaffLoginPhone,requestValues,trustedShop}
  from './m04-shop-staff-session-scope.js';

const TOKEN=/^[0-9a-f]{64}$/;
const ROLE=/^[^\u0000-\u001f\u007f]{1,80}$/u;
const NAME=/^[^\u0000-\u001f\u007f]{1,120}$/u;
const INVITATION_LIFETIME_MS=15*60_000;
const issueDenied=()=>({issued:false});
const activateDenied=()=>({activated:false});

const currentAdmin=[
  'FROM auth_sessions s JOIN auth_users admin ON admin.user_id=s.user_id',
  'WHERE s.token_hash=? AND s.revoked_at_ms IS NULL',
  'AND s.created_at_ms<=? AND s.expires_at_ms>?',
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?',
  "AND admin.role_name='Administrator' AND admin.status='Active'",
  'AND admin.credential_state='+"'Modern'"+'',
  'AND admin.auth_version=s.user_auth_version',
  'AND admin.credential_version=s.credential_version',
  'AND s.role_auth_version IS NULL'
].join(' ');

const currentAdminArgs=(tokenHash,nowMs)=>[
  tokenHash,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
];

const checkAdminAndRole=[
  'SELECT 1',currentAdmin,
  "AND EXISTS(SELECT 1 FROM auth_roles r WHERE r.role_name=? AND r.status='Active')"
].join(' ');

const insertPending=[
  'INSERT INTO auth_users',
  '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)',
  "SELECT ?,?,?,?,'Inactive',?,?,?",
  'FROM auth_sessions s',
  'JOIN auth_users admin ON admin.user_id=s.user_id',
  "JOIN auth_roles role ON role.role_name=? AND role.status='Active'",
  'WHERE s.token_hash=? AND s.revoked_at_ms IS NULL',
  'AND s.created_at_ms<=? AND s.expires_at_ms>?',
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?',
  "AND admin.role_name='Administrator' AND admin.status='Active'",
  "AND admin.credential_state='Modern'",
  'AND admin.auth_version=s.user_auth_version',
  'AND admin.credential_version=s.credential_version',
  'AND s.role_auth_version IS NULL'
].join(' ');

const insertTicket=[
  'INSERT INTO auth_staff_activation_tickets',
  '(token_hash,shop_id,user_id,issuer_user_id,issuer_auth_version,',
  'target_auth_version,target_credential_version,role_name,role_auth_version,',
  'issued_at_ms,expires_at_ms)',
  'SELECT ?,?,target.user_id,admin.user_id,admin.auth_version,',
  'target.auth_version,target.credential_version,target.role_name,role.auth_version,?,?',
  'FROM auth_users target',
  "JOIN auth_roles role ON role.role_name=target.role_name AND role.status='Active'",
  'JOIN auth_sessions s ON s.token_hash=?',
  'JOIN auth_users admin ON admin.user_id=s.user_id',
  "WHERE target.user_id=? AND target.status='Inactive'",
  'AND s.revoked_at_ms IS NULL',
  'AND s.created_at_ms<=? AND s.expires_at_ms>?',
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?',
  "AND admin.role_name='Administrator' AND admin.status='Active'",
  "AND admin.credential_state='Modern'",
  'AND admin.auth_version=s.user_auth_version',
  'AND admin.credential_version=s.credential_version',
  'AND s.role_auth_version IS NULL'
].join(' ');

const currentTicket=[
  'SELECT 1 FROM auth_users target',
  'JOIN auth_roles role ON role.role_name=target.role_name',
  'JOIN auth_users issuer ON issuer.user_id=t.issuer_user_id',
  'WHERE target.user_id=t.user_id',
  "AND target.status='Inactive' AND target.credential_state='Modern'",
  "AND target.role_name=t.role_name AND target.role_name<>'Administrator'",
  'AND target.auth_version=t.target_auth_version',
  'AND target.credential_version=t.target_credential_version',
  "AND role.status='Active' AND role.auth_version=t.role_auth_version",
  "AND issuer.role_name='Administrator' AND issuer.status='Active'",
  "AND issuer.credential_state='Modern'",
  'AND issuer.auth_version=t.issuer_auth_version'
].join(' ');

const consumeTicket=[
  'UPDATE auth_staff_activation_tickets AS t',
  'SET consumed_at_ms=?,consumed_nonce=?',
  'WHERE token_hash=? AND shop_id=? AND consumed_at_ms IS NULL',
  'AND expires_at_ms>? AND EXISTS('+currentTicket+')'
].join(' ');

const activateUser=[
  'UPDATE auth_users SET',
  "password_hash=?,password_salt=?,password_iterations=?,",
  "credential_version=credential_version+1,status='Active'",
  "WHERE user_id=? AND status='Inactive' AND credential_state='Modern'",
  "AND role_name<>'Administrator'",
  'AND EXISTS(SELECT 1 FROM auth_staff_activation_tickets t',
  'WHERE t.user_id=auth_users.user_id AND t.token_hash=? AND t.shop_id=?',
  'AND t.consumed_at_ms=? AND t.consumed_nonce=?',
  'AND t.target_auth_version=auth_users.auth_version',
  'AND t.target_credential_version=auth_users.credential_version',
  'AND t.role_name=auth_users.role_name',
  'AND EXISTS('+currentTicket+'))'
].join(' ');

/**
 * Creates a DISABLED Shop-specific staff account with a random inaccessible
 * placeholder verifier, plus an expiring once-only activation token.
 * SQL checks Administrator authority again at the INSERT boundary.
 */
export async function issueStaffInviteForShop(scope,input){
  const parsed=requestValues(input,[
    'selectedShopId','managerToken','fullName','mobile','roleName'
  ]);
  if(!parsed||typeof parsed.managerToken!=='string'||
     !TOKEN.test(parsed.managerToken))return issueDenied();
  const fullName=typeof parsed.fullName==='string'?parsed.fullName.trim():'';
  const roleName=typeof parsed.roleName==='string'?parsed.roleName.trim():'';
  const phone=canonicalStaffLoginPhone(parsed.mobile);
  if(!NAME.test(fullName)||!ROLE.test(roleName)||roleName==='Administrator'||!phone)
    return issueDenied();
  const checked=await trustedShop(scope,parsed.selectedShopId);
  if(!checked)return issueDenied();
  try{
    const db=checked.shopDb;
    const nowMs=Date.now();
    const managerHash=await hashOpaqueSessionToken(parsed.managerToken);
    if(!managerHash)return issueDenied();
    // Cheap eligibility check BEFORE an expensive password hash, never used
    // as commit authorization: both INSERTs contain current SQL-time checks.
    const available=await db.prepare(checkAdminAndRole)
      .bind(...currentAdminArgs(managerHash,nowMs),roleName).first();
    if(!available)return issueDenied();
    const userId='STAFF-'+crypto.randomUUID();
    const activationToken=createOpaqueSessionToken();
    const tokenHash=await hashOpaqueSessionToken(activationToken);
    const placeholder=await createOfflinePasswordCredential(createOpaqueSessionToken());
    const expiresAtMs=nowMs+INVITATION_LIFETIME_MS;
    const results=await db.batch([
      db.prepare(insertPending).bind(userId,fullName,phone,roleName,
        placeholder.passwordHash,placeholder.passwordSalt,placeholder.iterations,
        roleName,...currentAdminArgs(managerHash,nowMs)),
      db.prepare(insertTicket).bind(tokenHash,checked.shopId,
        nowMs,expiresAtMs,managerHash,userId,
        nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs)
    ]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
      return issueDenied();
    return {issued:true,shopId:checked.shopId,userId,activationToken,expiresAtMs};
  }catch{return issueDenied();}
}

/**
 * Activates only the disabled account bound to an uncancelled 15-minute
 * ticket, same trusted Shop and still-valid issuer and target authority.
 * The per-attempt nonce prohibits a second request from using an old
 * consumed_at_ms value, even if it lands in the same millisecond.
 */
export async function activateInvitedStaffForShop(scope,input){
  const parsed=requestValues(input,['selectedShopId','activationToken','password']);
  if(!parsed||typeof parsed.activationToken!=='string'||
     !TOKEN.test(parsed.activationToken)||typeof parsed.password!=='string'||
     parsed.password.length<8||parsed.password.length>1024)
    return activateDenied();
  const checked=await trustedShop(scope,parsed.selectedShopId);
  if(!checked)return activateDenied();
  try{
    const db=checked.shopDb;
    const tokenHash=await hashOpaqueSessionToken(parsed.activationToken);
    const nowMs=Date.now();
    const ticket=await db.prepare(
      'SELECT user_id FROM auth_staff_activation_tickets WHERE token_hash=? AND shop_id=? AND consumed_at_ms IS NULL AND expires_at_ms>?'
    ).bind(tokenHash,checked.shopId,nowMs).first();
    if(!ticket)return activateDenied();
    const credential=await createOfflinePasswordCredential(parsed.password);
    const nonce=createOpaqueSessionToken();
    // D1 batch is atomic. The UPDATE guards are duplicated at SQL commit:
    // a failed token claim cannot activate any account in the second step.
    const results=await db.batch([
      db.prepare(consumeTicket).bind(nowMs,nonce,tokenHash,checked.shopId,nowMs),
      db.prepare(activateUser).bind(
        credential.passwordHash,credential.passwordSalt,credential.iterations,
        ticket.user_id,tokenHash,checked.shopId,nowMs,nonce
      )
    ]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
      return activateDenied();
    return {activated:true,shopId:checked.shopId,userId:ticket.user_id};
  }catch{return activateDenied();}
}
