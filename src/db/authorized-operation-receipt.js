/**
 * M03 internal authorized receipt readback, NOT a production login or posting
 * endpoint. The joined synthetic auth tables are test-only future interfaces.
 * Do not register this in public RPC until real M04 schema and role policy
 * have passed migration, cutover and authorization review.
 */
import {requireD1Binding} from './d1-binding.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

const TOKEN=/^[0-9a-f]{64}$/;
const TENANT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Z0-9_-]{1,64}$/;
const ACTOR=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TYPE=/^[a-z][a-z0-9._-]{1,63}$/;
const HASH=/^[0-9a-f]{64}$/;

// Authenticates a *read* and retrieves the tenant's immutable receipt in
// one SQL statement. Never use a successful lookup as authority for a
// subsequent write; M04 must authorize mutation inside its D1 transaction.
const SQL=`SELECT auth.tenant_id,auth.user_id AS actor_id,
    receipt.tenant_id AS receipt_tenant_id,
    receipt.operation_id,receipt.actor_id AS receipt_actor_id,
    receipt.operation_type,receipt.payload_hash,
    receipt.result_ref,receipt.committed_at
  FROM (
    SELECT s.tenant_id,s.user_id
    FROM synthetic_auth_sessions s
    JOIN synthetic_auth_users u
      ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
    JOIN synthetic_auth_roles g
      ON g.tenant_id=s.tenant_id AND g.role_id=s.role_id
    WHERE s.token_hash=? AND s.tenant_id=?
      AND s.revoked_at IS NULL AND s.expires_at>?
      AND u.status='Active' AND g.status='Active'
      AND g.can_read_receipt=1
      AND u.role_id=s.role_id
      AND u.auth_version=s.user_version
      AND g.auth_version=s.role_version
  ) AS auth
  LEFT JOIN operation_receipts receipt
    ON receipt.tenant_id=auth.tenant_id AND receipt.operation_id=?
  LIMIT 2`;

function validateInput(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null)){
    throw new TypeError('Invalid authorized receipt request');
  }
  const fields=Reflect.ownKeys(input);
  if(fields.length!==6 || fields.some(key=>typeof key!=='string') ||
    fields.sort().join(',')!=='now,operationId,operationType,payload,tenantId,tokenHash'){
    throw new TypeError('Invalid authorized receipt request fields');
  }
  const fieldsValue={};
  for(const key of fields){
    const desc=Object.getOwnPropertyDescriptor(input,key);
    if(!desc?.enumerable || !Object.hasOwn(desc,'value')){
      throw new TypeError('Invalid authorized receipt field descriptor');
    }
    fieldsValue[key]=desc.value;
  }
  const {tokenHash,tenantId,now,operationId,operationType,payload}=fieldsValue;
  if(typeof tokenHash!=='string' || !TOKEN.test(tokenHash) ||
    typeof tenantId!=='string' || !TENANT.test(tenantId) ||
    !Number.isSafeInteger(now) || now<0 ||
    typeof operationId!=='string' || !OP.test(operationId) ||
    typeof operationType!=='string' || !TYPE.test(operationType)){
    throw new TypeError('Invalid authorized receipt token, tenant, time or operation');
  }
  return {tokenHash,tenantId,now,operationId,operationType,payload};
}
function isValidReceipt(row,tenantId,operationId){
  return row.receipt_tenant_id===tenantId &&
    row.operation_id===operationId &&
    typeof row.receipt_actor_id==='string' && ACTOR.test(row.receipt_actor_id) &&
    typeof row.operation_type==='string' && TYPE.test(row.operation_type) &&
    typeof row.payload_hash==='string' && HASH.test(row.payload_hash) &&
    typeof row.result_ref==='string' && !!row.result_ref.trim() &&
    typeof row.committed_at==='string' && !!row.committed_at.trim();
}

/**
 * Trusted caller supplies an opaque session TOKEN DIGEST and server clock.
 * Actor identity comes ONLY from an active session row in D1.
 *
 * The SELECT gives a point-in-time authority snapshot. Revocation immediately
 * after the SELECT can still occur before response serialization; this is a
 * read-only reconciliation contract, never permission to perform writes.
 */
export function createAuthorizedOperationReceiptAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async reconcile_(request){
      const x=validateInput(request);
      // Canonicalization must fail closed before the SQL read. A placeholder
      // actor is used ONLY to validate the JSON subset; it is discarded.
      // The actual fingerprint is derived later from D1's verified user ID.
      await hashCanonicalOperationIntent({
        tenantId:x.tenantId,actorId:'VALIDATOR',operationType:x.operationType,
        payload:x.payload
      });
      let response;
      try{
        response=await DB.prepare(SQL).bind(
          x.tokenHash,x.tenantId,x.now,x.operationId
        ).all();
      }catch(error){
        throw new Error('NEEDS_REVIEW: D1 authorized receipt lookup failed',{cause:error});
      }
      if(response?.success!==true || !Array.isArray(response.results) ||
         response.results.length>1){
        throw new Error('NEEDS_REVIEW: malformed or ambiguous D1 authorized receipt result');
      }
      if(response.results.length===0){
        throw new Error('Denied: receipt read permission unavailable');
      }
      const row=response.results[0];
      if(!row || row.tenant_id!==x.tenantId ||
        typeof row.actor_id!=='string' || !ACTOR.test(row.actor_id)){
        throw new Error('NEEDS_REVIEW: invalid D1 session identity');
      }
      if(row.receipt_tenant_id===null && row.operation_id===null &&
        row.receipt_actor_id===null && row.operation_type===null &&
        row.payload_hash===null && row.result_ref===null &&
        row.committed_at===null){
        return {status:'NEEDS_REVIEW',operationId:x.operationId};
      }
      if(!isValidReceipt(row,x.tenantId,x.operationId)){
        throw new Error('NEEDS_REVIEW: invalid D1 committed receipt');
      }
      if(row.receipt_actor_id!==row.actor_id){
        // Authorized users cannot enumerate another actor's receipt.
        throw new Error('Denied: receipt belongs to a different actor');
      }
      const digest=await hashCanonicalOperationIntent({
        tenantId:x.tenantId,actorId:row.actor_id,
        operationType:x.operationType,payload:x.payload
      });
      if(row.operation_type!==x.operationType || row.payload_hash!==digest){
        return {status:'CONFLICT',operationId:x.operationId};
      }
      return {status:'REPLAY',operationId:x.operationId,resultRef:row.result_ref};
    }
  });
}
