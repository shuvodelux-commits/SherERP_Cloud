/**
 * M06 internal legacy (non-split) Sales Update payment preview. PURE, NO WRITES.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * SalesManagement.gs::updateSaleInternal_ Cash/Due/Partial branch and
 * Utils.gs::resolveBankAccount_.
 *
 * M03/M04 must supply a trusted tenant-filtered, uniquely resolved original
 * invoice and server-authoritative edit capability. Before an actual write,
 * the shared D1 kernel must enforce M05 FIFO, M07 return, M08 settlement,
 * Cash Session, authorized actor, operation ID and atomic journal guards.
 */
import {planSaleUpdateLineTotals} from './sale-update-line-totals.js';

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
  if(!Array.isArray(value))
    throw new TypeError('Missing trusted '+label+' array snapshot.');
  for(const row of value)trusted(row,label+' row');
  return value;
}
function discountAmount(value){
  if(value===undefined||value===null||value==='')return 0;
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0)
    throw new TypeError('Sale Update discount must be finite and nonnegative.');
  return amount;
}
/**
 * Frozen Utils.gs deliberately allows historical Inactive BANK_ACCOUNTS to
 * be re-saved by their original ID. Do not reuse the split-mode allocator's
 * new-tender active-account constraint for these legacy edits.
 */
function legacyBankAccount(paymentMethod,bankAccountId,bankAccounts){
  if(paymentMethod!=='Bank'&&paymentMethod!=='Mobile Banking')
    return {id:'',name:''};
  const id=bankAccountId===undefined||bankAccountId===null
    ?'':String(bankAccountId).trim();
  if(!id)throw new Error('Choose a bank account.');
  const row=bankAccounts.find(account=>account['Bank Account ID']===id);
  if(!row)throw new Error('Bank account not found.');
  return {id:row['Bank Account ID'],name:row['Account Name']};
}

/**
 * Preview the original non-v1 Sales Update payment fields. No editing
 * eligibility, account booking, Party resolution or financial posting.
 */
export function planLegacySaleUpdatePaymentPreview(snapshot,{canEditSales}={}){
  if(canEditSales!==true)throw new Error('Permission denied: sales.edit');
  trusted(snapshot,'legacy Sale Update snapshot');
  const id=snapshot.invoiceId;
  if(typeof id!=='string'||!id.trim())
    throw new TypeError('Missing exact original invoice ID.');
  const sale=trusted(snapshot.sale,'legacy Sales header');
  if(sale['Invoice ID']!==id)throw new Error('Invoice ID mismatch.');
  if(String(sale['Is Deleted']||'').toUpperCase()==='TRUE')
    throw new Error('Deleted invoice cannot be edited.');
  // A future source version is not silently treated as an old one.
  if(String(sale['Payment Detail Version']||'').trim()!=='')
    throw new Error('Legacy invoice payment version mismatch.');
  const oldItems=trustedRows(snapshot.oldItems,'original sale items');
  const newItems=trustedRows(snapshot.newItems,'proposed sale items');
  const bankAccounts=trustedRows(snapshot.bankAccounts,'bank accounts');
  if(newItems.length===0)throw new Error('Cart is empty.');

  const {subtotal,lines}=planSaleUpdateLineTotals(id,oldItems,newItems);
  const discount=discountAmount(snapshot.discount);
  const grandTotal=Math.max(0,subtotal-discount);
  if(!Number.isFinite(grandTotal))
    throw new RangeError('Sale Update money overflow.');

  const paymentType=snapshot.paymentType;
  let paidAmount,dueAmount;
  if(paymentType==='Cash'){
    paidAmount=grandTotal;dueAmount=0;
  }else if(paymentType==='Due'){
    paidAmount=0;dueAmount=grandTotal;
  }else if(paymentType==='Partial'){
    const raw=snapshot.paidAmount;
    const n=Number(raw);
    paidAmount=Number.isFinite(n)&&n>=0?n:0;
    if(paidAmount<=0||paidAmount>=grandTotal)
      throw new Error('Partial payment must be more than 0 and less than the grand total.');
    dueAmount=grandTotal-paidAmount;
  }else{
    throw new Error('Choose a payment type.');
  }
  const paymentStatus=dueAmount<=0?'Paid':(paidAmount>0?'Partial':'Due');
  const paymentMethod=paidAmount>0?(snapshot.paymentMethod||'Cash'):'';
  const bank=legacyBankAccount(paymentMethod,snapshot.bankAccountId,bankAccounts);
  return {
    invoiceId:id,subtotal,lines,discount,grandTotal,
    paidAmount,dueAmount,paymentType,paymentStatus,paymentMethod,
    bankAccountId:bank.id,bankAccountName:bank.name
  };
}
