/**
 * M07-B3 TEST-ONLY original Store Credit correction in real isolated D1.
 * No public RPC, no real M04 authority or production financial writer.
 * All signed Customer and original lot changes must happen inside one D1
 * receipt/trigger transaction; never infer Customer from Party display.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const KEYS='actorId,creditPaisa,customerId,invoiceId,lotId,operationId,originalHash,reason,returnId,sku,tenantId,units';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);

function validate(input){
  if(!plain(input)||Reflect.ownKeys(input).sort().join(',')!==KEYS)
    throw new TypeError('Invalid synthetic Store Credit deletion shape');
  const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
    originalHash,customerId,units,creditPaisa,reason}=input;
  if(![tenantId,actorId,invoiceId,returnId,sku,lotId,customerId].every(x=>
      typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1_000_000||
    !Number.isSafeInteger(creditPaisa)||creditPaisa<1||creditPaisa>1_000_000_000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
    throw new TypeError('Invalid synthetic Store Credit deletion source, amount or reason');
  return {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
    originalHash,customerId,units,creditPaisa,reason};
}

const CLAIM=`INSERT INTO m07_credit_delete_receipts(
 tenant_id,operation_id,return_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,customer_id,units,credit_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions
   WHERE tenant_id=? AND state='Open')
 AND EXISTS(
   SELECT 1 FROM m07_credit_returns r
   JOIN m07_credit_ledger l ON l.tenant_id=r.tenant_id
     AND l.return_id=r.return_id AND l.invoice_id=r.invoice_id
     AND l.customer_id=r.customer_id AND l.credit_paisa=r.credit_paisa
   JOIN m07_return_movements m ON m.tenant_id=r.tenant_id
     AND m.return_id=r.return_id AND m.invoice_id=r.invoice_id
     AND m.sku=r.sku AND m.lot_id=r.lot_id AND m.units_in=r.units
   JOIN m06_invoices i ON i.tenant_id=r.tenant_id
     AND i.invoice_id=r.invoice_id AND i.sku=r.sku
     AND i.customer_id=r.customer_id AND i.payload_hash=r.source_hash
   JOIN m06_sale_items si ON si.tenant_id=i.tenant_id
     AND si.invoice_id=i.invoice_id AND si.sku=i.sku
     AND si.units=i.units
   JOIN m07_source_lots p ON p.tenant_id=r.tenant_id
     AND p.invoice_id=r.invoice_id AND p.sku=r.sku
     AND p.lot_id=r.lot_id AND p.sold_units=si.units
     AND p.returned_units>=r.units
   JOIN m07_lot_stock lot ON lot.tenant_id=r.tenant_id
     AND lot.lot_id=r.lot_id AND lot.sku=r.sku AND lot.available>=r.units
   JOIN m06_owned_stock stock ON stock.tenant_id=r.tenant_id
     AND stock.sku=r.sku AND stock.available>=r.units
   JOIN m07_customer_signed_accounts a ON a.tenant_id=r.tenant_id
     AND a.customer_id=r.customer_id AND a.party_id=l.party_id
     AND a.active=1 AND a.signed_due_paisa=l.balance_paisa
   JOIN m06_customer_accounts c ON c.tenant_id=r.tenant_id
     AND c.customer_id=r.customer_id AND c.party_id=a.party_id
   JOIN m06_party_links link ON link.tenant_id=r.tenant_id
     AND link.source_group='CUSTOMERS' AND link.source_id=r.customer_id
     AND link.party_id=a.party_id AND link.reviewed=1
   WHERE r.tenant_id=? AND r.return_id=? AND r.invoice_id=?
     AND r.sku=? AND r.lot_id=? AND r.source_hash=?
     AND r.customer_id=? AND r.units=? AND r.credit_paisa=?
     AND NOT EXISTS(SELECT 1 FROM m07_credit_delete_dependencies dep
       WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id
         AND dep.customer_id=r.customer_id)
     AND NOT EXISTS(SELECT 1 FROM m07_credit_ledger newer
       WHERE newer.tenant_id=l.tenant_id AND newer.customer_id=l.customer_id
         AND newer.rowid>l.rowid
         AND NOT EXISTS(SELECT 1 FROM m07_credit_delete_receipts done
           WHERE done.tenant_id=newer.tenant_id AND done.return_id=newer.return_id))
 )
 AND NOT EXISTS(SELECT 1 FROM m07_credit_returns
   WHERE tenant_id=? AND operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m07_cash_returns
   WHERE tenant_id=? AND (operation_id=? OR return_id=?))
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;

const READBACK=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_credit_delete_receipts WHERE tenant_id=?
 AND (return_id=? OR operation_id=?)`;
function rows(value){
  if(value?.success!==true||!Array.isArray(value.results))
    throw new Error('NEEDS_REVIEW: Store Credit deletion D1 readback missing');
  return value.results;
}
export function createSyntheticD1CreditDeleteContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Synthetic Store Credit deletion D1 unavailable');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Store Credit deletion hook');
  return Object.freeze({
    async post(raw){
      const x=validate(raw);
      const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
        originalHash,customerId,units,creditPaisa,reason}=x;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.store-credit.delete',
        payload:{invoiceId,returnId,sku,lotId,originalHash,customerId,
          units,creditPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,operationId,returnId});
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,operationId,returnId,actorId,invoiceId,sku,lotId,
            originalHash,intentHash,customerId,units,creditPaisa,reason,
            tenantId,
            tenantId,returnId,invoiceId,sku,lotId,originalHash,
            customerId,units,creditPaisa,
            tenantId,operationId,
            tenantId,operationId,returnId
          ),
          DB.prepare(READBACK).bind(tenantId,returnId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Store Credit deletion outcome uncertain; reconcile source operation');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: Store Credit deletion D1 batch incomplete');
      const [claim,found]=batch.map(rows);
      if(found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous Store Credit deletion receipt');
      const receipt=found[0];
      const same=receipt?.return_id===returnId&&
        receipt?.operation_id===operationId&&
        receipt?.actor_id===actorId&&receipt?.intent_hash===intentHash;
      if(claim.length===1&&same)
        return {status:'COMMITTED',operationId,returnId};
      if(claim.length===0){
        if(!receipt)return {status:'DECLINED',operationId};
        return same?{status:'REPLAY',operationId,returnId}:
          {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory Store Credit deletion receipt');
    }
  });
}
