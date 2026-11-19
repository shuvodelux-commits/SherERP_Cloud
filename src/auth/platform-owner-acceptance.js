import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const ELIGIBLE=`FROM platform_owner_invitations i
  JOIN platform_shop_bindings b ON b.shop_id=i.shop_id
  WHERE i.token_hash=? AND i.shop_id=? AND b.database_id=? AND b.database_marker=?
  AND i.issued_at_ms<=${NOW} AND i.expires_at_ms>${NOW}
  AND NOT EXISTS(SELECT 1 FROM platform_first_shop_owners o WHERE o.shop_id=i.shop_id)`;

async function activeInvite(env,inviteCode){
  const config=pilotShopConfiguration(env);
  const hash=await hashOpaqueSessionToken(inviteCode);
  if(!config||!hash)return null;
  const params=[hash,config.shopId,config.databaseId,config.databaseMarker];
  const invite=await env.CONTROL_DB.prepare(`SELECT i.recipient_issuer,i.recipient_subject ${ELIGIBLE}`).bind(...params).first();
  if(!invite||!await pilotShopIdentityMatches(config))return null;
  // Domain separation keeps the Google challenge distinct from the D1 lookup digest.
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('shererp-first-owner:'+inviteCode));
  const nonce=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return {nonce,invite,params,config};
}

export async function readOwnerInviteChallenge(env,inviteCode){
  return (await activeInvite(env,inviteCode))?.nonce??null;
}

export async function acceptOwnerInvite(env,{inviteCode,credential}){
  const active=await activeInvite(env,inviteCode);
  if(!active)return null;
  const identity=await verifyGoogleLoginIdToken({
    token:credential,clientId:env.PLATFORM_OWNER_CLIENT_ID,expectedNonce:active.nonce,
  });
  if(!identity||identity.issuer!==active.invite.recipient_issuer||identity.subject!==active.invite.recipient_subject)return null;
  if(!await pilotShopIdentityMatches(active.config))return null;
  const receipt=await env.CONTROL_DB.prepare(`INSERT INTO platform_first_shop_owners
    (shop_id,invite_hash,issuer,subject,accepted_at_ms)
    SELECT i.shop_id,i.token_hash,i.recipient_issuer,i.recipient_subject,${NOW} ${ELIGIBLE}
    AND i.recipient_issuer=? AND i.recipient_subject=?
    RETURNING shop_id AS shopId`).bind(...active.params,identity.issuer,identity.subject).first();
  return receipt?{shopId:receipt.shopId,role:'Owner'}:null;
}
