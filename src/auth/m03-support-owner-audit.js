/**
 * Owner-scoped, read-only Support Access audit view.
 *
 * The trusted private Owner Worker supplies its physical Shop D1 binding.
 * All Owner authority and event selection are ONE current Control D1 SELECT.
 * This does not create or permit a support grant; no financial data is read.
 * Its HTTP route remains default-off until a separately reviewed migration.
 */
import {hashOpaqueSessionToken} from './session-token.js';
import {OWNER_SESSION_FRESH_SQL} from './platform-owner-session-deadline.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';

const OWNER_AUDIT_SQL=`WITH current_owner AS (
  SELECT o.shop_id AS shopId
  FROM platform_first_shop_owners o
  JOIN platform_shop_owner_access a ON a.shop_id=o.shop_id AND a.enabled=1
  JOIN platform_shop_bindings b ON b.shop_id=o.shop_id
  JOIN platform_shop_owner_sessions s ON s.shop_id=o.shop_id
  WHERE s.token_hash=? AND ${OWNER_SESSION_FRESH_SQL}
    AND o.shop_id=? AND b.database_id=? AND b.database_marker=?
),
recent AS (
  SELECT e.event_type AS eventType,e.event_at_ms AS eventAtMs,
    g.operation_id AS operationId,g.reason AS reason,e.event_id AS eventId
  FROM m03_local_support_events e
  JOIN m03_local_support_grants g
    ON g.operation_id=e.grant_operation_id AND g.shop_id=e.shop_id
  JOIN current_owner owner ON owner.shopId=e.shop_id
  ORDER BY e.event_at_ms DESC,e.event_id DESC LIMIT 50
)
SELECT owner.shopId,recent.eventType,recent.eventAtMs,
  recent.operationId,recent.reason
FROM current_owner owner LEFT JOIN recent ON TRUE
ORDER BY recent.eventAtMs DESC,recent.eventId DESC`;

const ACTIONS=new Set(['START','READ','END']);

/**
 * Result: {status:'ok',events:[...]} / {status:'denied'|'unavailable'}.
 * No Owner or Admin bearer, Google identity, database ID or account row content.
 */
export async function readOwnerSupportAudit(env,ownerToken){
  const scope=pilotShopConfiguration(env??{});
  const hash=await hashOpaqueSessionToken(ownerToken);
  if(!scope||!hash||typeof env.CONTROL_DB?.prepare!=='function')return {status:'denied'};
  if(!await pilotShopIdentityMatches(scope))return {status:'denied'};
  try{
    const response=await env.CONTROL_DB.prepare(OWNER_AUDIT_SQL)
      .bind(hash,scope.shopId,scope.databaseId,scope.databaseMarker).all();
    const rows=response?.results;
    if(!Array.isArray(rows))return {status:'unavailable'};
    if(rows.length===0)return {status:'denied'};
    if(rows.length>50)return {status:'unavailable'};
    const events=[];
    for(const row of rows){
      if(row.shopId!==scope.shopId)return {status:'unavailable'};
      if(row.eventType===null)continue;
      if(!ACTIONS.has(row.eventType)||!Number.isSafeInteger(row.eventAtMs)||
         row.eventAtMs<=0||typeof row.operationId!=='string'||
         typeof row.reason!=='string'||row.reason.length>180){
        return {status:'unavailable'};
      }
      events.push({
        eventType:row.eventType,eventAtMs:row.eventAtMs,
        operationId:row.operationId,reason:row.reason,
        actor:'Platform Super Admin',
      });
    }
    return {status:'ok',events};
  }catch{
    // A missing support-audit schema is NOT equivalent to an empty history.
    // No database errors or Shop details are returned.
    return {status:'unavailable'};
  }
}
