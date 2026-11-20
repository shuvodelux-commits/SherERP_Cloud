/**
 * First Support Edit business slice: clean-Shop standard Product creation.
 * PRIVATE, DEFAULT OFF. No Owner impersonation or Owner session lease.
 * This module needs the separately approved Control D1 0002 and staged
 * Shop D1 0012 migration; it is NOT a production HTTP endpoint.
 */
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {validatePlatformSuperAdminSession,CURRENT_PLATFORM_ADMIN_FROM}
  from '../auth/platform-superadmin-session.js';
import {pilotShopConfiguration,pilotShopIdentityMatches}
  from '../auth/platform-shop-binding.js';
import {authorizeSupportWriteIntent}
  from '../modules/m03-support-write-authority.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {validateOwnerProductDraft,CLEAN_PRODUCT_SOURCE}
  from './m03-owner-product-create.js';
import {originalSourceIdPrefix} from './m03-source-id-families.js';

const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const denied=()=>({status:'denied'});
const supportEnabled=env=>env?.M03_SUPPORT_WRITE_ENABLED==='true'&&
  env.M03_SUPPORT_PRODUCT_WRITES_ENABLED==='true'&&
  typeof env.CONTROL_DB?.prepare==='function';

const SQL_PERMIT=`EXISTS(
  SELECT 1 FROM shop_support_product_permits p
  JOIN shop_identity i ON i.singleton=1
  WHERE p.intent_id=? AND p.operation_id=? AND p.intent_hash=?
    AND p.actor_id=? AND p.name_key=? AND p.payload=?
    AND p.grant_id=?
    AND p.shop_id=i.shop_id
    AND p.database_id=i.database_id AND p.database_marker=i.database_marker
    AND p.issued_at_ms<=${NOW} AND p.expires_at_ms>${NOW}
)`;

/**
 * This intentionally returns the original Product ID and receipt.
 * Caller must never retry using a different operation ID after an
 * uncertain Shop D1 outcome; the original receipt is the authority.
 */
