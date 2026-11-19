import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';
import {hashOpaqueSessionToken} from './session-token.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const isUuid=value=>typeof value==='string'&&UUID.test(value);

export async function verifyPlatformShopBinding(env,{shopId,sessionToken}){
  if(!isUuid(shopId))return 'invalid';
  const {
    CONTROL_DB:controlDb,PLATFORM_PILOT_DB:shopDb,PLATFORM_PILOT_SHOP_ID:expectedShopId,
    PLATFORM_PILOT_D1_ID:databaseId,PLATFORM_PILOT_MARKER:databaseMarker,
  }=env;
  if(typeof shopDb?.prepare!=='function'||!isUuid(expectedShopId)||!isUuid(databaseId)||!isUuid(databaseMarker)){
    return 'unavailable';
  }
  const sessionHash=await hashOpaqueSessionToken(sessionToken);
  if(!sessionHash||!await controlDb.prepare(`SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}`).bind(sessionHash).first()){
    return 'denied';
  }
  if(shopId!==expectedShopId)return 'not_found';
  let identity;
  try{
    identity=await shopDb.prepare('SELECT shop_id,database_id,database_marker FROM shop_identity WHERE singleton=1').first();
  }catch{
    return 'mismatch';
  }
  if(identity?.shop_id!==shopId||identity.database_id!==databaseId||identity.database_marker!==databaseMarker){
    return 'mismatch';
  }

  // The Shop D1 read is a snapshot. In Control D1 check the session again
  // in the same batch that creates or reads the immutable receipt.
  const [written,read]=await controlDb.batch([
    controlDb.prepare(`INSERT INTO platform_shop_bindings
      (shop_id,database_id,database_marker,verified_by_subject,verified_at_ms)
      SELECT ?,?,?,f.subject,${NOW} ${CURRENT_PLATFORM_ADMIN_FROM}
      AND EXISTS(SELECT 1 FROM platform_shop_reservations WHERE shop_id=? AND created_by_subject=f.subject)
      AND NOT EXISTS(SELECT 1 FROM platform_shop_bindings WHERE shop_id=?)
      AND NOT EXISTS(SELECT 1 FROM platform_shop_bindings WHERE database_id=? OR database_marker=?)`)
      .bind(shopId,databaseId,databaseMarker,sessionHash,shopId,shopId,databaseId,databaseMarker),
    controlDb.prepare(`WITH current_admin AS (SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})
      SELECT b.database_id,b.database_marker,r.shop_id
      FROM current_admin a
      LEFT JOIN platform_shop_reservations r ON r.shop_id=? AND r.created_by_subject=a.subject
      LEFT JOIN platform_shop_bindings b ON b.shop_id=r.shop_id`).bind(sessionHash,shopId),
  ]);
  if(!written.success||!read.success)throw new Error('Shop binding verification unavailable');
  const receipt=read.results[0];
  if(!receipt)return 'denied';
  if(!receipt.shop_id)return 'not_found';
  if(receipt.database_id!==databaseId||receipt.database_marker!==databaseMarker)return 'mismatch';
  return written.meta.changes===1?'created':'replayed';
}
