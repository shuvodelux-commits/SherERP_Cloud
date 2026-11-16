/**
 * M07-B5 TEST ONLY: exact-once Supplier Credit Purchase Return correction.
 * Original M05 Purchase and M07 Supplier Credit receipt remain immutable;
 * isolated local D1 source guards atomically restore original lot and only
 * this supplier's independently signed Supplier Due/advance.
 * NOT a production RPC, authenticated service, migration, or public Writer.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[0-9a-f]{64}$/;
const FIELDS='actorId,creditPaisa,lotId,operationId,originalHash,purchaseId,reason,returnId,sku,supplierId,tenantId,units';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);

function validate(raw){
  if(!plain(raw)||Reflect.ownKeys(raw).sort().join(',')!==FIELDS)
    throw new TypeError('Invalid synthetic Supplier Credit deletion request shape');
  const {tenantId,actorId,operationId,returnId,purchaseId,supplierId,
    sku,lotId,originalHash,units,creditPaisa,reason}=raw;
  if(![tenantId,actorId,returnId,purchaseId,supplierId,sku,lotId].every(x=>
      typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1_000_000||
    !Number.isSafeInteger(creditPaisa)||creditPaisa<1||creditPaisa>1_000_000_000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
    throw new TypeError('Invalid synthetic Supplier Credit deletion source, quantity, amount or reason');
  return {tenantId,actorId,operationId,returnId,purchaseId,supplierId,
    sku,lotId,originalHash,units,creditPaisa,reason};
}

const CLAIM=`INSERT INTO m07_purchase_credit_delete_receipts(
 tenant_id,return_id,operation_id,actor_id,purchase_id,supplier_id,
 sku,lot_id,source_hash,intent_hash,units,credit_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m05_sessions s
   WHERE s.tenant_id=? AND s.state='Open')
 AND EXISTS(
   SELECT 1 FROM m07_purchase_credit_returns r
   JOIN m07_purchase_credit_ledger l ON l.tenant_id=r.tenant_id
     AND l.return_id=r.return_id AND l.purchase_id=r.purchase_id
     AND l.supplier_id=r.supplier_id AND l.credit_paisa=r.credit_paisa
   JOIN m07_purchase_return_moves rm ON rm.tenant_id=r.tenant_id
     AND rm.return_id=r.return_id AND rm.purchase_id=r.purchase_id
     AND rm.sku=r.sku AND rm.lot_id=r.lot_id AND rm.units_out=r.units
   JOIN m05_purchases p ON p.tenant_id=r.tenant_id
     AND p.purchase_id=r.purchase_id AND p.supplier_id=r.supplier_id
     AND p.sku=r.sku AND p.intent_hash=r.source_hash
   JOIN m05_items i ON i.tenant_id=p.tenant_id
     AND i.purchase_id=p.purchase_id AND i.sku=p.sku
     AND i.qty=p.qty AND i.unit_cost_paisa=p.unit_cost_paisa
   JOIN m05_movements origin ON origin.tenant_id=p.tenant_id
     AND origin.purchase_id=p.purchase_id AND origin.sku=p.sku
     AND origin.lot_id=r.lot_id AND origin.units_in=p.qty
   JOIN m05_lots purchased ON purchased.tenant_id=p.tenant_id
     AND purchased.purchase_id=p.purchase_id AND purchased.supplier_id=p.supplier_id
     AND purchased.sku=p.sku AND purchased.lot_id=r.lot_id
     AND purchased.qty=p.qty AND purchased.unit_cost_paisa=p.unit_cost_paisa
     AND purchased.purchase_date=p.purchase_date
   JOIN m07_purchase_lot_balances b ON b.tenant_id=p.tenant_id
     AND b.purchase_id=p.purchase_id AND b.lot_id=r.lot_id
     AND b.sku=p.sku AND b.remaining+r.units<=purchased.qty
   JOIN m05_products product ON product.tenant_id=p.tenant_id
     AND product.sku=p.sku AND product.active=1 AND product.deleted=0
     AND product.product_type='Standard'
   JOIN m05_suppliers supplier ON supplier.tenant_id=p.tenant_id
     AND supplier.supplier_id=p.supplier_id AND supplier.active=1
   JOIN m05_party_links link ON link.tenant_id=p.tenant_id
     AND link.source_group='SUPPLIERS'
     AND link.source_id=p.supplier_id AND link.party_id=supplier.party_id
     AND link.reviewed=1
   JOIN m07_purchase_supplier_signed signed ON signed.tenant_id=p.tenant_id
     AND signed.supplier_id=p.supplier_id AND signed.active=1
     AND signed.party_id=supplier.party_id AND signed.party_id=l.party_id
     AND signed.signed_due_paisa=l.balance_paisa
   WHERE r.tenant_id=? AND r.return_id=? AND r.purchase_id=?
     AND r.supplier_id=? AND r.sku=? AND r.lot_id=?
     AND r.source_hash=? AND r.units=? AND r.credit_paisa=?
     AND p.grand_paisa=p.qty*p.unit_cost_paisa-p.discount_paisa
     AND p.grand_paisa>0 AND p.grand_paisa*r.units=p.qty*r.credit_paisa
     AND NOT EXISTS(SELECT 1 FROM m07_purchase_credit_delete_dependencies dep
       WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id
       AND dep.supplier_id=r.supplier_id)
     AND NOT EXISTS(SELECT 1 FROM m07_purchase_credit_ledger newer
       WHERE newer.tenant_id=l.tenant_id AND newer.supplier_id=l.supplier_id
       AND newer.rowid>l.rowid
       AND NOT EXISTS(SELECT 1 FROM m07_purchase_credit_delete_receipts corrected
         WHERE corrected.tenant_id=newer.tenant_id
         AND corrected.return_id=newer.return_id))
 )
 AND NOT EXISTS(SELECT 1 FROM m07_purchase_credit_returns original
   WHERE original.tenant_id=? AND original.operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m07_purchase_cash_returns cash
   WHERE cash.tenant_id=? AND (cash.operation_id=? OR cash.return_id=?))
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;

const READBACK=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_purchase_credit_delete_receipts
 WHERE tenant_id=? AND (return_id=? OR operation_id=?)`;

function rows(part){
  if(part?.success!==true||!Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: Supplier Credit correction D1 receipt unavailable');
  return part.results;
}

export function createSyntheticD1PurchaseCreditDeleteContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new TypeError('Invalid synthetic Supplier Credit correction D1 binding');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Supplier Credit correction hook');
  return Object.freeze({
    async post(raw){
      const x=validate(raw);
      const {tenantId,actorId,operationId,returnId,purchaseId,supplierId,
        sku,lotId,originalHash,units,creditPaisa,reason}=x;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.return.supplier-credit.delete',
        payload:{returnId,purchaseId,supplierId,sku,lotId,originalHash,
          units,creditPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,returnId,purchaseId,operationId});
      let response;
      try{
        response=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,returnId,operationId,actorId,purchaseId,supplierId,
            sku,lotId,originalHash,intentHash,units,creditPaisa,reason,
            tenantId,
            tenantId,returnId,purchaseId,supplierId,sku,lotId,
            originalHash,units,creditPaisa,
            tenantId,operationId,
            tenantId,operationId,returnId
          ),
          DB.prepare(READBACK).bind(tenantId,returnId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Supplier Credit correction outcome uncertain; reconcile the original operation');
      }
      if(!Array.isArray(response)||response.length!==2)
        throw new Error('NEEDS_REVIEW: Supplier Credit correction D1 batch incomplete');
      const [claimed,found]=response.map(rows);
      if(found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous Supplier Credit correction identity');
      const receipt=found[0];
      const exact=receipt?.return_id===returnId&&
        receipt?.operation_id===operationId&&
        receipt?.actor_id===actorId&&receipt?.intent_hash===intentHash;
      if(claimed.length===1&&exact)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!receipt)return {status:'DECLINED',operationId};
        return exact?{status:'REPLAY',operationId,returnId}:
          {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: conflicting Supplier Credit correction claim/readback');
    }
  });
}
