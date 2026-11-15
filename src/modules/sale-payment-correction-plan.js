/**
 * M06 internal read-only SAME-TOTAL split-tender correction intent.
 *
 * Composes frozen SalePayments.gs helpers already ported in sale-payments.js.
 * Source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * Not a sale editor, user authorization, SQL CAS, RPC, book writer or
 * settlement engine. All snapshots MUST come from M03/M04/M08 authenticated,
 * tenant-scoped sources; a future posting kernel must recheck every invariant
 * at the same atomic SQL boundary and never trust this preflight as authority.
 */
import {
  salePaymentPaisa_,
  readSalePaymentBreakdown_,
  assertSalePaymentBookEvidence_,
  normalizeSalePayments_,
  salePaymentNextRevision_,
  salePaymentAccountDeltas_
} from './sale-payments.js';

const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

/**
 * Preview existing split-payment revision and signed Cash/Bank differences.
 * The invoice total remains unchanged; item/price edits require the original
 * SalesManagement module and a separately authorized atomic transaction.
 */
export function planSaleSplitPaymentCorrection(snapshot){
  if(!plain(snapshot) || !plain(snapshot.sale) ||
     !plain(snapshot.currentSettlement) ||
     !Array.isArray(snapshot.paymentRows) ||
     !Array.isArray(snapshot.cashBookRows) ||
     !Array.isArray(snapshot.bankBookRows) ||
     !Array.isArray(snapshot.newPayments) ||
     !Array.isArray(snapshot.bankAccounts)){
    throw new TypeError('Missing trusted sale, settlement, payment or book snapshots.');
  }
  const id=snapshot.invoiceId;
  if(typeof id!=='string' || !id.trim() ||
     String(snapshot.sale['Invoice ID']||'')!==id){
    throw new Error('Invoice ID mismatch for split payment correction.');
  }
  const sale=snapshot.sale;
  if(String(sale['Is Deleted']||'').toUpperCase()==='TRUE'){
    throw new Error('Deleted invoice cannot be corrected.');
  }
  if(String(sale['Payment Detail Version']||'').trim()!=='1'){
    throw new Error('Split payment correction requires payment detail version 1.');
  }

  // Keep checkout tender and later Customer collections separate. A later
  // settlement must be reconciled by M08 before any historical edit.
  const savedPaid=salePaymentPaisa_(sale['Paid Amount'],'Paid Amount',false);
  const savedDue=salePaymentPaisa_(sale['Due Amount'],'Due Amount',false);
  const currentPaid=salePaymentPaisa_(
    snapshot.currentSettlement.paidAmount,'Current paid amount',false);
  const currentDue=salePaymentPaisa_(
    snapshot.currentSettlement.dueAmount,'Current due amount',false);
  if(currentPaid!==savedPaid || currentDue!==savedDue){
    throw new Error('This invoice has later customer settlements. Reconcile those payments first.');
  }

  const previous=readSalePaymentBreakdown_(sale,snapshot.paymentRows);
  assertSalePaymentBookEvidence_(
    id,previous,snapshot.cashBookRows,snapshot.bankBookRows);
  const allocation=normalizeSalePayments_(
    sale['Grand Total'],snapshot.newPayments,snapshot.bankAccounts);
  const nextRevision=salePaymentNextRevision_(id,snapshot.paymentRows);
  if(!Number.isSafeInteger(nextRevision) || nextRevision<1){
    throw new RangeError('Invalid payment revision range. Needs Review.');
  }
  const reversedPaymentIds=snapshot.paymentRows.filter(p=>
    String(p['Invoice ID'])===id && String(p['Status'])==='Active'
  ).map(p=>String(p['Payment ID']));
  const accountDeltas=salePaymentAccountDeltas_(previous,allocation.payments);
  return {nextRevision,reversedPaymentIds,allocation,accountDeltas};
}
