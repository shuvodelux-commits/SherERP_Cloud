/**
 * M09 read-only report date windows.
 * Source semantics: pinned Reports.gs::reportRange_ / inRange_.
 * This is NOT a public RPC, SQL query, authorization decision, or date converter.
 */
const DATE_ONLY=/^\d{4}-\d{2}-\d{2}$/;

function plainRecord(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}

function ownValue(object,key,context){
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor)return undefined;
  if(!Object.hasOwn(descriptor,'value'))
    throw new TypeError('Invalid '+context+': accessors are not trusted');
  return descriptor.value;
}

function trustedToday(today){
  if(typeof today!=='string'||!DATE_ONLY.test(today))
    throw new TypeError('Trusted shop-local today must be YYYY-MM-DD');
  const year=Number(today.slice(0,4));
  const month=Number(today.slice(5,7));
  const day=Number(today.slice(8,10));
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>monthDays[month-1])
    throw new TypeError('Trusted shop-local today is not a valid date');
  return today;
}

function cleanFilterValue(filters,key){
  const value=ownValue(filters,key,'report filters');
  if(value===undefined||value===null)return '';
  if(!['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid report filters: expected primitive from/to values');
  return String(value).trim();
}

function validRange(range){
  if(!plainRecord(range))throw new TypeError('Invalid canonical report range');
  const from=ownValue(range,'from','report range');
  const to=ownValue(range,'to','report range');
  if(typeof from!=='string'||typeof to!=='string'||
    !DATE_ONLY.test(from)||!DATE_ONLY.test(to)||from>to)
    throw new TypeError('Invalid canonical report range');
  return {from,to};
}

/** Match original inclusive, lexicographic report-window semantics. */
export function normalizeReportRange(filters,today){
  const shopToday=trustedToday(today);
  const input=filters==null?{}:filters;
  if(!plainRecord(input))throw new TypeError('Invalid report filters: plain object required');
  const rawFrom=cleanFilterValue(input,'from');
  const rawTo=cleanFilterValue(input,'to');
  let from=DATE_ONLY.test(rawFrom)?rawFrom:shopToday.slice(0,8)+'01';
  let to=DATE_ONLY.test(rawTo)?rawTo:shopToday;
  if(from>to)[from,to]=[to,from];
  return {from,to};
}

/** Mirrors the original report bootstrap defaults using trusted shop time. */
export function reportDefaultRange(today){
  const value=trustedToday(today);
  return {defaultFrom:value.slice(0,8)+'01',defaultTo:value};
}

/** Already-normalized row dates only: never compare a raw timestamp. */
export function dateInReportRange(dateOnly,range){
  const {from,to}=validRange(range);
  if(dateOnly==='')return false;
  if(typeof dateOnly!=='string'||!DATE_ONLY.test(dateOnly))
    throw new TypeError('Expected normalized canonical report date');
  return dateOnly>=from&&dateOnly<=to;
}
