/**
 * M04 Super Admin MFA loss recovery.
 *
 * Only the original approved Google subject + a saved, unused 128-bit
 * recovery code can begin replacement enrollment. This never grants the
 * Admin role until the NEW TOTP is verified. Old factor, sessions and
 * recovery codes are invalidated atomically on success.
 */
import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {matchingStep,CURRENT_PLATFORM_ADMIN_FROM,
  validatePlatformSuperAdminSession} from './platform-superadmin-session.js';
import {PLATFORM_ADMIN_TRUSTED_SESSION_MS} from './platform-admin-trusted-session.js';
import {readBrowserAdminFactorRecord,generateEncryptedBrowserAdminFactor,
  decryptBrowserAdminFactor} from './browser-first-admin-setup.js';

const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const CODE=/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/;
const PENDING_MS=10*60_000;
const DOMAIN='SherERP:admin:offline-recovery:v1:';
const bytesHex=raw=>Array.from(raw,x=>x.toString(16).padStart(2,'0')).join('');
const hashText=async text=>bytesHex(new Uint8Array(await crypto.subtle.digest(
  'SHA-256',new TextEncoder().encode(text))));
const recoveryCodeHash=code=>hashText(DOMAIN+code.replaceAll('-',''));
const enabled=env=>env?.PLATFORM_BROWSER_SETUP==='true'&&
  typeof env.CONTROL_DB?.batch==='function'&&
  typeof env.CONTROL_DB?.prepare==='function'&&
  /^[0-9a-f]{64}$/.test(env.PLATFORM_FACTOR_ENCRYPTION_KEY??'')&&
  typeof env.PLATFORM_CLIENT_ID==='string';

async function freshCodes(){
  const codes=[];
  for(let i=0;i<8;i++){
    const key=bytesHex(crypto.getRandomValues(new Uint8Array(16)));
    codes.push([key.slice(0,8),key.slice(8,16),key.slice(16,24),key.slice(24)].join('-'));
  }
  return {codes,hashes:await Promise.all(codes.map(recoveryCodeHash))};
}

export async function issueAdminRecoveryCodes(env,sessionToken,code){
  if(!enabled(env)||typeof code!=='string'||!/^[0-9]{6}$/.test(code))
    return null;
  try{
    const db=env.CONTROL_DB;
    const admin=await validatePlatformSuperAdminSession(db,sessionToken);
    if(!admin)return null;
    const factor=await readBrowserAdminFactorRecord(env);
    if(!factor)return null;
    const step=await matchingStep(factor.secret,code,Math.floor(Date.now()/30000));
    if(step===null)return null;
    const hash=await hashOpaqueSessionToken(sessionToken);
    const {codes,hashes}=await freshCodes();
    const statements=[
      db.prepare(`INSERT INTO platform_admin_recovery_generation
        (singleton,generation,factor_version,updated_at_ms)
        SELECT 1,COALESCE((SELECT generation FROM platform_admin_recovery_generation
          WHERE singleton=1),0)+1,a.factor_version,${NOW}
        FROM platform_admin_auth a WHERE a.singleton=1 AND a.enabled=1
          AND a.factor_version=?
          AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM})
        ON CONFLICT(singleton) DO UPDATE SET
          generation=excluded.generation,factor_version=excluded.factor_version,
          updated_at_ms=excluded.updated_at_ms`).bind(factor.factorVersion,hash),
      db.prepare('DELETE FROM platform_admin_recovery_codes WHERE singleton=1'),
      ...hashes.map(codeHash=>db.prepare(`INSERT INTO platform_admin_recovery_codes
        (code_hash,singleton,generation,factor_version,issued_at_ms)
        SELECT ?,1,generation,factor_version,${NOW}
        FROM platform_admin_recovery_generation WHERE singleton=1 AND factor_version=?`)
        .bind(codeHash,factor.factorVersion))
    ];
    const results=await db.batch(statements);
    if(results[0]?.meta?.changes!==1||
      results.slice(2).some(result=>result.meta?.changes!==1))return null;
    return codes;
  }catch{return null;}
}

