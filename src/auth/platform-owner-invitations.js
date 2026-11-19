import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const GOOGLE_ISSUER='https://accounts.google.com';
const GOOGLE_SUBJECT=/^[!-~]{1,255}$/;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const LIFETIME_MS=600_000;

export async function issuePlatformOwnerInvitation(env,{googleSubject,sessionToken}){
  if(typeof googleSubject!=='string'||!GOOGLE_SUBJECT.test(googleSubject))return {status:'invalid'};
  const configuration=pilotShopConfiguration(env);
  if(!configuration)return {status:'unavailable'};
  const {CONTROL_DB:db}=env;
  const {shopId,databaseId,databaseMarker}=configuration;
  const sessionHash=await hashOpaqueSessionToken(sessionToken);
  if(!sessionHash||!await db.prepare(`SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}`).bind(sessionHash).first()){
    return {status:'denied'};
  }
  if(!await pilotShopIdentityMatches(configuration))return {status:'conflict'};

  const inviteCode=createOpaqueSessionToken();
  const inviteHash=await hashOpaqueSessionToken(inviteCode);
  const receipt=await db.prepare(`INSERT INTO platform_owner_invitations
    (token_hash,shop_id,recipient_issuer,recipient_subject,issued_by_subject,issued_at_ms,expires_at_ms)
    SELECT ?,?,?,?,f.subject,${NOW},${NOW}+? ${CURRENT_PLATFORM_ADMIN_FROM}
    AND EXISTS(SELECT 1 FROM platform_shop_bindings b
      WHERE b.shop_id=? AND b.database_id=? AND b.database_marker=? AND b.verified_by_subject=f.subject)
    AND NOT EXISTS(SELECT 1 FROM platform_owner_invitations WHERE shop_id=? AND expires_at_ms>${NOW})
    AND NOT EXISTS(SELECT 1 FROM platform_first_shop_owners WHERE shop_id=?)
    RETURNING expires_at_ms AS expiresAtMs`)
    .bind(inviteHash,shopId,GOOGLE_ISSUER,googleSubject,LIFETIME_MS,sessionHash,shopId,databaseId,databaseMarker,shopId,shopId).first();
  if(!receipt)return {status:'conflict'};
  return {status:'created',inviteCode,expiresAtMs:receipt.expiresAtMs};
}
