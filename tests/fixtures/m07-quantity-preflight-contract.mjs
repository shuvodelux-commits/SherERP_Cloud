/**
 * M07-B9 TEST ONLY: single-source-lot Sales Return quantity-edit preflight.
 * This is an immutable, read-only Workerd/D1 feasibility snapshot, NOT a
 * correction writer, source lot optimizer, authorization or production RPC.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const FIELDS='expectedVersion,newUnits,returnId,tenantId';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);

function validate(input){
 if(!plain(input)||Reflect.ownKeys(input).sort().join(',')!==FIELDS||
  ![input.tenantId,input.returnId].every(x=>typeof x==='string'&&ID.test(x))||
  !Number.isSafeInteger(input.newUnits)||input.newUnits<1||input.newUnits>1_000_000||
  !Number.isSafeInteger(input.expectedVersion)||
  input.expectedVersion<0||input.expectedVersion>1_000_000)
  throw new TypeError('Invalid synthetic Return quantity preflight input shape');
 return input;
}

/*
 * One tenant-scoped read snapshot. No ad-hoc lookup followed by mutation,
 * no client-chosen SQL identifiers, no source-price or source-lot guessing.
 */
const READ=`WITH source_returns AS (
 SELECT 'Cash' AS refund_method,tenant_id,return_id,invoice_id,sku,lot_id,
  source_hash,units,refund_paisa AS amount_paisa,'' AS customer_id
 FROM m07_cash_returns WHERE tenant_id=? AND return_id=?
 UNION ALL
 SELECT 'Store Credit' AS refund_method,tenant_id,return_id,invoice_id,sku,lot_id,
  source_hash,units,credit_paisa AS amount_paisa,customer_id
 FROM m07_credit_returns WHERE tenant_id=? AND return_id=?
)
SELECT r.refund_method,r.tenant_id,r.return_id,r.invoice_id,r.sku,r.lot_id,
 r.source_hash,r.units,r.amount_paisa,r.customer_id,
 inv.invoice_id AS original_invoice,inv.sku AS original_sku,
 inv.customer_id AS original_customer,inv.payload_hash AS original_hash,
 inv.units AS original_sold_units,inv.grand_paisa AS original_grand_paisa,
 inv.unit_price_paisa AS original_unit_price_paisa,
 inv.discount_paisa AS original_discount_paisa,
 item.units AS sold_item_units,sm.units_out AS sold_movement_units,
 provenance.sold_units AS lot_sold_units,
 provenance.returned_units AS lot_returned_units,
 returned_lot.lot_id AS restored_lot_id,returned_lot.available AS restored_available,
 shop.available AS shop_available,
 movement.units_in AS original_return_movement_units,
 refund.debit_paisa AS original_cash_refund,
 credit.credit_paisa AS original_credit_paisa,
 credit.customer_id AS ledger_customer,
 credit.party_id AS ledger_party,credit.balance_paisa AS ledger_balance,
 signed.party_id AS signed_party,signed.signed_due_paisa AS signed_balance,
 signed.active AS signed_active,
 customer.party_id AS customer_party,
 party.party_id AS reviewed_party,party.reviewed AS reviewed_link,
 COALESCE(version.edit_version,0) AS current_version,
 cash_deleted.return_id AS cash_delete_id,
 credit_deleted.return_id AS credit_delete_id,
 (SELECT COUNT(*) FROM m07_cash_price_edit_receipts e
  WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id) AS cash_price_revisions,
 (SELECT COUNT(*) FROM m07_credit_price_edit_receipts e
  WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id) AS credit_price_revisions,
 (SELECT COUNT(*) FROM m07_cash_price_edit_dependencies e
  WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id) AS cash_dependencies,
 (SELECT COUNT(*) FROM m07_credit_price_edit_dependencies e
  WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
   AND e.customer_id=r.customer_id) AS credit_dependencies,
 (SELECT COUNT(*) FROM m07_credit_delete_dependencies e
  WHERE e.tenant_id=r.tenant_id AND e.return_id=r.return_id
   AND e.customer_id=r.customer_id) AS credit_delete_dependencies,
 (SELECT COUNT(*) FROM m07_credit_ledger later
  WHERE later.tenant_id=credit.tenant_id AND later.customer_id=credit.customer_id
   AND later.rowid>credit.rowid) AS later_customer_credits,
 (SELECT COALESCE(SUM(m2.units_in),0) FROM m07_return_movements m2
  WHERE m2.tenant_id=r.tenant_id AND m2.invoice_id=r.invoice_id
   AND m2.sku=r.sku AND m2.lot_id=r.lot_id
   AND (
    EXISTS(SELECT 1 FROM m07_cash_returns c2
     WHERE c2.tenant_id=m2.tenant_id AND c2.return_id=m2.return_id
     AND NOT EXISTS(SELECT 1 FROM m07_cash_delete_receipts d
      WHERE d.tenant_id=c2.tenant_id AND d.return_id=c2.return_id))
    OR EXISTS(SELECT 1 FROM m07_credit_returns c2
     WHERE c2.tenant_id=m2.tenant_id AND c2.return_id=m2.return_id
     AND NOT EXISTS(SELECT 1 FROM m07_credit_delete_receipts d
      WHERE d.tenant_id=c2.tenant_id AND d.return_id=c2.return_id))
   )
 ) AS active_movement_units,
 session.state AS cash_session_state
FROM source_returns r
LEFT JOIN m06_invoices inv ON inv.tenant_id=r.tenant_id
 AND inv.invoice_id=r.invoice_id
LEFT JOIN m06_sale_items item ON item.tenant_id=r.tenant_id
 AND item.invoice_id=r.invoice_id AND item.sku=r.sku
LEFT JOIN m06_stock_movements sm ON sm.tenant_id=r.tenant_id
 AND sm.invoice_id=r.invoice_id AND sm.sku=r.sku
LEFT JOIN m07_source_lots provenance ON provenance.tenant_id=r.tenant_id
 AND provenance.invoice_id=r.invoice_id AND provenance.sku=r.sku
 AND provenance.lot_id=r.lot_id
LEFT JOIN m07_lot_stock returned_lot ON returned_lot.tenant_id=r.tenant_id
 AND returned_lot.lot_id=r.lot_id AND returned_lot.sku=r.sku
LEFT JOIN m06_owned_stock shop ON shop.tenant_id=r.tenant_id AND shop.sku=r.sku
LEFT JOIN m07_return_movements movement ON movement.tenant_id=r.tenant_id
 AND movement.return_id=r.return_id AND movement.invoice_id=r.invoice_id
 AND movement.sku=r.sku AND movement.lot_id=r.lot_id
LEFT JOIN m07_cash_refunds refund ON refund.tenant_id=r.tenant_id
 AND refund.return_id=r.return_id AND refund.invoice_id=r.invoice_id
LEFT JOIN m07_credit_ledger credit ON credit.tenant_id=r.tenant_id
 AND credit.return_id=r.return_id AND credit.invoice_id=r.invoice_id
LEFT JOIN m07_customer_signed_accounts signed ON signed.tenant_id=r.tenant_id
 AND signed.customer_id=r.customer_id
LEFT JOIN m06_customer_accounts customer ON customer.tenant_id=r.tenant_id
 AND customer.customer_id=r.customer_id
LEFT JOIN m06_party_links party ON party.tenant_id=r.tenant_id
 AND party.source_group='CUSTOMERS' AND party.source_id=r.customer_id
LEFT JOIN m07_return_edit_versions version ON version.tenant_id=r.tenant_id
 AND version.return_id=r.return_id
LEFT JOIN m07_cash_delete_receipts cash_deleted
 ON cash_deleted.tenant_id=r.tenant_id AND cash_deleted.return_id=r.return_id
LEFT JOIN m07_credit_delete_receipts credit_deleted
 ON credit_deleted.tenant_id=r.tenant_id AND credit_deleted.return_id=r.return_id
LEFT JOIN m06_cash_sessions session ON session.tenant_id=r.tenant_id`;

