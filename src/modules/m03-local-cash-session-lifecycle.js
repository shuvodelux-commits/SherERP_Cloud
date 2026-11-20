/**
 * M03 LOCAL INTEGRATION CONTRACT ONLY — NOT AN ERP CASH WRITER.
 * Never imported into a deployable Worker or public RPC.
 *
 * Executes real M04 auth and source POS grants inside actual disposable
 * Workerd/D1 SQL statements, using separate m03_local_cash_* tables.
 * It proves resumable Start/Close lifecycle and an Open-only synthetic
 * cash-intent gate. It does not produce a real Cash Book, bank ledger,
 * invoice, opening adjustment, Party account, or cash reconciliation.
 *
 * The source action parity is startCashSession/closeCashSession => pos.add,
 * getCashSessionSummary => pos.view. Per-shop flag OFF remains auth-gated.
 */
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {roleMetadata,roleNavigationConsistent} from '../auth/d1-legacy-rpc.js';

const OP=/^[A-Z0-9][A-Z0-9-]{2,63}$/;
const deny=()=>new Error('Denied: local Cash Session authority unavailable');
const AUTH_FROM=[
  'FROM auth_sessions AS s',
  'JOIN auth_users AS u ON u.user_id=s.user_id',
  'LEFT JOIN auth_roles AS r ON r.role_name=u.role_name'
].join(' ');
const AUTH_WHERE=[
  's.token_hash=? AND s.revoked_at_ms IS NULL',
  'AND s.created_at_ms<=? AND s.expires_at_ms>?',
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?',
  "AND u.status='Active' AND u.credential_state='Modern'",
  'AND u.auth_version=s.user_auth_version',
  'AND u.credential_version=s.credential_version',
  'AND ((u.role_name=\'Administrator\' AND s.role_auth_version IS NULL)',
  "OR (u.role_name<>'Administrator' AND r.status='Active'",
  'AND r.auth_version=s.role_auth_version',
  'AND r.permissions_json=? AND r.allowed_modules=?',
  'AND json_valid(r.permissions_json)=1',
  "AND json_type(r.permissions_json,?)='true'))"
].join(' ');
const PREFLIGHT=`SELECT u.role_name,r.permissions_json,r.allowed_modules
  ${AUTH_FROM} WHERE s.token_hash=? LIMIT 2`;
const START_CLAIM=`INSERT INTO m03_local_cash_sessions
  (session_id,open_op,status,opening_minor,opened_ms,open_actor)
  SELECT ?,?,'Starting',?,?,u.user_id ${AUTH_FROM}
  WHERE ${AUTH_WHERE} ON CONFLICT DO NOTHING`;
const START_READ=`SELECT c.session_id,c.status,c.opening_minor,c.open_actor,
  u.user_id AS current_actor ${AUTH_FROM}
  JOIN m03_local_cash_sessions AS c ON c.session_id=?
  WHERE ${AUTH_WHERE} AND c.open_op=? AND c.opening_minor=? LIMIT 2`;
const START_FINISH=`UPDATE m03_local_cash_sessions AS c SET status='Open'
  WHERE c.session_id=? AND c.open_op=? AND c.opening_minor=?
  AND c.status='Starting'
  AND EXISTS (SELECT 1 ${AUTH_FROM} WHERE ${AUTH_WHERE}
    AND u.user_id=c.open_actor)`;
const CLOSE_CLAIM=`UPDATE m03_local_cash_sessions AS c
  SET status='Closing',close_op=?,counted_minor=?,closed_ms=?,
      close_actor=(SELECT u.user_id ${AUTH_FROM}
        WHERE ${AUTH_WHERE} LIMIT 1)
  WHERE c.session_id=? AND c.status='Open' AND c.close_op IS NULL
    AND EXISTS (SELECT 1 ${AUTH_FROM} WHERE ${AUTH_WHERE})`;
const CLOSE_READ=`SELECT c.session_id,c.status,c.close_op,c.counted_minor,
  c.close_actor,u.user_id AS current_actor ${AUTH_FROM}
  JOIN m03_local_cash_sessions AS c ON c.session_id=?
  WHERE ${AUTH_WHERE} AND c.close_op=? AND c.counted_minor=? LIMIT 2`;
