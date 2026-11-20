/**
 * LOCAL / TEST-ONLY M03 Control Center support-read authority.
 * NOT imported by the hosted Admin Worker, public ERP Worker or RPC registry.
 * The caller MUST supply a trusted Shop D1 binding. Never select a D1 from a
 * client-provided identifier. No operational ERP read or write is exposed.
 */
import {CURRENT_PLATFORM_ADMIN_FROM} from '../auth/platform-superadmin-session.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from '../auth/session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const GRANT_MS=300000;
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const UUID4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Disposable Control D1 only; these are NOT production/staging migrations. */
export const LOCAL_SUPPORT_READ_DDL=Object.freeze([
  `CREATE TABLE m03_local_support_grants (
    operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
    token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    shop_id TEXT NOT NULL REFERENCES platform_shop_bindings(shop_id),
    database_id TEXT NOT NULL CHECK(length(database_id)=36),
    database_marker TEXT NOT NULL CHECK(length(database_marker)=36),
    admin_session_hash TEXT NOT NULL CHECK(length(admin_session_hash)=64),
    actor_subject TEXT NOT NULL CHECK(length(actor_subject) BETWEEN 1 AND 255),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 180),
    issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms>0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms=issued_at_ms+300000),
    revoked_at_ms INTEGER CHECK(revoked_at_ms IS NULL OR revoked_at_ms>=issued_at_ms)
  ) STRICT`,
  `CREATE TABLE m03_local_support_events (
    event_id TEXT PRIMARY KEY,
    grant_operation_id TEXT NOT NULL REFERENCES m03_local_support_grants(operation_id),
    event_type TEXT NOT NULL CHECK(event_type IN ('START','READ','END')),
    shop_id TEXT NOT NULL,
    actor_subject TEXT NOT NULL,
    event_at_ms INTEGER NOT NULL CHECK(event_at_ms>0)
  ) STRICT`,
  `CREATE TRIGGER m03_local_support_start
    AFTER INSERT ON m03_local_support_grants
    BEGIN
      INSERT INTO m03_local_support_events
        (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
      VALUES (NEW.operation_id||':START',NEW.operation_id,'START',NEW.shop_id,NEW.actor_subject,NEW.issued_at_ms);
    END`,
  `CREATE TRIGGER m03_local_support_revoke
    AFTER UPDATE OF revoked_at_ms ON m03_local_support_grants
    WHEN OLD.revoked_at_ms IS NULL AND NEW.revoked_at_ms IS NOT NULL
    BEGIN
      INSERT INTO m03_local_support_events
        (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
      VALUES (NEW.operation_id||':END',NEW.operation_id,'END',NEW.shop_id,NEW.actor_subject,NEW.revoked_at_ms);
    END`,
  `CREATE TRIGGER m03_local_support_grant_immutable
    BEFORE UPDATE ON m03_local_support_grants
    WHEN OLD.revoked_at_ms IS NOT NULL OR NEW.revoked_at_ms IS NULL
      OR NEW.revoked_at_ms<OLD.issued_at_ms
      OR NEW.operation_id IS NOT OLD.operation_id
      OR NEW.token_hash IS NOT OLD.token_hash
      OR NEW.shop_id IS NOT OLD.shop_id
      OR NEW.database_id IS NOT OLD.database_id
      OR NEW.database_marker IS NOT OLD.database_marker
      OR NEW.admin_session_hash IS NOT OLD.admin_session_hash
      OR NEW.actor_subject IS NOT OLD.actor_subject
      OR NEW.reason IS NOT OLD.reason
      OR NEW.issued_at_ms IS NOT OLD.issued_at_ms
      OR NEW.expires_at_ms IS NOT OLD.expires_at_ms
    BEGIN SELECT RAISE(ABORT,'immutable support grant'); END`,
  `CREATE TRIGGER m03_local_support_grant_no_delete
    BEFORE DELETE ON m03_local_support_grants
    BEGIN SELECT RAISE(ABORT,'immutable support grant'); END`,
  `CREATE TRIGGER m03_local_support_event_no_update
    BEFORE UPDATE ON m03_local_support_events
    BEGIN SELECT RAISE(ABORT,'immutable support audit'); END`,
  `CREATE TRIGGER m03_local_support_event_no_delete
    BEFORE DELETE ON m03_local_support_events
    BEGIN SELECT RAISE(ABORT,'immutable support audit'); END`,
  'CREATE INDEX m03_local_support_event_shop_order ON m03_local_support_events(shop_id,event_at_ms,event_id)',
]);

function validScope(scope){
  return scope!==null && typeof scope==='object' &&
    typeof scope.shopDb?.prepare==='function' &&
    [scope.shopId,scope.databaseId,scope.databaseMarker].every(
      value=>typeof value==='string'&&UUID.test(value));
}

async function verifiedPhysicalScope(scope){
  if(!validScope(scope))return false;
  try{
    const row=await scope.shopDb.prepare(
      'SELECT shop_id,database_id,database_marker FROM shop_identity WHERE singleton=1').first();
    return row?.shop_id===scope.shopId &&
      row.database_id===scope.databaseId &&
      row.database_marker===scope.databaseMarker;
  }catch{
    return false;
  }
}

const validReason=value=>typeof value==='string' &&
  value.trim().length>=12 && value.trim().length<=180 && !/\p{Cc}/u.test(value);
const validId=value=>typeof value==='string'&&UUID4.test(value);

/**
 * First issuance returns the random bearer exactly once; replay never does.
 * All current MFA/session/binding checks happen INSIDE the SQL INSERT itself.
 */
