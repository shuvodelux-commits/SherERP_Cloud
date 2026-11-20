/**
 * TEST-ONLY M04 source POS permission proof (NOT a production Cash Session).
 *
 * The real internal auth_users/auth_roles/auth_sessions are used in local
 * Workerd/D1; only m04_source_pos_* receipt and journal are synthetic.
 * M03 owns the eventual operational SQL and source lifecycle integration.
 * No Cloudflare Worker or public RPC imports this fixture.
 */
import {AUTH_POLICY} from '../../src/auth/d1-auth-core.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {roleMetadata,roleNavigationConsistent} from '../../src/auth/d1-legacy-rpc.js';

// Literal source contract from merged M04 #738: do not accept user-supplied
// module/action or infer a grant from navigation. Only exact RPC method names
// can select the SQL permission path.
const ACTIONS=Object.freeze({
  startCashSession:'add',
  closeCashSession:'add',
  getCashSessionSummary:'view',
});
const MUTATIONS=new Set(['startCashSession','closeCashSession']);
const ID=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const deny=()=>new Error('Denied: M04 source POS authority unavailable');

const FROM=[
  "FROM auth_sessions AS s",
  "JOIN auth_users AS u ON u.user_id=s.user_id",
  "LEFT JOIN auth_roles AS r ON r.role_name=u.role_name"
].join(' ');

const WHERE=[
  "s.token_hash=? AND s.revoked_at_ms IS NULL",
  "AND s.created_at_ms<=? AND s.expires_at_ms>?",
  "AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?",
  "AND u.status='Active' AND u.credential_state='Modern'",
  "AND u.auth_version=s.user_auth_version",
  "AND u.credential_version=s.credential_version",
  "AND (",
  "  (u.role_name='Administrator' AND s.role_auth_version IS NULL)",
  "  OR (u.role_name<>'Administrator' AND r.status='Active'",
  "      AND r.auth_version=s.role_auth_version",
  "      AND r.permissions_json=? AND r.allowed_modules=?",
  "      AND json_valid(r.permissions_json)=1",
  "      AND json_type(r.permissions_json,?)='true')",
  ")"
].join(' ');

const PREFLIGHT=[
  "SELECT u.role_name,r.permissions_json,r.allowed_modules",
  FROM,
  "WHERE s.token_hash=?"
].join(' ');

const CLAIM=[
  "INSERT INTO m04_source_pos_receipts(operation_id,action,actor_id)",
  "SELECT ?,?,u.user_id",FROM,"WHERE",WHERE,
  "ON CONFLICT(operation_id) DO NOTHING"
].join(' ');

const RECEIPT=[
  "SELECT receipt.operation_id,receipt.action,receipt.actor_id,",
  "u.user_id AS current_actor",FROM,
  "JOIN m04_source_pos_receipts AS receipt ON receipt.operation_id=?",
  "WHERE",WHERE,"LIMIT 2"
].join(' ');

const SUMMARY=[
  "SELECT u.user_id AS actor_id",FROM,"WHERE",WHERE,"LIMIT 2"
].join(' ');

function validateShape(x,keys){
  if(!x||typeof x!=='object'||Array.isArray(x)||
    (Object.getPrototypeOf(x)!==Object.prototype &&
     Object.getPrototypeOf(x)!==null))
    throw new TypeError('Invalid M04 source POS request');
  const inputKeys=Reflect.ownKeys(x);
  if(inputKeys.length!==keys.length ||
    inputKeys.some(k=>typeof k!=='string'||!keys.includes(k)))
    throw new TypeError('Invalid M04 source POS request fields');
  for(const key of keys){
    const desc=Object.getOwnPropertyDescriptor(x,key);
    if(!desc?.enumerable || !Object.hasOwn(desc,'value'))
      throw new TypeError('Invalid M04 source POS request descriptor');
  }
  if(typeof x.token!=='string'||!/^[a-f0-9]{64}$/.test(x.token))
    throw new TypeError('Invalid M04 source POS bearer');
}

function currentTime(serverNowMs){
  const now=serverNowMs();
  if(!Number.isSafeInteger(now)||now<0 ||
     !Number.isSafeInteger(now+AUTH_POLICY.sessionMaxMs))
    throw deny();
  return now;
}

async function authority(DB,token,action,now){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)throw deny();
  const current=await DB.prepare(PREFLIGHT).bind(digest).first();
  if(!current)throw deny();

  // A parser preflight alone is NOT authorization; the same role text,
  // module list, session, credential and authority epoch are checked again
  // by SQL INSIDE the mutation or read. Revoked/changed roles cannot use a
  // previously parsed grant or a stale cached permission.
  let roleJSON=null,modules=null;
  if(current.role_name!=='Administrator'){
    const role=roleMetadata(current);
    if(!role||!roleNavigationConsistent(role))throw deny();
    const pos=Object.getOwnPropertyDescriptor(role.permissions,'pos')?.value;
    const granted=pos&&Object.getOwnPropertyDescriptor(pos,action)?.value;
    if(granted!==true)throw deny();
    roleJSON=current.permissions_json;
    modules=current.allowed_modules;
  }
  const auth=[digest,now,now,now-AUTH_POLICY.sessionIdleMs,now,
    roleJSON,modules,'$.pos.'+action];
  return auth;
}

export function createM04SourcePosActionProbe(DB,{serverNowMs}={}){
  if(!DB||typeof DB.prepare!=='function' ||
     typeof serverNowMs!=='function')
    throw new TypeError('Invalid trusted D1 binding or server clock');

  return Object.freeze({
    async mutate_(request){
      validateShape(request,['token','operationId','action']);
      if(typeof request.operationId!=='string'||!ID.test(request.operationId)||
         !MUTATIONS.has(request.action))
        throw new TypeError('Invalid M04 source POS mutation');
      try{
        const now=currentTime(serverNowMs);
        const auth=await authority(DB,request.token,ACTIONS[request.action],now);
        const claim=await DB.prepare(CLAIM)
          .bind(request.operationId,request.action,...auth).run();
        if(claim?.success!==true)throw deny();
        const receipt=await DB.prepare(RECEIPT)
          .bind(request.operationId,...auth).first();
        if(!receipt || receipt.operation_id!==request.operationId ||
           receipt.action!==request.action ||
           receipt.actor_id!==receipt.current_actor)throw deny();
        return {operationId:receipt.operation_id,
          action:receipt.action,actorId:receipt.actor_id};
      }catch{
        // No existence or actor enumeration across unauthorized requests.
        throw deny();
      }
    },
    async summary_(request){
      validateShape(request,['token']);
      try{
        const now=currentTime(serverNowMs);
        const auth=await authority(DB,request.token,ACTIONS.getCashSessionSummary,now);
        const result=await DB.prepare(SUMMARY).bind(...auth).first();
        if(!result || typeof result.actor_id!=='string')throw deny();
        return {action:'getCashSessionSummary',actorId:result.actor_id};
      }catch{
        throw deny();
      }
    }
  });
}