function sourceConsistent(r){
 if(!r||r.original_invoice!==r.invoice_id||
  r.original_sku!==r.sku||r.original_hash!==r.source_hash||
  !Number.isSafeInteger(r.original_sold_units)||r.original_sold_units<1||
  r.original_sold_units!==r.sold_item_units||
  r.original_sold_units!==r.sold_movement_units||
  r.original_sold_units!==r.lot_sold_units||
  !Number.isSafeInteger(r.units)||r.units<1||
  !Number.isSafeInteger(r.lot_returned_units)||
  r.lot_returned_units<r.units||
  r.lot_returned_units>r.lot_sold_units||
  r.lot_returned_units!==r.active_movement_units||
  r.restored_lot_id!==r.lot_id||
  !Number.isSafeInteger(r.restored_available)||r.restored_available<0||
  !Number.isSafeInteger(r.shop_available)||r.shop_available<0||
  r.original_return_movement_units!==r.units||
  !Number.isSafeInteger(r.amount_paisa)||r.amount_paisa<0||
  !Number.isSafeInteger(r.original_grand_paisa)||
  !Number.isSafeInteger(r.original_unit_price_paisa)||
  !Number.isSafeInteger(r.original_discount_paisa)||
  r.original_grand_paisa!==r.original_sold_units*r.original_unit_price_paisa-r.original_discount_paisa||
  r.amount_paisa*r.original_sold_units>r.original_grand_paisa*r.units)
  return false;
 if(r.refund_method==='Cash')
  return r.original_cash_refund===r.amount_paisa&&
   r.original_credit_paisa===null;
 if(r.refund_method==='Store Credit')
  return r.original_customer===r.customer_id&&
   r.original_cash_refund===null&&
   r.original_credit_paisa===r.amount_paisa&&
   r.ledger_customer===r.customer_id&&
   r.ledger_party!==null&&r.ledger_party===r.signed_party&&
   r.ledger_party===r.customer_party&&
   r.ledger_party===r.reviewed_party&&
   r.reviewed_link===1&&r.signed_active===1&&
   r.signed_balance===r.ledger_balance;
 return false;
}

