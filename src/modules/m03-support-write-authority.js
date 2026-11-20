/**
 * M03: Super Admin support-edit AUTHORIZATION FOUNDATION only.
 *
 * Default OFF. No HTTP routes, Owner session issuance or Shop D1 business
 * mutations exist here. Later approved transaction adapters must prove
 * a distinct Support actor in the SAME Shop D1 atomic write predicate.
 */
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {CURRENT_PLATFORM_ADMIN_FROM,matchingStep}
  from '../auth/platform-superadmin-session.js';
import {readBrowserAdminFactorRecord}
  from '../auth/browser-first-admin-setup.js';
import {pilotShopConfiguration,pilotShopIdentityMatches}
  from '../auth/platform-shop-binding.js';

const NOW="CAST(unixepoch('subsec')*1000 AS INTEGER)";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const ACTIONS=Object.freeze({
  'products.add':'products','parties.add':'parties',
  'purchases.post':'purchases','pos.sale':'pos',
  'returns.post':'returns','finance.post':'finance',
});
const ACCEPTED_SCOPES=new Set(Object.values(ACTIONS));
const validReason=v=>typeof v==='string'&&
  v.trim().length>=12&&v.trim().length<=180&&
  !/[\u0000-\u001f\u007f]/.test(v);
const enabled=env=>env?.M03_SUPPORT_WRITE_ENABLED==='true'&&
  env.PLATFORM_BROWSER_SETUP==='true'&&
  typeof env.CONTROL_DB?.prepare==='function'&&
  typeof env.CONTROL_DB?.batch==='function'&&
  typeof env.PLATFORM_FACTOR_ENCRYPTION_KEY==='string';
const correctPhysical=async(env,shopId,dbId,marker)=>{
  const scope=pilotShopConfiguration(env);
  if(!scope||scope.shopId!==shopId||scope.databaseId!==dbId||
    scope.databaseMarker!==marker||!await pilotShopIdentityMatches(scope))return false;
  return true;
};

const currentGrantSQL=`FROM m03_support_write_grants g
  JOIN m03_local_support_grants r ON r.operation_id=g.read_grant_operation_id
  JOIN platform_shop_bindings b ON b.shop_id=g.shop_id
    AND b.database_id=g.database_id AND b.database_marker=g.database_marker
  JOIN platform_shop_provisioning p ON p.shop_id=g.shop_id
    AND p.stage='ready' AND p.database_id=g.database_id
    AND p.database_marker=g.database_marker
  WHERE g.operation_id=? AND g.admin_session_hash=?
    AND g.issued_at_ms<=${NOW} AND g.expires_at_ms>${NOW}
    AND g.revoked_at_ms IS NULL
    AND r.revoked_at_ms IS NULL AND r.issued_at_ms<=${NOW}
    AND r.expires_at_ms>${NOW}
    AND r.admin_session_hash=g.admin_session_hash
    AND r.shop_id=g.shop_id AND r.database_id=g.database_id
    AND r.database_marker=g.database_marker
    AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
      AND f.subject=g.actor_subject AND a.factor_version=g.factor_version)`;

