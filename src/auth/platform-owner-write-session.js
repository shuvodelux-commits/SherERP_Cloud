import {publishOwnerWriteGrant} from '../db/shop-owner-write-grant.js';
import {pilotShopConfiguration} from './platform-shop-binding.js';
import {hashOpaqueSessionToken} from './session-token.js';

// Internal candidate for use after Owner authentication. Do not expose it as
// an RPC: the release must coordinate Shop D1 withdrawal with Control D1
// sign-out and disable before it serves any product write route.
export async function publishCurrentOwnerWriteSession(env,token){
  const scope=pilotShopConfiguration(env);
  const hash=await hashOpaqueSessionToken(token);
  if(!scope||!hash)return false;
  const {shopId,databaseId,databaseMarker,shopDb}=scope;
  const current=await env.CONTROL_DB.prepare(`SELECT g.generation
    FROM platform_shop_owner_sessions s
    JOIN platform_owner_session_generation g ON g.shop_id=s.shop_id
    JOIN platform_shop_owner_access a ON a.shop_id=s.shop_id AND a.enabled=1
    JOIN platform_shop_bindings b ON b.shop_id=s.shop_id
    WHERE s.shop_id=? AND s.token_hash=? AND b.database_id=? AND b.database_marker=?`)
    .bind(shopId,hash,databaseId,databaseMarker).first();
  if(!current)return false;
  return publishOwnerWriteGrant(shopDb,scope,token,current.generation);
}
