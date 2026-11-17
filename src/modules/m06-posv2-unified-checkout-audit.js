/**
 * M06 PRIVATE: audit a previously quoted POS V2 Standard/Tile checkout.
 *
 * This is diagnostic display evidence only. It never loads current catalog
 * prices, authenticates an actor, authorizes Cash Session, accesses D1,
 * posts an invoice, or repairs historical sales. M03 must independently
 * re-plan all trusted quantities/prices in its single SQL-atomic writer.
 *
 * Original: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Units: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 */
import {salePaymentPaisa_} from './sale-payments.js';

const DIGITS=/^(?:0|[1-9][0-9]*)$/u;
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const PRIVATE_FIELDS=[
 'fifoDraws','stockLots','purchasePrice','purchaseCost','vendorCost',
 'actorId','sessionId','customerId','tenantId','DB','sourceRows'
];

function data(value,label){
 if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
   throw new TypeError('Invalid trusted '+label+' record');
 for(const key of Reflect.ownKeys(value)){
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))
    throw new TypeError('Invalid trusted '+label+' accessor');
 }
}
function array(value,label){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
  throw new TypeError('Invalid trusted '+label+' list');
 const d=Object.getOwnPropertyDescriptors(value);
 if(Object.values(d).some(x=>!Object.hasOwn(x,'value'))||
    Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).includes(false))
  throw new TypeError('Invalid trusted '+label+' accessor or sparse list');
 for(const item of value)data(item,label+' row');
}
function cents(value){
 try{return BigInt(salePaymentPaisa_(value,'Checkout audit amount',false));}
 catch{return null;}
}
function savedCents(value){
 if(typeof value!=='string'||!DIGITS.test(value))return null;
 const n=BigInt(value);
 return n<=MAX?n:null;
}
function count(value,zeroAllowed){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const raw=String(value);
 if(!DIGITS.test(raw))return null;
 const n=BigInt(raw);
 return n<=MAX&&(zeroAllowed||n>0n)?n:null;
}
function ratio(value,label){
 data(value,label);
 return savedCents(value.numerator)!==null&&
  savedCents(value.denominator)!==null&&BigInt(value.denominator)>0n;
}
function finitePositive(value){
 return typeof value==='number'&&Number.isFinite(value)&&value>0;
}
function same(a,b){return a!==null&&b!==null&&a===b;}

/**
 * Check an M06 read-only private checkout without making it postable.
 * Invalid numeric or domain evidence returns a stable diagnostic issue.
 * Accessors and non-data records are rejected before nested field access.
 *
 * @returns {{ready:boolean,issues:Array<{code:string,line?:number}>,
 * summary:{lineCount:number,grandAmountMinor:string|null,
 * paidAmountMinor:string|null,changeAmountMinor:string|null}}}
 */
