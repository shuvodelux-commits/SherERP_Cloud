/**
 * PORT-P3 Run 3 — local-only, separately nonce-bound Google identity challenge.
 *
 * Internal challenge and first-factor activation for a trusted Control D1 operator.
 * The operator binds the approved database, Google identity and pending TOTP secret.
 * Deployed Workers must not expose this operator API.
 */
import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {proveTotpStep,validFirstFactorTotp} from './port-p3-first-factor-activation.js';
import {createD1ExactlyOneBatchGuard} from '../db/exactly-one-batch.js';

const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const CURRENT_STEP=`CAST(${NOW}/30000 AS INTEGER)`;
const ISSUER='https://accounts.google.com';
const MAX_ATTEMPTS=5;
const CHALLENGE_MS=120_000;
const TABLE='port_p3_activation_challenges';
const OPERATOR_ID=/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const GOOGLE_SUBJECT=/^[0-9]{10,128}$/;
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;

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
const TICKET_ATTEMPTS=`COALESCE((SELECT SUM(prev.attempt_count) FROM ${TABLE} prev
  WHERE prev.ticket_hash=${TABLE}.ticket_hash),0)`;
const CONSUME=`UPDATE ${TABLE}
  SET consumed_at_ms=${NOW}
  WHERE challenge_hash=? AND ticket_hash=? AND nonce=?
    AND issuer=? AND subject=?
    AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
    AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
    AND attempt_count BETWEEN 1 AND ? AND ${TICKET_ATTEMPTS}<=?
    AND ${ELIGIBLE}`;

/**
 * A separately authorized Control D1 operator creates a new Google nonce.
 * Returns the challenge secret once; persists only its SHA-256 digest.
 * A ticket may have only one live challenge and five attempts in total,
 * including past consumed/revoked/expired challenges.
 */
export async function issueFirstPlatformActivationChallenge({controlDb,setupToken}={}){
  return issueActivationChallenge(controlDb,setupToken);
}

async function issueActivationChallenge(controlDb,setupToken,googleSubject=null){
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
        AND (? IS NULL OR f.subject=?)
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
      .bind(challengeHash,nonce,CHALLENGE_MS,ticketHash,ISSUER,
        googleSubject,googleSubject,MAX_ATTEMPTS).first();
    return row?{challengeToken,nonce,expiresAtMs:row.expiresAtMs}:null;
  }catch{
    // Fail closed without revealing the Control D1 target or token material.
    return null;
  }
}

async function verifyActivationAttempt({
  controlDb,setupToken,challengeToken,clientId,credential,
},googleSubject=null){
  const [ticketHash,challengeHash]=await Promise.all([
    hashOpaqueSessionToken(setupToken),hashOpaqueSessionToken(challengeToken),
  ]);
  if(!ticketHash || !challengeHash)return null;

  const attempt=await controlDb.prepare(`UPDATE ${TABLE}
    SET attempt_count=attempt_count+1
    WHERE challenge_hash=? AND ticket_hash=?
      AND (? IS NULL OR subject=?)
      AND issued_at_ms<=${NOW} AND expires_at_ms>${NOW}
      AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
      AND attempt_count<? AND ${TICKET_ATTEMPTS}<?
      AND ${ELIGIBLE}
    RETURNING nonce,issuer,subject,${CURRENT_STEP} AS step`)
    .bind(challengeHash,ticketHash,googleSubject,googleSubject,MAX_ATTEMPTS,MAX_ATTEMPTS).first();
  if(!attempt)return null;

  const identity=await verifyGoogleLoginIdToken({
    token:credential,clientId,expectedNonce:attempt.nonce,
  });
  if(!identity || identity.issuer!==attempt.issuer || identity.subject!==attempt.subject)return null;
  return {...attempt,ticketHash,challengeHash};
}

function prepareConsumption(controlDb,proof,matchedStep){
  const values=[proof.challengeHash,proof.ticketHash,proof.nonce,proof.issuer,
    proof.subject,MAX_ATTEMPTS,MAX_ATTEMPTS];
  if(matchedStep===undefined)return controlDb.prepare(CONSUME).bind(...values);
  return controlDb.prepare(`${CONSUME} AND ? BETWEEN ${CURRENT_STEP}-1 AND ${CURRENT_STEP}`)
    .bind(...values,matchedStep);
}

