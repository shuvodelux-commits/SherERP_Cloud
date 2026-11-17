/**
 * M06-B16 INTERNAL: read-only integrity audit for source-shaped Tile checkout
 * evidence. Consistency does not imply authentic/current trusted D1 state.
 * No database access, public RPC, inventory reservation, actor/session lookup,
 * Cash/Bank/Party posting, printing or sale authorization.
 *
 * Sources: frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * (SalePayments.gs); reviewed M02 rational Tile quantity/price contract.
 */
import {priceTileQuantity} from './tile-quantity-contract.js';
import {salePaymentPaisa_} from './sale-payments.js';

const MAX_PAISA=BigInt(Number.MAX_SAFE_INTEGER);
const WHOLE=/^(?:0|[1-9][0-9]*)$/u;
const id=x=>typeof x==='string'&&x.length>0&&x===x.trim()&&x.length<=256;

function record(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid trusted '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid trusted '+label+' accessor');
  }
  return value;
}
function rows(value,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
    throw new TypeError('Invalid trusted '+label+' array');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value'))||
     Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i))
       .some(own=>!own))
    throw new TypeError('Invalid trusted '+label+' accessor or sparse array');
  for(const valueRow of value)record(valueRow,label+' row');
}
function minor(value){
  // Do not invoke caller-defined valueOf/toString during financial checks.
  if(typeof value!=='string'&&typeof value!=='number')return null;
  if(typeof value==='number'&&!Number.isFinite(value))return null;
  try{return BigInt(salePaymentPaisa_(value,'Checkout evidence',false));}
  catch{return null;}
}
function exactMinor(value){
  if(typeof value!=='string'||!WHOLE.test(value))return null;
  const n=BigInt(value);
  return n<=MAX_PAISA?n:null;
}
function fraction(a,b){
  if(!a||!b)return false;
  // Nested saved rational evidence must meet the same no-accessor contract
  // as the parent Tile quote. Never read an inherited/getter numerator.
  record(a,'Tile rational fraction');
  if(!Object.hasOwn(a,'numerator')||!Object.hasOwn(a,'denominator')||
     typeof a.numerator!=='string'||typeof a.denominator!=='string')
    return false;
  return a.numerator===b.numerator&&a.denominator===b.denominator;
}
function sameOptionalFraction(a,b){
  return (a===null||a===undefined)&&(b===null||b===undefined)||
    fraction(a,b);
}
function safeAdd(a,b){
  if(a===null||b===null)return null;
  const n=a+b;
  return n<=MAX_PAISA?n:null;
}

/**
 * Audit a private M06 #504 quote as a *diagnostic* source snapshot.
 * The caller must independently prove M04 authority and M03 current D1
 * identity, stock, Cash Session, original payment accounts, and atomic write.
 * A "ready" result MUST NEVER be used as an approval to post a sale.
 */
