/**
 * M07-A2 TEST-ONLY Store Credit proof. Signed Customer due can become an
 * advance; original M06 nonnegative Customer due is NOT rewritten.
 * No live Party ledger, staff authentication, RPC or deployment is provided.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP_ID=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const FIELDS='actorId,creditPaisa,customerId,invoiceId,lotId,operationId,originalHash,reason,returnId,sku,tenantId,units';

const SQL_CLAIM=`INSERT INTO m07_credit_returns(
 tenant_id,return_id,operation_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,customer_id,units,credit_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions
   WHERE tenant_id=? AND state='Open')
 AND EXISTS(SELECT 1 FROM m06_invoices i
   JOIN m06_sale_items si ON si.tenant_id=i.tenant_id
    AND si.invoice_id=i.invoice_id AND si.sku=i.sku
   JOIN m06_stock_movements sm ON sm.tenant_id=i.tenant_id
    AND sm.invoice_id=i.invoice_id AND sm.sku=i.sku
   WHERE i.tenant_id=? AND i.invoice_id=? AND i.payload_hash=?
    AND i.sku=? AND i.customer_id=?
    AND si.units=i.units AND sm.units_out=i.units
    AND i.grand_paisa*? >= ?*i.units)
 AND EXISTS(SELECT 1 FROM m07_source_lots l
   WHERE l.tenant_id=? AND l.invoice_id=? AND l.sku=? AND l.lot_id=?
   AND l.sold_units=(SELECT si.units FROM m06_sale_items si
    WHERE si.tenant_id=l.tenant_id AND si.invoice_id=l.invoice_id AND si.sku=l.sku)
   AND l.returned_units+? <= l.sold_units)
 AND EXISTS(SELECT 1 FROM m07_lot_stock
   WHERE tenant_id=? AND lot_id=? AND sku=?)
 AND EXISTS(SELECT 1 FROM m06_owned_stock
   WHERE tenant_id=? AND sku=?)
 AND EXISTS(SELECT 1 FROM m07_customer_signed_accounts a
   JOIN m06_customer_accounts c ON c.tenant_id=a.tenant_id
    AND c.customer_id=a.customer_id AND c.party_id=a.party_id
   JOIN m06_party_links link ON link.tenant_id=a.tenant_id
    AND link.source_group='CUSTOMERS' AND link.source_id=a.customer_id
    AND link.party_id=a.party_id AND link.reviewed=1
   WHERE a.tenant_id=? AND a.customer_id=? AND a.active=1)
 AND NOT EXISTS(SELECT 1 FROM m07_cash_returns
   WHERE tenant_id=? AND (operation_id=? OR return_id=?))
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;
const SQL_RECEIPT=`SELECT 'CREDIT' AS kind,return_id,operation_id,actor_id,intent_hash
 FROM m07_credit_returns WHERE tenant_id=? AND (return_id=? OR operation_id=?)
 UNION ALL
 SELECT 'CASH' AS kind,return_id,operation_id,actor_id,intent_hash
 FROM m07_cash_returns WHERE tenant_id=? AND (return_id=? OR operation_id=?)`;

const isPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validate(input){
  if(!isPlain(input)||Reflect.ownKeys(input).sort().join(',')!==FIELDS)
    throw new TypeError('Invalid synthetic Store Credit shape');
  const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
    originalHash,customerId,units,creditPaisa,reason}=input;
  if(![tenantId,actorId,invoiceId,returnId,sku,lotId,customerId].every(x=>
    typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP_ID.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1_000_000||
    !Number.isSafeInteger(creditPaisa)||creditPaisa<1||creditPaisa>1_000_000_000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
    throw new TypeError('Invalid synthetic Store Credit source, amount, customer or reason');
  return input;
}
function rows(part){
  if(part?.success!==true||!Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: Store Credit D1 response incomplete');
  return part.results;
}

export function createSyntheticD1StoreCreditContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing synthetic Store Credit D1 binding');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Store Credit prebatch hook');
  return Object.freeze({
    async post(raw){
      const {tenantId,actorId,invoiceId,returnId,operationId,sku,lotId,
        originalHash,customerId,units,creditPaisa,reason}=validate(raw);
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.store-credit',
        payload:{invoiceId,returnId,sku,lotId,originalHash,customerId,units,creditPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,operationId,returnId});
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(SQL_CLAIM).bind(
            tenantId,returnId,operationId,actorId,invoiceId,sku,lotId,
            originalHash,intentHash,customerId,units,creditPaisa,reason,
            tenantId,
            tenantId,invoiceId,originalHash,sku,customerId,units,creditPaisa,
            tenantId,invoiceId,sku,lotId,units,
            tenantId,lotId,sku,
            tenantId,sku,
            tenantId,customerId,
            tenantId,operationId,returnId
          ),
          DB.prepare(SQL_RECEIPT).bind(
            tenantId,returnId,operationId,
            tenantId,returnId,operationId
          )
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Store Credit result uncertain; reconcile original operation ID');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: missing Store Credit batch readback');
      const [claimed,seen]=batch.map(rows);
      if(seen.length>1)throw new Error('NEEDS_REVIEW: ambiguous cross-method return identity');
      const old=seen[0];
      if(claimed.length===1&&old?.kind==='CREDIT'&&old.return_id===returnId&&
        old.operation_id===operationId&&old.actor_id===actorId&&old.intent_hash===intentHash)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!old)return {status:'DECLINED',operationId};
        if(old.kind==='CREDIT'&&old.return_id===returnId&&
          old.operation_id===operationId&&old.actor_id===actorId&&old.intent_hash===intentHash)
          return {status:'REPLAY',operationId,returnId:old.return_id};
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory Store Credit D1 readback');
    }
  });
}