/** Consume a local Google proof without enabling MFA or issuing a session. */
export async function verifyAndConsumeFirstPlatformActivationChallenge(input={}){
  const {controlDb}=input;
  if(typeof controlDb?.prepare!=='function')return false;
  try{
    const proof=await verifyActivationAttempt(input);
    if(!proof)return false;
    const result=await prepareConsumption(controlDb,proof).run();
    return result.success===true && result.meta?.changes===1;
  }catch{
    return false;
  }
}

/**
 * Disposable D1 first-factor proof. Google and TOTP share one ticket attempt
 * budget. On an ambiguous D1 response an operator must read the challenge and
 * factor state before retrying.
 */
export async function activateFirstPlatformFactorFromChallenge(input={}){
  return activateFactor(input);
}

async function activateFactor(input,{operatorId,googleSubject}={}){
  const {controlDb,totpSecret,code}=input;
  if(typeof controlDb?.prepare!=='function' || typeof controlDb.batch!=='function' ||
     !validFirstFactorTotp(totpSecret,code))return false;
  try{
    const proof=await verifyActivationAttempt(input,googleSubject);
    if(!proof || !Number.isSafeInteger(proof.step) || proof.step<1)return false;
    const step=await proveTotpStep(totpSecret,code,proof.step);
    if(step===null)return false;

    const statements=[
      prepareConsumption(controlDb,proof,step),
      controlDb.prepare('INSERT INTO platform_admin_auth (singleton,enabled,factor_version) VALUES (1,1,1)'),
    ];
    if(operatorId){
      statements.push(controlDb.prepare(`INSERT INTO platform_first_mfa_activation_audit
        (singleton,challenge_hash,operator_id,factor_version,activated_at_ms)
        SELECT 1,challenge_hash,?,1,consumed_at_ms FROM ${TABLE}
        WHERE challenge_hash=? AND consumed_at_ms IS NOT NULL`)
        .bind(operatorId,proof.challengeHash));
    }
    await createD1ExactlyOneBatchGuard({DB:controlDb}).execute_(statements);
    return true;
  }catch{
    return false;
  }
}

/**
 * Bind one private operator context. Credential, actor and pending secret come
 * from the trusted process, never from the operation input.
 */
export async function createTrustedFirstMfaOperator({
  controlDb,operatorId,operatorBearer,clientId,googleSubject,totpSecret,
}={}){
  if(typeof controlDb?.prepare!=='function' || typeof controlDb.batch!=='function' ||
     typeof operatorId!=='string' || !OPERATOR_ID.test(operatorId) ||
     typeof googleSubject!=='string' || !GOOGLE_SUBJECT.test(googleSubject) ||
     typeof clientId!=='string' || !GOOGLE_CLIENT.test(clientId) ||
     !validFirstFactorTotp(totpSecret,'000000'))return null;
  const expectedHash=await hashOpaqueSessionToken(operatorBearer);
  if(!expectedHash)return null;

  async function authorized(bearer){
    const suppliedHash=await hashOpaqueSessionToken(bearer);
    if(!suppliedHash)return false;
    let difference=0;
    for(let i=0;i<expectedHash.length;i++){
      difference|=suppliedHash.charCodeAt(i)^expectedHash.charCodeAt(i);
    }
    return difference===0;
  }

  return Object.freeze({
    async issueChallenge({bearer,setupToken}={}){
      if(!await authorized(bearer))return null;
      return issueActivationChallenge(controlDb,setupToken,googleSubject);
    },
    async activate({bearer,setupToken,challengeToken,credential,code}={}){
      if(!await authorized(bearer))return false;
      return activateFactor({controlDb,setupToken,challengeToken,clientId,credential,totpSecret,code},
        {operatorId,googleSubject});
    },
    async readReceipt({bearer,challengeToken}={}){
      if(!await authorized(bearer))return null;
      const challengeHash=await hashOpaqueSessionToken(challengeToken);
      if(!challengeHash)return null;
      return controlDb.prepare(`SELECT a.operator_id AS operatorId,
        a.factor_version AS factorVersion,a.activated_at_ms AS activatedAtMs
        FROM platform_first_mfa_activation_audit a
        JOIN ${TABLE} c ON c.challenge_hash=a.challenge_hash
        WHERE a.challenge_hash=? AND a.operator_id=? AND c.subject=?`)
        .bind(challengeHash,operatorId,googleSubject).first();
    },
  });
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
