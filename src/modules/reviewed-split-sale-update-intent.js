/**
 * M06 reviewed split Sale Update intent — PURE, NO FINANCIAL WRITES.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SalesManagement.gs / SalePayments.gs original edit/checkout rules.
 *
 * This is NOT a D1 transaction, RPC, permission service, Cash Session writer
 * or authorization to post. M03/M04/M05/M07/M08 must independently validate
 * the same data and operation ID at the DB-enforced atomic write boundary.
 */
import {projectSaleForUpdate} from './sale-update-read-model.js';
import {planSplitSaleUpdatePreview} from './split-sale-update-preview.js';
import {
  salePaymentPaisa_,assertSalePaymentBookEvidence_,
  salePaymentNextRevision_,salePaymentAccountDeltas_
} from './sale-payments.js';

const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);
function trusted(row,label){
  if(!plain(row) ||
    Object.values(Object.getOwnPropertyDescriptors(row))
      .some(desc=>!Object.hasOwn(desc,'value'))){
    throw new TypeError('Missing trusted '+label+' record or untrusted accessor.');
  }
  return row;
}
function trustedRows(value,label){
  if(!Array.isArray(value))throw new TypeError('Missing trusted '+label+' array snapshot.');
  for(const row of value)trusted(row,label+' row');
  return value;
}
const sourceRowKeys=[
  'sales','items','paymentRows','returnItems','sessions',
  'bundleComponents','vendorSourcing','cashBookRows','bankBookRows',
  'newItems','newPayments','bankAccounts'
];

/**
 * Preview a financially reviewed edit without executing any side effects.
 * All snapshots and the canEditSales capability MUST be server-authoritative.
 */
export function planReviewedSplitSaleUpdate(snapshot,{canEditSales}={}){
  if(canEditSales!==true)throw new Error('Permission denied: sales.edit');
  trusted(snapshot,'Sale Update source snapshot');
  for(const name of sourceRowKeys)trustedRows(snapshot[name],name);
  const settlement=trusted(snapshot.currentSettlement,'Customer settlement');
  const id=snapshot.invoiceId;
  if(typeof id!=='string'||!id.trim())
    throw new TypeError('Missing trusted source invoice ID.');

  // The frozen getSaleForUpdate guards unique invoice, active returns,
  // original Cash Session, split children and historical Bundle snapshots.
  const original=projectSaleForUpdate(id,snapshot,{canEditSales:true});
  if(original.paymentDetailVersion!=='1')
    throw new Error('Reviewed split Sale Update requires payment detail version 1.');

  const sale=snapshot.sales.find(row=>String(row['Invoice ID'])===id);
  // An imported invoice with unreconciled original checkout cannot be
  // used as the basis for another financial correction.
  let savedPaid,savedDue;
  try{
    const savedGrand=salePaymentPaisa_(sale['Grand Total'],'Grand Total',false);
    savedPaid=salePaymentPaisa_(sale['Paid Amount'],'Paid Amount',false);
    savedDue=salePaymentPaisa_(sale['Due Amount'],'Due Amount',false);
    if(!Number.isSafeInteger(savedPaid+savedDue)||savedPaid+savedDue!==savedGrand)
      throw new Error('Unreconciled original checkout');
  }catch{
    throw new Error('NEEDS_REVIEW: original reviewed Sale Update checkout totals mismatch');
  }
  const currentPaid=salePaymentPaisa_(
    settlement.paidAmount,'Current paid amount',false);
  const currentDue=salePaymentPaisa_(
    settlement.dueAmount,'Current due amount',false);
  if(savedPaid!==currentPaid || savedDue!==currentDue){
    throw new Error('This invoice has later customer settlements. Reconcile those payments first.');
  }

  // The original Cash/Bank book movements must match the original applied
  // checkout tenders before a replacement can even be planned.
  assertSalePaymentBookEvidence_(
    id,original.payments,snapshot.cashBookRows,snapshot.bankBookRows);

  const nextRevision=salePaymentNextRevision_(id,snapshot.paymentRows);
  if(!Number.isSafeInteger(nextRevision)||nextRevision<1)
    throw new RangeError('Invalid payment revision range. Needs Review.');
  const reversedPaymentIds=snapshot.paymentRows
    .filter(row=>String(row['Invoice ID'])===id && String(row['Status'])==='Active')
    .map(row=>String(row['Payment ID']));

  const preview=planSplitSaleUpdatePreview({
    invoiceId:id,sale,oldItems:snapshot.items,
    newItems:snapshot.newItems,discount:snapshot.discount,
    payments:snapshot.newPayments,bankAccounts:snapshot.bankAccounts
  },{canEditSales:true});

  const accountDeltas=salePaymentAccountDeltas_(
    original.payments,preview.allocation.payments);
  return {original,preview,nextRevision,reversedPaymentIds,accountDeltas};
}
