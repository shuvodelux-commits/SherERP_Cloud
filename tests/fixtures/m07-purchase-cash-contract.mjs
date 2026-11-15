/**
 * M07-B1 TEST ONLY: original M05 purchase/lot Cash Return exact-once local D1 proof.
 * Original M05 purchase header/lot quantity is immutable; remaining lives in
 * disposable m07_purchase_lot_balances. No public RPC, real M08 Cash or RBAC.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[0-9a-f]{64}$/;
const FIELDS='actorId,lotId,operationId,originalHash,purchaseId,reason,refundPaisa,returnId,sku,tenantId,units';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function validate(raw){
 if(!plain(raw)||Reflect.ownKeys(raw).sort().join(',')!==FIELDS)
   throw new TypeError('Invalid Purchase Cash Return request shape');
 const {tenantId,actorId,purchaseId,returnId,operationId,sku,lotId,
  originalHash,units,refundPaisa,reason}=raw;
 if(![tenantId,actorId,purchaseId,returnId,sku,lotId].every(x=>typeof x==='string'&&ID.test(x))||
  typeof operationId!=='string'||!OP.test(operationId)||
  typeof originalHash!=='string'||!HASH.test(originalHash)||
  !Number.isSafeInteger(units)||units<1||units>1000000||
  !Number.isSafeInteger(refundPaisa)||refundPaisa<1||refundPaisa>1000000000||
  typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
   throw new TypeError('Invalid Purchase Cash Return identity, source, amount or reason');
 return {tenantId,actorId,purchaseId,returnId,operationId,sku,lotId,
  originalHash,units,refundPaisa,reason};
}
const CLAIM=`INSERT INTO m07_purchase_cash_returns(
 tenant_id,return_id,operation_id,actor_id,purchase_id,sku,lot_id,
 source_hash,intent_hash,units,refund_paisa,reason)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT DO NOTHING RETURNING return_id,operation_id,actor_id,intent_hash`;
const READ=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_purchase_cash_returns
 WHERE tenant_id=? AND (operation_id=? OR return_id=?)`;
function rows(part){
 if(part?.success!==true||!Array.isArray(part.results))
  throw new Error('NEEDS_REVIEW: incomplete Purchase Cash Return local D1 receipt');
 return part.results;
}
export function createSyntheticD1PurchaseCashReturnContract(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
  throw new Error('Missing local Purchase Cash Return D1');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
  throw new TypeError('Invalid Purchase Cash Return pre-claim hook');
 return Object.freeze({
  async post(raw){
   const v=validate(raw);
   const {tenantId,actorId,purchaseId,returnId,operationId,
    sku,lotId,originalHash,units,refundPaisa,reason}=v;
   const intentHash=await hashCanonicalOperationIntent({
    tenantId,actorId,operationType:'purchase.return.cash',
    payload:{purchaseId,returnId,sku,lotId,originalHash,units,refundPaisa,reason}
   });
   if(beforeBatch)await beforeBatch({tenantId,purchaseId,returnId,operationId});
   let response;
   try{
    response=await DB.batch([
     DB.prepare(CLAIM).bind(
      tenantId,returnId,operationId,actorId,purchaseId,sku,lotId,
      originalHash,intentHash,units,refundPaisa,reason),
     DB.prepare(READ).bind(tenantId,operationId,returnId)
    ]);
   }catch{
    throw new Error('NEEDS_REVIEW: Purchase Cash Return commit uncertain; reconcile original operation ID');
   }
   if(!Array.isArray(response)||response.length!==2)
    throw new Error('NEEDS_REVIEW: missing Purchase Cash Return D1 claim/readback');
   const [claimed,found]=response.map(rows);
   if(found.length>1)
    throw new Error('NEEDS_REVIEW: ambiguous Purchase Cash Return identity');
   const old=found[0];
   const exact=old?.return_id===returnId&&old?.operation_id===operationId&&
     old?.actor_id===actorId&&old?.intent_hash===intentHash;
   if(claimed.length===1&&exact)
    return {status:'COMMITTED',operationId,returnId};
   if(claimed.length===0){
    if(!old)return {status:'DECLINED',operationId};
    if(exact)return {status:'REPLAY',operationId,returnId};
    return {status:'CONFLICT',operationId};
   }
   throw new Error('NEEDS_REVIEW: contradictory Purchase Cash Return commit/readback');
  }
 });
}
