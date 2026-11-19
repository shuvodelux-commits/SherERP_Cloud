import {normalizeGoogleGmail} from './google-id-token.js';
import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';
import {hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export async function approvePlatformOwnerGmail(env,{email,sessionToken}){
  const gmail=normalizeGoogleGmail(typeof email==='string'?email.trim():null);
  if(!gmail)return {status:'invalid'};
  const config=pilotShopConfiguration(env);
  if(!config)return {status:'unavailable'};
  const {shopId,databaseId,databaseMarker}=config;
  const db=env.CONTROL_DB;
  const sessionHash=await hashOpaqueSessionToken(sessionToken);
  if(!sessionHash||!await db.prepare(`SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}`).bind(sessionHash).first()){
    return {status:'denied'};
  }
  if(!await pilotShopIdentityMatches(config))return {status:'conflict'};
  const approved=await db.prepare(`INSERT INTO platform_owner_gmail_approvals
    (shop_id,email,approved_by_subject,approved_at_ms)
    SELECT ?,?,f.subject,${NOW} ${CURRENT_PLATFORM_ADMIN_FROM}
    AND EXISTS(SELECT 1 FROM platform_shop_bindings b
      WHERE b.shop_id=? AND b.database_id=? AND b.database_marker=? AND b.verified_by_subject=f.subject)
    AND NOT EXISTS(SELECT 1 FROM platform_first_shop_owners WHERE shop_id=?)
    ON CONFLICT(shop_id) DO UPDATE SET email=excluded.email,
      approved_by_subject=excluded.approved_by_subject,approved_at_ms=excluded.approved_at_ms
    RETURNING shop_id AS shopId,email`)
    .bind(shopId,gmail,sessionHash,shopId,databaseId,databaseMarker,shopId).first();
  return approved?{status:'approved',...approved}:{status:'conflict'};
}
