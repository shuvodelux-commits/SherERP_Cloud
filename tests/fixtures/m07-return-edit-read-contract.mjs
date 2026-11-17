/**
 * M07-B6 READ ONLY — synthetic, source-shaped getReturnForEdit projection.
 * Requires real M04 returns:edit authority and full frozen GAS source DTO
 * before integration. Never expose as a Worker RPC or production service.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const KEYS='returnId,tenantId';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);

function validate(input){
 if(!plain(input)||Reflect.ownKeys(input).sort().join(',')!==KEYS||
  ![input.tenantId,input.returnId].every(x=>typeof x==='string'&&ID.test(x)))
  throw new TypeError('Invalid synthetic Return Edit readback input shape');
 return input;
}

/* One tenant-bound, read-only SQLite statement gives a consistent receipt,
   source, provenance, economic-effect and soft-delete snapshot. */
const QUERY=`WITH returns AS (
 SELECT 'Cash' AS refund_method,tenant_id,return_id,invoice_id,
   sku,lot_id,source_hash,units,refund_paisa AS amount_paisa,
   reason,'' AS customer_id
 FROM m07_cash_returns WHERE tenant_id=? AND return_id=?
 UNION ALL
 SELECT 'Store Credit' AS refund_method,tenant_id,return_id,invoice_id,
   sku,lot_id,source_hash,units,credit_paisa AS amount_paisa,
   reason,customer_id
 FROM m07_credit_returns WHERE tenant_id=? AND return_id=?

), corrections AS (
 SELECT 'Cash' AS correction_method,
  e.tenant_id,e.return_id,e.next_version AS revision_version,
  e.expected_version AS revision_expected_version,
  e.operation_id AS revision_operation,e.actor_id AS revision_actor,
  e.intent_hash AS revision_hash,
  e.invoice_id AS revision_invoice,e.sku AS revision_sku,
  e.lot_id AS revision_lot,e.source_hash AS revision_source,
  e.previous_refund_paisa AS revision_previous,
  e.new_refund_paisa AS revision_new,
  NULL AS revision_customer,
  a.operation_id AS adjustment_operation,
  a.debit_paisa AS adjustment_debit,a.credit_paisa AS adjustment_credit,
  NULL AS adjustment_customer,NULL AS adjustment_party,NULL AS adjustment_balance
 FROM m07_cash_price_edit_receipts e
 LEFT JOIN m07_cash_price_edit_adjustments a
  ON a.tenant_id=e.tenant_id AND a.return_id=e.return_id
  AND a.next_version=e.next_version
 UNION ALL
 SELECT 'Store Credit' AS correction_method,
  e.tenant_id,e.return_id,e.next_version,
  e.expected_version,e.operation_id,e.actor_id,e.intent_hash,
  e.invoice_id,e.sku,e.lot_id,e.source_hash,
  e.previous_credit_paisa,e.new_credit_paisa,e.customer_id,
  a.operation_id,a.debit_paisa,a.credit_paisa,
  a.customer_id,a.party_id,a.balance_paisa
 FROM m07_credit_price_edit_receipts e
 LEFT JOIN m07_credit_price_edit_ledger a
  ON a.tenant_id=e.tenant_id AND a.return_id=e.return_id
  AND a.next_version=e.next_version
)
SELECT
 r.refund_method,r.tenant_id,r.return_id,r.invoice_id,r.sku,r.lot_id,
 r.source_hash,r.units,r.amount_paisa,r.reason,r.customer_id,
 i.invoice_id AS original_invoice,i.payload_hash AS original_source_hash,i.sku AS original_sku,
 i.customer_id AS original_customer,i.units AS original_units,
 i.unit_price_paisa AS original_unit_price,i.grand_paisa AS original_grand,
 si.units AS item_units,sm.units_out AS sale_movement_units,
 p.sold_units,p.returned_units,
 ls.lot_id AS present_lot,rm.units_in AS return_move_units,
 f.debit_paisa AS refund_debit,cl.credit_paisa AS credit_amount,
 cl.customer_id AS ledger_customer,cl.party_id AS ledger_party,
 cl.balance_paisa AS ledger_balance,
 a.party_id AS account_party,a.active AS account_active,
 a.signed_due_paisa AS current_signed_balance,
 l.party_id AS reviewed_party,l.reviewed AS link_reviewed,
 v.edit_version,
 e.correction_method,e.revision_version,e.revision_expected_version,
 e.revision_operation,e.revision_actor,e.revision_hash,
 e.revision_invoice,e.revision_sku,e.revision_lot,e.revision_source,
 e.revision_previous,e.revision_new,e.revision_customer,
 e.adjustment_operation,e.adjustment_debit,e.adjustment_credit,
 e.adjustment_customer,e.adjustment_party,e.adjustment_balance,
 (SELECT COUNT(*) FROM m07_cash_price_edit_adjustments ca
  WHERE ca.tenant_id=r.tenant_id AND ca.return_id=r.return_id)
  AS total_cash_adjustments,
 (SELECT COUNT(*) FROM m07_credit_price_edit_ledger cl2
  WHERE cl2.tenant_id=r.tenant_id AND cl2.return_id=r.return_id)
  AS total_credit_adjustments,
 cd.return_id AS cash_deleted,sd.return_id AS credit_deleted
 FROM returns r
 LEFT JOIN m06_invoices i ON i.tenant_id=r.tenant_id AND i.invoice_id=r.invoice_id
 LEFT JOIN m06_sale_items si ON si.tenant_id=r.tenant_id
   AND si.invoice_id=r.invoice_id AND si.sku=r.sku
 LEFT JOIN m06_stock_movements sm ON sm.tenant_id=r.tenant_id
   AND sm.invoice_id=r.invoice_id AND sm.sku=r.sku
 LEFT JOIN m07_source_lots p ON p.tenant_id=r.tenant_id
   AND p.invoice_id=r.invoice_id AND p.sku=r.sku AND p.lot_id=r.lot_id
 LEFT JOIN m07_lot_stock ls ON ls.tenant_id=r.tenant_id
   AND ls.lot_id=r.lot_id AND ls.sku=r.sku
 LEFT JOIN m07_return_movements rm ON rm.tenant_id=r.tenant_id
   AND rm.return_id=r.return_id AND rm.invoice_id=r.invoice_id
   AND rm.sku=r.sku AND rm.lot_id=r.lot_id
 LEFT JOIN m07_cash_refunds f ON f.tenant_id=r.tenant_id
   AND f.return_id=r.return_id AND f.invoice_id=r.invoice_id
 LEFT JOIN m07_credit_ledger cl ON cl.tenant_id=r.tenant_id
   AND cl.return_id=r.return_id AND cl.invoice_id=r.invoice_id
 LEFT JOIN m07_customer_signed_accounts a ON a.tenant_id=r.tenant_id
   AND a.customer_id=r.customer_id
 LEFT JOIN m06_party_links l ON l.tenant_id=r.tenant_id
   AND l.source_group='CUSTOMERS' AND l.source_id=r.customer_id
 LEFT JOIN m07_return_edit_versions v ON v.tenant_id=r.tenant_id
   AND v.return_id=r.return_id
 LEFT JOIN m07_cash_delete_receipts cd ON cd.tenant_id=r.tenant_id
   AND cd.return_id=r.return_id
 LEFT JOIN m07_credit_delete_receipts sd ON sd.tenant_id=r.tenant_id
   AND sd.return_id=r.return_id
 LEFT JOIN corrections e ON e.tenant_id=r.tenant_id
   AND e.return_id=r.return_id`;

