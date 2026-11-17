/**
 * M06 private, read-only multiple-Tile checkout preview. No sale writer.
 *
 * Original money: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SalePayments.gs::normalizeSalePayments_/salePaymentPaisa_ (exact source).
 * Tile dimensions, source pricing and revision: M02/M03 approved private
 * reader + M06 #498 quote. Never multiply displayed Sqft back into money.
 *
 * M04 auth, M03 D1-atomic Cash Session/stock/FIFO/Party/Cash/Bank/posting,
 * M07 returns and M09 print are separate, currently blocked integration.
 */
import {previewTileSaleLineCandidateD1} from './m06-tile-sale-line-preview.js';
import {normalizeSalePayments_,salePaymentPaisa_} from './sale-payments.js';

const MAX_PAISA=BigInt(Number.MAX_SAFE_INTEGER);
const MINOR=/^(?:0|[1-9][0-9]*)$/u;

function record(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid trusted '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!Object.hasOwn(d,'value')||
       (allowed!==null&&!allowed.includes(key)))
      throw new TypeError('Unsupported or accessor-backed '+label+' field');
  }
}
function rows(value,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
    Object.values(Object.getOwnPropertyDescriptors(value))
      .some(d=>!Object.hasOwn(d,'value')))
    throw new TypeError('Invalid trusted '+label+' list');
  for(const row of value)record(row,null,label);
}
function id(value){
  return typeof value==='string'&&value.trim().length>0&&
    value===value.trim()&&value.length<=256;
}
function safeMinor(value){
  if(typeof value!=='string'||!MINOR.test(value))
    throw new Error('NEEDS_REVIEW: Tile quote is missing exact paisa amount');
  const minor=BigInt(value);
  if(minor>MAX_PAISA)
    throw new RangeError('NEEDS_REVIEW: Tile quote amount out of range');
  return minor;
}

/**
 * Server-supplied snapshot.DB and snapshot.bankAccounts are trusted ONLY
 * after future M04 authenticated tenant/actor checks by the M03 integrator.
 * This helper itself has no permission to load stock or post a transaction.
 */
export async function previewMultiTileSaleCheckoutCandidateD1(intent,snapshot){
  record(intent,['lines','discount','payments'],'Tile checkout intent');
  record(snapshot,['DB','bankAccounts'],'Tile checkout snapshot');
  if(!Array.isArray(intent.lines)||intent.lines.length===0)
    throw new TypeError('Empty Tile checkout cart');
  rows(intent.lines,'Tile checkout line');
  rows(intent.payments,'Tile checkout payment');
  rows(snapshot.bankAccounts,'trusted Bank Account');

  const bankIds=new Set();
  for(const account of snapshot.bankAccounts){
    const key=account['Bank Account ID'];
    if(!id(key))throw new Error('NEEDS_REVIEW: invalid trusted Bank Account ID');
    if(bankIds.has(key))throw new Error('NEEDS_REVIEW: duplicate Bank Account ID');
    bankIds.add(key);
  }

  const lines=[],productIds=new Set();
  let subtotalMinor=0n;
  for(const input of intent.lines){
    record(input,['productId','request'],'Tile checkout line');
    if(!id(input.productId))throw new TypeError('Invalid Tile Product ID');
    if(productIds.has(input.productId))
      throw new Error('NEEDS_REVIEW: duplicate Product ID on Tile checkout');
    productIds.add(input.productId);
    record(input.request,null,'Tile quantity request');

    // This single reviewed D1 path resolves current product revision,
    // physical quantity, selected price anchor, and exact rational area.
    const quote=await previewTileSaleLineCandidateD1({
      DB:snapshot.DB,productId:input.productId,revision:'current',
      request:input.request
    });
    if(quote===null||quote.productId!==input.productId||
       quote.salePreview?.postingAllowed!==false||
       quote.stockAuthority!=='not-loaded')
      throw new Error('NEEDS_REVIEW: Tile product/current quote unavailable');
    const minor=safeMinor(quote.salePreview.lineAmountMinor);
    subtotalMinor+=minor;
    if(subtotalMinor>MAX_PAISA)
      throw new RangeError('NEEDS_REVIEW: Tile checkout total out of range');
    lines.push({
      productId:quote.productId,
      productName:quote.productName,
      revision:quote.revision,
      stockUnit:quote.stockUnit,
      quantity:quote.quantity,
      salePreview:quote.salePreview,
      lineTotal:Number(minor)/100,
      stockAuthority:'not-loaded',
      postingAllowed:false
    });
  }

  const discountMinor=BigInt(salePaymentPaisa_(
    intent.discount,'Discount',true));
  const grandMinor=subtotalMinor>discountMinor?
    subtotalMinor-discountMinor:0n;

  const subtotal=Number(subtotalMinor)/100;
  const discount=Number(discountMinor)/100;
  const grandTotal=Number(grandMinor)/100;
  const allocation=normalizeSalePayments_(
    grandTotal,intent.payments,snapshot.bankAccounts
  );
  return {
    lines,subtotal,discount,grandTotal,allocation,
    stockAuthority:'not-loaded',postingAllowed:false
  };
}
