/**
 * M06 pure preview for the frozen split-invoice Sales Update checkout path.
 *
 * Source authority: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SalesManagement.gs::updateSaleInternal_; SalePayments.gs::normalizeSalePayments_.
 *
 * This is NOT an edit authorization or posting path. M03/M04 must supply an
 * authenticated, tenant-scoped snapshot, M05/M07/M08 must reconcile stock,
 * returns, Customer and tender evidence, and the eventual D1 writer must
 * recheck all financial guards atomically. No Cash/Bank/ledger/stock writes.
 */
import {planSaleUpdateLineTotals} from './sale-update-line-totals.js';
import {normalizeSalePayments_} from './sale-payments.js';

const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

function trusted(value,label){
  if(!plain(value) ||
    Object.values(Object.getOwnPropertyDescriptors(value))
      .some(desc=>!Object.hasOwn(desc,'value')))
    throw new TypeError('Missing trusted '+label+' record or unexpected accessor.');
  return value;
}
function trustedRows(value,label){
  if(!Array.isArray(value))throw new TypeError('Missing trusted '+label+' array snapshot.');
  for(const row of value)trusted(row,label+' row');
  return value;
}
function discountAmount(value){
  // GAS Utils.gs::isValidNonNegativeNumber_ treats blank as zero.
  if(value===null || value===undefined || value==='')return 0;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)
    throw new TypeError('Sale Update discount must be finite and nonnegative.');
  return n;
}
const roundMoney=value=>{
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
};

/**
 * Preview the original version-1 split Sale Update totals only.
 *
 * The canEditSales capability is trusted server-side input, never a value
 * accepted directly from a browser or RPC request.
 */
export function planSplitSaleUpdatePreview(snapshot,{canEditSales}={}){
  if(canEditSales!==true)throw new Error('Permission denied: sales.edit');
  trusted(snapshot,'Sales Update snapshot');
  const id=snapshot.invoiceId;
  if(typeof id!=='string'||!id.trim())
    throw new TypeError('Missing trusted invoice ID.');
  const sale=trusted(snapshot.sale,'Sales header');
  if(sale['Invoice ID']!==id)throw new Error('Invoice ID mismatch in Sales Update.');
  if(String(sale['Is Deleted']||'').toUpperCase()==='TRUE')
    throw new Error('Deleted invoice cannot enter Sales Update.');
  if(String(sale['Payment Detail Version']||'').trim()!=='1')
    throw new Error('Sales Update split preview requires payment detail version 1.');
  const oldItems=trustedRows(snapshot.oldItems,'original SALE_ITEMS');
  const newItems=trustedRows(snapshot.newItems,'proposed POS items');
  const payments=trustedRows(snapshot.payments,'split payment');
  const bankAccounts=trustedRows(snapshot.bankAccounts,'bank account');

  const {subtotal,lines}=planSaleUpdateLineTotals(id,oldItems,newItems);
  const discount=discountAmount(snapshot.discount);
  // Exact frozen updateSaleInternal_ ordering: raw net first, then round
  // to integer-paisa scale before passing to normalizeSalePayments_.
  const grandTotal=Math.max(0,subtotal-discount);
  if(!Number.isFinite(grandTotal))
    throw new RangeError('Sale Update total out of range.');
  const allocation=normalizeSalePayments_(
    roundMoney(grandTotal),payments,bankAccounts);
  return {invoiceId:id,subtotal,discount,grandTotal,lines,allocation};
}
