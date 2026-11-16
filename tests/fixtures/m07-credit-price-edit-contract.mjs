/**
 * M07-B8 TEST-ONLY Store Credit price-only correction, isolated Workerd/D1.
 * Financial changes belong solely to the source Customer signed role.
 * Not production RPC, native auth, stock correction, migration or live ledger.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const FIELDS='actorId,customerId,expectedVersion,invoiceId,lotId,newCreditPaisa,operationId,originalHash,previousCreditPaisa,reason,returnId,sku,tenantId';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validate(raw){
 if(!plain(raw)||Reflect.ownKeys(raw).sort().join(',')!==FIELDS)
  throw new TypeError('Invalid synthetic Store Credit price edit input shape');
 const {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
  originalHash,customerId,expectedVersion,previousCreditPaisa,newCreditPaisa,reason}=raw;
 if(![tenantId,actorId,returnId,invoiceId,sku,lotId,customerId].every(x=>
   typeof x==='string'&&ID.test(x))||
   typeof operationId!=='string'||!OP.test(operationId)||
   typeof originalHash!=='string'||!HASH.test(originalHash)||
   !Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>999999||
   !Number.isSafeInteger(previousCreditPaisa)||previousCreditPaisa<0||
   previousCreditPaisa>1_000_000_000||
   !Number.isSafeInteger(newCreditPaisa)||newCreditPaisa<0||
   newCreditPaisa>1_000_000_000||
   typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
  throw new TypeError('Invalid synthetic Store Credit price edit identifiers, version, credit or reason');
 return {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
  originalHash,customerId,expectedVersion,previousCreditPaisa,newCreditPaisa,reason};
}

/** All change-admission checks run under the same D1 INSERT transaction. */
const CLAIM=`INSERT INTO m07_credit_price_edit_receipts(
 tenant_id,return_id,operation_id,actor_id,invoice_id,sku,lot_id,
 source_hash,intent_hash,customer_id,expected_version,next_version,
 previous_credit_paisa,new_credit_paisa,reason)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions sess
  WHERE sess.tenant_id=? AND sess.state='Open')
 AND EXISTS(
  SELECT 1 FROM m07_credit_returns r
  JOIN m07_credit_ledger ledger ON ledger.tenant_id=r.tenant_id
   AND ledger.return_id=r.return_id AND ledger.invoice_id=r.invoice_id
   AND ledger.customer_id=r.customer_id AND ledger.credit_paisa=r.credit_paisa
  JOIN m07_return_movements move ON move.tenant_id=r.tenant_id
   AND move.return_id=r.return_id AND move.invoice_id=r.invoice_id
   AND move.sku=r.sku AND move.lot_id=r.lot_id AND move.units_in=r.units
  JOIN m06_invoices invoice ON invoice.tenant_id=r.tenant_id
   AND invoice.invoice_id=r.invoice_id AND invoice.sku=r.sku
   AND invoice.customer_id=r.customer_id AND invoice.payload_hash=r.source_hash
  JOIN m06_sale_items item ON item.tenant_id=invoice.tenant_id
   AND item.invoice_id=invoice.invoice_id AND item.sku=invoice.sku
   AND item.units=invoice.units
  JOIN m06_stock_movements sale_move ON sale_move.tenant_id=invoice.tenant_id
   AND sale_move.invoice_id=invoice.invoice_id AND sale_move.sku=invoice.sku
   AND sale_move.units_out=invoice.units
  JOIN m07_source_lots provenance ON provenance.tenant_id=r.tenant_id
   AND provenance.invoice_id=r.invoice_id AND provenance.sku=r.sku
   AND provenance.lot_id=r.lot_id AND provenance.sold_units=item.units
   AND provenance.returned_units>=r.units
  JOIN m07_lot_stock restored ON restored.tenant_id=r.tenant_id
   AND restored.lot_id=r.lot_id AND restored.sku=r.sku
  JOIN m06_owned_stock shop ON shop.tenant_id=r.tenant_id AND shop.sku=r.sku
  JOIN m07_customer_signed_accounts signed ON signed.tenant_id=r.tenant_id
   AND signed.customer_id=r.customer_id AND signed.party_id=ledger.party_id
   AND signed.active=1
  JOIN m06_customer_accounts c ON c.tenant_id=r.tenant_id
   AND c.customer_id=r.customer_id AND c.party_id=signed.party_id
  JOIN m06_party_links party ON party.tenant_id=r.tenant_id
   AND party.source_group='CUSTOMERS' AND party.source_id=r.customer_id
   AND party.party_id=signed.party_id AND party.reviewed=1
  WHERE r.tenant_id=? AND r.return_id=? AND r.invoice_id=?
    AND r.sku=? AND r.lot_id=? AND r.source_hash=? AND r.customer_id=?
    AND r.units>0 AND invoice.units*invoice.unit_price_paisa-invoice.discount_paisa=invoice.grand_paisa
    AND invoice.grand_paisa*r.units>=?*invoice.units
    AND COALESCE((SELECT v.edit_version FROM m07_return_edit_versions v
      WHERE v.tenant_id=r.tenant_id AND v.return_id=r.return_id),0)=?
    AND COALESCE((SELECT MAX(e.next_version) FROM m07_credit_price_edit_receipts e
      WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id),0)=?
    AND COALESCE((SELECT e.new_credit_paisa FROM m07_credit_price_edit_receipts e
      WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
      ORDER BY e.next_version DESC LIMIT 1),r.credit_paisa)=?
    AND signed.signed_due_paisa=COALESCE((
      SELECT e.balance_paisa FROM m07_credit_price_edit_ledger e
      WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
      ORDER BY e.next_version DESC LIMIT 1),ledger.balance_paisa)
    AND NOT EXISTS(SELECT 1 FROM m07_credit_delete_receipts d
      WHERE d.tenant_id=r.tenant_id AND d.return_id=r.return_id)
    AND NOT EXISTS(SELECT 1 FROM m07_credit_delete_dependencies dep
      WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id
       AND dep.customer_id=r.customer_id)
    AND NOT EXISTS(SELECT 1 FROM m07_credit_price_edit_dependencies dep
      WHERE dep.tenant_id=r.tenant_id AND dep.return_id=r.return_id
       AND dep.customer_id=r.customer_id)
    AND NOT EXISTS(SELECT 1 FROM m07_credit_ledger later
      WHERE later.tenant_id=ledger.tenant_id AND later.customer_id=ledger.customer_id
       AND later.rowid>ledger.rowid)
 )
 AND ?<>?
 AND NOT EXISTS(SELECT 1 FROM m07_credit_returns original
  WHERE original.tenant_id=? AND original.operation_id=?)
 AND NOT EXISTS(SELECT 1 FROM m07_cash_returns original
  WHERE original.tenant_id=? AND original.operation_id=?)
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash,next_version`;

