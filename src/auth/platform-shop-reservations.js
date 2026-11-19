import {hashOpaqueSessionToken} from './session-token.js';
import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';

const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export async function reservePlatformShop(db,{operationId,displayName,sessionToken}){
  const name=typeof displayName==='string'?displayName.trim():'';
  if(typeof operationId!=='string'||!UUID_V4.test(operationId)||!name||name.length>120||/\p{Cc}/u.test(name)){
    return {status:'invalid'};
  }
  const sessionHash=await hashOpaqueSessionToken(sessionToken);
  if(!sessionHash)return {status:'denied'};

  // D1 executes these statements atomically. The session is checked inside
  // the write, and a retry can only read a receipt under the current session.
  const [written,read]=await db.batch([
    db.prepare(`INSERT INTO platform_shop_reservations
      (shop_id,operation_id,display_name,created_by_subject,created_at_ms)
      SELECT ?,?,?,f.subject,${NOW} ${CURRENT_PLATFORM_ADMIN_FROM}
      AND NOT EXISTS(SELECT 1 FROM platform_shop_reservations WHERE operation_id=?)`)
      .bind(crypto.randomUUID(),operationId,name,sessionHash,operationId),
    db.prepare(`WITH current_admin AS (SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})
      SELECT r.shop_id AS shopId,r.display_name AS displayName
      FROM current_admin a JOIN platform_shop_reservations r
        ON r.created_by_subject=a.subject WHERE r.operation_id=?`).bind(sessionHash,operationId),
  ]);
  if(!written.success||!read.success)throw new Error('Business reservation unavailable');
  const receipt=read.results[0];
  if(!receipt)return {status:'denied'};
  if(receipt.displayName!==name)return {status:'conflict'};
  return {
    status:written.meta.changes===1?'created':'replayed',
    reservation:{shopId:receipt.shopId,displayName:receipt.displayName,status:'reserved'},
  };
}
