/**
 * M09 INTERNAL source-shaped Day Book running drawer balance.
 * Frozen original: DayBook.gs running-cash block, dayBookTimeFromTs_,
 * Utils.gs::roundMoney_. Source rows must already be authorized and complete.
 *
 * No D1, RPC, cache, time-of-day fallback, financial posting or Party netting.
 */
import {reportDefaultRange} from './report-date-range.js';

const TIME=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT=/^\d{4}-\d{2}-\d{2}T00:00:00$/;
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

function copyRecord(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' row');
  const out=Object.create(null);
  const fields=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(fields)){
    if(typeof key!=='string' || !Object.hasOwn(fields[key],'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' row accessor');
    const item=fields[key].value;
    if(item!==null && item!==undefined &&
       !['string','number','boolean'].includes(typeof item))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof item==='number' && !Number.isFinite(item))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    out[key]=item;
  }
  return out;
}

function recordArray(input,label){
  if(!Array.isArray(input))
    throw new TypeError('Invalid trusted Day Book '+label+' array');
  const desc=Object.getOwnPropertyDescriptors(input);
  for(const [key,field] of Object.entries(desc)){
    if(key==='length')continue;
    if(!/^(?:0|[1-9]\d*)$/.test(key) || !Object.hasOwn(field,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' array field');
  }
  if(Object.keys(desc).length!==input.length+1)
    throw new TypeError('Invalid incomplete Day Book '+label+' array');
  return Array.from(input,entry=>copyRecord(entry,label));
}

function validDate(value,label){
  if(typeof value!=='string' || !DAY.test(value))
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value);
  return value;
}

function validStamp(value,label,{allowDay=false,allowEmpty=false,allowMidnight=false}={}){
  if(allowEmpty && value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  if(allowDay && DAY.test(value))return validDate(value,label);
  if(allowMidnight && MIDNIGHT.test(value)){
    validDate(value.slice(0,10),label);
    return value;
  }
  if(!TIME.test(value))
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  validDate(value.slice(0,10),label);
  return value;
}

function safeReference(value,label){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string' && !(typeof value==='number' && Number.isFinite(value)))
    throw new TypeError('Invalid Day Book '+label+' reference');
  const ref=String(value);
  if(ref in Object.prototype)
    throw new TypeError('Unsafe Day Book '+label+' reference');
  return ref;
}

function cashMoney(value,key){
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new TypeError('Invalid Day Book Cash Book money '+key);
  const n=Number(value);
  if(!Number.isFinite(n))
    throw new TypeError('Invalid finite Day Book Cash Book money '+key);
  return n;
}

function validSource(row){
  row.ts=validStamp(row.ts,'transaction',{allowDay:true});
  if(typeof row.time!=='string')
    throw new TypeError('Invalid Day Book source time');
  if(typeof row.isDeleted!=='boolean')
    throw new TypeError('Invalid Day Book source deleted flag');
  safeReference(row.referenceNo,'source');
  for(const key of ['cashIn','cashOut']){
    if(typeof row[key]!=='number' || !Number.isFinite(row[key]))
      throw new TypeError('Invalid Day Book source money '+key);
  }
  return row;
}

function validCashBook(row){
  const ref=safeReference(row.Reference,'Cash Book');
  const postedAt=validStamp(row['Created At']??'','cash posting',{allowEmpty:true});
  const businessDate=validStamp(row.Date,'cash business',{allowDay:true,allowMidnight:true});
  const credit=cashMoney(row.Credit,'Credit'),debit=cashMoney(row.Debit,'Debit');
  return {ref,postedAt,businessDate,delta:credit-debit};
}

function timeFromTs(ts){
  if(!ts)return '';
  const index=String(ts).indexOf('T');
  return index===-1?'':String(ts).slice(index+1);
}

/**
 * Original chronological pre-filter result. All prior movements affect a
 * later row's balance, even if that row is subsequently filtered out.
 */
export function projectDayBookRunningCash(rows,cashBookRows){
  const transactions=recordArray(rows,'transactions').map(validSource);
  const movements=recordArray(cashBookRows,'cash movements').map(validCashBook);

  transactions.sort((a,b)=>a.ts.localeCompare(b.ts));

  // Source uses last live cash-bearing occurrence of each document ref.
  const sourceByRef=new Map();
  transactions.forEach((row,index)=>{
    const ref=safeReference(row.referenceNo,'source');
    if(ref && row.ts && (row.cashIn || row.cashOut) && !row.isDeleted)
      sourceByRef.set(ref,{ts:row.ts,index});
  });

  const cashBookSorted=movements.map(m=>{
    const source=sourceByRef.get(m.ref);
    const nearSource=!!(m.postedAt && source &&
      Math.abs(new Date(m.postedAt).getTime() -
        new Date(source.ts).getTime())<=30000);
    const dateOnly=DAY.test(m.businessDate)||MIDNIGHT.test(m.businessDate);
    const ts=nearSource?source.ts:
      (m.postedAt || (dateOnly && source ? source.ts : m.businessDate));
    return {
      ts,
      sourceIndex:source && source.ts===ts?source.index:-1,
      delta:m.delta
    };
  }).sort((a,b)=>a.ts.localeCompare(b.ts)||a.sourceIndex-b.sourceIndex);

  let pointer=0,currentBalance=null;
  transactions.forEach((row,index)=>{
    while(pointer<cashBookSorted.length &&
      (cashBookSorted[pointer].ts<row.ts ||
       (cashBookSorted[pointer].ts===row.ts &&
        cashBookSorted[pointer].sourceIndex<=index))){
      currentBalance=roundMoney(
        (currentBalance===null?0:currentBalance)+cashBookSorted[pointer].delta
      );
      pointer++;
    }
    row.runningCashBalance=currentBalance;
    if(!row.time)row.time=timeFromTs(row.ts);
  });
  return transactions;
}
