/**
 * INTERNAL M03 <-> M04 schema compatibility adapter (READ ONLY).
 *
 * M04's auth_sessions/auth_users here are defined by the nondeployable
 * tests/fixtures/m04-auth-migrations proposal, not any deployed D1 migration.
 * operation_receipts is likewise only a synthetic test-only table.
 *
 * The current architecture is ONE business per D1 binding. M04 sessions have
 * no tenant key: this adapter MUST NOT be used against a shared-tenant D1.
 * Until source-shaped staff RBAC is approved, built-in Administrator only.
 * Never register this adapter directly as a public RPC.
 */
import {requireD1Binding} from './d1-binding.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

const TOKEN=/^[0-9a-f]{64}$/;
const BUSINESS=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Z0-9_-]{1,64}$/;
const ACTOR=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TYPE=/^[a-z][a-z0-9._-]{1,63}$/;
const HASH=/^[0-9a-f]{64}$/;

const READ=`SELECT auth.actor_id,
    receipt.tenant_id AS receipt_tenant_id,
    receipt.operation_id,receipt.actor_id AS receipt_actor_id,
    receipt.operation_type,receipt.payload_hash,receipt.result_ref,
    receipt.committed_at
  FROM (
    SELECT s.user_id AS actor_id
    FROM auth_sessions AS s
    JOIN auth_users AS u ON u.user_id=s.user_id
    WHERE s.token_hash=?
      AND s.revoked_at_ms IS NULL
      AND s.created_at_ms<=? AND s.expires_at_ms>?
      AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?
      AND u.status='Active'
      AND u.auth_version=s.user_auth_version
      AND u.credential_version=s.credential_version
      AND u.role_name='Administrator'
      AND s.role_auth_version IS NULL
  ) AS auth
  LEFT JOIN operation_receipts AS receipt
    ON receipt.tenant_id=? AND receipt.operation_id=?
  LIMIT 2`;

function exactData(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null)){
    throw new TypeError('Invalid M04 receipt request');
  }
  const keys=Reflect.ownKeys(input);
  const allowed=['token','nowMs','operationId','operationType','payload'];
  if(keys.length!==allowed.length ||
     keys.some(key=>typeof key!=='string'||!allowed.includes(key))){
    throw new TypeError('Invalid M04 receipt request fields');
  }
  const values={};
  for(const key of allowed){
    const desc=Object.getOwnPropertyDescriptor(input,key);
    if(!desc?.enumerable || !Object.hasOwn(desc,'value')){
      throw new TypeError('Invalid M04 receipt request accessor');
    }
    values[key]=desc.value;
  }
  const {token,nowMs,operationId,operationType,payload}=values;
  if(typeof token!=='string'||!TOKEN.test(token) ||
     !Number.isSafeInteger(nowMs)||nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs) ||
     typeof operationId!=='string'||!OP.test(operationId) ||
     typeof operationType!=='string'||!TYPE.test(operationType)){
    throw new TypeError('Invalid M04 receipt token, time or operation');
  }
  return {token,nowMs,operationId,operationType,payload};
}
function hexBytes(token){
  const bytes=new Uint8Array(32);
  for(let i=0;i<32;i++)bytes[i]=parseInt(token.slice(i*2,i*2+2),16);
  return bytes;
}
async function sessionDigest(token){
  const subtle=globalThis.crypto?.subtle;
  if(!subtle?.digest) throw new Error('NEEDS_REVIEW: Web Crypto is required');
  const digest=new Uint8Array(await subtle.digest('SHA-256',hexBytes(token)));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
function validReceipt(row,businessId,operationId){
  return row.receipt_tenant_id===businessId &&
    row.operation_id===operationId &&
    typeof row.receipt_actor_id==='string' && ACTOR.test(row.receipt_actor_id) &&
    typeof row.operation_type==='string' && TYPE.test(row.operation_type) &&
    typeof row.payload_hash==='string' && HASH.test(row.payload_hash) &&
    typeof row.result_ref==='string' && !!row.result_ref.trim() &&
    typeof row.committed_at==='string' && !!row.committed_at.trim();
}

/**
 * Read-only single-SELECT authority snapshot using the *actual M04 proposal*
 * session column names, version checks and 30-minute inactivity boundary.
 * Token is digested like M04 login; neither actor nor business is passed in
 * a per-call request. No session touch, mutation, automatic retry or cache.
 */
export function createM04SingleBusinessReceiptReadback(env,{businessId}={}){
  const DB=requireD1Binding(env);
  if(typeof businessId!=='string'||!BUSINESS.test(businessId))
    throw new TypeError('Invalid trusted single-business D1 context');
  return Object.freeze({
    async reconcile_(input){
      const {token,nowMs,operationId,operationType,payload}=exactData(input);
      // Check canonical JSON subset before D1; not a permission check.
      await hashCanonicalOperationIntent({
        tenantId:businessId,actorId:'VALIDATOR',
        operationType,payload
      });
      const tokenHash=await sessionDigest(token);
      let response;
      try{
        response=await DB.prepare(READ).bind(
          tokenHash,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,
          nowMs,businessId,operationId
        ).all();
      }catch(error){
        throw new Error('NEEDS_REVIEW: D1 M04 receipt readback unavailable',{cause:error});
      }
      if(response?.success!==true||!Array.isArray(response.results)||
        response.results.length>1){
        throw new Error('NEEDS_REVIEW: malformed M04 receipt lookup');
      }
      if(response.results.length===0){
        throw new Error('Denied: M04 receipt read permission unavailable');
      }
      const row=response.results[0];
      if(!row||typeof row!=='object' ||
        typeof row.actor_id!=='string'||!ACTOR.test(row.actor_id)){
        throw new Error('NEEDS_REVIEW: invalid M04 session row');
      }
      if(row.receipt_tenant_id===null && row.operation_id===null &&
        row.receipt_actor_id===null && row.operation_type===null &&
        row.payload_hash===null && row.result_ref===null &&
        row.committed_at===null){
        return {status:'NEEDS_REVIEW',operationId};
      }
      if(!validReceipt(row,businessId,operationId)){
        throw new Error('NEEDS_REVIEW: malformed committed M04 receipt');
      }
      if(row.receipt_actor_id!==row.actor_id){
        throw new Error('Denied: receipt actor is not this session');
      }
      const digest=await hashCanonicalOperationIntent({
        tenantId:businessId,actorId:row.actor_id,operationType,payload
      });
      if(row.operation_type!==operationType || row.payload_hash!==digest){
        return {status:'CONFLICT',operationId};
      }
      return {status:'REPLAY',operationId,resultRef:row.result_ref};
    }
  });
}
