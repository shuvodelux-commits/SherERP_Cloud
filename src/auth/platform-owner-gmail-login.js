import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const APPROVED_SHOP=`FROM platform_owner_gmail_approvals a
  JOIN platform_shop_bindings b ON b.shop_id=a.shop_id
  WHERE a.shop_id=? AND b.database_id=? AND b.database_marker=?
    AND NOT EXISTS(SELECT 1 FROM platform_first_shop_owners o WHERE o.shop_id=a.shop_id)`;
const scope=({shopId,databaseId,databaseMarker})=>[shopId,databaseId,databaseMarker];

export async function beginFirstOwnerGmailLogin(env){
  const config=pilotShopConfiguration(env);
  if(!config||!await pilotShopIdentityMatches(config))return null;
  const browserToken=createOpaqueSessionToken();
  const digest=await hashOpaqueSessionToken(browserToken);
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const db=env.CONTROL_DB;
  const [,write]=await db.batch([
    db.prepare(`DELETE FROM platform_owner_gmail_challenges WHERE expires_at_ms<=${NOW}`),
    db.prepare(`INSERT INTO platform_owner_gmail_challenges (challenge_hash,shop_id,nonce,expires_at_ms)
      SELECT ?,a.shop_id,?,${NOW}+120000 ${APPROVED_SHOP}`).bind(digest,nonce,...scope(config)),
  ]);
  return write.success&&write.meta.changes===1?{browserToken,nonce}:null;
}

export async function loginFirstOwnerWithGmail(env,{browserToken,credential}){
  const config=pilotShopConfiguration(env);
  const browserHash=await hashOpaqueSessionToken(browserToken);
  if(!config||!browserHash)return null;
  const db=env.CONTROL_DB;
  const challenge=await db.prepare(`SELECT nonce FROM platform_owner_gmail_challenges
    WHERE challenge_hash=? AND shop_id=? AND expires_at_ms>${NOW}`).bind(browserHash,config.shopId).first();
  if(!challenge)return null;
  const identity=await verifyGoogleLoginIdToken({
    token:credential,clientId:env.PLATFORM_OWNER_CLIENT_ID,expectedNonce:challenge.nonce,requireGmail:true,
  });
  if(!identity||!await pilotShopIdentityMatches(config))return null;
  const token=createOpaqueSessionToken();
  const tokenHash=await hashOpaqueSessionToken(token);
  // The existing immutable first-Owner record references an invitation audit
  // row. This identifier has no redeemable code and never leaves the server.
  const auditId=createOpaqueSessionToken();
  const results=await db.batch([
    db.prepare(`INSERT INTO platform_owner_invitations
      (token_hash,shop_id,recipient_issuer,recipient_subject,issued_by_subject,issued_at_ms,expires_at_ms)
      SELECT ?,a.shop_id,?,?,a.approved_by_subject,${NOW},${NOW}+120000 ${APPROVED_SHOP}
      AND a.email=? AND EXISTS(SELECT 1 FROM platform_owner_gmail_challenges c
        WHERE c.shop_id=a.shop_id AND c.challenge_hash=? AND c.nonce=? AND c.expires_at_ms>${NOW})`)
      .bind(auditId,identity.issuer,identity.subject,...scope(config),identity.email,browserHash,challenge.nonce),
    db.prepare(`INSERT INTO platform_first_shop_owners (shop_id,invite_hash,issuer,subject,accepted_at_ms)
      SELECT shop_id,token_hash,recipient_issuer,recipient_subject,${NOW}
      FROM platform_owner_invitations WHERE token_hash=? AND shop_id=?`).bind(auditId,config.shopId),
    db.prepare(`INSERT INTO platform_shop_owner_sessions (shop_id,token_hash,issued_at_ms,challenge_hash)
      SELECT o.shop_id,?,${NOW},? FROM platform_first_shop_owners o
      JOIN platform_shop_owner_access a ON a.shop_id=o.shop_id AND a.enabled=1
      WHERE o.shop_id=? AND o.invite_hash=?`).bind(tokenHash,browserHash,config.shopId,auditId),
    db.prepare(`DELETE FROM platform_owner_gmail_challenges WHERE shop_id=? AND challenge_hash=?
      AND EXISTS(SELECT 1 FROM platform_shop_owner_sessions WHERE shop_id=? AND token_hash=?)`)
      .bind(config.shopId,browserHash,config.shopId,tokenHash),
    db.prepare('SELECT 1 FROM platform_shop_owner_sessions WHERE shop_id=? AND token_hash=?')
      .bind(config.shopId,tokenHash),
  ]);
  if(!results.every(result=>result.success===true))throw new Error('Owner sign-in unavailable');
  return results.at(-1).results.length===1?token:null;
}