function trustworthy(x){
 if(!x||x.original_invoice!==x.invoice_id||
    x.original_sku!==x.sku||x.source_hash!==x.original_source_hash)return false;
 if(x.original_units!==x.item_units||
    x.original_units!==x.sale_movement_units||
    x.sold_units!==x.item_units||
    !Number.isSafeInteger(x.returned_units)||
    x.returned_units<x.units||
    x.returned_units>x.sold_units||
    x.present_lot!==x.lot_id||
    x.return_move_units!==x.units||
    x.units<1||
    x.amount_paisa<0||
    x.original_grand*x.units<x.amount_paisa*x.original_units)return false;
 if(x.refund_method==='Cash')
   return x.refund_debit===x.amount_paisa&&x.credit_amount===null;
 if(x.refund_method==='Store Credit')
   return x.original_customer===x.customer_id&&
     x.credit_amount===x.amount_paisa&&
     x.ledger_customer===x.customer_id&&
     x.ledger_party!==null&&
     x.ledger_party===x.account_party&&
     x.ledger_party===x.reviewed_party&&
     x.account_active===1&&x.link_reviewed===1&&
     x.refund_debit===null;
 return false;
}

/**
 * Reconcile append-only B7/B8 revision receipts against their atomic
 * adjustment evidence. No revision is assumed absent merely because the
 * original Cash/Customer ledger still contains the historical amount.
 * This never authorizes a subsequent financial edit or D1 write.
 */
