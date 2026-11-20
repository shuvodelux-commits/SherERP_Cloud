import {PLATFORM_ADMIN_TRUSTED_SESSION_MS} from './platform-admin-trusted-session.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const UNENROLLED='NOT EXISTS(SELECT 1 FROM platform_first_superadmin WHERE singleton=1)';

/** Internal persistence step. The caller must verify bootstrap, Google and TOTP
 * and encrypt the authenticator secret before calling this function. */
export async function commitFirstAdminEnrollment(db,{subject,enrollmentHash,nonce,encryptedSecret,requirePending=false,sessionHash,otpStep}){
  const [record]=await db.batch([
    // Keep the existing immutable identity's provenance link. The row is
    // revoked on creation and cannot be redeemed by the legacy setup routes.
    db.prepare(`INSERT INTO platform_setup_tickets
      (token_hash,nonce,issuer,subject,issued_at_ms,expires_at_ms,revoked_at_ms)
      SELECT ?,?,'https://accounts.google.com',?,${NOW},${NOW}+1000,${NOW}
      WHERE ${UNENROLLED} ${requirePending?`AND EXISTS(
        SELECT 1 FROM platform_browser_setup WHERE token_hash=? AND subject=?
          AND encrypted_secret=? AND expires_at_ms>${NOW}
          AND ? BETWEEN CAST(${NOW}/30000 AS INTEGER)-1 AND CAST(${NOW}/30000 AS INTEGER)
      )`:''}`).bind(enrollmentHash,nonce,subject,
        ...(requirePending?[enrollmentHash,subject,encryptedSecret,otpStep]:[])),
    db.prepare(`INSERT INTO platform_first_superadmin
      (singleton,issuer,subject,setup_token_hash,enrolled_at_ms)
      SELECT 1,issuer,subject,token_hash,${NOW} FROM platform_setup_tickets
      WHERE token_hash=? AND ${UNENROLLED}`).bind(enrollmentHash),
    db.prepare(`INSERT INTO platform_admin_auth (singleton,enabled,factor_version)
      SELECT singleton,1,1 FROM platform_first_superadmin WHERE setup_token_hash=?
      AND NOT EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)`).bind(enrollmentHash),
    db.prepare(`INSERT INTO platform_browser_first_factor (singleton,encrypted_secret)
      SELECT singleton,? FROM platform_first_superadmin WHERE setup_token_hash=?
      AND NOT EXISTS(SELECT 1 FROM platform_browser_first_factor WHERE singleton=1)`)
      .bind(encryptedSecret,enrollmentHash),
    ...(sessionHash?[
      db.prepare(`INSERT INTO platform_login_challenges(binding_hash,nonce,expires_at_ms)
        SELECT ?,nonce,${NOW}+120000 FROM platform_setup_tickets
        JOIN platform_first_superadmin ON setup_token_hash=token_hash
        WHERE token_hash=? AND NOT EXISTS(SELECT 1 FROM platform_login_challenges WHERE binding_hash=?)`)
        .bind(enrollmentHash,enrollmentHash,enrollmentHash),
      db.prepare(`INSERT INTO platform_login_attempts(binding_hash,attempted_at_ms)
        SELECT binding_hash,${NOW} FROM platform_login_challenges WHERE binding_hash=?
        AND NOT EXISTS(SELECT 1 FROM platform_login_attempts WHERE binding_hash=?)`)
        .bind(enrollmentHash,enrollmentHash),
      db.prepare(`INSERT INTO platform_admin_sessions
        (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
        SELECT ?,binding_hash,1,1,?,${NOW},${NOW}+${PLATFORM_ADMIN_TRUSTED_SESSION_MS} FROM platform_login_attempts
        WHERE binding_hash=? AND NOT EXISTS(SELECT 1 FROM platform_admin_sessions WHERE binding_hash=?)`)
        .bind(sessionHash,otpStep,enrollmentHash,enrollmentHash),
    ]:[]),
    db.prepare(`DELETE FROM platform_browser_setup WHERE EXISTS(
      SELECT 1 FROM platform_first_superadmin WHERE setup_token_hash=?
    )`).bind(enrollmentHash),
  ]);
  return record.meta.changes===1;
}
