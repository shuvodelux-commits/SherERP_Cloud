/**
 * M07-B2 SYNTHETIC TEST-ONLY source-bound Cash Return delete/reversal.
 *
 * M03/M04/M05/M06/M08 must independently implement and authorize the real
 * native correction writer. This is neither a production service nor RPC.
 * Original return and refund remain immutable; linked inverse rows prove
 * rollback/accounting net and the synthetic read view hides corrected rows.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OPERATION_ID=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const EXPECTED='actorId,invoiceId,lotId,operationId,originalHash,reason,refundPaisa,returnId,sku,tenantId,units';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||
   Object.getPrototypeOf(value)===null);
function validated(value){
  if(!plain(value)||Reflect.ownKeys(value).sort().join(',')!==EXPECTED)
    throw new TypeError('Invalid synthetic Cash Return deletion shape');
  const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
    originalHash,units,refundPaisa,reason}=value;
  if(![tenantId,actorId,invoiceId,returnId,sku,lotId].every(x=>
      typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OPERATION_ID.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1_000_000||
    !Number.isSafeInteger(refundPaisa)||refundPaisa<0||refundPaisa>1_000_000_000||
    typeof reason!=='string'||!reason||reason.length>200||
    reason.trim()!==reason)
    throw new TypeError('Invalid synthetic Cash Return deletion identifier, amount or reason');
  return {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
    originalHash,units,refundPaisa,reason};
}

const CLAIM=`INSERT INTO m07_cash_delete_receipts(
 tenant_id,operation_id,return_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,units,refund_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions
   WHERE tenant_id=? AND state='Open')
 AND EXISTS(
 SELECT 1 FROM m07_cash_returns r
 JOIN m07_cash_refunds f ON f.tenant_id=r.tenant_id
   AND f.return_id=r.return_id AND f.invoice_id=r.invoice_id
   AND f.debit_paisa=r.refund_paisa
 JOIN m07_return_movements m ON m.tenant_id=r.tenant_id
   AND m.return_id=r.return_id AND m.invoice_id=r.invoice_id
   AND m.sku=r.sku AND m.lot_id=r.lot_id AND m.units_in=r.units
 JOIN m06_invoices i ON i.tenant_id=r.tenant_id
   AND i.invoice_id=r.invoice_id AND i.sku=r.sku
   AND i.payload_hash=r.source_hash
 JOIN m07_source_lots p ON p.tenant_id=r.tenant_id
   AND p.invoice_id=r.invoice_id AND p.sku=r.sku
   AND p.lot_id=r.lot_id AND p.sold_units>=r.units
   AND p.returned_units>=r.units
 JOIN m07_lot_stock l ON l.tenant_id=r.tenant_id
   AND l.lot_id=r.lot_id AND l.sku=r.sku AND l.available>=r.units
 JOIN m06_owned_stock s ON s.tenant_id=r.tenant_id
   AND s.sku=r.sku AND s.available>=r.units
 WHERE r.tenant_id=? AND r.return_id=? AND r.invoice_id=?
   AND r.sku=? AND r.lot_id=? AND r.source_hash=?
   AND r.units=? AND r.refund_paisa=?
 )
 AND NOT EXISTS(SELECT 1 FROM m07_cash_returns
   WHERE tenant_id=? AND operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m07_credit_returns
   WHERE tenant_id=? AND operation_id=?)
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;

const RECEIPT=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_cash_delete_receipts
 WHERE tenant_id=? AND (return_id=? OR operation_id=?)`;
function results(value){
  if(value?.success!==true||!Array.isArray(value.results))
    throw new Error('NEEDS_REVIEW: invalid Cash Return deletion D1 receipt readback');
  return value.results;
}
export function createSyntheticD1CashReturnDeleteContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 synthetic Cash Return deletion binding unavailable');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Cash Return deletion hook');
  return Object.freeze({
    async post(raw){
      const data=validated(raw);
      const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
        originalHash,units,refundPaisa,reason}=data;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.cash.delete',
        payload:{invoiceId,returnId,sku,lotId,originalHash,units,refundPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,returnId,operationId});
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,operationId,returnId,actorId,invoiceId,sku,lotId,
            originalHash,intentHash,units,refundPaisa,reason,
            tenantId,
            tenantId,returnId,invoiceId,sku,lotId,originalHash,units,refundPaisa,
            tenantId,operationId,
            tenantId,operationId
          ),
          DB.prepare(RECEIPT).bind(tenantId,returnId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Cash Return deletion commit uncertain; reconcile original operation');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: Cash Return deletion result incomplete');
      const [claim,seen]=batch.map(results);
      if(seen.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous Cash Return deletion identity');
      const receipt=seen[0];
      const matches=receipt?.return_id===returnId&&
        receipt?.operation_id===operationId&&
        receipt?.actor_id===actorId&&receipt?.intent_hash===intentHash;
      if(claim.length===1&&matches)
        return {status:'COMMITTED',operationId,returnId};
      if(claim.length===0){
        if(!receipt)return {status:'DECLINED',operationId};
        return matches
          ?{status:'REPLAY',operationId,returnId}
          :{status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: inconsistent Cash Return deletion claim');
    }
  });
}
