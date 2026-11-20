/**
 * M08 INTERNAL / NONPOSTING: exact-decimal proposal for new empty shops.
 *
 * Business principles approved 20 Nov 2026; specific numeric limits and tie
 * mode are CANDIDATES awaiting distinct owner/M08/M03 technical sign-off.
 * No Worker/RPC/SQL/DB import. Never turn this pure quote into a posting API.
 * Inputs are canonical text, not floating point numbers. Snapshots, actor,
 * tenant, product revisions, source IDs and account backing MUST be verified
 * independently by the eventual M03 SQL-time financial kernel.
 */
const MAX_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const MAX_QUANTITY=1000000000n;
const MAX_UNIT_PRICE=1000000000n;
const MAX_RATIO=(10n**36n)-1n;
const DECIMAL=/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,12})?$/u;
const MINOR=/^(?:0|[1-9][0-9]{0,15})$/u;
const RATIO=/^[1-9][0-9]{0,35}$/u;
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;
const MODES=new Set(['HALF_UP','HALF_EVEN']);

/** Reject accessors, exotic prototypes, unreviewed fields and Promise-shaped inputs. */
function record(value,keys) {
  if(value===null||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Explicit M08 data record required');
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!keys.includes(key)||!d.enumerable||!Object.hasOwn(d,'value'))
      throw new TypeError('Invalid or accessor M08 input');
  }
}
function mode(value){
  if(typeof value!=='string'||!MODES.has(value))
    throw new TypeError('Explicit reviewed rounding mode required');
  return value;
}
const abs=v=>v<0n?-v:v;
function gcd(a,b){a=abs(a);b=abs(b);while(b)[a,b]=[b,a%b];return a||1n;}
function rational(n,d=1n){
  if(typeof n!=='bigint'||typeof d!=='bigint'||d<=0n)
    throw new TypeError('Invalid exact rational');
  const g=gcd(n,d);
  return {n:n/g,d:d/g};
}
const plus=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const minus=(a,b)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const times=(a,b)=>rational(a.n*b.n,a.d*b.d);
const over=(a,b)=>{
  if(b.n<=0n)throw new RangeError('Exact denominator must be positive');
  return rational(a.n*b.d,a.d*b.n);
};
const encoded=x=>({numerator:String(x.n),denominator:String(x.d)});
const nonnegative=(x,label)=>{if(x.n<0n)throw new RangeError('Negative '+label);return x;};

