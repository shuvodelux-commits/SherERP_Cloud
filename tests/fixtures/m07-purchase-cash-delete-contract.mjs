/**
 * M07-B4 TEST-ONLY original Purchase Cash Return reversal, Workerd/D1.
 * Frozen source PurchaseReturn.gs records linked Purchase Return separately.
 * No production writer, M04 actor binding, authentic cash journal or RPC.
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
    throw new TypeError('Invalid synthetic Purchase Cash Return reversal shape');
  const {tenantId,actorId,purchaseId,returnId,operationId,sku,lotId,
    originalHash,units,refundPaisa,reason}=raw;
  if(![tenantId,actorId,purchaseId,returnId,sku,lotId].every(x=>
      typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1_000_000||
    !Number.isSafeInteger(refundPaisa)||refundPaisa<1||refundPaisa>1_000_000_000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
    throw new TypeError('Invalid synthetic Purchase Cash reversal identity, quantity, amount or reason');
  return {tenantId,actorId,purchaseId,returnId,operationId,sku,lotId,
    originalHash,units,refundPaisa,reason};
}

const CLAIM=`INSERT INTO m07_purchase_cash_delete_receipts(
 tenant_id,return_id,operation_id,actor_id,purchase_id,sku,lot_id,
 source_hash,intent_hash,units,refund_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m05_sessions
   WHERE tenant_id=? AND state='Open')
 AND EXISTS(
   SELECT 1 FROM m07_purchase_cash_returns r
   JOIN m07_purchase_cash_inflows f ON f.tenant_id=r.tenant_id
     AND f.return_id=r.return_id AND f.purchase_id=r.purchase_id
     AND f.credit_paisa=r.refund_paisa
   JOIN m07_purchase_return_moves rm ON rm.tenant_id=r.tenant_id
     AND rm.return_id=r.return_id AND rm.purchase_id=r.purchase_id
     AND rm.lot_id=r.lot_id AND rm.sku=r.sku AND rm.units_out=r.units
   JOIN m05_purchases p ON p.tenant_id=r.tenant_id
     AND p.purchase_id=r.purchase_id AND p.sku=r.sku
     AND p.intent_hash=r.source_hash
   JOIN m05_items i ON i.tenant_id=p.tenant_id
     AND i.purchase_id=p.purchase_id AND i.sku=p.sku
     AND i.qty=p.qty AND i.unit_cost_paisa=p.unit_cost_paisa
   JOIN m05_movements origmove ON origmove.tenant_id=p.tenant_id
     AND origmove.purchase_id=p.purchase_id AND origmove.sku=p.sku
     AND origmove.lot_id=r.lot_id AND origmove.units_in=p.qty
   JOIN m05_lots origlot ON origlot.tenant_id=p.tenant_id
     AND origlot.purchase_id=p.purchase_id AND origlot.supplier_id=p.supplier_id
     AND origlot.sku=p.sku AND origlot.lot_id=r.lot_id
     AND origlot.qty=p.qty AND origlot.unit_cost_paisa=p.unit_cost_paisa
     AND origlot.purchase_date=p.purchase_date
   JOIN m07_purchase_lot_balances b ON b.tenant_id=p.tenant_id
     AND b.lot_id=r.lot_id AND b.purchase_id=p.purchase_id
     AND b.sku=p.sku AND b.remaining>=0
     AND b.remaining+r.units<=origlot.qty
   JOIN m05_products product ON product.tenant_id=p.tenant_id
     AND product.sku=p.sku AND product.active=1
     AND product.deleted=0 AND product.product_type='Standard'
   JOIN m05_suppliers supplier ON supplier.tenant_id=p.tenant_id
     AND supplier.supplier_id=p.supplier_id AND supplier.active=1
   JOIN m05_party_links link ON link.tenant_id=p.tenant_id
     AND link.source_group='SUPPLIERS'
     AND link.source_id=p.supplier_id AND link.party_id=supplier.party_id
     AND link.reviewed=1
   WHERE r.tenant_id=? AND r.return_id=? AND r.purchase_id=?
     AND r.sku=? AND r.lot_id=? AND r.source_hash=?
     AND r.units=? AND r.refund_paisa=?
     AND p.grand_paisa=p.qty*p.unit_cost_paisa-p.discount_paisa
     AND p.grand_paisa*r.units=p.qty*r.refund_paisa
     AND p.paid_paisa>=f.credit_paisa
     AND NOT EXISTS(SELECT 1 FROM m07_purchase_cash_delete_dependencies dep
       WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id)
 )
 AND NOT EXISTS(SELECT 1 FROM m07_purchase_cash_returns
   WHERE tenant_id=? AND operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m05_purchases
   WHERE tenant_id=? AND operation_id=?)
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;
const RECEIPT=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_purchase_cash_delete_receipts
 WHERE tenant_id=? AND (return_id=? OR operation_id=?)`;

function rows(response){
  if(response?.success!==true||!Array.isArray(response.results))
    throw new Error('NEEDS_REVIEW: Purchase Cash reversal D1 receipt unavailable');
  return response.results;
}

export function createSyntheticD1PurchaseCashDeleteContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing synthetic Purchase Cash reversal local D1');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Purchase Cash reversal hook');
  return Object.freeze({
    async post(raw){
      const x=validate(raw);
      const {tenantId,actorId,purchaseId,returnId,operationId,sku,lotId,
        originalHash,units,refundPaisa,reason}=x;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.return.cash.delete',
        payload:{purchaseId,returnId,sku,lotId,originalHash,units,refundPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,purchaseId,returnId,operationId});
      let response;
      try{
        response=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,returnId,operationId,actorId,purchaseId,sku,lotId,
            originalHash,intentHash,units,refundPaisa,reason,
            tenantId,
            tenantId,returnId,purchaseId,sku,lotId,originalHash,units,refundPaisa,
            tenantId,operationId,
            tenantId,operationId
          ),
          DB.prepare(RECEIPT).bind(tenantId,returnId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Purchase Cash reversal outcome uncertain; reconcile original operation');
      }
      if(!Array.isArray(response)||response.length!==2)
        throw new Error('NEEDS_REVIEW: incomplete Purchase Cash reversal D1 batch');
      const [claimed,found]=response.map(rows);
      if(found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous Purchase Cash reversal identity');
      const receipt=found[0];
      const same=receipt?.return_id===returnId&&
        receipt?.operation_id===operationId&&receipt?.actor_id===actorId&&
        receipt?.intent_hash===intentHash;
      if(claimed.length===1&&same)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!receipt)return {status:'DECLINED',operationId};
        return same
          ?{status:'REPLAY',operationId,returnId}
          :{status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: inconsistent Purchase Cash reversal claim/readback');
    }
  });
}
