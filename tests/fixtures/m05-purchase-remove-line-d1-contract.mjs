/**
 * M05 local test-only removal claim. Not a deployed RPC or M07 native writer.
 * The D1 trigger owns preconditions and makes SKU stock and Supplier payable
 * atomic; original purchase/lot/Cash/Bank history remains immutable.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const SQL_CLAIM=`INSERT OR IGNORE INTO m05ml_remove_receipts(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,reason,
 sku,expected_version,removed_qty,removed_cost_paisa,new_due_paisa)
 SELECT ?,?,?,?,?,?,?,?,i.qty,i.cost_paisa,
 p.due_paisa-i.qty*i.cost_paisa
 FROM m05ml_purchases p JOIN m05ml_items i ON i.tenant_id=p.tenant_id
 AND i.purchase_id=p.purchase_id AND i.sku=?
 WHERE p.tenant_id=? AND p.purchase_id=?
 AND p.due_paisa>=i.qty*i.cost_paisa
 RETURNING purchase_id,operation_id,actor_id,intent_hash,new_due_paisa`;
const SQL_LOOKUP=`SELECT r.purchase_id,r.operation_id,r.actor_id,r.intent_hash,
 r.new_due_paisa,a.lines_removed
 FROM m05ml_remove_receipts r LEFT JOIN m05ml_remove_audit a
 ON a.tenant_id=r.tenant_id AND a.purchase_id=r.purchase_id
 WHERE r.tenant_id=? AND r.operation_id=?`;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const keysExact=(x,keys)=>record(x)&&
 Reflect.ownKeys(x).sort().join(',')===keys.slice().sort().join(',');

function validate(input){
 if(!keysExact(input,['tenantId','actorId','purchaseId','operationId',
   'reason','sku','expectedVersion'])
   ||!ID.test(input.tenantId||'')||!ID.test(input.actorId||'')
   ||!ID.test(input.purchaseId||'')||!ID.test(input.sku||'')
   ||!OP.test(input.operationId||'')
   ||typeof input.reason!=='string'||input.reason.trim().length===0
   ||input.reason.length>200||/[\x00-\x1f\x7f]/.test(input.reason)
   ||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1
   ||input.expectedVersion>1_000_000)
   throw new TypeError('Invalid test-only original purchase SKU removal');
}
function rows(result){
 if(result?.success!==true||!Array.isArray(result.results))
   throw new Error('NEEDS_REVIEW: missing authoritative local D1 removal result');
 return result.results;
}
export function createSyntheticPurchaseLineRemover(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
   throw new Error('Synthetic local D1 binding required');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
   throw new TypeError('Invalid removal beforeBatch test hook');
 return Object.freeze({
   async remove(input){
     validate(input);
     const {tenantId,actorId,purchaseId,operationId,reason,sku,expectedVersion}=input;
     const intentHash=await hashCanonicalOperationIntent({
       tenantId,actorId,operationType:'purchase.remove_line.synthetic',
       payload:{purchaseId,reason,sku,expectedVersion}
     });
     if(beforeBatch)await beforeBatch({tenantId,purchaseId,operationId});
     let result;
     try{
       result=await DB.batch([
         DB.prepare(SQL_CLAIM).bind(
           tenantId,purchaseId,operationId,actorId,intentHash,reason,
           sku,expectedVersion,sku,tenantId,purchaseId
         ),
         DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
       ]);
     }catch{
       // A client may lose an acknowledgment after a real D1 commit.
       // Do not silently retry with a different financial operation ID.
       throw new Error('NEEDS_REVIEW: purchase line removal commit uncertain; reconcile operation ID');
     }
     if(!Array.isArray(result)||result.length!==2)
       throw new Error('NEEDS_REVIEW: ambiguous purchase line removal response');
     const [claim,lookup]=result.map(rows);
     const found=lookup.length===1?lookup[0]:null;
     const same=found?.actor_id===actorId&&found?.intent_hash===intentHash
       &&found?.purchase_id===purchaseId&&found?.lines_removed===1;
     if(claim.length===1&&same)return {
       status:'COMMITTED',operationId,purchaseId,
       newDuePaisa:found.new_due_paisa,linesRemoved:1
     };
     if(claim.length===0){
       if(!found)return {status:'DECLINED',operationId};
       if(same)return {
         status:'REPLAY',operationId,purchaseId,
         newDuePaisa:found.new_due_paisa,linesRemoved:1
       };
       return {status:'CONFLICT',operationId};
     }
     throw new Error('NEEDS_REVIEW: inconsistent removal D1 claim/readback');
   }
 });
}
