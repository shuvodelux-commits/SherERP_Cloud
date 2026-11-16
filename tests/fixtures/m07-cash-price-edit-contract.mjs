/**
 * M07-B7 TEST ONLY: source-bound Cash Sales Return price-only correction.
 * Append-only price revisions and exact delta Cash adjustments in one D1
 * transaction; no stock/lot write, production RPC, auth service or migration.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const EXPECTED='actorId,expectedVersion,invoiceId,lotId,newRefundPaisa,operationId,originalHash,previousRefundPaisa,reason,returnId,sku,tenantId';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function validate(input){
 if(!plain(input)||Reflect.ownKeys(input).sort().join(',')!==EXPECTED)
  throw new TypeError('Invalid synthetic Cash Return price edit shape');
 const {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
   originalHash,expectedVersion,previousRefundPaisa,newRefundPaisa,reason}=input;
 if(![tenantId,actorId,returnId,invoiceId,sku,lotId].every(x=>
     typeof x==='string'&&ID.test(x))||
   typeof operationId!=='string'||!OP.test(operationId)||
   typeof originalHash!=='string'||!HASH.test(originalHash)||
   !Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>999999||
   !Number.isSafeInteger(previousRefundPaisa)||previousRefundPaisa<0||
   previousRefundPaisa>1_000_000_000||
   !Number.isSafeInteger(newRefundPaisa)||newRefundPaisa<0||
   newRefundPaisa>1_000_000_000||
   typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
  throw new TypeError('Invalid synthetic Cash Return price edit identity, version, amount or reason');
 return {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
   originalHash,expectedVersion,previousRefundPaisa,newRefundPaisa,reason};
}

const CLAIM=`INSERT INTO m07_cash_price_edit_receipts(
 tenant_id,return_id,operation_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,expected_version,next_version,
 previous_refund_paisa,new_refund_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(
  SELECT 1 FROM m06_cash_sessions sess
  WHERE sess.tenant_id=? AND sess.state='Open'
 )
 AND EXISTS(
  SELECT 1 FROM m07_cash_returns r
  JOIN m07_cash_refunds refund ON refund.tenant_id=r.tenant_id
   AND refund.return_id=r.return_id AND refund.invoice_id=r.invoice_id
   AND refund.debit_paisa=r.refund_paisa
  JOIN m07_return_movements movement ON movement.tenant_id=r.tenant_id
   AND movement.return_id=r.return_id AND movement.invoice_id=r.invoice_id
   AND movement.sku=r.sku AND movement.lot_id=r.lot_id
   AND movement.units_in=r.units
  JOIN m06_invoices invoice ON invoice.tenant_id=r.tenant_id
   AND invoice.invoice_id=r.invoice_id AND invoice.sku=r.sku
   AND invoice.payload_hash=r.source_hash
  JOIN m06_sale_items item ON item.tenant_id=invoice.tenant_id
   AND item.invoice_id=invoice.invoice_id AND item.sku=invoice.sku
   AND item.units=invoice.units
  JOIN m06_stock_movements source_move ON source_move.tenant_id=invoice.tenant_id
   AND source_move.invoice_id=invoice.invoice_id AND source_move.sku=invoice.sku
   AND source_move.units_out=invoice.units
  JOIN m07_source_lots provenance ON provenance.tenant_id=r.tenant_id
   AND provenance.invoice_id=r.invoice_id AND provenance.sku=r.sku
   AND provenance.lot_id=r.lot_id AND provenance.sold_units=item.units
   AND provenance.returned_units>=r.units
  JOIN m07_lot_stock lot ON lot.tenant_id=r.tenant_id
   AND lot.lot_id=r.lot_id AND lot.sku=r.sku
  JOIN m06_owned_stock shop ON shop.tenant_id=r.tenant_id
   AND shop.sku=r.sku
  WHERE r.tenant_id=? AND r.return_id=? AND r.invoice_id=?
    AND r.sku=? AND r.lot_id=? AND r.source_hash=?
    AND r.units>0
    AND invoice.units*invoice.unit_price_paisa-invoice.discount_paisa=invoice.grand_paisa
    AND invoice.grand_paisa*r.units>=?*invoice.units
    AND COALESCE((SELECT v.edit_version FROM m07_return_edit_versions v
      WHERE v.tenant_id=r.tenant_id AND v.return_id=r.return_id),0)=?
    AND COALESCE((SELECT MAX(e.next_version) FROM m07_cash_price_edit_receipts e
      WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id),0)=?
    AND COALESCE((SELECT e.new_refund_paisa
      FROM m07_cash_price_edit_receipts e WHERE e.tenant_id=r.tenant_id
       AND e.return_id=r.return_id
      ORDER BY e.next_version DESC LIMIT 1),r.refund_paisa)=?
    AND NOT EXISTS(SELECT 1 FROM m07_cash_delete_receipts d
      WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)
    AND NOT EXISTS(SELECT 1 FROM m07_cash_price_edit_dependencies dep
      WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id)
 )
 AND ?<>?
 AND NOT EXISTS(SELECT 1 FROM m07_cash_returns prior
   WHERE prior.tenant_id=? AND prior.operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m07_credit_returns prior
   WHERE prior.tenant_id=? AND prior.operation_id=?)
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash,next_version`;

const READ_OPERATION=`SELECT return_id,operation_id,actor_id,intent_hash,next_version
 FROM m07_cash_price_edit_receipts
 WHERE tenant_id=? AND operation_id=?`;
const READ_VERSION=`SELECT COALESCE((
 SELECT edit_version FROM m07_return_edit_versions WHERE tenant_id=? AND return_id=?
 ),0) AS current_version`;
function rows(part){
 if(part?.success!==true||!Array.isArray(part.results))
  throw new Error('NEEDS_REVIEW: incomplete D1 Cash price-edit proof');
 return part.results;
}
export function createSyntheticD1CashPriceEditContract(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
  throw new TypeError('Invalid synthetic Cash price-edit D1 binding');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
  throw new TypeError('Invalid synthetic Cash price-edit hook');
 return Object.freeze({
  async post(raw){
   const x=validate(raw);
   const {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
     originalHash,expectedVersion,previousRefundPaisa,newRefundPaisa,reason}=x;
   const nextVersion=expectedVersion+1;
   const intentHash=await hashCanonicalOperationIntent({
    tenantId,actorId,operationType:'sales.return.cash.price-only-edit',
    payload:{returnId,invoiceId,sku,lotId,originalHash,
     expectedVersion,previousRefundPaisa,newRefundPaisa,reason}
   });
   if(beforeBatch)await beforeBatch({tenantId,returnId,operationId});
   let response;
   try{
    response=await DB.batch([
     DB.prepare(CLAIM).bind(
      tenantId,returnId,operationId,actorId,invoiceId,sku,lotId,
      originalHash,intentHash,expectedVersion,nextVersion,
      previousRefundPaisa,newRefundPaisa,reason,
      tenantId,
      tenantId,returnId,invoiceId,sku,lotId,originalHash,
      newRefundPaisa,expectedVersion,expectedVersion,previousRefundPaisa,
      previousRefundPaisa,newRefundPaisa,
      tenantId,operationId,tenantId,operationId
     ),
     DB.prepare(READ_OPERATION).bind(tenantId,operationId),
     DB.prepare(READ_VERSION).bind(tenantId,returnId)
    ]);
   }catch{
    throw new Error('NEEDS_REVIEW: Cash price-edit commit uncertain; inspect immutable operation ID');
   }
   if(!Array.isArray(response)||response.length!==3)
    throw new Error('NEEDS_REVIEW: Cash price-edit claim/readback incomplete');
   const [claimed,found,versions]=response.map(rows);
   if(found.length>1||versions.length!==1||
     !Number.isSafeInteger(versions[0]?.current_version))
    throw new Error('NEEDS_REVIEW: Cash price-edit identity/version ambiguous');
   const receipt=found[0],currentVersion=versions[0].current_version;
   const exact=receipt?.return_id===returnId&&
     receipt?.operation_id===operationId&&
     receipt?.actor_id===actorId&&
     receipt?.intent_hash===intentHash&&
     receipt?.next_version===nextVersion;
   if(claimed.length===1&&exact&&currentVersion===nextVersion)
    return {status:'COMMITTED',operationId,returnId,version:nextVersion};
   if(claimed.length===0){
    if(!receipt)return {status:'DECLINED',operationId};
    if(exact&&currentVersion===nextVersion)
     return {status:'REPLAY',operationId,returnId,version:nextVersion};
    return {status:'CONFLICT',operationId};
   }
   throw new Error('NEEDS_REVIEW: contradictory Cash price-edit D1 receipt');
  }
 });
}
