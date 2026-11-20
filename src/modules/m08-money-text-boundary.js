/**
 * M08 INTERNAL / NONPOSTING: canonical BDT-paisa/legacy M06 Number boundary.
 *
 * This does not alter the original M06 source-faithful split-payment helper,
 * introduce a posting engine, or authorize operational accounting writes.
 * The owner has NOT signed monetary scales/tie mode/maximum yet (M08 #66).
 */
import {normalizeSalePayments_} from './sale-payments.js';

const MAX_SAFE_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const MINOR=/^-?(?:0|[1-9][0-9]{0,15})$/u;
const BDT=/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/u;
const abs=x=>x<0n?-x:x;

/** No accessors or unusual prototypes may reach the source payment helper. */
function dataRecord(value,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Plain '+label+' data record required');
  for(const key of Reflect.ownKeys(value)){
    const desc=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!desc.enumerable||!Object.hasOwn(desc,'value'))
      throw new TypeError('Plain '+label+' data record required');
  }
}
function dataArray(value,label){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
      Object.keys(value).length!==value.length ||
      Array.from({length:value.length},(_,i)=>Object.hasOwn(value,i)).some(x=>!x))
    throw new TypeError('Dense '+label+' data array required');
  for(const row of value)dataRecord(row,label);
}
function paisa(value,{signed=false}={}){
  if(typeof value!=='string'||!MINOR.test(value)||
      (value.startsWith('-')&&!signed))
    throw new TypeError('Canonical nonnegative integer-paisa text required');
  const n=BigInt(value);
  if(value.startsWith('-')&&n===0n)
    throw new TypeError('Negative zero is not canonical money');
  if(abs(n)>MAX_SAFE_MINOR)
    throw new TypeError('Paisa amount outside the candidate safe integer boundary');
  return n;
}
function bdt(value,{signed=false}={}){
  if(typeof value!=='string'||!BDT.test(value)||
      (value.startsWith('-')&&!signed))
    throw new TypeError('Canonical nonnegative BDT money text required');
  const negative=value.startsWith('-'),raw=negative?value.slice(1):value;
  const [whole,decimal='']=raw.split('.');
  const n=BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0')||'0');
  if(negative&&n===0n)throw new TypeError('Negative zero is not canonical money');
  if(n>MAX_SAFE_MINOR)throw new RangeError('BDT money exceeds candidate safe minor-unit bound');
  return negative?-n:n;
}

/** Precise string-only serializer for BDT: never divide with IEEE-754 Number. */
export function minorPaisaToBdtText(value,{signed=false}={}){
  const cents=paisa(value,{signed});
  const digits=abs(cents);
  return (cents<0n?'-':'')+
    String(digits/100n)+'.'+String(digits%100n).padStart(2,'0');
}
/** Precise string-only parser, allowing one or two fractional BDT digits. */
export function bdtTextToMinorPaisa(value,{signed=false}={}){
  return String(bdt(value,{signed}));
}
function resultMinor(value,label){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)
    throw new RangeError('Lossy M06 '+label+' number: invalid source result');
  try{return bdt(String(value));}
  catch{throw new RangeError('Lossy M06 '+label+' number: minor-unit round-trip mismatch');}
}

/**
 * A guard at a PURE/TEST-only M06 interop boundary, not M03 SQL authorization.
 * If M06 emitted Number values cannot be reconstructed to whole paisa and
 * conserved exactly, fail before any future financial writer could use them.
 * Do not trust the bank account list without separate M04/D1 verification.
 */
export function auditM06MoneyNumbers(input){
  dataRecord(input,'payment audit');
  const permitted=['grandPaisa','payments','accountRows'];
  if(Reflect.ownKeys(input).some(k=>!permitted.includes(k)))
    throw new TypeError('Unknown M08 payment audit input');
  const grand=paisa(input.grandPaisa);
  dataArray(input.payments,'payment instruction');
  dataArray(input.accountRows,'account snapshot');
  if(input.payments.length>20)throw new RangeError('Too many M06 payment rows');
  const exactInstructions=new Map();
  for(const row of input.payments){
    if(typeof row.amount!=='string')
      throw new TypeError('Money tender must be canonical BDT text, not Number');
    const requested=bdt(row.amount);
    if(typeof row.id!=='string'||!row.id||row.id.trim()!==row.id||
        exactInstructions.has(row.id))
      throw new TypeError('Missing, duplicate, or noncanonical payment row ID');
    exactInstructions.set(row.id,{method:row.method,tendered:requested});
  }
  const original=normalizeSalePayments_(
    minorPaisaToBdtText(input.grandPaisa),input.payments,input.accountRows
  );
  const paid=resultMinor(original.paidAmount,'paid');
  const due=resultMinor(original.dueAmount,'due');
  const cashChange=resultMinor(original.changeAmount,'cash change');
  const legs=original.payments.map(row=>{
    dataRecord(row,'normalized payment');
    const applied=resultMinor(row.applied,'applied');
    const tendered=resultMinor(row.tendered,'tendered');
    const change=resultMinor(row.change,'leg change');
    const requested=exactInstructions.get(row.rowId);
    if(!requested||requested.method!==row.method||requested.tendered!==tendered)
      throw new RangeError('Lossy M06 tender intent: source output differs from exact instruction');
    if(!['Cash','Bank','Mobile Banking'].includes(row.method))
      throw new RangeError('M06 payment method is not supported');
    if(row.method==='Cash'){
      if(tendered!==applied+change)
        throw new RangeError('Lossy M06 Cash tender/apply/change mismatch');
    }else if(change!==0n||tendered!==applied){
      throw new RangeError('Lossy M06 non-Cash payment mismatch');
    }
    return Object.freeze({
      rowId:row.rowId,method:row.method,bankAccountId:row.bankAccountId||'',
      tenderedPaisa:String(tendered),appliedPaisa:String(applied),
      changePaisa:String(change)
    });
  });
  if(legs.filter(x=>x.method==='Cash').length>1)
    throw new RangeError('M06 returned multiple Cash rows');
  const totalApplied=legs.reduce((s,x)=>s+BigInt(x.appliedPaisa),0n);
  const totalChange=legs.reduce((s,x)=>
    s+(x.method==='Cash'?BigInt(x.changePaisa):0n),0n);
  if(paid+due!==grand||paid!==totalApplied||cashChange!==totalChange)
    throw new RangeError('Lossy M06 payment amount: exact paisa conservation mismatch');
  return Object.freeze({
    grandPaisa:String(grand),paidPaisa:String(paid),duePaisa:String(due),
    cashChangePaisa:String(cashChange),legs:Object.freeze(legs),
    safeForM08SyntheticReview:true,nonPostingOnly:true
  });
}
