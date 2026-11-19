import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const CURRENT_OWNER=`FROM platform_first_shop_owners o
  JOIN platform_shop_owner_access a ON a.shop_id=o.shop_id AND a.enabled=1
  JOIN platform_shop_bindings b ON b.shop_id=o.shop_id`;

const pilotTuple=({shopId,databaseId,databaseMarker})=>[shopId,databaseId,databaseMarker];

// Internal service. The caller must pass the result of freshly verifying a
// Google credential and its server-issued challenge, never browser-supplied claims.
export async function issueOwnerSession(env,verifiedIdentity,{challengeHash=null,nonce=null}={}){
  if(typeof verifiedIdentity?.issuer!=='string'||typeof verifiedIdentity.subject!=='string')return null;
  const config=pilotShopConfiguration(env);
  if(!config||!await pilotShopIdentityMatches(config))return null;
  const token=createOpaqueSessionToken();
  const hash=await hashOpaqueSessionToken(token);
  const issued=await env.CONTROL_DB.prepare(`INSERT INTO platform_shop_owner_sessions
    (shop_id,token_hash,issued_at_ms,challenge_hash)
    SELECT o.shop_id,?,${NOW},? ${CURRENT_OWNER}
    WHERE o.shop_id=? AND b.database_id=? AND b.database_marker=? AND o.issuer=? AND o.subject=?
    AND (? IS NULL OR EXISTS(SELECT 1 FROM platform_shop_owner_login_challenges c
      WHERE c.shop_id=o.shop_id AND c.challenge_hash=? AND c.nonce=? AND c.expires_at_ms>${NOW}))
    ON CONFLICT(shop_id) DO UPDATE SET token_hash=excluded.token_hash,
      issued_at_ms=excluded.issued_at_ms,challenge_hash=excluded.challenge_hash
    RETURNING shop_id`)
    .bind(hash,challengeHash,...pilotTuple(config),verifiedIdentity.issuer,verifiedIdentity.subject,challengeHash,challengeHash,nonce).first();
  return issued?token:null;
}

export async function validateOwnerSession(env,token){
  const hash=await hashOpaqueSessionToken(token);
  const config=pilotShopConfiguration(env);
  if(!hash||!config||!await pilotShopIdentityMatches(config))return null;
  return env.CONTROL_DB.prepare(`SELECT o.shop_id AS shopId,'Owner' AS role ${CURRENT_OWNER}
    JOIN platform_shop_owner_sessions s ON s.shop_id=o.shop_id
    WHERE o.shop_id=? AND b.database_id=? AND b.database_marker=? AND s.token_hash=?`)
    .bind(...pilotTuple(config),hash).first();
}

export async function revokeOwnerSession(env,token){
  const hash=await hashOpaqueSessionToken(token);
  const config=pilotShopConfiguration(env);
  if(!hash||!config)return false;
  const result=await env.CONTROL_DB.prepare(`DELETE FROM platform_shop_owner_sessions
    WHERE shop_id=? AND token_hash=? AND EXISTS(
      SELECT 1 FROM platform_shop_bindings b
      WHERE b.shop_id=platform_shop_owner_sessions.shop_id AND b.database_id=? AND b.database_marker=?
    )`).bind(config.shopId,hash,config.databaseId,config.databaseMarker).run();
  return result.success===true&&result.meta?.changes===1;
}


export async function beginOwnerGoogleLogin(env){
  const config=pilotShopConfiguration(env);
  if(!config||!await pilotShopIdentityMatches(config))return null;
  const browserToken=createOpaqueSessionToken();
  const hash=await hashOpaqueSessionToken(browserToken);
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const db=env.CONTROL_DB;
  const [,inserted]=await db.batch([
    db.prepare(`DELETE FROM platform_shop_owner_login_challenges WHERE expires_at_ms<=${NOW}`),
    db.prepare(`INSERT INTO platform_shop_owner_login_challenges (challenge_hash,shop_id,nonce,expires_at_ms)
      SELECT ?,o.shop_id,?,${NOW}+120000 ${CURRENT_OWNER}
      WHERE o.shop_id=? AND b.database_id=? AND b.database_marker=?`).bind(hash,nonce,...pilotTuple(config)),
  ]);
  return inserted.success&&inserted.meta.changes===1?{browserToken,nonce}:null;
}

export async function loginOwnerWithGoogle(env,{browserToken,credential}){
  const config=pilotShopConfiguration(env);
  const challengeHash=await hashOpaqueSessionToken(browserToken);
  if(!config||!challengeHash)return null;
  const challenge=await env.CONTROL_DB.prepare(`SELECT nonce
    FROM platform_shop_owner_login_challenges WHERE shop_id=? AND challenge_hash=? AND expires_at_ms>${NOW}`)
    .bind(config.shopId,challengeHash).first();
  if(!challenge)return null;
  const identity=await verifyGoogleLoginIdToken({
    token:credential,clientId:env.PLATFORM_OWNER_CLIENT_ID,expectedNonce:challenge.nonce,
  });
  return identity?issueOwnerSession(env,identity,{challengeHash,nonce:challenge.nonce}):null;
}

export async function signOutOwnerBrowser(env,{sessionToken,browserToken}){
  const config=pilotShopConfiguration(env);
  if(!config)return false;
  const [sessionHash,challengeHash]=await Promise.all([
    hashOpaqueSessionToken(sessionToken),hashOpaqueSessionToken(browserToken),
  ]);
  if(!sessionHash&&!challengeHash)return true;
  const db=env.CONTROL_DB;
  const results=await db.batch([
    db.prepare(`DELETE FROM platform_shop_owner_login_challenges WHERE shop_id=? AND challenge_hash=?`)
      .bind(config.shopId,challengeHash),
    ...(env.OWNER_GMAIL_SIGNUP_ENABLED==='true'?[db.prepare(
      'DELETE FROM platform_owner_gmail_challenges WHERE shop_id=? AND challenge_hash=?',
    ).bind(config.shopId,challengeHash)]:[]),
    db.prepare(`DELETE FROM platform_shop_owner_sessions WHERE shop_id=? AND (token_hash=? OR challenge_hash=?)`)
      .bind(config.shopId,sessionHash,challengeHash),
  ]);
  return results.every(result=>result.success===true);
}