export async function createSupportProduct(env,{grantId,sessionToken,input}={}){
  if(!supportEnabled(env)||!UUID.test(grantId))return denied();
  const payload=validateOwnerProductDraft(input);
  if(!payload||!UUID.test(input?.operationId))return {status:'invalid'};
  try{
    const scope=pilotShopConfiguration(env);
    if(!scope||!await pilotShopIdentityMatches(scope))return denied();
    const admin=await validatePlatformSuperAdminSession(env.CONTROL_DB,sessionToken);
    if(!admin?.subject||!/^[-A-Za-z0-9_.:]{1,108}$/.test(admin.subject))
      return denied();
    const actorId='support:'+admin.subject;
    const opId=input.operationId;
    const intentHash=await hashCanonicalOperationIntent({
      tenantId:scope.shopId,actorId,operationType:'products.add',payload
    });
    const intent=await authorizeSupportWriteIntent(env,{
      grantId,action:'products.add',intentId:opId,
      intentHash,sessionToken
    });
    if(!['authorized-intent','replayed'].includes(intent.status))return denied();

    const sessionHash=await hashOpaqueSessionToken(sessionToken);
    const g=await env.CONTROL_DB.prepare(`SELECT
      g.operation_id AS grantId,g.actor_subject AS actorSubject,
      g.shop_id AS shopId,g.database_id AS databaseId,
      g.database_marker AS databaseMarker,g.expires_at_ms AS expiresAtMs
      FROM m03_support_write_intents p
      JOIN m03_support_write_grants g ON g.operation_id=p.write_grant_operation_id
      JOIN m03_local_support_grants r ON r.operation_id=g.read_grant_operation_id
      JOIN platform_shop_bindings b ON b.shop_id=g.shop_id
        AND b.database_id=g.database_id AND b.database_marker=g.database_marker
      JOIN platform_shop_provisioning v ON v.shop_id=g.shop_id
        AND v.stage='ready' AND v.database_id=b.database_id
        AND v.database_marker=b.database_marker
      WHERE p.intent_id=? AND p.intent_hash=? AND p.action='products.add'
        AND p.actor_subject=? AND g.operation_id=? AND g.scope='products'
        AND g.admin_session_hash=? AND g.revoked_at_ms IS NULL
        AND g.issued_at_ms<=${NOW} AND g.expires_at_ms>${NOW}
        AND r.revoked_at_ms IS NULL AND r.issued_at_ms<=${NOW}
        AND r.expires_at_ms>${NOW}
        AND r.admin_session_hash=g.admin_session_hash
        AND r.shop_id=g.shop_id
        AND r.database_id=g.database_id AND r.database_marker=g.database_marker
        AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
          AND f.subject=g.actor_subject AND a.factor_version=g.factor_version)`)
      .bind(opId,intentHash,admin.subject,grantId,sessionHash,sessionHash).first();
    if(!g||g.actorSubject!==admin.subject||g.shopId!==scope.shopId||
      g.databaseId!==scope.databaseId||
      g.databaseMarker!==scope.databaseMarker||
      !Number.isSafeInteger(g.expiresAtMs)||
      g.expiresAtMs<=Date.now())return denied();

    const db=scope.shopDb;
    // Each approval is bound to ONE operation, intent hash, Support actor and
    // immutable physical Shop tuple. It is not an Owner grant.
    const time=Date.now();
    await db.prepare(`INSERT INTO shop_support_product_permits
      (intent_id,grant_id,operation_id,shop_id,database_id,
       database_marker,actor_id,name_key,payload,intent_hash,
       issued_at_ms,expires_at_ms)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? FROM shop_identity i
      WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=?
        AND i.database_marker=? AND ?>${NOW}
        AND NOT EXISTS(SELECT 1 FROM shop_support_product_permits
          WHERE intent_id=? OR operation_id=?)`)
      .bind(opId,grantId,opId,scope.shopId,scope.databaseId,
        scope.databaseMarker,actorId,payload.name.toLowerCase(),
        JSON.stringify(payload),intentHash,time,
        Math.min(g.expiresAtMs,time+300000),
        scope.shopId,scope.databaseId,scope.databaseMarker,
        g.expiresAtMs,opId,opId).run();
    const permitArgs=[opId,opId,intentHash,actorId,
      payload.name.toLowerCase(),JSON.stringify(payload),grantId];
    const [insert,read]=await db.batch([
      db.prepare(`INSERT INTO owner_product_create_receipts
        (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
        SELECT ?,?,?,?,?,${NOW}
        WHERE ${SQL_PERMIT} AND ${CLEAN_PRODUCT_SOURCE}
          AND NOT EXISTS(SELECT 1 FROM owner_product_create_receipts
            WHERE operation_id=?)
          AND NOT EXISTS(SELECT 1 FROM owner_product_create_receipts r
            JOIN products p ON p.product_id='PRD-'||printf('%06d',r.sequence)
            WHERE r.name_key=? AND p.is_deleted=0)
        RETURNING sequence`)
        .bind(opId,actorId,intentHash,payload.name.toLowerCase(),
          JSON.stringify(payload),...permitArgs,opId,payload.name.toLowerCase()),
      db.prepare(`SELECT ${SQL_PERMIT} AS authorized,
        (${CLEAN_PRODUCT_SOURCE}) AS clean,r.sequence,r.actor_id,r.intent_hash
        FROM (SELECT 1) x LEFT JOIN owner_product_create_receipts r
          ON r.operation_id=?`).bind(...permitArgs,opId)
    ]);
    if(insert?.success!==true||read?.success!==true)
      return {status:'needs-review'};
    const row=read.results?.[0];
    if(row?.authorized!==1)return denied();
    if(row.clean!==1)return {status:'unavailable'};
    if(row.actor_id!==actorId||row.intent_hash!==intentHash)
      return {status:'conflict'};
    if(!Number.isSafeInteger(row.sequence)||row.sequence<1)
      return {status:'needs-review'};
    const newState=insert.results?.length===1?'created':'replayed';

    // Report only after a verified Shop receipt. If Control D1 logging
    // cannot complete, return needs-review; NEVER invent a second sale/ID.
    const eventId=opId+':RESULT';
    const audit=await env.CONTROL_DB.prepare(`INSERT INTO m03_support_write_events
      (event_id,write_grant_operation_id,shop_id,actor_subject,
       event_type,intent_id,event_at_ms)
      SELECT ?,g.operation_id,g.shop_id,g.actor_subject,
        'RESULT',p.intent_id,${NOW}
      FROM m03_support_write_intents p
      JOIN m03_support_write_grants g ON g.operation_id=p.write_grant_operation_id
      WHERE p.intent_id=? AND p.intent_hash=? AND p.action='products.add'
        AND p.actor_subject=? AND g.operation_id=?
        AND NOT EXISTS(SELECT 1 FROM m03_support_write_events WHERE event_id=?)`)
      .bind(eventId,opId,intentHash,admin.subject,grantId,eventId).run();
    if(audit?.success!==true)return {status:'needs-review'};
    return {status:newState,
      id:originalSourceIdPrefix('PRODUCTS')+'-'+String(row.sequence).padStart(6,'0')};
  }catch{
    return {status:'unavailable'};
  }
}
