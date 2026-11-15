/**
 * TEST ONLY — synthetic local Workerd/D1 Supplier purchase reassignment.
 * No public RPC, production D1 posting, or multi-role offset is authorized.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const SQL_CLAIM=`INSERT OR IGNORE INTO m05ml_supplier_transfer_receipts(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,reason,
 source_supplier_id,target_supplier_id,due_paisa)
 SELECT ?,?,?,?,?,?,?,?,p.due_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=? AND p.purchase_id=?
 AND p.supplier_id=? AND p.due_paisa>0
 RETURNING purchase_id,operation_id,actor_id,intent_hash,target_supplier_id,due_paisa`;
const SQL_LOOKUP=`SELECT r.purchase_id,r.operation_id,r.actor_id,r.intent_hash,
 r.target_supplier_id,r.due_paisa,a.lot_count
 FROM m05ml_supplier_transfer_receipts r
 LEFT JOIN m05ml_supplier_transfer_audit a ON a.tenant_id=r.tenant_id
 AND a.purchase_id=r.purchase_id
 WHERE r.tenant_id=? AND r.operation_id=?`;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function validate(input){
 const expected=[
   'tenantId','actorId','purchaseId','operationId','reason',
   'sourceSupplierId','targetSupplierId'
 ];
 if(!record(input)||Reflect.ownKeys(input).sort().join(',')!==expected.sort().join(',')
  ||!ID.test(input.tenantId||'')||!ID.test(input.actorId||'')
  ||!ID.test(input.purchaseId||'')||!ID.test(input.sourceSupplierId||'')
  ||!ID.test(input.targetSupplierId||'')||!OP.test(input.operationId||'')
  ||typeof input.reason!=='string'||input.reason.trim().length===0
  ||input.reason.length>200||/[\x00-\x1f\x7f]/.test(input.reason))
   throw new TypeError('Invalid synthetic purchase Supplier reassignment identity');
}
function rows(result){
 if(result?.success!==true||!Array.isArray(result.results))
   throw new Error('NEEDS_REVIEW: missing authoritative Supplier transfer D1 result');
 return result.results;
}
export function createSyntheticPurchaseSupplierTransfer(DB,{beforeBatch}={}){
 if(!DB||typeof DB.batch!=='function'||typeof DB.prepare!=='function')
   throw new Error('Test-only local Workerd D1 binding required');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
   throw new TypeError('Invalid Supplier transfer test-only beforeBatch hook');
 return Object.freeze({
   async transfer(input){
     validate(input);
     const {tenantId,actorId,purchaseId,operationId,reason,
       sourceSupplierId,targetSupplierId}=input;
     const intentHash=await hashCanonicalOperationIntent({
       tenantId,actorId,operationType:'purchase.supplier_transfer.synthetic',
       payload:{purchaseId,reason,sourceSupplierId,targetSupplierId}
     });
     if(beforeBatch)await beforeBatch({tenantId,purchaseId,operationId});
     let results;
     try{
       results=await DB.batch([
         DB.prepare(SQL_CLAIM).bind(
           tenantId,purchaseId,operationId,actorId,intentHash,reason,
           sourceSupplierId,targetSupplierId,
           tenantId,purchaseId,sourceSupplierId
         ),
         DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
       ]);
     }catch{
       // Never infer rollback solely from a missing client response: D1 may
       // have committed. Reconcile the same operation ID before any retry.
       throw new Error('NEEDS_REVIEW: Supplier purchase reassignment uncertain; reconcile operation ID');
     }
     if(!Array.isArray(results)||results.length!==2)
       throw new Error('NEEDS_REVIEW: ambiguous Supplier reassignment D1 batch');
     const [claim,lookup]=results.map(rows);
     const found=lookup.length===1?lookup[0]:null;
     const same=found?.purchase_id===purchaseId
       &&found?.actor_id===actorId&&found?.intent_hash===intentHash
       &&found?.target_supplier_id===targetSupplierId
       &&Number.isSafeInteger(found?.lot_count)&&found.lot_count>0;
     if(claim.length===1&&same)return {
       status:'COMMITTED',operationId,purchaseId,
       targetSupplierId,dueTransferredPaisa:found.due_paisa
     };
     if(claim.length===0){
       if(!found)return {status:'DECLINED',operationId};
       if(same)return {
         status:'REPLAY',operationId,purchaseId,
         targetSupplierId,dueTransferredPaisa:found.due_paisa
       };
       return {status:'CONFLICT',operationId};
     }
     throw new Error('NEEDS_REVIEW: inconsistent Supplier transfer claim/readback');
   }
 });
}