export async function beginAdminMfaRecovery(env,{browserToken,credential,recoveryCode}={}){
  if(!enabled(env)||typeof credential!=='string'||
    typeof recoveryCode!=='string'||!CODE.test(recoveryCode))return null;
  try{
    const db=env.CONTROL_DB;
    const binding=await hashOpaqueSessionToken(browserToken);
    if(!binding)return null;
    const challenge=await db.prepare(`SELECT c.nonce,f.issuer,f.subject,a.factor_version
      FROM platform_login_challenges c
      JOIN platform_first_superadmin f ON f.singleton=1
      JOIN platform_admin_auth a ON a.singleton=1 AND a.enabled=1
      WHERE c.binding_hash=? AND c.expires_at_ms>${NOW}
        AND NOT EXISTS(SELECT 1 FROM platform_login_cancellations x
          WHERE x.binding_hash=c.binding_hash)
        AND NOT EXISTS(SELECT 1 FROM platform_login_attempts x
          WHERE x.binding_hash=c.binding_hash)`).bind(binding).first();
    if(!challenge)return null;
    const identity=await verifyGoogleLoginIdToken({
      token:credential,clientId:env.PLATFORM_CLIENT_ID,
      expectedNonce:challenge.nonce,requireGmail:true
    });
    if(identity?.issuer!==challenge.issuer||identity?.subject!==challenge.subject)
      return null;
    // Only one recovery attempt per fresh Google challenge; throttling also
    // applies globally across all browser challenges in a 60-second window.
    const attempt=await db.prepare(`INSERT INTO platform_login_attempts
      (binding_hash,attempted_at_ms)
      SELECT c.binding_hash,${NOW} FROM platform_login_challenges c
      WHERE c.binding_hash=? AND c.expires_at_ms>${NOW}
        AND NOT EXISTS(SELECT 1 FROM platform_login_attempts x
          WHERE x.binding_hash=c.binding_hash)
        AND (SELECT count(*) FROM platform_login_attempts
          WHERE attempted_at_ms>${NOW}-60000)<5
      RETURNING binding_hash`).bind(binding).first();
    if(!attempt)return null;
    const {manualKey,encryptedSecret}=await generateEncryptedBrowserAdminFactor(env);
    const recoveryToken=createOpaqueSessionToken();
    const recoveryHash=await hashOpaqueSessionToken(recoveryToken);
    const codeHash=await recoveryCodeHash(recoveryCode);
    const results=await db.batch([
      db.prepare(`UPDATE platform_admin_recovery_codes
        SET consumed_at_ms=${NOW},consumed_by_binding=?
        WHERE code_hash=? AND consumed_at_ms IS NULL
          AND factor_version=? AND generation=(
            SELECT generation FROM platform_admin_recovery_generation
            WHERE singleton=1 AND factor_version=?)
          AND EXISTS(SELECT 1 FROM platform_login_attempts WHERE binding_hash=?)
        RETURNING code_hash`)
        .bind(binding,codeHash,challenge.factor_version,challenge.factor_version,binding),
      db.prepare(`INSERT INTO platform_admin_recovery_pending
        (token_hash,binding_hash,subject,encrypted_secret,factor_version,
         issued_at_ms,expires_at_ms)
        SELECT ?,?,?,?, ?,${NOW},${NOW}+?
        WHERE EXISTS(SELECT 1 FROM platform_admin_recovery_codes
          WHERE code_hash=? AND consumed_at_ms IS NOT NULL
            AND consumed_by_binding=?)
          AND EXISTS(SELECT 1 FROM platform_login_attempts
            WHERE binding_hash=?)`)
        .bind(recoveryHash,binding,challenge.subject,encryptedSecret,
          challenge.factor_version,PENDING_MS,codeHash,binding,binding),
    ]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)return null;
    return {recoveryToken,manualKey};
  }catch{return null;}
}

