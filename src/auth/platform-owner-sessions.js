import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const CURRENT_OWNER=`FROM platform_first_shop_owners o
  JOIN platform_shop_owner_access a ON a.shop_id=o.shop_id AND a.enabled=1
  JOIN platform_shop_bindings b ON b.shop_id=o.shop_id`;

const pilotTuple=({shopId,databaseId,databaseMarker})=>[shopId,databaseId,databaseMarker];

// Internal service. The caller must pass the result of freshly verifying a
// Google credential and its server-issued challenge, never browser-supplied claims.
export async function issueOwnerSession(env,verifiedIdentity){
  if(typeof verifiedIdentity?.issuer!=='string'||typeof verifiedIdentity.subject!=='string')return null;
  const config=pilotShopConfiguration(env);
  if(!config||!await pilotShopIdentityMatches(config))return null;
  const token=createOpaqueSessionToken();
  const hash=await hashOpaqueSessionToken(token);
  const issued=await env.CONTROL_DB.prepare(`INSERT INTO platform_shop_owner_sessions
    (shop_id,token_hash,issued_at_ms)
    SELECT o.shop_id,?,${NOW} ${CURRENT_OWNER}
    WHERE o.shop_id=? AND b.database_id=? AND b.database_marker=? AND o.issuer=? AND o.subject=?
    ON CONFLICT(shop_id) DO UPDATE SET token_hash=excluded.token_hash,issued_at_ms=excluded.issued_at_ms
    RETURNING shop_id`)
    .bind(hash,...pilotTuple(config),verifiedIdentity.issuer,verifiedIdentity.subject).first();
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
