/**
 * M04 test-only one-business-per-D1 SQL-current cash authority probe.
 *
 * This fixture uses the REAL internal M04 auth_users / auth_roles /
 * auth_sessions shape, but only synthetic m04_cash_probe_* tables. It is
 * NOT an accounting writer, a source cashier-permission mapping or an
 * approved production Cash Session schema. No public Worker imports it.
 */
import {AUTH_POLICY} from '../../src/auth/d1-auth-core.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const OPERATION=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const CASH_SESSION=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;

const SOURCE=[
  "FROM auth_sessions AS s",
  "JOIN auth_users AS u ON u.user_id=s.user_id",
  "LEFT JOIN auth_roles AS r ON r.role_name=u.role_name",
  "CROSS JOIN m04_cash_probe_policy AS p",
  "LEFT JOIN m04_cash_probe_grants AS g ON g.role_name=u.role_name"
].join(' ');

// The mutation's INSERT SELECT and the immutable receipt READ each check
// currently committed M04 authority, not a stale JS preflight result.
const PERMISSION=[
  "s.token_hash=? AND s.revoked_at_ms IS NULL",
  "AND s.created_at_ms<=? AND s.expires_at_ms>?",
  "AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?",
  "AND u.status='Active' AND u.credential_state='Modern'",
  "AND u.auth_version=s.user_auth_version",
  "AND u.credential_version=s.credential_version",
  "AND (",
  "  (u.role_name='Administrator' AND s.role_auth_version IS NULL)",
  "  OR (u.role_name<>'Administrator' AND r.status='Active'",
  "      AND r.auth_version=s.role_auth_version AND g.can_record=1)",
  ")",
  "AND (",
  "  (p.session_required=0 AND ? IS NULL)",
  "  OR (p.session_required=1 AND EXISTS (",
  "    SELECT 1 FROM m04_cash_probe_sessions AS cs",
  "    WHERE cs.session_id=? AND cs.status='Open'",
  "  ))",
  ")"
].join(' ');

const INSERT=[
  "INSERT INTO m04_cash_probe_intents",
  "(operation_id,actor_id,cash_session_id,amount_minor)",
  "SELECT ?,u.user_id,?,?",SOURCE,"WHERE",PERMISSION,
  "ON CONFLICT(operation_id) DO NOTHING"
].join(' ');

const READ=[
  "SELECT t.operation_id,t.actor_id,t.amount_minor,t.cash_session_id,",
  "u.user_id AS current_actor", SOURCE,
  "JOIN m04_cash_probe_intents AS t ON t.operation_id=?",
  "WHERE",PERMISSION,"LIMIT 2"
].join(' ');

function inputOnly(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null))
    throw new TypeError('Invalid M04 probe request');
  const expected=['token','operationId','cashSessionId','amountMinor'];
  const keys=Reflect.ownKeys(request);
  if(keys.length!==expected.length ||
      keys.some(k=>typeof k!=='string'||!expected.includes(k)))
    throw new TypeError('Invalid M04 probe request fields');
  const x={};
  for(const key of expected){
    const d=Object.getOwnPropertyDescriptor(request,key);
    if(!d?.enumerable||!Object.hasOwn(d,'value'))
      throw new TypeError('Invalid M04 probe request descriptor');
    x[key]=d.value;
  }
  if(typeof x.token!=='string'||!/^[a-f0-9]{64}$/.test(x.token)||
     typeof x.operationId!=='string'||!OPERATION.test(x.operationId)||
     (x.cashSessionId!==null &&
       (typeof x.cashSessionId!=='string'||!CASH_SESSION.test(x.cashSessionId)))||
     !Number.isSafeInteger(x.amountMinor)||x.amountMinor<=0)
    throw new TypeError('Invalid M04 probe session, operation or amount');
  return x;
}

const denied=()=>new Error('Denied: M04 real-auth cash probe refused');

/**
 * No actor/business/time is accepted from the payload.
 * serverNowMs MUST be supplied by trusted Worker integration, not an RPC
 * argument. The test injects a deterministic server clock only in Workerd.
 */
export function createM04RealAuthCashProbe(DB,{serverNowMs}={}){
  if(!DB||typeof DB.prepare!=='function'||
     typeof serverNowMs!=='function')
    throw new TypeError('Invalid trusted D1 or server clock');
  return Object.freeze({
    async record_(request){
      const x=inputOnly(request);
      const now=serverNowMs();
      if(!Number.isSafeInteger(now)||now<0||
          !Number.isSafeInteger(now+AUTH_POLICY.sessionMaxMs))
        throw denied();
      const digest=await hashOpaqueSessionToken(x.token);
      if(!digest)throw denied();
      const auth=[digest,now,now,now-AUTH_POLICY.sessionIdleMs,now,
        x.cashSessionId,x.cashSessionId];
      try{
        // Exactly one SQL mutation owns both current staff authorization
        // and the trigger-created synthetic journal append.
        const r=await DB.prepare(INSERT)
          .bind(x.operationId,x.cashSessionId,x.amountMinor,...auth).run();
        if(r?.success!==true)throw denied();
        const receipt=await DB.prepare(READ)
          .bind(x.operationId,...auth).first();
        if(!receipt||receipt.current_actor!==receipt.actor_id||
            receipt.operation_id!==x.operationId||
            receipt.cash_session_id!==x.cashSessionId||
            receipt.amount_minor!==x.amountMinor)
          throw denied();
        return {operationId:receipt.operation_id,actorId:receipt.actor_id,
          amountMinor:receipt.amount_minor};
      }catch{
        // A rejected replay, late D1 abort and missing authority share
        // a generic response. Never reveal an old actor or ledger value.
        throw denied();
      }
    }
  });
}