/** Frozen numeric text policy candidate: <=12 integer digits, <=12 decimal digits, no float coercion. */
function decimal(value,{signed=false}={}){
  if(typeof value!=='string'||!DECIMAL.test(value)||(!signed&&value.startsWith('-')))
    throw new TypeError('Canonical exact decimal string required');
  const negative=value.startsWith('-');
  const clean=negative?value.slice(1):value;
  const [integer,part='']=clean.split('.');
  const number=BigInt(integer+part);
  if(negative&&number===0n)throw new TypeError('Negative zero is not a valid source decimal');
  return rational(negative?-number:number,10n**BigInt(part.length));
}
function bounded(value,max,label,{positive=false}={}){
  if(value.n<0n||(positive&&value.n===0n)||value.n>max*value.d)
    throw new RangeError(label+' outside proposed M08 bound');
  return value;
}
function decimalQty(value,{positive=true}={}){
  return bounded(decimal(value),MAX_QUANTITY,'quantity',{positive});
}
function decimalPrice(value){return bounded(decimal(value),MAX_UNIT_PRICE,'unit price');}
function canonicalInteger(value,label,{allowZero=false}={}){
  if(typeof value!=='string'||!MINOR.test(value))
    throw new TypeError('Canonical '+label+' minor-unit string required');
  const n=BigInt(value);
  if(n>MAX_MINOR||(!allowZero&&n===0n))throw new RangeError(label+' outside safe minor-unit bound');
  return n;
}
function ratioFromObject(value){
  record(value,['numerator','denominator']);
  if(typeof value.numerator!=='string'||!RATIO.test(value.numerator)||
      typeof value.denominator!=='string'||!RATIO.test(value.denominator))
    throw new TypeError('Canonical positive exact ratio required');
  const numerator=BigInt(value.numerator),denominator=BigInt(value.denominator);
  if(numerator>MAX_RATIO||denominator>MAX_RATIO)
    throw new RangeError('Unit ratio outside proposed M08 bound');
  return rational(numerator,denominator);
}
function roundedInteger(value,roundingMode){
  mode(roundingMode);
  const n=abs(value.n),div=value.d,base=n/div,rem=n%div;
  const ties=rem*2n===div;
  const grow=rem*2n>div||(ties&&(
    roundingMode==='HALF_UP'||(base%2n===1n)));
  const magnitude=base+(grow?1n:0n);
  return value.n<0n?-magnitude:magnitude;
}
function roundMinor(value,roundingMode){
  const cents=roundedInteger(times(value,rational(100n)),roundingMode);
  if(abs(cents)>MAX_MINOR)throw new RangeError('Rounded amount exceeds safe minor-unit range');
  return cents;
}
function lineQuantity(quantity,unitRatio){
  const source=decimalQty(quantity);
  const physical=unitRatio===undefined?source:times(source,unitRatio);
  return bounded(physical,MAX_QUANTITY,'converted quantity',{positive:true});
}
function priceLineInternal(input,roundingMode){
  // An explicitly present but missing ratio is NOT a valid base-unit intent.
  const ratio=Object.hasOwn(input,'unitRatio')?ratioFromObject(input.unitRatio):undefined;
  const physical=lineQuantity(input.quantity,ratio);
  const cost=decimalPrice(input.unitPrice);
  const value=times(physical,cost);
  const paisa=roundMinor(value,roundingMode);
  return {physical,value,paisa};
}
/** Pure exact source lexical/rational projection; returns no JS BigInt or float. */
export function exactDecimal(value,{signed=false}={}){
  if(typeof signed!=='boolean')throw new TypeError('Explicit signed flag must be boolean');
  return encoded(decimal(value,{signed}));
}
/** A standalone signed rounding probe; posting paths have their own authenticated debit/credit policy. */
export function roundSignedAmountPaisa(value,roundingMode){
  return String(roundMinor(decimal(value,{signed:true}),mode(roundingMode)));
}
/** Price one line with an independently verified unit-ratio snapshot. */
export function quoteExactLine(input){
  record(input,['quantity','unitPrice','unitRatio','roundingMode']);
  const roundingMode=mode(input.roundingMode);
  const row=priceLineInternal(input,roundingMode);
  return {quantitySource:input.quantity,priceSource:input.unitPrice,
    physicalQuantity:encoded(row.physical),exactAmount:encoded(row.value),
    amountPaisa:String(row.paisa)};
}
function checkLines(lines,roundingMode){
  if(!Array.isArray(lines)||lines.length<1||lines.length>200)
    throw new TypeError('One to 200 exact invoice lines required');
  const ids=new Set();
  return lines.map(row=>{
    record(row,['id','quantity','unitPrice','unitRatio']);
    if(typeof row.id!=='string'||!IDENTIFIER.test(row.id)||ids.has(row.id))
      throw new TypeError('Duplicate or invalid immutable line identity');
    ids.add(row.id);
    const calc=priceLineInternal(row,roundingMode);
    return {...row,calc};
  });
}
/**
 * Candidate proportional invoice-net allocation, source subtotal/zero-floor
 * preserved. This is a QUOTE, not approved discount posting or supplier AP.
 * Remaining paisa goes to largest remainders, with stable immutable ID ties.
 */
