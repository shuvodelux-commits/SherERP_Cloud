/**
 * PORT-P3: private operator-only pre-enrollment setup ticket primitive.
 *
 * This module MUST NOT be exposed by a Worker route or imported from the
 * public entry point. An independently authorized operator must verify and
 * approve the Google subject and Control D1 identity before invoking it.
 * Possession of a D1 binding is NOT proof of operator authorization.
 *
 * No factor, session, account or recovery credential is issued here.
 */
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const ISSUER='https://accounts.google.com';
const SUBJECT=/^[0-9]{6,255}$/;
const LIFETIME_MS=600_000;

function newNonce(){
  const bytes=new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

/**
 * Create one 10-minute setup ticket in an already-reviewed Control D1.
 * The opaque ticket is returned ONCE; the database stores only its digest.
 * No active parallel ticket or post-enrollment issuance is allowed.
 */
export async function issueFirstPlatformSetupTicket({controlDb,googleSubject}={}){
  if(typeof googleSubject!=='string' || !SUBJECT.test(googleSubject) ||
     typeof controlDb?.prepare!=='function')return null;
  const setupToken=createOpaqueSessionToken();
  const tokenHash=await hashOpaqueSessionToken(setupToken);
  const nonce=newNonce();
  try{
    const row=await controlDb.prepare(`INSERT INTO platform_setup_tickets
      (token_hash,nonce,issuer,subject,issued_at_ms,expires_at_ms)
      SELECT ?,?,?,?,${NOW},${NOW}+?
      WHERE NOT EXISTS(SELECT 1 FROM platform_first_superadmin WHERE singleton=1)
        AND NOT EXISTS(SELECT 1 FROM platform_setup_tickets
          WHERE revoked_at_ms IS NULL AND expires_at_ms>${NOW})
      RETURNING expires_at_ms AS expiresAtMs`)
      .bind(tokenHash,nonce,ISSUER,googleSubject,LIFETIME_MS).first();
    return row?{setupToken,expiresAtMs:row.expiresAtMs}:null;
  }catch{
    // Do not expose SQL, binding, account or authentication details.
    throw new Error('PORT-P3 Control D1 setup ticket issuance unavailable');
  }
}

/** Revoke an unused, unexpired setup ticket by possession of its secret. */
export async function revokeFirstPlatformSetupTicket({controlDb,setupToken}={}){
  const tokenHash=await hashOpaqueSessionToken(setupToken);
  if(!tokenHash || typeof controlDb?.prepare!=='function')return false;
  try{
    const result=await controlDb.prepare(`UPDATE platform_setup_tickets
      SET revoked_at_ms=${NOW}
      WHERE token_hash=? AND revoked_at_ms IS NULL
        AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
        AND NOT EXISTS(SELECT 1 FROM platform_first_superadmin WHERE singleton=1)`)
      .bind(tokenHash).run();
    return result.success===true && result.meta?.changes===1;
  }catch{
    throw new Error('PORT-P3 Control D1 setup ticket revocation unavailable');
  }
}
