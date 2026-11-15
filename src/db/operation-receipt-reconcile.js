import {requireD1Binding} from './d1-binding.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

// This is a READ-ONLY future contract. Its operation_receipts table exists
// ONLY in the local synthetic test fixture until a separately reviewed M02/M03
// migration is approved. Never register it as a public RPC.
const QUERY=`SELECT tenant_id,operation_id,actor_id,operation_type,
                    payload_hash,result_ref,committed_at
  FROM operation_receipts
  WHERE tenant_id=? AND operation_id=?
  LIMIT 2`;
const OP_ID=/^[A-Z0-9_-]{1,64}$/;
const HASH=/^[0-9a-f]{64}$/;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TYPE=/^[a-z][a-z0-9._-]{1,63}$/;

function inputData(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)){
    throw new TypeError('Invalid operation receipt intent object');
  }
  const keys=Reflect.ownKeys(value);
  if(keys.length!==5 || keys.some(key=>typeof key!=='string') ||
    keys.sort().join(',')!=='actorId,operationId,operationType,payload,tenantId'){
    throw new TypeError('Invalid operation receipt intent fields');
  }
  const read=key=>{
    const property=Object.getOwnPropertyDescriptor(value,key);
    if(!property || !property.enumerable || !Object.hasOwn(property,'value')){
      throw new TypeError('Invalid operation receipt intent accessor');
    }
    return property.value;
  };
  const tenantId=read('tenantId'), operationId=read('operationId'),
    actorId=read('actorId'), operationType=read('operationType'),
    payload=read('payload');
  if(typeof operationId!=='string'||!OP_ID.test(operationId)){
    throw new TypeError('Invalid stable operation receipt ID');
  }
  return {tenantId,operationId,actorId,operationType,payload};
}
function knownReceipt(record,tenantId,operationId){
  return !!record && typeof record==='object' &&
    record.tenant_id===tenantId && record.operation_id===operationId &&
    typeof record.actor_id==='string' && IDENT.test(record.actor_id) &&
    typeof record.operation_type==='string' && TYPE.test(record.operation_type) &&
    typeof record.payload_hash==='string' && HASH.test(record.payload_hash) &&
    typeof record.result_ref==='string' && !!record.result_ref.trim() &&
    typeof record.committed_at==='string' && !!record.committed_at.trim();
}

/**
 * Server-trusted, tenant-scoped readback of an immutable COMMITTED receipt
 * after a potentially lost D1 transaction response. No writes, no fallback,
 * no module cache, no client-supplied digest and no retry authorization.
 *
 * REPLAY = same committed scope and original canonical payload, safe to
 * return the original result reference (not to repost).
 * CONFLICT = operation ID already committed to different immutable intent.
 * NEEDS_REVIEW = absent committed receipt, NOT an invitation to retry.
 */
export function createOperationReceiptReconciliationAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async reconcile_(intent){
      const {tenantId,operationId,actorId,operationType,payload}=inputData(intent);
      // Recompute the canonical digest; never trust a supplied hash as intent.
      const payloadHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType,payload
      });
      let response;
      try{
        response=await DB.prepare(QUERY).bind(tenantId,operationId).all();
      }catch(error){
        throw new Error('NEEDS_REVIEW: D1 operation receipt lookup failed',{cause:error});
      }
      if(response?.success!==true || !Array.isArray(response.results) ||
         response.results.length>1){
        throw new Error('NEEDS_REVIEW: invalid or ambiguous D1 operation receipt result');
      }
      if(response.results.length===0){
        return {status:'NEEDS_REVIEW',operationId};
      }
      const row=response.results[0];
      if(!knownReceipt(row,tenantId,operationId)){
        throw new Error('NEEDS_REVIEW: malformed D1 operation receipt');
      }
      if(row.actor_id!==actorId || row.operation_type!==operationType ||
         row.payload_hash!==payloadHash){
        return {status:'CONFLICT',operationId};
      }
      return {status:'REPLAY',operationId,resultRef:row.result_ref};
    }
  });
}
