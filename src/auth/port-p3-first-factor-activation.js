/**
 * PORT-P3 Run 2: internal-only, first platform Super Admin MFA activation proof.
 *
 * The caller MUST be a separately approved trusted operator with an already
 * verified Control D1 binding and the matching protected TOTP configuration.
 * This is NOT an authorization API, public route, installer, secret store,
 * lost-factor recovery mechanism or approval for remote database writes.
 *
 * This module is deliberately not imported from any deployed Worker.
 */
import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {hashOpaqueSessionToken} from './session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const CURRENT_STEP=`CAST(${NOW}/30000 AS INTEGER)`;
const HEX_SECRET=/^[0-9a-f]{40}$/;
const SIX_DIGITS=/^[0-9]{6}$/;

export function validFirstFactorTotp(secret,code){
  return typeof secret==='string' && HEX_SECRET.test(secret) &&
    typeof code==='string' && SIX_DIGITS.test(code);
}

export async function proveTotpStep(secret,code,step){
  const bytes=Uint8Array.from(secret.match(/../g),pair=>Number.parseInt(pair,16));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-1'},false,['sign']);
  for(const candidate of [step,step-1]){
    const counter=new DataView(new ArrayBuffer(8));
    counter.setBigUint64(0,BigInt(candidate));
    const mac=new DataView(await crypto.subtle.sign('HMAC',key,counter));
    const offset=mac.getUint8(mac.byteLength-1)&15;
    const truncated=(mac.getUint32(offset)&0x7fffffff)%1_000_000;
    const expected=String(truncated).padStart(6,'0');
    let difference=0;
    for(let digit=0;digit<6;digit++)difference|=expected.charCodeAt(digit)^code.charCodeAt(digit);
    if(difference===0)return candidate;
  }
  return null;
}

/**
 * Enable version 1 only after the immutable first-admin identity, original
 * unexpired setup ticket, fresh signed Google proof, and TOTP are verified.
 *
 * The SQL write repeats all mutable guards and checks OTP time against the
 * D1 server clock. A single INSERT is the concurrency/replay boundary.
 * The TOTP secret is supplied in volatile memory and is NEVER stored in D1.
 */
export async function activateFirstPlatformFactor({
  controlDb,setupToken,clientId,credential,totpSecret,code,
}={}){
  if(typeof controlDb?.prepare!=='function' || !validFirstFactorTotp(totpSecret,code))return false;

  try{
    const ticketHash=await hashOpaqueSessionToken(setupToken);
    if(!ticketHash)return false;

    const ticket=await controlDb.prepare(`SELECT t.nonce,t.issuer,t.subject,
      ${CURRENT_STEP} AS step
      FROM platform_first_superadmin f
      JOIN platform_setup_tickets t ON t.token_hash=f.setup_token_hash
      WHERE f.singleton=1 AND t.token_hash=?
        AND t.issuer=f.issuer AND t.subject=f.subject
        AND t.issued_at_ms<=${NOW} AND t.expires_at_ms>${NOW}
        AND t.revoked_at_ms IS NULL
        AND NOT EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)`)
      .bind(ticketHash).first();
    if(!ticket || !Number.isSafeInteger(ticket.step) || ticket.step<1)return false;

    const identity=await verifyGoogleLoginIdToken({
      token:credential,clientId,expectedNonce:ticket.nonce,
    });
    if(!identity || identity.issuer!==ticket.issuer || identity.subject!==ticket.subject)return false;

    const matchedStep=await proveTotpStep(totpSecret,code,ticket.step);
    if(matchedStep===null)return false;

    const result=await controlDb.prepare(`INSERT INTO platform_admin_auth
      (singleton,enabled,factor_version)
      SELECT 1,1,1
      FROM platform_first_superadmin f
      JOIN platform_setup_tickets t ON t.token_hash=f.setup_token_hash
      WHERE f.singleton=1 AND t.token_hash=? AND t.nonce=?
        AND t.issuer=? AND t.subject=? AND f.issuer=? AND f.subject=?
        AND t.issued_at_ms<=${NOW} AND t.expires_at_ms>${NOW}
        AND t.revoked_at_ms IS NULL
        AND ? BETWEEN ${CURRENT_STEP}-1 AND ${CURRENT_STEP}
        AND NOT EXISTS(SELECT 1 FROM platform_admin_auth WHERE singleton=1)`)
      .bind(ticketHash,ticket.nonce,identity.issuer,identity.subject,
        identity.issuer,identity.subject,matchedStep).run();
    return result.success===true && result.meta?.changes===1;
  }catch{
    // Fail closed. No credential, token, SQL diagnostic or secret is logged.
    return false;
  }
}
