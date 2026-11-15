/**
 * M06 source-faithful Saved Draft payload preflight (PURE, NO WRITES).
 *
 * Adapted from pinned Mohim_ERP DraftSales.gs::validateSalesDraftPayload_.
 * A future M04-authorized caller must obtain real tenant-scoped settings
 * and BANK_ACCOUNTS from M03, then revalidate before any D1 CAS/write.
 */
import {normalizeSalePayments_} from './sale-payments.js';

const text=value=>String(value || '').trim();
const validNonNegative=value=>{
  const n=Number(value);
  return !isNaN(n) && isFinite(n) && n>=0;
};
const money=value=>{
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
};
const object=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

/**
 * The result is source-shaped draft metadata + JSON to persist only after
 * a separately authorized, version-guarded D1 write. Not a posting proof.
 */
export function validateSaleDraftPayload(payload,{settings,bankAccounts}={}) {
  if(!object(settings) || !Array.isArray(bankAccounts)) {
    throw new TypeError('Missing trusted draft settings or bank account snapshot.');
  }
  payload=payload||{};
  const items=Array.isArray(payload.items)?payload.items:[];
  if(!items.length)throw new Error('Add at least one product before saving a draft.');
  const cleanItems=items.map((item,i)=>{
    const productId=text(item.productId);
    const name=text(item.name);
    const qty=Number(item.qty);
    const unitPrice=Number(item.unitPrice);
    const lineTotal=Number(item.lineTotal);
    if(!productId||!name)throw new Error('Line '+(i+1)+': product is required.');
    if(!validNonNegative(qty)||qty<=0)throw new Error('Line '+(i+1)+': quantity must be greater than zero.');
    if(!validNonNegative(unitPrice))throw new Error('Line '+(i+1)+': price must be a valid number.');
    if(!validNonNegative(lineTotal))throw new Error('Line '+(i+1)+': line total must be a valid number.');
    return {
      productId,name,unit:text(item.unit),qty,
      unitPrice:money(unitPrice),lineTotal:money(lineTotal),
      savedPriceMode:['auto','manual','fixed'].includes(item.savedPriceMode)?item.savedPriceMode:'manual',
      shortageResolution:item.shortageResolution==='vendor'?'vendor':'negative',
      vendorId:text(item.vendorId),vendorName:text(item.vendorName),
      vendorUnitCost:item.vendorUnitCost===''||item.vendorUnitCost===undefined?'':Number(item.vendorUnitCost),
      productType:item.productType==='Bundle'?'Bundle':'Standard',
      bundleRevision:Number.isSafeInteger(Number(item.bundleRevision))?Number(item.bundleRevision):0,
      serialSelections:Array.isArray(item.serialSelections)?item.serialSelections:[],
      warrantyData:item.warrantyData||null
    };
  });
  const subtotal=Number(payload.subtotal),discount=Number(payload.discount),
    grandTotal=Number(payload.grandTotal);
  for(const n of [subtotal,discount,grandTotal]){
    if(!validNonNegative(n))throw new Error('Draft totals must be valid non-negative numbers.');
  }

  // Original draft saves legacy and split snapshots as different JSON shapes.
  // Source-copied calculator validates allocations but never moves money here.
  const incoming=payload.payment&&typeof payload.payment==='object'?payload.payment:{};
  const isSplit=Object.prototype.hasOwnProperty.call(incoming,'payments');
  let payment;
  if(isSplit){
    if(String(settings['POS Multi Payment Enabled']||'').toLowerCase()!=='true') {
      throw new Error('POS multiple payments are not enabled for this business.');
    }
    if(!Array.isArray(incoming.payments)||!incoming.payments.length) {
      throw new Error('Add at least one payment row to the split-payment draft.');
    }
    normalizeSalePayments_(grandTotal,incoming.payments,bankAccounts);
    payment={payments:incoming.payments.map(row=>({
      id:text(row.id),method:text(row.method),
      amount:row.amount===null||row.amount===undefined?'':String(row.amount).trim(),
      accountId:text(row.accountId)
    }))};
  }else{
    payment={
      amountReceived:text(incoming.amountReceived),
      paymentMethod:text(incoming.paymentMethod),
      bankAccountId:text(incoming.bankAccountId)
    };
  }
  const itemsJson=JSON.stringify(cleanItems),paymentJson=JSON.stringify(payment);
  if(itemsJson.length>45000||paymentJson.length>45000){
    throw new Error('This draft is too large to save. Remove some lines or notes.');
  }
  return {
    customerId:text(payload.customerId),
    customerName:text(payload.customerName),
    customerPhone:text(payload.customerPhone),
    customerFatherName:text(payload.customerFatherName),
    customerRelationType:String(payload.customerRelationType||'').trim()==='Husband'?'Husband':'Father',
    customerAddress:text(payload.customerAddress),
    items:cleanItems,itemsJson,payment,paymentJson,notes:text(payload.notes),
    subtotal:money(subtotal),discount:money(discount),grandTotal:money(grandTotal)
  };
}