export function auditMultiTileSaleCheckoutEvidence(preview){
  record(preview,'checkout');
  rows(preview.lines,'Tile checkout line');
  record(preview.allocation,'payment allocation');
  rows(preview.allocation.payments,'payment');
  const issues=[],add=(code,line=-1)=>issues.push({code,line});
  const productIds=new Set();
  let subtotalMinor=0n,validSubtotal=true;
  if(!preview.lines.length)add('EMPTY_SALE');
  if(preview.stockAuthority!=='not-loaded'||preview.postingAllowed!==false)
    add('UNAUTHORIZED_POSTING_CLAIM');

  for(const [i,line] of preview.lines.entries()){
    if(!id(line.productId))add('INVALID_PRODUCT_ID',i);
    else{
      if(productIds.has(line.productId))add('DUPLICATE_PRODUCT_ID',i);
      productIds.add(line.productId);
    }
    if(line.stockAuthority!=='not-loaded'||line.postingAllowed!==false||
       line.salePreview?.postingAllowed!==false)
      add('UNAUTHORIZED_POSTING_CLAIM',i);
    if(line.stockUnit!=='Pcs')add('INVALID_STOCK_UNIT',i);

    const quantity=record(line.quantity,'Tile quantity');
    const quote=record(line.salePreview,'Tile quote');
    if(quote.mode!=='read-only-sale-quote')add('INVALID_TILE_SNAPSHOT',i);
    if(!quantity.measurementSnapshot||!quantity.requestSnapshot){
      add('INVALID_TILE_SNAPSHOT',i);
    }else{
      const config=record(quantity.measurementSnapshot,'Tile measurement');
      const request=record(quantity.requestSnapshot,'Tile request');
      if(config.productId!==line.productId||
         config.revision!==String(line.revision))
        add('PRODUCT_REVISION_MISMATCH',i);
      let expected=null;
      try{
        expected=priceTileQuantity(config,request,quote.pricingUnit,quote.unitPriceText);
      }catch{add('INVALID_TILE_SNAPSHOT',i);}
      if(expected){
        if(quantity.pieces!==expected.quantity.pieces||
           quantity.boxes!==expected.quantity.boxes||
           quantity.extraPieces!==expected.quantity.extraPieces||
           quantity.displaySqft!==expected.quantity.displaySqft||
           !fraction(quantity.actualSqft,expected.quantity.actualSqft)||
           !sameOptionalFraction(quantity.requestedSqft,expected.quantity.requestedSqft))
          add('TILE_QUANTITY_MISMATCH',i);
        if(!fraction(quote.billingQuantity,expected.billingQuantity)||
           !fraction(quote.exactAmount,expected.exactAmount)||
           quote.billingQuantityDisplay!==expected.billingQuantityDisplay||
           quote.roundingDeltaMinor!==expected.displayQuantityAmountDeltaMinor||
           quote.lineAmountMinor!==expected.lineAmountMinor)
          add('TILE_QUOTE_MISMATCH',i);
      }
    }
    if(!quote.priceSnapshot||typeof quote.priceSnapshot!=='object')
      add('PRICE_SNAPSHOT_MISMATCH',i);
    else{
      const price=record(quote.priceSnapshot,'Tile price');
      if(price.pricingUnit!==quote.pricingUnit||
         price.unitPriceText!==quote.unitPriceText)
        add('PRICE_SNAPSHOT_MISMATCH',i);
    }
    const lineMinor=exactMinor(quote.lineAmountMinor);
    if(lineMinor===null){add('TILE_QUOTE_MISMATCH',i);validSubtotal=false;}
    else{
      subtotalMinor=safeAdd(subtotalMinor,lineMinor);
      if(subtotalMinor===null){add('SUBTOTAL_OVERFLOW',i);validSubtotal=false;subtotalMinor=0n;}
    }
    if(lineMinor===null||minor(line.lineTotal)!==lineMinor)
      add('LINE_AMOUNT_MISMATCH',i);
  }

  const savedSubtotal=minor(preview.subtotal);
  const discount=minor(preview.discount);
  const grand=minor(preview.grandTotal);
  if(savedSubtotal===null||discount===null||grand===null)
    add('INVALID_CHECKOUT_MONEY');
  else{
    if(validSubtotal&&subtotalMinor!==savedSubtotal)
      add('SUBTOTAL_MISMATCH');
    const expectedGrand=savedSubtotal>discount?savedSubtotal-discount:0n;
    if(expectedGrand!==grand)add('GRAND_TOTAL_MISMATCH');
  }

  const allocation=preview.allocation;
  const paid=minor(allocation.paidAmount);
  const due=minor(allocation.dueAmount);
  const change=minor(allocation.changeAmount);
  if(paid===null||due===null||change===null)
    add('INVALID_PAYMENT_AMOUNT');
  else if(grand!==null&&paid+due!==grand)
    add('PAID_DUE_MISMATCH');

  if(allocation.payments.length>20)add('TOO_MANY_PAYMENT_ROWS');
  const rowIds=new Set(),orders=new Set(),positiveRows=[];
  let totalApplied=0n,totalChange=0n,validPayments=true,cashCount=0;
  for(const [i,p] of allocation.payments.entries()){
    if(!id(p.rowId))add('INVALID_PAYMENT_ROW_ID',i);
    else{
      if(rowIds.has(p.rowId))add('DUPLICATE_PAYMENT_ROW_ID',i);
      rowIds.add(p.rowId);
    }
    if(!Number.isSafeInteger(p.rowOrder)||p.rowOrder<1||p.rowOrder>20)
      add('INVALID_PAYMENT_ORDER',i);
    else{
      if(orders.has(p.rowOrder))add('DUPLICATE_PAYMENT_ORDER',i);
      orders.add(p.rowOrder);
    }
    const tendered=minor(p.tendered),applied=minor(p.applied),returned=minor(p.change);
    if(tendered===null||applied===null||returned===null){
      add('INVALID_PAYMENT_AMOUNT',i);validPayments=false;continue;
    }
    if(applied>0n)positiveRows.push(p);
    totalApplied=safeAdd(totalApplied,applied);
    if(totalApplied===null){validPayments=false;totalApplied=0n;add('PAYMENT_AMOUNT_OVERFLOW',i);}
    if(p.method==='Cash'){
      cashCount++;
      if(p.bankAccountId||p.bankAccountName)
        add('CASH_ACCOUNT_MISMATCH',i);
      if(tendered!==applied+returned||tendered===0n)
        add('CASH_TENDER_MISMATCH',i);
      totalChange=safeAdd(totalChange,returned);
      if(totalChange===null){validPayments=false;totalChange=0n;add('PAYMENT_AMOUNT_OVERFLOW',i);}
    }else if(p.method==='Bank'||p.method==='Mobile Banking'){
      if(!id(p.bankAccountId))add('NONCASH_ACCOUNT_MISMATCH',i);
      if(returned!==0n||tendered!==applied||applied===0n)
        add('NONCASH_TENDER_MISMATCH',i);
    }else add('UNSUPPORTED_PAYMENT_METHOD',i);
  }
  if(cashCount>1)add('DUPLICATE_CASH_ROW');
  if(validPayments&&paid!==null&&totalApplied!==paid)
    add('APPLIED_TOTAL_MISMATCH');
  if(validPayments&&change!==null&&totalChange!==change)
    add('CASH_CHANGE_MISMATCH');

  if(paid!==null&&due!==null){
    const status=due===0n?'Paid':paid===0n?'Due':'Partial';
    const type=due===0n?'Cash':paid===0n?'Due':'Partial';
    if(allocation.paymentStatus!==status||allocation.paymentType!==type)
      add('PAYMENT_HEADER_MISMATCH');
  }
  const sole=positiveRows.length===1?positiveRows[0]:null;
  const method=sole?.method??(positiveRows.length?'Multiple':'');
  const accountId=sole?.bankAccountId??'';
  const accountName=sole?.bankAccountName??'';
  if(allocation.paymentMethod!==method||
     allocation.bankAccountId!==accountId||
     allocation.bankAccountName!==accountName)
    add('PAYMENT_HEADER_MISMATCH');

  return {
    ready:issues.length===0,issues,postingAllowed:false,
    summary:{
      lines:preview.lines.length,
      subtotalMinor:validSubtotal?String(subtotalMinor):null,
      discountMinor:discount===null?null:String(discount),
      grandMinor:grand===null?null:String(grand),
      paidMinor:paid===null?null:String(paid),
      dueMinor:due===null?null:String(due),
      changeMinor:change===null?null:String(change)
    }
  };
}