const CLOSE_FINISH=`UPDATE m03_local_cash_sessions AS c SET status='Closed'
  WHERE c.session_id=? AND c.close_op=? AND c.counted_minor=?
    AND c.status='Closing'
    AND EXISTS (SELECT 1 ${AUTH_FROM} WHERE ${AUTH_WHERE}
      AND u.user_id=c.close_actor)`;
const SUMMARY=`SELECT u.user_id AS actor_id,c.session_id,c.status,c.opening_minor
  ${AUTH_FROM} LEFT JOIN m03_local_cash_sessions AS c
    ON c.status IN ('Open','Closing')
  WHERE ${AUTH_WHERE} ORDER BY c.opened_ms DESC LIMIT 2`;
const OPEN_ONLY=[
  '(p.session_required=0 AND ? IS NULL)',
  "OR (p.session_required=1 AND EXISTS (SELECT 1",
  'FROM m03_local_cash_sessions AS c',
  "WHERE c.session_id=? AND c.status='Open'))"
].join(' ');
const INTENT_CLAIM=`INSERT INTO m03_local_cash_intents
  (operation_id,actor_id,session_id,amount_minor)
  SELECT ?,u.user_id,?,? ${AUTH_FROM}
  CROSS JOIN m03_local_cash_policy AS p
  WHERE ${AUTH_WHERE} AND (${OPEN_ONLY})
  ON CONFLICT DO NOTHING`;
const INTENT_READ=`SELECT i.operation_id,i.actor_id,i.session_id,
  i.amount_minor,u.user_id AS current_actor ${AUTH_FROM}
  CROSS JOIN m03_local_cash_policy AS p
  JOIN m03_local_cash_intents AS i ON i.operation_id=?
  WHERE ${AUTH_WHERE} AND (${OPEN_ONLY}) LIMIT 2`;

function input(request,required){
  if(!request||typeof request!=='object'||Array.isArray(request)||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null))
    throw deny();
  const keys=Reflect.ownKeys(request);
  if(keys.length!==required.length ||
      keys.some(k=>typeof k!=='string'||!required.includes(k)))throw deny();
  const out={};
  for(const key of required){
    const prop=Object.getOwnPropertyDescriptor(request,key);
    if(!prop?.enumerable||!Object.hasOwn(prop,'value'))throw deny();
    out[key]=prop.value;
  }
  if(typeof out.token!=='string'||!/^[a-f0-9]{64}$/.test(out.token))
    throw deny();
  if(required.includes('operationId') &&
     (typeof out.operationId!=='string'||!OP.test(out.operationId)))
    throw deny();
  if(required.includes('sessionId') && out.sessionId!==null &&
     (typeof out.sessionId!=='string'||!/^CS-[A-Z0-9][A-Z0-9-]{2,63}$/.test(out.sessionId)))
    throw deny();
  for(const key of ['openingMinor','countedMinor','amountMinor']){
    if(required.includes(key) &&
      (!Number.isSafeInteger(out[key])||out[key]<0||out[key]>1_000_000 ||
       (key==='amountMinor' && out[key]===0)))throw deny();
  }
  return out;
}
function clock(now){
  const value=now();
  if(!Number.isSafeInteger(value)||value<0 ||
     !Number.isSafeInteger(value+AUTH_POLICY.sessionMaxMs))throw deny();
  return value;
}
async function authorization(DB,token,action,now){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)throw deny();
  const row=await DB.prepare(PREFLIGHT).bind(digest).first();
  if(!row)throw deny();
  let raw=null,modules=null;
  if(row.role_name!=='Administrator'){
    const role=roleMetadata(row);
    if(!role || !roleNavigationConsistent(role) ||
       Object.getOwnPropertyDescriptor(
         Object.getOwnPropertyDescriptor(role.permissions,'pos')?.value||{},
         action)?.value!==true)throw deny();
    raw=row.permissions_json;
    modules=row.allowed_modules;
  }
  // The preflight is only shape validation. Every read/INSERT/UPDATE uses
  // this same fingerprint, epoch, role-text, and permission predicate
  // AGAIN within its SQL statement, including resumptions and replay reads.
  return [digest,now,now,now-AUTH_POLICY.sessionIdleMs,now,
    raw,modules,'$.pos.'+action];
}
async function write(DB,sql,params){
  const result=await DB.prepare(sql).bind(...params).run();
  if(result?.success!==true)throw deny();
}
async function one(DB,sql,params){
  const results=await DB.prepare(sql).bind(...params).all();
  if(results?.success!==true || !Array.isArray(results.results) ||
     results.results.length!==1)throw deny();
  return results.results[0];
}

