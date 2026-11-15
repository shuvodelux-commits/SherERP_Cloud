/**
 * TEST-ONLY purchase soft-delete poster for synthetic local m05ml_* D1.
 * This is NOT the M07 native reversal engine, production SQL, staff auth or
 * RPC. The authoritative guard and entire reversal run in SQLite triggers.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const SQL_CLAIM=`INSERT OR IGNORE INTO m05ml_delete_receipts(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,reason,deleted_at,due_reversed_paisa)
 SELECT ?,?,?,?,?,?,?,p.due_paisa
 FROM m05ml_purchases p
 WHERE p.tenant_id=? AND p.purchase_id=?
 AND EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=p.tenant_id AND s.state='Open')
 AND EXISTS(SELECT 1 FROM m05ml_suppliers s JOIN m05ml_party_links l
 ON l.tenant_id=s.tenant_id AND l.source_group='SUPPLIERS'
 AND l.source_id=s.supplier_id AND l.party_id=s.party_id AND l.reviewed=1
 WHERE s.tenant_id=p.tenant_id AND s.supplier_id=p.supplier_id AND s.active=1)
 AND NOT EXISTS(SELECT 1 FROM m05ml_purchase_returns r
 WHERE r.tenant_id=p.tenant_id AND r.purchase_id=p.purchase_id AND r.active=1)
 AND NOT EXISTS(SELECT 1 FROM m05ml_purchase_settlements x
 WHERE x.tenant_id=p.tenant_id AND x.purchase_id=p.purchase_id AND x.active=1)
 AND EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id)
 AND (SELECT COUNT(*) FROM m05ml_lots l
 WHERE l.tenant_id=p.tenant_id AND l.purchase_id=p.purchase_id)
 = (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id)
 AND NOT EXISTS(
 SELECT 1 FROM m05ml_items i
 LEFT JOIN m05ml_lots l
 ON l.tenant_id=i.tenant_id AND l.purchase_id=i.purchase_id AND l.sku=i.sku
 LEFT JOIN m05ml_products pr
 ON pr.tenant_id=i.tenant_id AND pr.sku=i.sku
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id
 AND (l.lot_id IS NULL OR l.qty<>i.qty OR l.remaining_qty<>l.qty
 OR pr.sku IS NULL OR pr.stock<i.qty OR pr.active<>1 OR pr.deleted<>0
 OR pr.product_type<>'Standard'))
 RETURNING purchase_id,operation_id,actor_id,intent_hash,due_reversed_paisa`;
const SQL_LOOKUP=`SELECT d.purchase_id,d.operation_id,d.actor_id,d.intent_hash,
 d.due_reversed_paisa,a.lines_reversed
 FROM m05ml_delete_receipts d
 LEFT JOIN m05ml_delete_audit a ON a.tenant_id=d.tenant_id
 AND a.purchase_id=d.purchase_id
 WHERE d.tenant_id=? AND d.operation_id=?`;
function validate(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     Reflect.ownKeys(input).sort().join(',')!==
     ['tenantId','actorId','purchaseId','operationId','reason'].sort().join(',') ||
     !ID.test(input.tenantId||'') || !ID.test(input.actorId||'') ||
     !ID.test(input.purchaseId||'') || !OP.test(input.operationId||'') ||
     typeof input.reason!=='string' ||
     input.reason.trim().length===0 || input.reason.length>200 ||
     /[\x00-\x1f\x7f]/.test(input.reason)){
    throw new TypeError('Invalid synthetic purchase deletion identity or reason');
  }
}
function getRows(result){
  if(result?.success!==true||!Array.isArray(result.results))
    throw new Error('NEEDS_REVIEW: missing D1 deletion claim result');
  return result.results;
}

export function createSyntheticPurchaseDeleter(DB,{beforeBatch}={}){
  if(!DB||typeof DB.batch!=='function'||typeof DB.prepare!=='function')
    throw new Error('Synthetic local D1 test binding required');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic beforeBatch hook');
  return Object.freeze({
    async remove(input){
      validate(input);
      const {tenantId,actorId,purchaseId,operationId,reason}=input;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.delete.synthetic',
        payload:{purchaseId,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,purchaseId,operationId});
      let result;
      try{
        result=await DB.batch([
          DB.prepare(SQL_CLAIM).bind(
            tenantId,purchaseId,operationId,actorId,intentHash,reason,'2026-11-15',
            tenantId,purchaseId
          ),
          DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
        ]);
      }catch{
        // The real caller must reconcile uncertain responses by operation ID.
        // Do not infer rollback from a missing client response.
        throw new Error('NEEDS_REVIEW: purchase deletion commit uncertain; reconcile operation ID');
      }
      if(!Array.isArray(result)||result.length!==2)
        throw new Error('NEEDS_REVIEW: deletion result shape uncertain');
      const [claim,lookup]=result.map(getRows);
      const found=lookup.length===1?lookup[0]:null;
      const equal=found?.intent_hash===intentHash && found?.actor_id===actorId;
      if(claim.length===1&&found?.purchase_id===purchaseId&&equal &&
         Number.isSafeInteger(found?.lines_reversed)){
        return {status:'COMMITTED',operationId,purchaseId,
          linesReversed:found.lines_reversed,
          dueReversedPaisa:found.due_reversed_paisa};
      }
      if(claim.length===0){
        if(!found)return {status:'DECLINED',operationId};
        if(equal&&found.purchase_id===purchaseId &&
           Number.isSafeInteger(found.lines_reversed)){
          return {status:'REPLAY',operationId,purchaseId,
            linesReversed:found.lines_reversed,
            dueReversedPaisa:found.due_reversed_paisa};
        }
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: inconsistent purchase deletion receipt');
    }
  });
}
