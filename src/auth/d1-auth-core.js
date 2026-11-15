/**
 * M04 internal D1 authentication core. NOT wired to any public RPC.
 *
 * Requires: a successfully migrated, trusted D1 binding and explicitly
 * reviewed staff provisioning. See test-only auth SQL proposal.
 * Do not use a legacy SHA256 password as a PBKDF2 credential.
 * Do not accept the time or canonical phone directly from a browser.
 */
import {verifyLegacyPassword} from './legacy-password.js';

export const AUTH_POLICY=Object.freeze({
  passwordIterations:210_000,
  sessionMaxMs:12*60*60*1000,
  sessionIdleMs:30*60*1000,
  loginFailureLimit:5,
  loginLockMs:15*60*1000,
  throttleResetMs:60*60*1000,
});

const HASH=/^[a-f0-9]{64}$/;
const SALT=/^[a-f0-9]{48}$/;
const PHONE=/^01[3-9][0-9]{8}$/;
const tokenPattern=/^[a-f0-9]{64}$/;

const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
function hexToBytes(value){
  const result=new Uint8Array(value.length/2);
  for(let i=0;i<result.length;i++) result[i]=parseInt(value.slice(2*i,2*i+2),16);
  return result;
}
function fixedEqual(a,b){
  if(a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function requireCrypto(){
  if(typeof globalThis.crypto?.getRandomValues!=='function' ||
     typeof globalThis.crypto?.subtle?.deriveBits!=='function' ||
     typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('Web Crypto is required for authentication');
  return globalThis.crypto;
}
function requireD1(db){
  if(!db || typeof db.prepare!=='function') throw new Error('D1 authentication storage unavailable');
  return db;
}
function validClock(nowMs){
  return Number.isSafeInteger(nowMs) && nowMs>=0 &&
    Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs) &&
    Number.isSafeInteger(nowMs+AUTH_POLICY.throttleResetMs);
}
function validSecret(password) {
  return typeof password==='string' && password.length>=1 && password.length<=1024;
}
async function sha256Hex(bytes) {
  const c=requireCrypto();
  return hex(new Uint8Array(await c.subtle.digest('SHA-256',bytes)));
}
async function credentialDigest(password,salt,iterations){
  const c=requireCrypto();
  const key=await c.subtle.importKey('raw',new TextEncoder().encode(password),
    'PBKDF2',false,['deriveBits']);
  const result=await c.subtle.deriveBits({
    name:'PBKDF2',hash:'SHA-256',salt:hexToBytes(salt),iterations,
  },key,256);
  return hex(new Uint8Array(result));
}

/**
 * Offline password provisioning helper, NEVER public RPC. Produces no
 * raw password field; callers must protect the output as credentials.
 */
export async function createOfflinePasswordCredential(password){
  if(typeof password!=='string' || password.length<8 || password.length>1024)
    throw new TypeError('Invalid offline password');
  const salt=hex(requireCrypto().getRandomValues(new Uint8Array(24)));
  return {
    passwordAlgo:'pbkdf2-sha256',
    passwordHash:await credentialDigest(password,salt,AUTH_POLICY.passwordIterations),
    passwordSalt:salt,
    iterations:AUTH_POLICY.passwordIterations,
  };
}
async function verifyStoredCredential(password,row){
  if(!row || row.password_algo!=='pbkdf2-sha256' ||
     typeof row.password_hash!=='string' || !HASH.test(row.password_hash) ||
     typeof row.password_salt!=='string' || !SALT.test(row.password_salt) ||
     !Number.isSafeInteger(row.password_iterations) ||
     row.password_iterations<AUTH_POLICY.passwordIterations ||
     row.password_iterations>1_000_000) return false;
  const actual=await credentialDigest(password,row.password_salt,row.password_iterations);
  return fixedEqual(actual,row.password_hash);
}

async function locked(db,phoneDigest,nowMs){
  const row=await db.prepare(
    'SELECT locked_until_ms,reset_at_ms FROM auth_login_throttle WHERE login_hash=?'
  ).bind(phoneDigest).first();
  return !!row && row.reset_at_ms>nowMs && row.locked_until_ms>nowMs;
}

async function recordFailure(db,phoneDigest,nowMs){
  const lockUntil=nowMs+AUTH_POLICY.loginLockMs;
  const resetAt=nowMs+AUTH_POLICY.throttleResetMs;
  // A single UPSERT atomically counts failures across concurrent Workers.
  // A blocked attempt cannot increment, extend or clear its own lock.
  await db.prepare(`INSERT INTO auth_login_throttle
    (login_hash,failure_count,locked_until_ms,reset_at_ms)
    VALUES (?,1,0,?)
    ON CONFLICT(login_hash) DO UPDATE SET
      failure_count = CASE
        WHEN auth_login_throttle.locked_until_ms > 0 OR auth_login_throttle.reset_at_ms <= ?
        THEN 1 ELSE MIN(auth_login_throttle.failure_count+1,5) END,
      locked_until_ms = CASE
        WHEN auth_login_throttle.locked_until_ms > 0 OR auth_login_throttle.reset_at_ms <= ?
        THEN 0
        WHEN auth_login_throttle.failure_count+1 >= 5 THEN ?
        ELSE 0 END,
      reset_at_ms = ?
    WHERE auth_login_throttle.locked_until_ms <= ?`)
    .bind(phoneDigest,resetAt,nowMs,nowMs,lockUntil,resetAt,nowMs).run();
}

const denyLogin=()=>({authenticated:false});
function sanitizedUser(row){
  return {id:row.user_id,name:row.full_name,role:row.role_name};
}
/**
 * Internal login with trusted normalized phone and clock.
 * Generic deny for missing/invalid credentials, inactive roles and lockout.
 */
export async function loginWithD1(db,{phoneKey,password,nowMs}={}){
  requireD1(db);
  if(typeof phoneKey!=='string' || !PHONE.test(phoneKey) ||
      !validSecret(password) || !validClock(nowMs)) return denyLogin();
  const phoneDigest=await sha256Hex(new TextEncoder().encode(phoneKey));
  if(await locked(db,phoneDigest,nowMs)) return denyLogin();

  let row=await db.prepare(`SELECT user_id,full_name,role_name,
     credential_state,password_algo,password_hash,password_salt,password_iterations,credential_version,
     auth_version,
     (CASE WHEN role_name='Administrator' THEN NULL ELSE
       (SELECT r.auth_version FROM auth_roles r
        WHERE r.role_name=auth_users.role_name AND r.status='Active') END)
       AS role_auth_version
     FROM auth_users WHERE phone_key=? AND status='Active'
       AND (role_name='Administrator' OR EXISTS (
         SELECT 1 FROM auth_roles r WHERE r.role_name=auth_users.role_name AND r.status='Active'))`)
     .bind(phoneKey).first();
  if(row?.credential_state==='LegacyPending'){
    // The legacy SHA256 verifier is a one-time import compatibility step,
    // never an alternative way to create an authenticated session.
    const legacy=await db.prepare(`SELECT legacy_hash,legacy_salt
      FROM auth_legacy_credentials WHERE user_id=?`).bind(row.user_id).first();
    if(password.length<8 || !legacy ||
       !await verifyLegacyPassword(password,legacy.legacy_hash,legacy.legacy_salt)){
      await recordFailure(db,phoneDigest,nowMs);
      return denyLogin();
    }
    const modern=await createOfflinePasswordCredential(password);
    // This single UPDATE is the only permitted upgrade boundary. SQL
    // triggers bump the account authority version AND erase the imported
    // hash+salt atomically; a losing race may never issue a session.
    const upgraded=await db.prepare(`UPDATE auth_users SET
      password_hash=?,password_salt=?,password_iterations=?,
      credential_version=credential_version+1,credential_state='Modern'
      WHERE user_id=? AND phone_key=? AND status='Active'
        AND credential_state='LegacyPending' AND role_name=?
        AND password_hash=? AND password_salt=? AND password_iterations=?
        AND credential_version=? AND auth_version=?
        AND EXISTS (SELECT 1 FROM auth_legacy_credentials l
          WHERE l.user_id=auth_users.user_id
            AND l.legacy_hash=? AND l.legacy_salt=?)
        AND (role_name='Administrator' OR EXISTS
          (SELECT 1 FROM auth_roles r WHERE r.role_name=auth_users.role_name
            AND r.status='Active' AND r.auth_version=?))
        AND NOT EXISTS (SELECT 1 FROM auth_login_throttle t
          WHERE t.login_hash=? AND t.reset_at_ms>? AND t.locked_until_ms>?)
      RETURNING user_id,credential_state`)
      .bind(modern.passwordHash,modern.passwordSalt,modern.iterations,
        row.user_id,phoneKey,row.role_name,row.password_hash,row.password_salt,
        row.password_iterations,row.credential_version,row.auth_version,
        legacy.legacy_hash,legacy.legacy_salt,row.role_auth_version,
        phoneDigest,nowMs,nowMs).first();
    if(upgraded?.user_id!==row.user_id || upgraded.credential_state!=='Modern')
      return denyLogin();
    // After the credential replacement, always go through the complete
    // modern verifier and existing authority-snapshot session INSERT.
    row=await db.prepare(`SELECT user_id,full_name,role_name,
      credential_state,password_algo,password_hash,password_salt,
      password_iterations,credential_version,auth_version,
      (CASE WHEN role_name='Administrator' THEN NULL ELSE
        (SELECT r.auth_version FROM auth_roles r
         WHERE r.role_name=auth_users.role_name AND r.status='Active') END)
        AS role_auth_version
      FROM auth_users WHERE user_id=? AND status='Active'
        AND (role_name='Administrator' OR EXISTS
          (SELECT 1 FROM auth_roles r WHERE r.role_name=auth_users.role_name
           AND r.status='Active'))`).bind(row.user_id).first();
  }
  if(!row || row.credential_state!=='Modern' ||
     !await verifyStoredCredential(password,row)){
    await recordFailure(db,phoneDigest,nowMs);
    return denyLogin();
  }

  const tokenBytes=requireCrypto().getRandomValues(new Uint8Array(32));
  const token=hex(tokenBytes);
  const tokenHash=await sha256Hex(tokenBytes);
  const expires=nowMs+AUTH_POLICY.sessionMaxMs;

  // Recheck active actor and lock state inside the SQL write; never grant a
  // session based only on stale verification from before the password KDF.
  const inserted=await db.prepare(`INSERT INTO auth_sessions
    (token_hash,user_id,created_at_ms,last_activity_at_ms,expires_at_ms,
     user_auth_version,role_auth_version,credential_version)
    SELECT ?,u.user_id,?,?,?,u.auth_version,
      (CASE WHEN u.role_name='Administrator' THEN NULL ELSE
        (SELECT r.auth_version FROM auth_roles r
         WHERE r.role_name=u.role_name AND r.status='Active') END),
      u.credential_version FROM auth_users u
    WHERE u.user_id=? AND u.status='Active' AND u.credential_state='Modern'
      AND u.role_name=? AND u.password_hash=? AND u.password_salt=?
      AND u.password_iterations=? AND u.credential_version=?
      AND u.auth_version=?
      AND (u.role_name='Administrator' OR EXISTS (
        SELECT 1 FROM auth_roles r WHERE r.role_name=u.role_name
          AND r.status='Active' AND r.auth_version=?))
      AND NOT EXISTS (SELECT 1 FROM auth_login_throttle t
         WHERE t.login_hash=? AND t.reset_at_ms > ? AND t.locked_until_ms > ?)`)
    .bind(tokenHash,nowMs,nowMs,expires,row.user_id,row.role_name,
      row.password_hash,row.password_salt,row.password_iterations,row.credential_version,
      row.auth_version,row.role_auth_version,
      phoneDigest,nowMs,nowMs).run();
  if(inserted.meta?.changes!==1) return denyLogin();

  // Do not clear an active lock; a success cannot have committed through it.
  await db.prepare(`DELETE FROM auth_login_throttle
    WHERE login_hash=? AND (locked_until_ms=0 OR reset_at_ms <= ?)`)
    .bind(phoneDigest,nowMs).run();
  return {authenticated:true,token,user:sanitizedUser(row)};
}

async function digestToken(token){
  if(typeof token!=='string' || !tokenPattern.test(token)) return null;
  return sha256Hex(hexToBytes(token));
}

export async function validateSessionWithD1(db,{token,nowMs}={}){
  requireD1(db);
  if(!validClock(nowMs)) return denyLogin();
  const digest=await digestToken(token);
  if(!digest) return denyLogin();

  const updated=await db.prepare(`UPDATE auth_sessions
     SET last_activity_at_ms=?
     WHERE token_hash=? AND revoked_at_ms IS NULL
       AND created_at_ms<=? AND expires_at_ms>?
       AND last_activity_at_ms>? AND last_activity_at_ms<=?
       AND EXISTS (SELECT 1 FROM auth_users u
         WHERE u.user_id=auth_sessions.user_id AND u.status='Active'
         AND u.auth_version=auth_sessions.user_auth_version
         AND u.credential_version=auth_sessions.credential_version
         AND ((u.role_name='Administrator' AND auth_sessions.role_auth_version IS NULL)
           OR EXISTS (SELECT 1 FROM auth_roles r
             WHERE r.role_name=u.role_name AND r.status='Active'
               AND r.auth_version=auth_sessions.role_auth_version)))`)
     .bind(nowMs,digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs).run();
  if(updated.meta?.changes!==1) return denyLogin();

  const row=await db.prepare(`SELECT u.user_id,u.full_name,u.role_name FROM auth_sessions s
     JOIN auth_users u ON u.user_id=s.user_id
     WHERE s.token_hash=? AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?
       AND u.status='Active' AND u.auth_version=s.user_auth_version
       AND u.credential_version=s.credential_version
       AND ((u.role_name='Administrator' AND s.role_auth_version IS NULL)
         OR EXISTS (SELECT 1 FROM auth_roles r WHERE r.role_name=u.role_name
           AND r.status='Active' AND r.auth_version=s.role_auth_version))`)
    .bind(digest,nowMs).first();
  return row ? {authenticated:true,user:sanitizedUser(row)} : denyLogin();
}

export async function revokeSessionWithD1(db,{token,nowMs}={}){
  requireD1(db);
  if(!validClock(nowMs)) return {revoked:false};
  const digest=await digestToken(token);
  if(!digest) return {revoked:true};
  await db.prepare(`UPDATE auth_sessions SET revoked_at_ms=?
    WHERE token_hash=? AND revoked_at_ms IS NULL AND created_at_ms<=?`)
    .bind(nowMs,digest,nowMs).run();
  return {revoked:true};
}
