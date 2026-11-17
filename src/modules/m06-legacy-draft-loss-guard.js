/**
 * M06 internal Saved Draft source-shape data-loss guard — READ ONLY.
 *
 * Frozen original: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * DraftSales.gs::validateSalesDraftPayload_. The legacy serializer cannot
 * retain new Tiles/mixed-unit revisions, component prices, exact area,
 * original lot draws, or lineAmountMinor. Fail closed rather than silently
 * save a lossy "legacy" draft. No new draft schema or posting authority.
 */
import {validateSaleDraftPayload} from './sale-draft-payload.js';

const HEAD_FIELDS=[
  'customerId','customerName','customerPhone','customerFatherName',
  'customerRelationType','customerAddress','items','subtotal','discount',
  'grandTotal','notes','payment'
];
const ITEM_FIELDS=[
  'productId','name','unit','qty','unitPrice','lineTotal','savedPriceMode',
  'shortageResolution','vendorId','vendorName','vendorUnitCost','productType',
  'bundleRevision','serialSelections','warrantyData'
];
const LEGACY_PAYMENT=['amountReceived','paymentMethod','bankAccountId'];
const SPLIT_PAYMENT=['payments'];
const PAYMENT_ROW=['id','method','amount','accountId'];
const UNIT_AWARE=/unitbreakdown|unitsnapshot|unitpricing|unitrevision|conversion|factor|measurement|tile|sqft|stockunit|stocklot|fifo|baseqty|lineamount|billingquantity|requestedarea|actualarea|priceSnapshot/i;

function dataObject(value,allowed,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid trusted '+label+' record');
  for(const field of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,field);
    if(!d||!Object.hasOwn(d,'value'))
      throw new TypeError('Invalid trusted '+label+' accessor field');
    if(allowed && !allowed.includes(field)){
      const key=String(field);
      if(UNIT_AWARE.test(key))
        throw new Error('NEEDS_REVIEW: versioned unit-aware draft snapshot required');
      throw new Error('NEEDS_REVIEW: legacy draft field would be discarded');
    }
  }
}
function dataRows(value,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
     Object.values(Object.getOwnPropertyDescriptors(value))
       .some(d=>!Object.hasOwn(d,'value')))
    throw new TypeError('Invalid trusted '+label+' list');
  for(const row of value)dataObject(row,null,label);
}

/**
 * Legacy-only candidate, never a versioned multi-unit Saved Draft writer.
 * Future M03 D1 CAS + actor/Cash Session and versioned original unit
 * evidence must be approved before any richer draft can be stored.
 */
export function prepareLosslessLegacySaleDraft(payload,trusted){
  dataObject(payload,HEAD_FIELDS,'draft payload');
  dataObject(trusted,['settings','bankAccounts'],'draft settings snapshot');
  dataObject(trusted.settings,null,'draft settings');
  dataRows(trusted.bankAccounts,'Bank Account');

  if(Array.isArray(payload.items)){
    dataRows(payload.items,'draft item');
    for(const item of payload.items)dataObject(item,ITEM_FIELDS,'draft item');
  }

  const payment=payload.payment;
  if(payment!==undefined&&payment!==null){
    dataObject(payment,null,'draft payment');
    const isSplit=Object.hasOwn(payment,'payments');
    dataObject(payment,isSplit?SPLIT_PAYMENT:LEGACY_PAYMENT,
      'draft payment');
    if(isSplit&&Array.isArray(payment.payments)){
      dataRows(payment.payments,'draft payment row');
      for(const row of payment.payments)
        dataObject(row,PAYMENT_ROW,'draft payment row');
    }
  }

  // The only conversion performed is the exact original source sanitizer.
  // It preserves the original JSON format and Business Settings decisions;
  // no new unit/price/stock reinterpretation is allowed in this path.
  const candidate=validateSaleDraftPayload(payload,trusted);
  return {draftFormat:'legacy',candidate,postingAllowed:false};
}
