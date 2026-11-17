/**
 * M09 internal Reports control readiness (Issue #431).
 * This is a read-only UI proposal, not authentication, report data, an RPC
 * guard, or a print action. M01 owns frontend wiring.
 */
const PERIOD_TABS=new Set(['rptSales','rptPurchase','rptCashBank','rptProfit']);
const SNAPSHOT_TABS=new Set(['rptStock','rptBalanceSheet']);

function ownRecord(input){
  if(input===null || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid M09 report control input');
  const result=Object.create(null);
  for(const key of Reflect.ownKeys(input)){
    const d=Object.getOwnPropertyDescriptor(input,key);
    if(typeof key!=='string' || !d || !Object.hasOwn(d,'value'))
      throw new TypeError('Invalid M09 report control input');
    result[key]=d.value;
  }
  if(typeof result.reportLoaded!=='boolean' ||
     typeof result.requestPending!=='boolean')
    throw new TypeError('Invalid M09 report control input');
  return result;
}

function calendarDate(value){
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const year=Number(value.slice(0,4));
  const month=Number(value.slice(5,7));
  const day=Number(value.slice(8,10));
  if(year===0 || month<1 || month>12)return false;
  const leap=year%4===0 && (year%100!==0 || year%400===0);
  const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return day>=1 && day<=monthDays[month-1];
}

/**
 * Returns only fixed state codes. loaded/pending must come from the current
 * authenticated tenant + tab lifecycle; a positive UI preview decision
 * NEVER authorizes a report, a financial RPC, or data access.
 */
export function inspectM09ReportControlState(input){
  const value=ownRecord(input);
  const activeTab=value.activeTab;
  const periodApplies=PERIOD_TABS.has(activeTab);
  const snapshot=SNAPSHOT_TABS.has(activeTab);
  let status='VIEW_UP_TO_DATE';
  if(!periodApplies && !snapshot)status='UNKNOWN_REPORT_TAB';
  else if(value.requestPending)status='REPORT_REQUEST_PENDING';
  else if(!value.reportLoaded)status='REPORT_NOT_LOADED';
  else if(periodApplies){
    if(!calendarDate(value.from) || !calendarDate(value.to) ||
      value.from>value.to)
      status='INVALID_REPORT_DATE_WINDOW';
    else if(!calendarDate(value.loadedFrom) ||
       !calendarDate(value.loadedTo) ||
       value.from!==value.loadedFrom || value.to!==value.loadedTo)
      status='REPORT_FILTERS_STALE';
  }
  const printPreviewEligible=status==='VIEW_UP_TO_DATE';
  return Object.freeze({
    activeTab:periodApplies||snapshot?activeTab:null,
    periodApplies,
    status,
    printPreviewEligible,
    needsRun:!printPreviewEligible,
    ready:false,
    authorized:false
  });
}