export function allocateInvoicePaisa(input){
  record(input,['lines','discount','roundingMode']);
  const roundingMode=mode(input.roundingMode);
  const lines=checkLines(input.lines,roundingMode);
  const discount=decimal(input.discount);
  const subtotal=lines.reduce((acc,row)=>plus(acc,row.calc.value),rational(0n));
  // Both gross invoice and discounted grand total must fit the money boundary.
  roundMinor(subtotal,roundingMode);
  const diff=minus(subtotal,discount);
  const grand=diff.n<0n?rational(0n):diff;
  const totalMinor=roundMinor(grand,roundingMode);
  // Source cost and purchase subtotals still need exact audit: never truncate.
  const out=lines.map(row=>{
    const net=subtotal.n===0n?rational(0n):
      times(row.calc.value,over(grand,subtotal));
    const scaled=times(net,rational(100n));
    const whole=scaled.n/scaled.d;
    return {id:row.id,quantitySource:row.quantity,unitPriceSource:row.unitPrice,
      physicalQuantity:encoded(row.calc.physical),exactLineAmount:encoded(row.calc.value),
      netExact:encoded(net),netPaisa:String(whole),
      _floor:whole,_remainder:scaled.n%scaled.d,_denominator:scaled.d};
  });
  let remaining=totalMinor-out.reduce((sum,row)=>sum+row._floor,0n);
  if(remaining<0n||remaining>BigInt(out.length))
    throw new RangeError('Invoice line allocation cannot conserve rounded header');
  const rank=[...out].sort((a,b)=>{
    const left=a._remainder*b._denominator,right=b._remainder*a._denominator;
    if(left!==right)return left>right?-1:1;
    return a.id<b.id?-1:a.id>b.id?1:0;
  });
  for(const row of rank){
    if(remaining<=0n)break;
    row.netPaisa=String(row._floor+1n);remaining--;
  }
  if(remaining!==0n)throw new RangeError('Nonconserving invoice remainder');
  return {discountSource:input.discount,excessDiscount:discount.n*subtotal.d>subtotal.n*discount.d,
    subtotalExact:encoded(subtotal),grandExact:encoded(grand),
    grandPaisa:String(totalMinor),
    lines:out.map(({_floor,_remainder,_denominator,...row})=>row)};
}
/**
 * NEW-SHOP policy candidate: source-compatible per-return rounding except
 * the FINAL eligible return absorbs the already-allocated signed residual.
 * All quantities/cents must come from reviewed original-lot receipts.
 */
export function quoteFinalSupplierReturnPaisa(input){
  record(input,['originalQuantity','alreadyReturnedQuantity','returnedQuantity',
    'allocatedLinePaisa','alreadyCreditedPaisa','roundingMode']);
  const roundingMode=mode(input.roundingMode);
  const original=decimalQty(input.originalQuantity);
  const priorQty=decimalQty(input.alreadyReturnedQuantity,{positive:false});
  const returning=decimalQty(input.returnedQuantity);
  const total=plus(priorQty,returning);
  if(total.n*original.d>original.n*total.d)
    throw new RangeError('Return exceeds original line quantity');
  const credited=canonicalInteger(input.alreadyCreditedPaisa,'already credited',{allowZero:true});
  const allocated=canonicalInteger(input.allocatedLinePaisa,'allocated line',{allowZero:true});
  if(credited>allocated)throw new RangeError('Prior credited amount exceeds original allocation');
  const isFinal=total.n*original.d===original.n*total.d;
  const remaining=allocated-credited;
  const proportion=over(times(rational(allocated),returning),original);
  const normal=roundedInteger(proportion,roundingMode);
  const money=isFinal?remaining:normal>remaining?remaining:normal;
  // Proposed safe review threshold: a last-return correction larger than one
  // paisa indicates accumulated micro-returns or a suspect prior receipt.
  // It needs an explicit M08 policy; never silently award a large last refund.
  if(isFinal&&abs(money-normal)>1n)
    throw new RangeError('Final supplier return residual exceeds one paisa: review required');
  if(money<0n||money>remaining)throw new RangeError('Invalid supplier return allocation');
  return {returnPaisa:String(money),remainingPaisa:String(remaining-money),
    finalReturn:isFinal};
}
/**
 * NEW-SHOP policy candidate only; original legacy Cash returns remain history.
 * Net collected backing must already account for actual voids/chargebacks,
 * previous Cash refunds, invoice links and authoritative SQL-time identity.
 */
export function quoteCashRefundPaisa(input){
  record(input,['returnPaisa','netCashCollectedPaisa',
    'priorCashRefundPaisa','requestedCashRefundPaisa']);
  const eligible=canonicalInteger(input.returnPaisa,'return',{allowZero:true});
  const net=canonicalInteger(input.netCashCollectedPaisa,'net collected',{allowZero:true});
  const prior=canonicalInteger(input.priorCashRefundPaisa,'prior cash refunds',{allowZero:true});
  const requested=canonicalInteger(input.requestedCashRefundPaisa,'requested cash refund',{allowZero:true});
  if(prior>net||requested>net-prior||requested>eligible)
    throw new RangeError('Cash refund exceeds eligible return or verified net money');
  return {cashRefundPaisa:String(requested),storeCreditPaisa:String(eligible-requested),
    remainingCashBackingPaisa:String(net-prior-requested)};
}