const READ_OPERATION=`SELECT return_id,operation_id,actor_id,intent_hash,next_version
 FROM m07_credit_price_edit_receipts WHERE tenant_id=? AND operation_id=?`;
const READ_VERSION=`SELECT COALESCE((
 SELECT edit_version FROM m07_return_edit_versions
 WHERE tenant_id=? AND return_id=?),0) AS current_version`;
const rows=part=>{
 if(part?.success!==true||!Array.isArray(part.results))
  throw new Error('NEEDS_REVIEW: Store Credit price-edit D1 result incomplete');
 return part.results;
};

export function createSyntheticD1CreditPriceEditContract(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
  throw new TypeError('Invalid synthetic Store Credit price-edit D1 binding');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
  throw new TypeError('Invalid synthetic Store Credit price-edit prebatch hook');
 return Object.freeze({
  async post(raw){
   const x=validate(raw);
   const {tenantId,actorId,operationId,returnId,invoiceId,sku,lotId,
    originalHash,customerId,expectedVersion,previousCreditPaisa,
    newCreditPaisa,reason}=x;
   const nextVersion=expectedVersion+1;
   const intentHash=await hashCanonicalOperationIntent({
    tenantId,actorId,operationType:'sales.return.store-credit.price-only-edit',
    payload:{returnId,invoiceId,sku,lotId,originalHash,customerId,
     expectedVersion,previousCreditPaisa,newCreditPaisa,reason}
   });
   if(beforeBatch)await beforeBatch({tenantId,returnId,operationId});
   let batch;
   try{
    batch=await DB.batch([
     DB.prepare(CLAIM).bind(
      tenantId,returnId,operationId,actorId,invoiceId,sku,lotId,
      originalHash,intentHash,customerId,expectedVersion,nextVersion,
      previousCreditPaisa,newCreditPaisa,reason,
      tenantId,
      tenantId,returnId,invoiceId,sku,lotId,originalHash,customerId,
      newCreditPaisa,expectedVersion,expectedVersion,previousCreditPaisa,
      previousCreditPaisa,newCreditPaisa,
      tenantId,operationId,tenantId,operationId
     ),
     DB.prepare(READ_OPERATION).bind(tenantId,operationId),
     DB.prepare(READ_VERSION).bind(tenantId,returnId)
    ]);
   }catch{
    throw new Error('NEEDS_REVIEW: Store Credit price-edit result uncertain; reconcile immutable operation');
   }
   if(!Array.isArray(batch)||batch.length!==3)
    throw new Error('NEEDS_REVIEW: Store Credit price-edit batch incomplete');
   const [claimed,found,versions]=batch.map(rows);
   if(found.length>1||versions.length!==1||
     !Number.isSafeInteger(versions[0]?.current_version))
    throw new Error('NEEDS_REVIEW: Store Credit price-edit receipt/version ambiguous');
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
   throw new Error('NEEDS_REVIEW: contradictory Store Credit price-edit D1 receipt');
  }
 });
}