export async function finishAdminMfaRecovery(env,{recoveryToken,code}={}){
  if(!enabled(env)||typeof code!=='string'||!/^[0-9]{6}$/.test(code))
    return null;
  try{
    const db=env.CONTROL_DB;
    const tokenHash=await hashOpaqueSessionToken(recoveryToken);
    if(!tokenHash)return null;
    const pending=await db.prepare(`UPDATE platform_admin_recovery_pending
      SET attempts=attempts+1 WHERE token_hash=? AND expires_at_ms>${NOW}
        AND attempts<5
      RETURNING subject,encrypted_secret,factor_version,binding_hash`)
      .bind(tokenHash).first();
    if(!pending)return null;
    const secret=await decryptBrowserAdminFactor(env,pending.encrypted_secret);
    if(!secret)return null;
    const matchedStep=await matchingStep(secret,code,Math.floor(Date.now()/30000));
    if(matchedStep===null)return null;
    const sessionToken=createOpaqueSessionToken();
    const sessionHash=await hashOpaqueSessionToken(sessionToken);
    const {codes,hashes}=await freshCodes();
    // The audit trigger is the transaction's fencing gate. A second
    // concurrent use or changed factor version aborts the *whole batch*.
    const results=await db.batch([
      db.prepare(`INSERT INTO platform_admin_recovery_rotation_audit
        (token_hash,subject,from_version,to_version,rotated_at_ms)
        VALUES (?,?,?,?,${NOW})`)
        .bind(tokenHash,pending.subject,pending.factor_version,pending.factor_version+1),
      db.prepare(`UPDATE platform_admin_auth SET factor_version=factor_version+1
        WHERE singleton=1 AND enabled=1 AND factor_version=?`)
        .bind(pending.factor_version),
      db.prepare('UPDATE platform_browser_first_factor SET encrypted_secret=? WHERE singleton=1')
        .bind(pending.encrypted_secret),
      // A restored factor cannot leave any device holding a valid old session.
      db.prepare('DELETE FROM platform_admin_sessions'),
      db.prepare(`INSERT INTO platform_admin_sessions
        (token_hash,binding_hash,singleton,factor_version,otp_step,
         issued_at_ms,expires_at_ms)
        SELECT ?,p.binding_hash,1,a.factor_version,?,${NOW},
          ${NOW}+?
        FROM platform_admin_recovery_pending p
        JOIN platform_admin_auth a ON a.singleton=1
        WHERE p.token_hash=? AND a.factor_version=?
          AND EXISTS(SELECT 1 FROM platform_login_attempts x
            WHERE x.binding_hash=p.binding_hash)`)
        .bind(sessionHash,matchedStep,PLATFORM_ADMIN_TRUSTED_SESSION_MS,
          tokenHash,pending.factor_version+1),
      db.prepare('DELETE FROM platform_admin_recovery_codes'),
      db.prepare(`UPDATE platform_admin_recovery_generation SET
        generation=generation+1,factor_version=?,updated_at_ms=${NOW}
        WHERE singleton=1 AND factor_version=?`)
        .bind(pending.factor_version+1,pending.factor_version),
      ...hashes.map(codeHash=>db.prepare(`INSERT INTO platform_admin_recovery_codes
        (code_hash,singleton,generation,factor_version,issued_at_ms)
        SELECT ?,1,generation,factor_version,${NOW}
        FROM platform_admin_recovery_generation
        WHERE singleton=1 AND factor_version=?`)
        .bind(codeHash,pending.factor_version+1)),
      db.prepare('DELETE FROM platform_admin_recovery_pending WHERE token_hash=?').bind(tokenHash)
    ]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1||
      results[4]?.meta?.changes!==1||results[6]?.meta?.changes!==1||
      results.slice(7,15).some(result=>result.meta?.changes!==1))
      return null;
    return {sessionToken,codes};
  }catch{return null;}
}