/**
 * Explicit trusted injection for disposable test Worker ONLY.
 * Operational M03 must later own real Shop D1 + server clock bindings,
 * source ID allocation, Cash Book journal and policy migrations separately.
 */
export function createM03LocalCashSession(DB,{serverNowMs}={}){
  if(!DB || typeof DB.prepare!=='function' ||
     typeof serverNowMs!=='function')throw new TypeError('Local D1/clock required');
  return Object.freeze({
    async start_(request,{interruptAfterClaim=false}={}){
      const x=input(request,['token','operationId','openingMinor']);
      const now=clock(serverNowMs),auth=await authorization(DB,x.token,'add',now);
      const sessionId='CS-'+x.operationId;
      try{
        await write(DB,START_CLAIM,
          [sessionId,x.operationId,x.openingMinor,now,...auth]);
        const read=()=>one(DB,START_READ,
          [sessionId,...auth,x.operationId,x.openingMinor]);
        let row=await read();
        if(row.open_actor!==row.current_actor)throw deny();
        if(row.status==='Starting'){
          if(interruptAfterClaim)
            return {sessionId,status:'Starting',needsResume:true};
          await write(DB,START_FINISH,
            [sessionId,x.operationId,x.openingMinor,...auth]);
          row=await read();
        }
        if(row.status!=='Open'||row.open_actor!==row.current_actor)
          throw deny();
        return {sessionId,status:'Open',openingMinor:row.opening_minor,
          actorId:row.open_actor};
      }catch{throw deny()}
    },
    async close_(request,{interruptAfterClaim=false}={}){
      const x=input(request,['token','sessionId','operationId','countedMinor']);
      if(x.sessionId===null)throw deny();
      const now=clock(serverNowMs),auth=await authorization(DB,x.token,'add',now);
      try{
        await write(DB,CLOSE_CLAIM,
          [x.operationId,x.countedMinor,now,...auth,x.sessionId,...auth]);
        const read=()=>one(DB,CLOSE_READ,
          [x.sessionId,...auth,x.operationId,x.countedMinor]);
        let row=await read();
        if(row.close_actor!==row.current_actor)throw deny();
        if(row.status==='Closing'){
          if(interruptAfterClaim)
            return {sessionId:x.sessionId,status:'Closing',needsResume:true};
          await write(DB,CLOSE_FINISH,
            [x.sessionId,x.operationId,x.countedMinor,...auth]);
          row=await read();
        }
        if(row.status!=='Closed'||row.close_actor!==row.current_actor)
          throw deny();
        return {sessionId:x.sessionId,status:'Closed',
          countedMinor:row.counted_minor,actorId:row.close_actor};
      }catch{throw deny()}
    },
    async summary_(request){
      const x=input(request,['token']);
      const now=clock(serverNowMs),auth=await authorization(DB,x.token,'view',now);
      try{
        const row=await one(DB,SUMMARY,auth);
        if(!row.session_id)return null;
        return {sessionId:row.session_id,status:row.status,
          openingMinor:row.opening_minor};
      }catch{throw deny()}
    },
    async cashIntent_(request){
      const x=input(request,['token','operationId','sessionId','amountMinor']);
      const now=clock(serverNowMs),auth=await authorization(DB,x.token,'add',now);
      try{
        // This is NOT a payment, only an immutable synthetic cash intent.
        await write(DB,INTENT_CLAIM,[x.operationId,x.sessionId,
          x.amountMinor,...auth,x.sessionId,x.sessionId]);
        const row=await one(DB,INTENT_READ,
          [x.operationId,...auth,x.sessionId,x.sessionId]);
        if(row.actor_id!==row.current_actor ||
           row.session_id!==x.sessionId ||
           row.amount_minor!==x.amountMinor)throw deny();
        return {operationId:row.operation_id,actorId:row.actor_id,
          amountMinor:row.amount_minor};
      }catch{throw deny()}
    }
  });
}
