import {publishOwnerWriteGrant,fenceOwnerWriteGrant} from '../db/shop-owner-write-grant.js';
import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';
import {hashOpaqueSessionToken} from './session-token.js';

// Reserve before publishing. Session rotation, deletion and disable cannot
// commit while a publication is outstanding, including a lost Shop response.
export async function publishCurrentOwnerWriteSession(env,token){
  const scope=pilotShopConfiguration(env);
  const hash=await hashOpaqueSessionToken(token);
  if(!scope||!hash)return false;
  const {shopId,databaseId,databaseMarker,shopDb}=scope;
  const current=await env.CONTROL_DB.prepare(`INSERT INTO platform_owner_grant_claim(shop_id,token_hash,generation)
    SELECT s.shop_id,s.token_hash,g.generation FROM platform_shop_owner_sessions s
    JOIN platform_owner_session_generation g ON g.shop_id=s.shop_id
    JOIN platform_shop_owner_access a ON a.shop_id=s.shop_id AND a.enabled=1
    JOIN platform_shop_bindings b ON b.shop_id=s.shop_id
    WHERE s.shop_id=? AND s.token_hash=? AND b.database_id=? AND b.database_marker=?
    ON CONFLICT(shop_id) DO UPDATE SET token_hash=excluded.token_hash
    WHERE platform_owner_grant_claim.token_hash=excluded.token_hash
      AND platform_owner_grant_claim.generation=excluded.generation
    RETURNING generation`).bind(shopId,hash,databaseId,databaseMarker).first();
  if(!current)return false;
  return publishOwnerWriteGrant(shopDb,scope,token,current.generation);
}

// Only trusted callers may supply the digest selected by an authenticated
// session change. The digest can also identify a login cancelled via challenge.
export async function fenceOwnerSession(env,sessionHash){
  if(env.OWNER_WRITE_GRANTS_ENABLED!=='true'||!sessionHash)return;
  const scope=pilotShopConfiguration(env);
  if(!scope)throw new Error('Owner write scope unavailable');
  const db=env.CONTROL_DB;
  const claim=await db.prepare(`SELECT c.generation,b.database_id,b.database_marker FROM platform_owner_grant_claim c
    JOIN platform_shop_bindings b ON b.shop_id=c.shop_id WHERE c.shop_id=? AND c.token_hash=?`).bind(scope.shopId,sessionHash).first();
  if(!claim)return;
  if(claim.database_id!==scope.databaseId||claim.database_marker!==scope.databaseMarker)throw new Error('Owner binding mismatch');
  if(!await fenceOwnerWriteGrant(scope.shopDb,scope,sessionHash,claim.generation)){
    throw new Error('Owner grant withdrawal incomplete');
  }
  await db.prepare(`DELETE FROM platform_owner_grant_claim
    WHERE shop_id=? AND token_hash=? AND generation=?`).bind(scope.shopId,sessionHash,claim.generation).run();
}

export async function finishOwnerLogin(env,token){
  if(token&&env.OWNER_WRITE_GRANTS_ENABLED==='true'&&!await publishCurrentOwnerWriteSession(env,token)){
    throw new Error('Owner write grant unavailable');
  }
  return token;
}

// First-Owner identity is immutable. Disable access and let the existing
// Control triggers remove the login challenge and session atomically.
export async function disablePlatformShopOwner(env,shopId,platformToken){
  const adminHash=await hashOpaqueSessionToken(platformToken);
  const db=env.CONTROL_DB;
  if(!adminHash||!await db.prepare(`SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}`).bind(adminHash).first())return 'denied';
  const scope=pilotShopConfiguration(env);
  if(!scope||scope.shopId!==shopId||!await pilotShopIdentityMatches(scope))return 'mismatch';
  const match=`EXISTS(SELECT 1 FROM platform_shop_bindings
    WHERE shop_id=? AND database_id=? AND database_marker=?)`;
  const tuple=[shopId,scope.databaseId,scope.databaseMarker];
  const session=await db.prepare(`SELECT token_hash FROM platform_shop_owner_sessions WHERE shop_id=? AND ${match}`)
    .bind(shopId,...tuple).first();
  await fenceOwnerSession(env,session?.token_hash);
  const disabled=await db.prepare(`UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=? AND ${match}
    AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}) RETURNING shop_id`).bind(shopId,...tuple,adminHash).first();
  return disabled?'disabled':'denied';
}