export function auditPosV2UnifiedCheckoutSnapshot(preview){
 data(preview,'POS V2 checkout');
 data(preview.allocation,'POS V2 payment allocation');
 array(preview.lines,'POS V2 sale line');
 array(preview.allocation.payments,'POS V2 payment');
 const issues=[],flag=(code,line)=>issues.push(
  line===undefined?{code}:{code,line});
 if(preview.postingAllowed!==false||
    preview.stockAuthority!=='not-loaded')flag('POSTING_AUTHORITY');
 if(!preview.lines.length||preview.lines.length>100)flag('INVALID_LINE_COUNT');

 const ids=new Set();
 let subtotal=0n,validLines=true;
 for(const [i,line] of preview.lines.entries()){
  if(line.postingAllowed!==false||line.stockAuthority!=='not-loaded')
   flag('POSTING_AUTHORITY',i);
  if(PRIVATE_FIELDS.some(key=>Object.hasOwn(line,key)))
   flag('PRIVATE_POSTING_EVIDENCE',i);
  if(typeof line.productId!=='string'||!line.productId.trim())
   flag('INVALID_PRODUCT',i);
  else{
   if(ids.has(line.productId))flag('DUPLICATE_PRODUCT',i);
   ids.add(line.productId);
  }
  if(!finitePositive(line.baseQty)||!line.stockUnit)
   flag('INVALID_BASE_QUANTITY',i);
  const exact=savedCents(line.lineAmountMinor);
  const displayed=cents(line.lineTotal);
  if(exact===null||!same(exact,displayed)){
   flag('LINE_AMOUNT_MISMATCH',i);
   validLines=false;
  }else{
   subtotal+=exact;
   if(subtotal>MAX){
    flag('SUBTOTAL_OVERFLOW',i);
    validLines=false;
   }
  }

  if(line.kind==='Standard'){
   array(line.unitBreakdownSnapshot,'POS V2 saved unit breakdown');
   array(line.unitPricingSnapshot,'POS V2 saved unit prices');
   if(line.unitBreakdownSnapshot.length!==line.unitPricingSnapshot.length)
    flag('STANDARD_PRICE_SNAPSHOT_MISMATCH',i);
   if(line.unitBreakdownSnapshot.length){
    let base=0,valid=true;
    for(const part of line.unitBreakdownSnapshot){
     const q=Number(part.qty),factor=Number(part.factor);
     if(!Number.isFinite(q)||q<=0||!Number.isFinite(factor)||factor<=0){
      valid=false;break;
     }
     base+=q*factor;
    }
    if(!valid||!Number.isFinite(base)||
      !finitePositive(line.baseQty)||Math.abs(base-line.baseQty)>1e-7)
     flag('STANDARD_BASE_MISMATCH',i);
   }
  }else if(line.kind==='Tile'){
   data(line.measurementSnapshot,'POS V2 Tile measurement');
   data(line.requestSnapshot,'POS V2 Tile request');
   data(line.priceSnapshot,'POS V2 Tile price');
   const boxes=count(line.boxes,true),extra=count(line.extraPieces,true);
   const perBox=count(line.measurementSnapshot.piecesPerBox,false);
   const pieces=finitePositive(line.baseQty)&&Number.isSafeInteger(line.baseQty)
     ?BigInt(line.baseQty):null;
   if(boxes===null||extra===null||perBox===null||pieces===null||
     boxes*perBox+extra!==pieces)
    flag('TILE_PACK_MISMATCH',i);
   if(!ratio(line.actualSqft,'POS V2 Tile actual area')||
      (line.requestedSqft!==null&&
       !ratio(line.requestedSqft,'POS V2 Tile requested area')))
    flag('INVALID_TILE_AREA',i);
   if(typeof line.tileRevision!=='string'||!line.tileRevision.trim())
    flag('INVALID_TILE_REVISION',i);
  }else flag('UNSUPPORTED_LINE_KIND',i);
 }

 const savedSubtotal=cents(preview.subtotal);
 const discount=cents(preview.discount);
 const grand=cents(preview.grandTotal);
 if(validLines&&savedSubtotal!==subtotal)flag('SUBTOTAL_MISMATCH');
 if(savedSubtotal===null||discount===null||grand===null||
    (savedSubtotal>discount?savedSubtotal-discount:0n)!==grand)
  flag('GRAND_TOTAL_MISMATCH');

 const pay=preview.allocation;
 const paid=cents(pay.paidAmount),due=cents(pay.dueAmount),
  change=cents(pay.changeAmount);
 if(paid===null||due===null||grand===null||paid+due!==grand)
  flag('PAYMENT_TOTAL_MISMATCH');
 let applied=0n,changes=0n;
 const paymentIds=new Set(),paymentOrders=new Set();
 let cashCount=0;
 if(pay.payments.length>20)flag('TOO_MANY_PAYMENTS');
 for(const p of pay.payments){
  if(typeof p.rowId!=='string'||!p.rowId.trim()||
     paymentIds.has(p.rowId))flag('DUPLICATE_PAYMENT_ID');
  paymentIds.add(p.rowId);
  if(!Number.isSafeInteger(p.rowOrder)||p.rowOrder<1||
     p.rowOrder>20||paymentOrders.has(p.rowOrder))
   flag('INVALID_PAYMENT_ORDER');
  paymentOrders.add(p.rowOrder);
  const tender=cents(p.tendered),taken=cents(p.applied),returned=cents(p.change);
  if(tender===null||taken===null||returned===null){
   flag('INVALID_PAYMENT_AMOUNT');continue;
  }
  applied+=taken;
  if(p.method==='Cash'){
   cashCount++;
   if(p.bankAccountId||p.bankAccountName||tender!==taken+returned)
    flag('CASH_TENDER_MISMATCH');
   changes+=returned;
  }else if(p.method==='Bank'||p.method==='Mobile Banking'){
   if(!p.bankAccountId||tender!==taken||returned!==0n)
    flag('NONCASH_PAYMENT_MISMATCH');
  }else flag('INVALID_PAYMENT_METHOD');
 }
 if(cashCount>1)flag('MULTIPLE_CASH_ROWS');
 if(paid===null||applied!==paid||applied>MAX)
  flag('APPLIED_TOTAL_MISMATCH');
 if(change===null||changes!==change||changes>MAX)
  flag('CHANGE_TOTAL_MISMATCH');
 if(paid!==null&&due!==null){
  const expected=due===0n?'Paid':paid===0n?'Due':'Partial';
  if(pay.paymentStatus!==expected)flag('PAYMENT_STATUS_MISMATCH');
 }
 return {
  ready:issues.length===0,issues,
  summary:{
   lineCount:preview.lines.length,
   grandAmountMinor:grand===null?null:String(grand),
   paidAmountMinor:paid===null?null:String(paid),
   changeAmountMinor:change===null?null:String(change)
  }
 };
}
