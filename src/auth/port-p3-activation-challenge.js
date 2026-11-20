/**
 * PORT-P3 Run 3 — local-only, separately nonce-bound Google identity challenge.
 *
 * This internal helper does NOT activate MFA, grant a platform role, mint a
 * session, approve a trusted operator, or recover an account. Do not expose
 * it via HTTP or import it from a deployed Worker. The challenge table exists
 * ONLY in a disposable test fixture pending M03 schema/release approval.
 */
import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';

const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const ISSUER='https://accounts.google.com';
const MAX_ATTEMPTS=5;
const CHALLENGE_MS=120_000;
const TABLE='port_p3_activation_challenges';

function randomNonce(){
  const data=new Uint8Array(32);
  globalThis.crypto.getRandomValues(data);
  return btoa(String.fromCharCode(...data))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

const ELIGIBLE=`EXISTS (
    SELECT 1 FROM platform_first_superadmin f
    JOIN platform_setup_tickets t ON t.token_hash=f.setup_token_hash
    WHERE f.singleton=1 AND t.token_hash=${TABLE}.ticket_hash
      AND t.issuer=f.issuer AND t.subject=f.subject
      AND t.issuer=${TABLE}.issuer AND t.subject=${TABLE}.subject
      AND t.issued_at_ms<=${NOW} AND t.expires_at_ms>${NOW}
      AND t.revoked_at_ms IS NULL
      AND NOT EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)
  )`;

/**
 * A separately authorized Control D1 operator creates a new Google nonce.
 * Returns the challenge secret once; persists only its SHA-256 digest.
 * A ticket may have only one live challenge and five attempts in total,
 * including past consumed/revoked/expired challenges.
 */
export async function issueFirstPlatformActivationChallenge({controlDb,setupToken}={}){
  if(typeof controlDb?.prepare!=='function')return null;
  const ticketHash=await hashOpaqueSessionToken(setupToken);
  if(!ticketHash)return null;

  const challengeToken=createOpaqueSessionToken();
  const challengeHash=await hashOpaqueSessionToken(challengeToken);
  const nonce=randomNonce();
  try{
    const row=await controlDb.prepare(`INSERT INTO ${TABLE}
      (challenge_hash,ticket_hash,nonce,issuer,subject,issued_at_ms,expires_at_ms)
      SELECT ?,t.token_hash,?,f.issuer,f.subject,${NOW},
        MIN(${NOW}+?,t.expires_at_ms)
      FROM platform_first_superadmin f
      JOIN platform_setup_tickets t ON t.token_hash=f.setup_token_hash
      WHERE f.singleton=1 AND t.token_hash=?
        AND t.issuer=? AND t.issuer=f.issuer AND t.subject=f.subject
        AND t.issued_at_ms<=${NOW} AND t.expires_at_ms>${NOW}
        AND t.revoked_at_ms IS NULL
        AND NOT EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)
        AND NOT EXISTS(
          SELECT 1 FROM ${TABLE} c
          WHERE c.ticket_hash=t.token_hash AND c.consumed_at_ms IS NULL
            AND c.revoked_at_ms IS NULL AND c.expires_at_ms>${NOW})
        AND COALESCE((SELECT SUM(c.attempt_count) FROM ${TABLE} c
          WHERE c.ticket_hash=t.token_hash),0)<?
      RETURNING expires_at_ms AS expiresAtMs`)
      .bind(challengeHash,nonce,CHALLENGE_MS,ticketHash,ISSUER,MAX_ATTEMPTS).first();
    return row?{challengeToken,nonce,expiresAtMs:row.expiresAtMs}:null;
  }catch{
    // Fail closed without revealing the Control D1 target or token material.
    return null;
  }
}

/**
 * Count EVERY Google verification attempt with an atomic SQL allowance.
 * Return true once only after signed Google issuer/audience/nonce/subject
 * verification and a second SQL-time challenge+ticket check.
 *
 * A positive boolean is ONLY a local identity-challenge proof, never a
 * privileged capability. Live MFA activation must consume the challenge
 * in the SAME reviewed SQL mutation that changes platform_admin_auth.
 */
export async function verifyAndConsumeFirstPlatformActivationChallenge({
  controlDb,setupToken,challengeToken,clientId,credential,
}={}){
  if(typeof controlDb?.prepare!=='function')return false;
  const [ticketHash,challengeHash]=await Promise.all([
    hashOpaqueSessionToken(setupToken),hashOpaqueSessionToken(challengeToken),
  ]);
  if(!ticketHash || !challengeHash)return false;

  try{
    const attempt=await controlDb.prepare(`UPDATE ${TABLE}
      SET attempt_count=attempt_count+1
      WHERE challenge_hash=? AND ticket_hash=?
        AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
        AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
        AND attempt_count<?
        AND COALESCE((SELECT SUM(prev.attempt_count) FROM ${TABLE} prev
          WHERE prev.ticket_hash=${TABLE}.ticket_hash),0)<?
        AND ${ELIGIBLE}
      RETURNING nonce,issuer,subject`)
      .bind(challengeHash,ticketHash,MAX_ATTEMPTS,MAX_ATTEMPTS).first();
    if(!attempt)return false;

    const identity=await verifyGoogleLoginIdToken({
      token:credential,clientId,expectedNonce:attempt.nonce,
    });
    if(!identity || identity.issuer!==attempt.issuer || identity.subject!==attempt.subject)return false;

    const result=await controlDb.prepare(`UPDATE ${TABLE}
      SET consumed_at_ms=${NOW}
      WHERE challenge_hash=? AND ticket_hash=? AND nonce=?
        AND issuer=? AND subject=?
        AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
        AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
        AND attempt_count BETWEEN 1 AND ?
        AND ${ELIGIBLE}`)
      .bind(challengeHash,ticketHash,attempt.nonce,identity.issuer,identity.subject,
        MAX_ATTEMPTS).run();
    return result.success===true && result.meta?.changes===1;
  }catch{
    return false;
  }
}

/** Explicitly cancel a pending challenge by BOTH original and challenge secrets. */
export async function revokeFirstPlatformActivationChallenge({
  controlDb,setupToken,challengeToken,
}={}){
  if(typeof controlDb?.prepare!=='function')return false;
  const [ticketHash,challengeHash]=await Promise.all([
    hashOpaqueSessionToken(setupToken),hashOpaqueSessionToken(challengeToken),
  ]);
  if(!ticketHash || !challengeHash)return false;

  try{
    const result=await controlDb.prepare(`UPDATE ${TABLE}
      SET revoked_at_ms=${NOW}
      WHERE challenge_hash=? AND ticket_hash=?
        AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
        AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL`)
      .bind(challengeHash,ticketHash).run();
    return result.success===true && result.meta?.changes===1;
  }catch{
    return false;
  }
}