function effectiveAmount(rows, source){
 const corrections=rows.filter(x=>x.revision_version!==null);
 // Two original Return methods sharing an ID are never interchangeable.
 if(rows.some(x=>
  x.refund_method!==source.refund_method||
  x.tenant_id!==source.tenant_id||
  x.return_id!==source.return_id||
  x.invoice_id!==source.invoice_id||
  x.sku!==source.sku||
  x.lot_id!==source.lot_id||
  x.source_hash!==source.source_hash||
  x.amount_paisa!==source.amount_paisa||
  x.customer_id!==source.customer_id))return null;
 const expectedCash=source.refund_method==='Cash'?corrections.length:0;
 const expectedCredit=source.refund_method==='Store Credit'?corrections.length:0;
 if(source.total_cash_adjustments!==expectedCash||
    source.total_credit_adjustments!==expectedCredit)return null;
 if(corrections.length===0)return source.amount_paisa;
 const revisions=[...corrections].sort((a,b)=>a.revision_version-b.revision_version);
 let amount=source.amount_paisa;
 let signedBalance=source.ledger_balance;
 for(let i=0;i<revisions.length;i++){
  const e=revisions[i],version=i+1;
  if(e.correction_method!==source.refund_method||
    e.revision_version!==version||
    e.revision_expected_version!==i||
    e.revision_invoice!==source.invoice_id||
    e.revision_sku!==source.sku||
    e.revision_lot!==source.lot_id||
    e.revision_source!==source.source_hash||
    typeof e.revision_operation!=='string'||!e.revision_operation||
    typeof e.revision_actor!=='string'||!e.revision_actor||
    typeof e.revision_hash!=='string'||e.revision_hash.length!==64||
    e.adjustment_operation!==e.revision_operation||
    e.revision_previous!==amount||
    !Number.isSafeInteger(e.revision_new)||
    e.revision_new<0||
    e.revision_new*source.original_units>source.original_grand*source.units)
   return null;
  const change=e.revision_new-e.revision_previous;
  const debit=source.refund_method==='Cash'?Math.max(change,0):Math.max(-change,0);
  const credit=source.refund_method==='Cash'?Math.max(-change,0):Math.max(change,0);
  if(e.adjustment_debit!==debit||e.adjustment_credit!==credit)
   return null;
  if(source.refund_method==='Store Credit'){
   if(e.revision_customer!==source.customer_id||
     e.adjustment_customer!==source.customer_id||
     e.adjustment_party!==source.ledger_party||
     !Number.isSafeInteger(signedBalance)||
     !Number.isSafeInteger(e.adjustment_balance)||
     e.adjustment_balance!==signedBalance-change)
    return null;
   signedBalance=e.adjustment_balance;
  }
  amount=e.revision_new;
 }
 if(source.edit_version!==revisions.length)return null;
 if(source.refund_method==='Store Credit' &&
    (source.current_signed_balance!==signedBalance||
     source.account_party!==source.ledger_party||
     source.reviewed_party!==source.ledger_party||
     source.account_active!==1||source.link_reviewed!==1))
  return null;
 return amount;
}

export function createSyntheticD1ReturnEditReader(DB){
 if(!DB||typeof DB.prepare!=='function')
   throw new TypeError('Invalid synthetic Return Edit D1 reader binding');
 return Object.freeze({
  async getReturnForEdit(raw){
   const {tenantId,returnId}=validate(raw);
   let rows;
   try{
    const res=await DB.prepare(QUERY).bind(tenantId,returnId,tenantId,returnId).all();
    if(res?.success!==true||!Array.isArray(res.results))
      return {status:'NEEDS_REVIEW'};
    rows=res.results;
   }catch{return {status:'NEEDS_REVIEW'};}
   if(rows.length===0)return {status:'NOT_FOUND'};
   const r=rows[0];
   if(r.cash_deleted!==null||r.credit_deleted!==null)
     return {status:'DELETED'};
   if(!trustworthy(r))return {status:'NEEDS_REVIEW'};
   const amount=effectiveAmount(rows,r);
   if(amount===null)return {status:'NEEDS_REVIEW'};
   return {
    status:'OK',
    data:{
      header:{
       returnId:r.return_id,invoiceId:r.invoice_id,
       refundMethod:r.refund_method,customerId:r.original_customer,
       reason:r.reason,totalReturnPaisa:amount
      },
      items:[{sku:r.sku,lotId:r.lot_id,
       quantity:r.units,amountPaisa:amount}],
      invoice:{invoiceId:r.invoice_id,sku:r.sku,soldUnits:r.original_units,
       unitPricePaisa:r.original_unit_price,
       grandPaisa:r.original_grand,customerId:r.original_customer},
      version:r.edit_version??0,editable:true
    }
   };
  }
 });
}
