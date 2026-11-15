/**
 * M07-A1 TEST-ONLY Cash return exercise layered on merged M06 synthetic sale.
 * NO public endpoint, production schema, real RBAC or generic correction API.
 * Tenant and actor are injected by a trusted local test harness.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP_ID=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const FIELDS='actorId,invoiceId,lotId,operationId,originalHash,reason,refundPaisa,returnId,sku,tenantId,units';
const SQL_CLAIM=`INSERT INTO m07_cash_returns(
 tenant_id,return_id,operation_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,units,refund_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions
   WHERE tenant_id=? AND state='Open')
 AND EXISTS(SELECT 1 FROM m06_invoices i
   JOIN m06_sale_items si ON si.tenant_id=i.tenant_id
     AND si.invoice_id=i.invoice_id AND si.sku=i.sku
   JOIN m06_stock_movements sm ON sm.tenant_id=i.tenant_id
     AND sm.invoice_id=i.invoice_id AND sm.sku=i.sku
   WHERE i.tenant_id=? AND i.invoice_id=? AND i.payload_hash=?
     AND i.sku=? AND si.units=i.units AND sm.units_out=i.units
     AND i.grand_paisa*? >= ?*i.units)
 AND EXISTS(SELECT 1 FROM m07_source_lots provenance
   WHERE provenance.tenant_id=? AND provenance.invoice_id=?
     AND provenance.sku=? AND provenance.lot_id=?
     AND provenance.sold_units=(SELECT si.units FROM m06_sale_items si
       WHERE si.tenant_id=provenance.tenant_id AND si.invoice_id=provenance.invoice_id
       AND si.sku=provenance.sku)
     AND provenance.returned_units+? <= provenance.sold_units)
 AND EXISTS(SELECT 1 FROM m07_lot_stock
   WHERE tenant_id=? AND lot_id=? AND sku=?)
 AND EXISTS(SELECT 1 FROM m06_owned_stock
   WHERE tenant_id=? AND sku=?)
 ON CONFLICT DO NOTHING RETURNING return_id,operation_id,actor_id,intent_hash`;
const SQL_RECEIPT=`SELECT return_id,operation_id,actor_id,intent_hash
 FROM m07_cash_returns WHERE tenant_id=? AND (return_id=? OR operation_id=?)`;
const isPlain=value=>value!==null && typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validate(input){
  if(!isPlain(input) || Reflect.ownKeys(input).sort().join(',')!==FIELDS)
    throw new TypeError('Invalid synthetic cash return shape');
  const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,originalHash,reason,
    units,refundPaisa}=input;
  if(![tenantId,actorId,invoiceId,returnId,sku,lotId].every(x=>
    typeof x==='string'&&ID.test(x)) ||
    typeof operationId!=='string'||!OP_ID.test(operationId) ||
    typeof originalHash!=='string'||!HASH.test(originalHash) ||
    !Number.isSafeInteger(units)||units<1||units>1000000 ||
    !Number.isSafeInteger(refundPaisa)||refundPaisa<0||refundPaisa>1000000000 ||
    typeof reason!=='string'||reason.trim()!==reason||!reason||reason.length>200)
    throw new TypeError('Invalid synthetic cash return identifier, units, price or reason');
  return {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,originalHash,reason,
    units,refundPaisa};
}
const rows=(part)=>{
  if(part?.success!==true||!Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: invalid D1 cash return readback');
  return part.results;
};
export function createSyntheticD1CashReturnContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 synthetic cash return binding unavailable');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic beforeBatch hook');
  return Object.freeze({
    async post(raw){
      const data=validate(raw);
      const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
        originalHash,reason,units,refundPaisa}=data;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.cash',
        payload:{invoiceId,returnId,sku,lotId,originalHash,units,refundPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,operationId,returnId});
      let batch;
      try {
        batch=await DB.batch([
          DB.prepare(SQL_CLAIM).bind(
            tenantId,returnId,operationId,actorId,invoiceId,sku,lotId,
            originalHash,intentHash,units,refundPaisa,reason,
            tenantId,
            tenantId,invoiceId,originalHash,sku,units,refundPaisa,
            tenantId,invoiceId,sku,lotId,units,
            tenantId,lotId,sku,
            tenantId,sku
          ),
          DB.prepare(SQL_RECEIPT).bind(tenantId,returnId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: cash return outcome uncertain; reconcile original operation');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: cash return D1 batch incomplete');
      const [claimed,receipts]=batch.map(rows);
      if(receipts.length>1)throw new Error('NEEDS_REVIEW: ambiguous return receipt identity');
      const old=receipts[0];
      if(claimed.length===1&&old?.return_id===returnId&&
        old?.operation_id===operationId&&old?.actor_id===actorId&&
        old?.intent_hash===intentHash)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!old)return {status:'DECLINED',operationId};
        if(old.return_id===returnId&&old.operation_id===operationId&&
          old.actor_id===actorId&&old.intent_hash===intentHash)
          return {status:'REPLAY',operationId,returnId:old.return_id};
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: inconsistent return claim/readback');
    }
  });
}
