import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const STEP_MS=30_000;
const DB_STEP=`CAST(${NOW}/${STEP_MS} AS INTEGER)`;
const ATTEMPT_WINDOW_MS=60_000;
const MAX_ATTEMPTS=5;
const SESSION_MS=15*60_000;
const CHALLENGE=`FROM platform_login_challenges c
  JOIN platform_admin_auth a ON a.singleton=1 AND a.enabled=1
  JOIN platform_first_superadmin f ON f.singleton=a.singleton
  WHERE c.binding_hash=? AND a.factor_version=? AND c.expires_at_ms>${NOW}
    AND NOT EXISTS(SELECT 1 FROM platform_login_cancellations x WHERE x.binding_hash=c.binding_hash)`;

const UNUSED='AND NOT EXISTS(SELECT 1 FROM platform_login_attempts used WHERE used.binding_hash=c.binding_hash)';

async function matchingStep(totpSecret,code,step){
  const raw=Uint8Array.from(totpSecret.match(/../g),byte=>Number.parseInt(byte,16));
  const key=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-1'},false,['sign']);
  for(const candidate of [step,step-1]){
    const counter=new DataView(new ArrayBuffer(8));
    counter.setBigUint64(0,BigInt(candidate));
    const signature=new DataView(await crypto.subtle.sign('HMAC',key,counter));
    const offset=signature.getUint8(signature.byteLength-1)&15;
    const number=(signature.getUint32(offset)&0x7fffffff)%1_000_000;
    const expected=String(number).padStart(6,'0');
    let difference=0;
    for(let digit=0;digit<6;digit++)difference|=expected.charCodeAt(digit)^code.charCodeAt(digit);
    if(difference===0)return candidate;
  }
  return null;
}

/** Internal platform proof. Settings come from the trusted caller, never a request body. */
export async function issuePlatformSuperAdminSession({
  controlDb,clientId,totpSecret,factorVersion,browserToken,credential,code,
}){
  if(typeof totpSecret!=='string' || !/^[0-9a-f]{40}$/.test(totpSecret) ||
     !Number.isSafeInteger(factorVersion) || factorVersion<1 ||
     typeof code!=='string' || !/^[0-9]{6}$/.test(code))return null;
  const bindingHash=await hashOpaqueSessionToken(browserToken);
  if(!bindingHash)return null;
  const challenge=await controlDb.prepare(`SELECT c.nonce,f.issuer,f.subject
    ${CHALLENGE} ${UNUSED}`).bind(bindingHash,factorVersion).first();
  if(!challenge)return null;
  const identity=await verifyGoogleLoginIdToken({token:credential,clientId,expectedNonce:challenge.nonce});
  if(!identity || identity.issuer!==challenge.issuer || identity.subject!==challenge.subject)return null;

  const attempt=await controlDb.prepare(`INSERT INTO platform_login_attempts(binding_hash,attempted_at_ms)
    SELECT c.binding_hash,${NOW} ${CHALLENGE} ${UNUSED}
      AND c.nonce=? AND (SELECT count(*) FROM platform_login_attempts WHERE attempted_at_ms>${NOW}-?)<?
    RETURNING CAST(attempted_at_ms/${STEP_MS} AS INTEGER) AS step`)
    .bind(bindingHash,factorVersion,challenge.nonce,ATTEMPT_WINDOW_MS,MAX_ATTEMPTS).first();
  if(!attempt)return null;
  const matched=await matchingStep(totpSecret,code,attempt.step);
  if(matched===null)return null;

  const token=createOpaqueSessionToken();
  const tokenHash=await hashOpaqueSessionToken(token);
  const record=await controlDb.prepare(`INSERT INTO platform_admin_sessions
    (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
    SELECT ?,c.binding_hash,1,a.factor_version,?,${NOW},${NOW}+? ${CHALLENGE}
      AND c.nonce=? AND ? BETWEEN ${DB_STEP}-1 AND ${DB_STEP}
      AND NOT EXISTS(SELECT 1 FROM platform_admin_sessions s WHERE s.otp_step>=?)
    RETURNING expires_at_ms AS expiresAtMs`)
    .bind(tokenHash,matched,SESSION_MS,bindingHash,factorVersion,challenge.nonce,matched,matched).first();
  return record?{token,expiresAtMs:record.expiresAtMs}:null;
}

export async function validatePlatformSuperAdminSession(controlDb,token){
  const tokenHash=await hashOpaqueSessionToken(token);
  if(!tokenHash)return null;
  return controlDb.prepare(`SELECT f.issuer,f.subject,'PlatformSuperAdmin' AS role
    FROM platform_admin_sessions s JOIN platform_first_superadmin f ON f.singleton=s.singleton
    JOIN platform_admin_auth a ON a.singleton=s.singleton AND a.enabled=1 AND a.factor_version=s.factor_version
    WHERE s.token_hash=? AND s.issued_at_ms<=${NOW} AND s.expires_at_ms>${NOW} AND s.revoked_at_ms IS NULL`)
    .bind(tokenHash).first();
}

export async function revokePlatformSuperAdminSession(controlDb,token){
  const tokenHash=await hashOpaqueSessionToken(token);
  if(!tokenHash)return false;
  const result=await controlDb.prepare(`UPDATE platform_admin_sessions SET revoked_at_ms=${NOW}
    WHERE token_hash=? AND issued_at_ms<=${NOW} AND revoked_at_ms IS NULL`).bind(tokenHash).run();
  return result.success===true && result.meta?.changes===1;
}

/** Cancel a browser login and revoke its sessions in a single Control D1 transaction. */
export async function signOutPlatformBrowser(controlDb,{sessionToken,browserToken}){
  const [tokenHash,bindingHash]=await Promise.all([
    hashOpaqueSessionToken(sessionToken),hashOpaqueSessionToken(browserToken),
  ]);
  if(!tokenHash&&!bindingHash)return;
  await controlDb.batch([
    controlDb.prepare(`INSERT INTO platform_login_cancellations(binding_hash,cancelled_at_ms)
      SELECT binding_hash,${NOW} FROM platform_login_challenges WHERE binding_hash=?
      ON CONFLICT(binding_hash) DO NOTHING`).bind(bindingHash),
    controlDb.prepare(`UPDATE platform_admin_sessions SET revoked_at_ms=${NOW}
      WHERE (token_hash=? OR binding_hash=?) AND issued_at_ms<=${NOW} AND revoked_at_ms IS NULL`)
      .bind(tokenHash,bindingHash),
  ]);
}
