/**
 * M06 INTERNAL: read-only audit of historical multi-unit POS checkout.
 * Sources: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2;
 * supplementary units sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 * Never read current conversions, reprice, authorize, post, or access D1/RPC.
 */
import {salePaymentPaisa_} from './sale-payments.js';

const EPS=0.0000001;
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const identifier=x=>typeof x==='string'&&x.trim().length>0;
const near=(a,b)=>Math.abs(a-b)<=EPS;
function plain(x){
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const p=Object.getPrototypeOf(x);
  return (p===Object.prototype||p===null)&&
    Object.values(Object.getOwnPropertyDescriptors(x))
      .every(d=>Object.hasOwn(d,'value'));
}
function rows(x,label){
  if(!Array.isArray(x)||Object.getPrototypeOf(x)!==Array.prototype||
    Object.values(Object.getOwnPropertyDescriptors(x))
      .some(d=>!Object.hasOwn(d,'value')))
    throw new TypeError('Invalid trusted '+label+' array or accessor');
  for(const item of x)
    if(!plain(item))throw new TypeError('Invalid trusted '+label+' row or accessor');
}
function paisa(value){
  try{return salePaymentPaisa_(value,'Historical checkout amount',false);}
  catch{return null;}
}

/** Result is diagnostic, NOT posting authorization or D1 import approval. */
export function auditMixedUnitSaleCheckoutSnapshot(preview){
  if(!plain(preview)||!plain(preview.allocation))
    throw new TypeError('Invalid trusted checkout snapshot');
  rows(preview.lines,'sale line');
  rows(preview.allocation.payments,'payment');
  const issues=[],add=(code,line=-1)=>issues.push({code,line});
  const seenProducts=new Set();
  let subtotal=0,goodSubtotal=true,unitLines=0,legacyLines=0;
  if(!preview.lines.length)add('EMPTY_SALE');

  for(const [i,line] of preview.lines.entries()){
    if(!identifier(line.productId))add('INVALID_PRODUCT_ID',i);
    else {
      if(seenProducts.has(line.productId))add('DUPLICATE_PRODUCT_ID',i);
      seenProducts.add(line.productId);
    }
    const amount=paisa(line.lineTotal);
    if(amount===null){add('INVALID_LINE_TOTAL',i);goodSubtotal=false;}
    else{
      subtotal+=amount;
      if(!Number.isSafeInteger(subtotal)){add('SUBTOTAL_OVERFLOW',i);goodSubtotal=false;}
    }
    if(!positive(line.baseQty)||!nonnegative(line.unitPrice))
      add('INVALID_BASE_SALE_LINE',i);
    if(!identifier(line.stockUnit))add('INVALID_STOCK_UNIT',i);
    if(!['Own','Negative','Vendor'].includes(line.shortageMode))
      add('INVALID_SHORTAGE_MODE',i);

    rows(line.fifoDraws,'FIFO draw');
    let drawn=0;
    const lotIds=new Set();
    for(const draw of line.fifoDraws){
      if(!identifier(draw.lotId)||!positive(draw.baseQty)){
        add('INVALID_FIFO_DRAW',i);continue;
      }
      if(lotIds.has(draw.lotId))add('DUPLICATE_FIFO_LOT',i);
      lotIds.add(draw.lotId);
      drawn+=draw.baseQty;
    }
    if(!nonnegative(line.shortfallBaseQty))add('INVALID_STOCK_SHORTFALL',i);
    if(line.shortageMode==='Own'&&line.shortfallBaseQty!==0)
      add('OWN_MODE_SHORTFALL',i);
    if(positive(line.baseQty)&&nonnegative(line.shortfallBaseQty)&&
       (!Number.isFinite(drawn)||!near(drawn+line.shortfallBaseQty,line.baseQty)))
      add('FIFO_COVERAGE_MISMATCH',i);

    rows(line.unitBreakdownSnapshot,'unit quantity');
    rows(line.unitPricingSnapshot,'unit price');
    const units=line.unitBreakdownSnapshot,prices=line.unitPricingSnapshot;
    if(!units.length&&!prices.length){legacyLines++;continue;}
    unitLines++;
    if(!units.length||!prices.length||units.length!==prices.length){
      add('INCOMPLETE_UNIT_SNAPSHOT',i);continue;
    }

    const conversions=new Set();
    let qty=0,componentsTotal=0,componentsCount=0;
    let quantityValid=true,priceValid=true;
    for(let k=0;k<units.length;k++){
      const unit=units[k],price=prices[k];
      if(!identifier(unit.conversionId)||!identifier(unit.unitName)||
         !positive(unit.factor)||!positive(unit.qty)){
        add('INVALID_UNIT_COMPONENT',i);quantityValid=false;
      }else{
        if(conversions.has(unit.conversionId))add('DUPLICATE_CONVERSION_ID',i);
        conversions.add(unit.conversionId);
        qty+=unit.factor*unit.qty;
      }
      if(unit.conversionId!==price.conversionId||
         unit.unitName!==price.unitName||
         unit.factor!==price.factor||unit.qty!==price.qty)
        add('COMPONENT_IDENTITY_MISMATCH',i);
      if(!nonnegative(price.unitPrice)){add('INVALID_COMPONENT_PRICE',i);priceValid=false;}
      else if(positive(unit.qty)){
        componentsTotal+=unit.qty*price.unitPrice;
        componentsCount+=unit.qty;
      }else priceValid=false;
    }
    if(quantityValid&&positive(line.baseQty)&&
       (!Number.isFinite(qty)||!near(qty,line.baseQty)))
      add('BASE_QUANTITY_MISMATCH',i);
    // Automatic FIFO component rates are rounded to cents. Effective base
    // unitPrice is display-only: baseQty*unitPrice need not equal lineTotal.
    if(priceValid&&amount!==null&&
       (!Number.isFinite(componentsTotal)||
        Math.abs(componentsTotal-amount/100)>0.005*componentsCount+0.01+EPS))
      add('COMPONENT_PRICE_TOTAL_MISMATCH',i);
  }

  const savedSubtotal=paisa(preview.subtotal);
  const discount=paisa(preview.discount);
  const grand=paisa(preview.grandTotal);
  if(savedSubtotal===null||discount===null||grand===null)
    add('INVALID_CHECKOUT_MONEY');
  else{
    if(goodSubtotal&&subtotal!==savedSubtotal)add('SUBTOTAL_MISMATCH');
    if(Math.max(0,savedSubtotal-discount)!==grand)add('GRAND_TOTAL_MISMATCH');
  }

  const allocation=preview.allocation;
  const paid=paisa(allocation.paidAmount),due=paisa(allocation.dueAmount);
  const savedChange=paisa(allocation.changeAmount);
  if(paid===null||due===null||savedChange===null)add('INVALID_PAYMENT_TOTAL');
  else if(grand!==null&&(!Number.isSafeInteger(paid+due)||paid+due!==grand))
    add('PAID_DUE_MISMATCH');
  let appliedTotal=0,changeTotal=0,cashRows=0;
  let validApplied=true,validChange=true;
  const paymentIds=new Set(),paymentOrders=new Set(),positivePayments=[];
  if(allocation.payments.length>20)add('TOO_MANY_PAYMENT_ROWS');
  for(const row of allocation.payments){
    if(!identifier(row.rowId))add('INVALID_PAYMENT_ROW_ID');
    else{
      if(paymentIds.has(row.rowId))add('DUPLICATE_PAYMENT_ROW_ID');
      paymentIds.add(row.rowId);
    }
    const order=row.rowOrder;
    if(!Number.isSafeInteger(order)||order<1||order>20)
      add('INVALID_PAYMENT_ROW_ORDER');
    else{
      if(paymentOrders.has(order))add('DUPLICATE_PAYMENT_ROW_ORDER');
      paymentOrders.add(order);
    }
    const tender=paisa(row.tendered),applied=paisa(row.applied),change=paisa(row.change);
    if(tender===null||applied===null||change===null){
      add('INVALID_PAYMENT_ROW_AMOUNT');validApplied=false;validChange=false;continue;
    }
    if(applied===0&&!(row.method==='Cash'&&tender>0&&change===tender))
      add('UNEXPECTED_ZERO_PAYMENT_ROW');
    if(applied>0)positivePayments.push(row);
    appliedTotal+=applied;
    if(!Number.isSafeInteger(appliedTotal))validApplied=false;
    if(row.method==='Cash'){
      cashRows++;
      if(row.bankAccountId||row.bankAccountName)add('CASH_ACCOUNT_MISMATCH');
      if(tender!==applied+change)add('CASH_TENDER_MISMATCH');
      changeTotal+=change;
      if(!Number.isSafeInteger(changeTotal))validChange=false;
    }else if(row.method==='Bank'||row.method==='Mobile Banking'){
      if(!identifier(row.bankAccountId))add('INVALID_NONCASH_ACCOUNT');
      if(change!==0)add('NONCASH_CHANGE');
      if(tender!==applied)add('NONCASH_TENDER_MISMATCH');
    }else add('UNSUPPORTED_PAYMENT_METHOD');
  }
  if(cashRows>1)add('DUPLICATE_CASH_ROW');
  if(validApplied&&paid!==null&&appliedTotal!==paid)
    add('APPLIED_TOTAL_MISMATCH');
  if(validChange&&savedChange!==null&&changeTotal!==savedChange)
    add('CASH_CHANGE_MISMATCH');
  if(paid!==null&&due!==null){
    const expected=due===0?'Paid':paid===0?'Due':'Partial';
    const expectedType=due===0?'Cash':paid>0?'Partial':'Due';
    if(allocation.paymentStatus!==expected)add('PAYMENT_STATUS_MISMATCH');
    if(allocation.paymentType!==expectedType)add('PAYMENT_TYPE_MISMATCH');
  }
  // Frozen normalizeSalePayments_ uses only positive applied rows for its
  // header. Cash fully returned as change is retained as a child but does
  // not compete with a single positive Bank/Mobile method.
  const sole=positivePayments.length===1?positivePayments[0]:null;
  const expectedMethod=sole?sole.method:positivePayments.length?'Multiple':'';
  if(allocation.paymentMethod!==expectedMethod)add('PAYMENT_METHOD_MISMATCH');
  const expectedAccountId=sole?sole.bankAccountId:'';
  const expectedAccountName=sole?sole.bankAccountName:'';
  if(allocation.bankAccountId!==expectedAccountId||
     allocation.bankAccountName!==expectedAccountName)
    add('PAYMENT_HEADER_ACCOUNT_MISMATCH');
  return {
    ready:issues.length===0,issues,
    summary:{
      lines:preview.lines.length,unitLines,legacyLines,
      subtotal:preview.subtotal,grandTotal:preview.grandTotal,
      paidAmount:allocation.paidAmount,dueAmount:allocation.dueAmount,
      cashChange:allocation.changeAmount
    }
  };
}
