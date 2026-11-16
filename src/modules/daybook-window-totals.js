/**
 * M09 INTERNAL Day Book final window/totals projection.
 * Frozen source: Mohim_ERP DayBook.gs filter/totals block and Utils.gs::roundMoney_.
 *
 * Caller MUST supply source-shaped Day Book rows after authorized M04
 * daybook.view check, bank duplicate suppression and Cash Book running
 * balance computation. This pure function cannot authorize data or create
 * missing financial facts. No D1, network, RPC, cache or posting path.
 */
import {reportDefaultRange} from './report-date-range.js';

const FILTER_KEYS=new Set([
  'dateFrom','dateTo','module','paymentMethod','query','backdatedOnly','includeDeleted'
]);
const ROW_KEYS=new Set([
  'ts','date','time','referenceNo','module','transactionType','party',
  'description','paymentMethod','cashIn','cashOut','bankIn','bankOut',
  'amount','createdBy','status','isDeleted','deletedBy','deleteReason',
  'isBackdated','backdatedDays','backdatedReason','sourceModule','sourceId',
  'openPage','openId','deleteModule','deleteId','runningCashBalance'
]);
const MONEY_FIELDS=['cashIn','cashOut','bankIn','bankOut'];
const SEARCH_FIELDS=['referenceNo','party','description','transactionType'];

function ownData(value,label,allowed){
  if(value===null || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    if(typeof key!=='string' || !Object.hasOwn(descriptors[key],'value') ||
      (allowed && !allowed.has(key)))
      throw new TypeError('Invalid trusted Day Book '+label+' fields/accessor');
  }
  return descriptors;
}

function canonicalDate(value,label){
  if(value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value); // Validate calendar date, no timezone parsing.
  return value;
}

function filtersFrom(input){
  const source=input===undefined?{}:input;
  const descriptors=ownData(source,'filters',FILTER_KEYS);
  const string=key=>{
    const value=descriptors[key]?.value;
    if(value===undefined || value===null)return '';
    if(typeof value!=='string')
      throw new TypeError('Invalid Day Book filter '+key);
    return value.trim();
  };
  const bool=key=>{
    const value=descriptors[key]?.value;
    if(value===undefined)return false;
    if(typeof value!=='boolean')
      throw new TypeError('Invalid Day Book filter '+key);
    return value;
  };
  return {
    dateFrom:canonicalDate(string('dateFrom'),'from filter'),
    dateTo:canonicalDate(string('dateTo'),'to filter'),
    module:string('module'),
    paymentMethod:string('paymentMethod'),
    query:string('query').toLowerCase(),
    backdatedOnly:bool('backdatedOnly'),
    includeDeleted:bool('includeDeleted')
  };
}

function sourceRow(value){
  const fields=ownData(value,'row',ROW_KEYS);
  for(const key of ['ts','date','module','paymentMethod',...SEARCH_FIELDS]){
    const content=fields[key]?.value;
    if(typeof content!=='string')
      throw new TypeError('Invalid trusted Day Book row '+key);
  }
  canonicalDate(fields.date.value,'row');
  for(const key of MONEY_FIELDS){
    const value=fields[key]?.value;
    if(typeof value!=='number' || !Number.isFinite(value))
      throw new TypeError('Invalid finite Day Book money '+key);
  }
  for(const key of ['isDeleted','isBackdated']){
    if(typeof fields[key]?.value!=='boolean')
      throw new TypeError('Invalid trusted Day Book row '+key);
  }
  for(const key of ['amount','backdatedDays','runningCashBalance']){
    const value=fields[key]?.value;
    if(value!==undefined && value!==null &&
      (typeof value!=='number' || !Number.isFinite(value)))
      throw new TypeError('Invalid trusted Day Book row '+key);
  }
  return {...value};
}

// Match the pinned source's per-addition rounding, not a single final round.
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

/**
 * @param {object[]} rows - already authorized source-shaped normalized rows
 * @param {object} filters - original browser Day Book filter contract
 * @param {boolean} isAdmin - trusted authenticated actor permission flag
 */
export function projectDayBookWindow(rows,filters={},isAdmin=false){
  if(!Array.isArray(rows))throw new TypeError('Invalid trusted Day Book rows');
  if(typeof isAdmin!=='boolean')
    throw new TypeError('Invalid trusted Day Book isAdmin actor flag');
  const f=filtersFrom(filters);
  const normalized=rows.map(sourceRow);
  const visible=normalized.filter(row=>{
    if(row.isDeleted && !(isAdmin && f.includeDeleted))return false;
    if(f.dateFrom && row.date<f.dateFrom)return false;
    if(f.dateTo && row.date>f.dateTo)return false;
    if(f.module && row.module!==f.module)return false;
    if(f.paymentMethod && row.paymentMethod!==f.paymentMethod)return false;
    if(f.backdatedOnly && !row.isBackdated)return false;
    if(f.query){
      const hay=SEARCH_FIELDS.map(key=>row[key]).join(' ').toLowerCase();
      if(!hay.includes(f.query))return false;
    }
    return true;
  });
  visible.sort((a,b)=>b.ts.localeCompare(a.ts));
  const totals={cashIn:0,cashOut:0,bankIn:0,bankOut:0};
  for(const row of visible){
    if(row.isDeleted)continue;
    for(const key of MONEY_FIELDS)
      totals[key]=roundMoney(totals[key]+row[key]);
  }
  totals.netCash=roundMoney(totals.cashIn-totals.cashOut);
  totals.netBank=roundMoney(totals.bankIn-totals.bankOut);
  return {rows:visible,totals,isAdmin,count:visible.length};
}