export function createSyntheticD1ReturnQuantityPreflight(DB){
 if(!DB||typeof DB.prepare!=='function')
  throw new TypeError('Invalid synthetic quantity preflight D1 binding');
 return Object.freeze({
  async plan(raw){
   const {tenantId,returnId,newUnits,expectedVersion}=validate(raw);
   let matched;
   try{
    const result=await DB.prepare(READ).bind(tenantId,returnId,tenantId,returnId).all();
    if(result?.success!==true||!Array.isArray(result.results))
     return {status:'NEEDS_REVIEW'};
    matched=result.results;
   }catch{return {status:'NEEDS_REVIEW'};}
   if(matched.length===0)return {status:'NOT_FOUND'};
   if(matched.length!==1)return {status:'NEEDS_REVIEW'};
   const r=matched[0];
   if(r.cash_delete_id!==null||r.credit_delete_id!==null)
    return {status:'DECLINED'};
   if(r.current_version!==expectedVersion)return {status:'STALE'};
   if(r.cash_price_revisions!==0||r.credit_price_revisions!==0||
    r.current_version!==0)return {status:'DECLINED'};
   if(r.cash_session_state!=='Open')return {status:'DECLINED'};
   if(r.cash_dependencies>0||r.credit_dependencies>0||
    r.credit_delete_dependencies>0||r.later_customer_credits>0)
    return {status:'DECLINED'};
   if(!sourceConsistent(r))return {status:'NEEDS_REVIEW'};
   if(newUnits===r.units)return {status:'DECLINED'};
   const deltaUnits=newUnits-r.units;
   if(deltaUnits>0&&r.lot_returned_units+deltaUnits>r.lot_sold_units)
    return {status:'DECLINED'};
   if(deltaUnits<0&&
    (r.restored_available<(-deltaUnits)||r.shop_available<(-deltaUnits)))
    return {status:'DECLINED'};
   return {status:'PLAN_ONLY',data:{
    returnId:r.return_id,invoiceId:r.invoice_id,
    refundMethod:r.refund_method,lotId:r.lot_id,
    oldUnits:r.units,newUnits,deltaUnits,
    action:deltaUnits>0?'RESTORE_ORIGINAL_LOT':'REMOVE_RETURNED_STOCK',
    editVersion:r.current_version,
    readOnly:true,commitAuthorized:false
   }};
  }
 });
}