export async function requestSupportEditGrant(env,{
  readGrantOperationId,writeGrantOperationId,scope,reason,otpCode,sessionToken
}={}){
  if(!enabled(env)||!UUID.test(readGrantOperationId)||!UUID.test(writeGrantOperationId)||
    !ACCEPTED_SCOPES.has(scope)||!validReason(reason)||
    typeof otpCode!=='string'||!/^[0-9]{6}$/.test(otpCode))return null;
  try{
    const hash=await hashOpaqueSessionToken(sessionToken);
    if(!hash)return null;
    const db=env.CONTROL_DB;
    const factor=await readBrowserAdminFactorRecord(env);
    if(!factor?.secret||!Number.isSafeInteger(factor.factorVersion))return null;
    const readGrant=await db.prepare(`SELECT g.shop_id AS shopId,
      g.database_id AS databaseId,g.database_marker AS databaseMarker
      FROM m03_local_support_grants g
      JOIN platform_shop_bindings b ON b.shop_id=g.shop_id
        AND b.database_id=g.database_id AND b.database_marker=g.database_marker
      JOIN platform_shop_provisioning p ON p.shop_id=g.shop_id
        AND p.stage='ready' AND p.database_id=g.database_id
        AND p.database_marker=g.database_marker
      WHERE g.operation_id=? AND g.admin_session_hash=? AND
        g.revoked_at_ms IS NULL AND g.issued_at_ms<=${NOW}
        AND g.expires_at_ms>${NOW}
        AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
          AND f.subject=g.actor_subject AND a.factor_version=?)`)
      .bind(readGrantOperationId,hash,hash,factor.factorVersion).first();
    if(!readGrant||!await correctPhysical(env,readGrant.shopId,
      readGrant.databaseId,readGrant.databaseMarker))return null;

    // Every TOTP attempt consumes a throttled server-side receipt, including
    // incorrect codes. The 5-per-minute ceiling is a SQL-time guard.
    const attempt=await db.prepare(`INSERT INTO m03_support_write_attempts
      (attempt_id,read_grant_operation_id,admin_session_hash,attempted_at_ms)
      SELECT ?,g.operation_id,?,${NOW} FROM m03_local_support_grants g
      WHERE g.operation_id=? AND g.admin_session_hash=? AND
        g.revoked_at_ms IS NULL AND g.expires_at_ms>${NOW}
        AND (SELECT count(*) FROM m03_support_write_attempts
          WHERE admin_session_hash=? AND attempted_at_ms>${NOW}-60000)<5
        AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
          AND f.subject=g.actor_subject)
      RETURNING attempt_id`)
      .bind(crypto.randomUUID(),hash,readGrantOperationId,hash,hash,hash).first();
    if(!attempt)return null;
    const otpStep=await matchingStep(factor.secret,otpCode,
      Math.floor(Date.now()/30000));
    if(otpStep===null)return null;
    const result=await db.prepare(`INSERT INTO m03_support_write_grants
      (operation_id,read_grant_operation_id,shop_id,database_id,
       database_marker,admin_session_hash,actor_subject,scope,reason,
       factor_version,otp_step,issued_at_ms,expires_at_ms)
      SELECT ?,g.operation_id,g.shop_id,g.database_id,g.database_marker,
        g.admin_session_hash,g.actor_subject,?,?,?,?,
        ${NOW},MIN(g.expires_at_ms,${NOW}+300000)
      FROM m03_local_support_grants g
      WHERE g.operation_id=? AND g.admin_session_hash=?
        AND g.issued_at_ms<=${NOW} AND g.expires_at_ms>${NOW}
        AND g.revoked_at_ms IS NULL
        AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
          AND f.subject=g.actor_subject AND a.factor_version=?
          AND s.otp_step<?)
        AND EXISTS(SELECT 1 FROM platform_shop_bindings b
          JOIN platform_shop_provisioning p ON p.shop_id=b.shop_id
          WHERE b.shop_id=g.shop_id AND b.database_id=g.database_id
            AND b.database_marker=g.database_marker
            AND p.stage='ready' AND p.database_id=b.database_id
            AND p.database_marker=b.database_marker)
      RETURNING operation_id AS operationId,shop_id AS shopId,
        scope,expires_at_ms AS expiresAtMs`)
      .bind(writeGrantOperationId,scope,reason.trim(),
        factor.factorVersion,otpStep,readGrantOperationId,hash,
        hash,factor.factorVersion,otpStep).first();
    return result?{grantId:result.operationId,shopId:result.shopId,
      scope:result.scope,expiresAtMs:result.expiresAtMs}:null;
  }catch{return null;}
}

/**
 * Only records permission to *attempt* one named operation. The caller must
 * still use an independently reviewed Shop D1 SQL-time support actor grant,
 * all existing accounting rules and a durable execution/result journal.
 * This function NEVER posts business money, ledger or stock mutations.
 */
export async function authorizeSupportWriteIntent(env,{
  grantId,action,intentId,intentHash,sessionToken
}={}){
  if(!enabled(env)||!UUID.test(grantId)||!UUID.test(intentId)||
    !Object.hasOwn(ACTIONS,action)||!HEX.test(intentHash))
    return {status:'denied'};
  try{
    const hash=await hashOpaqueSessionToken(sessionToken);
    if(!hash)return {status:'denied'};
    const db=env.CONTROL_DB;
    const current=await db.prepare(`SELECT g.shop_id AS shopId,
      g.database_id AS databaseId,g.database_marker AS databaseMarker,
      g.actor_subject AS actorSubject
      ${currentGrantSQL} AND g.scope=?`)
      .bind(grantId,hash,hash,ACTIONS[action]).first();
    if(!current||!await correctPhysical(env,current.shopId,
      current.databaseId,current.databaseMarker))return {status:'denied'};
    const receipt=await db.prepare(`INSERT INTO m03_support_write_intents
      (intent_id,write_grant_operation_id,shop_id,action,
       intent_hash,actor_subject,authorized_at_ms)
      SELECT ?,g.operation_id,g.shop_id,?,?,g.actor_subject,${NOW}
      ${currentGrantSQL} AND g.scope=?
      AND NOT EXISTS(SELECT 1 FROM m03_support_write_intents WHERE intent_id=?)
      RETURNING intent_id AS intentId`)
      .bind(intentId,action,intentHash,grantId,hash,hash,ACTIONS[action],intentId)
      .first();
    if(receipt)return {status:'authorized-intent',intentId};
    // Same immutable intent is safe to retry only while the identical grant,
    // actor and current Admin authentication remain valid.
    const replay=await db.prepare(`SELECT i.intent_id AS intentId
      FROM m03_support_write_intents i
      JOIN m03_support_write_grants g ON g.operation_id=i.write_grant_operation_id
      WHERE i.intent_id=? AND i.action=? AND i.intent_hash=?
        AND i.write_grant_operation_id=? AND i.actor_subject=g.actor_subject
        AND EXISTS(SELECT 1 ${currentGrantSQL} AND g.scope=?)`)
      .bind(intentId,action,intentHash,grantId,
        grantId,hash,hash,ACTIONS[action]).first();
    return replay?{status:'replayed',intentId}:{status:'denied'};
  }catch{return {status:'denied'};}
}