export async function issueLocalSupportReadGrant(controlDb,scope,{operationId,reason,sessionToken}={}){
  if(!validId(operationId)||!validReason(reason))return {status:'invalid'};
  if(typeof controlDb?.prepare!=='function'||!await verifiedPhysicalScope(scope))
    return {status:'denied'};
  const adminHash=await hashOpaqueSessionToken(sessionToken);
  if(!adminHash)return {status:'denied'};
  const purpose=reason.trim();
  const supportToken=createOpaqueSessionToken();
  const supportHash=await hashOpaqueSessionToken(supportToken);
  const {shopId,databaseId,databaseMarker}=scope;

  const issued=await controlDb.prepare(`INSERT INTO m03_local_support_grants
    (operation_id,token_hash,shop_id,database_id,database_marker,
     admin_session_hash,actor_subject,reason,issued_at_ms,expires_at_ms)
    SELECT ?,?,?,?,?,s.token_hash,f.subject,?,${NOW},${NOW}+${GRANT_MS}
    ${CURRENT_PLATFORM_ADMIN_FROM}
    AND EXISTS(SELECT 1 FROM platform_shop_reservations r
      JOIN platform_shop_bindings b ON b.shop_id=r.shop_id
      WHERE r.shop_id=? AND r.created_by_subject=f.subject
        AND b.database_id=? AND b.database_marker=?)
    AND NOT EXISTS(SELECT 1 FROM m03_local_support_grants g
      WHERE g.shop_id=? AND g.revoked_at_ms IS NULL AND g.expires_at_ms>${NOW})
    AND NOT EXISTS(SELECT 1 FROM m03_local_support_grants g WHERE g.operation_id=?)
    RETURNING expires_at_ms AS expiresAtMs`)
    .bind(operationId,supportHash,shopId,databaseId,databaseMarker,
      purpose,adminHash,shopId,databaseId,databaseMarker,shopId,operationId).first();
  if(issued)return {status:'created',operationId,supportToken,expiresAtMs:issued.expiresAtMs};

  // Deliberately reveal no raw bearer, and no receipt to a different session.
  const replay=await controlDb.prepare(`SELECT 1 FROM m03_local_support_grants g
    WHERE g.operation_id=? AND g.shop_id=? AND g.database_id=? AND g.database_marker=?
      AND g.reason=? AND g.admin_session_hash=?
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
        AND f.subject=g.actor_subject)`)
    .bind(operationId,shopId,databaseId,databaseMarker,purpose,adminHash,adminHash).first();
  return replay?{status:'replayed'}:{status:'denied'};
}

/**
 * This is an AUDITED AUTHORIZATION STEP, not an ERP data endpoint. Real data
 * reads require a later SQL-current same-tenant integration in the Shop D1.
 */
export async function authorizeLocalSupportRead(controlDb,scope,{eventId,sessionToken,supportToken}={}){
  if(!validId(eventId))return {status:'invalid'};
  if(typeof controlDb?.prepare!=='function'||!await verifiedPhysicalScope(scope))
    return {status:'denied'};
  const [adminHash,supportHash]=await Promise.all([
    hashOpaqueSessionToken(sessionToken),hashOpaqueSessionToken(supportToken),
  ]);
  if(!adminHash||!supportHash)return {status:'denied'};
  const {shopId,databaseId,databaseMarker}=scope;
  const result=await controlDb.prepare(`INSERT INTO m03_local_support_events
    (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
    SELECT ?,g.operation_id,'READ',g.shop_id,g.actor_subject,${NOW}
    FROM m03_local_support_grants g
    JOIN platform_shop_bindings b ON b.shop_id=g.shop_id
      AND b.database_id=g.database_id AND b.database_marker=g.database_marker
    JOIN platform_shop_reservations r ON r.shop_id=b.shop_id AND r.created_by_subject=g.actor_subject
    WHERE g.token_hash=? AND g.shop_id=? AND g.database_id=? AND g.database_marker=?
      AND g.admin_session_hash=? AND g.revoked_at_ms IS NULL
      AND g.issued_at_ms<=${NOW} AND g.expires_at_ms>${NOW}
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
        AND f.subject=g.actor_subject)
      AND NOT EXISTS(SELECT 1 FROM m03_local_support_events e WHERE e.event_id=?)
    RETURNING event_id AS eventId`)
    .bind(eventId,supportHash,shopId,databaseId,databaseMarker,adminHash,adminHash,eventId).first();
  return result?{status:'allowed'}:{status:'denied'};
}

/** Explicit END/revoke. A revoked/expired/fenced Admin cannot authorize reads. */
export async function revokeLocalSupportReadGrant(controlDb,scope,{operationId,sessionToken}={}){
  if(!validId(operationId))return {status:'invalid'};
  if(typeof controlDb?.prepare!=='function'||!await verifiedPhysicalScope(scope))
    return {status:'denied'};
  const adminHash=await hashOpaqueSessionToken(sessionToken);
  if(!adminHash)return {status:'denied'};
  const {shopId,databaseId,databaseMarker}=scope;
  const result=await controlDb.prepare(`UPDATE m03_local_support_grants
    SET revoked_at_ms=${NOW}
    WHERE operation_id=? AND shop_id=? AND database_id=? AND database_marker=?
      AND admin_session_hash=? AND revoked_at_ms IS NULL
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
        AND f.subject=m03_local_support_grants.actor_subject)
    RETURNING operation_id AS operationId`)
    .bind(operationId,shopId,databaseId,databaseMarker,adminHash,adminHash).first();
  return result?{status:'revoked'}:{status:'denied'};
}
