/**
 * M09 internal read-only Cash & Bank Report projection.
 *
 * Source: frozen Reports.gs::getCashBankReport / Utils.gs::roundMoney_.
 * A future approved caller must authenticate and check reports:view,
 * supply already-active Cash Book, all source-equivalent Bank Book rows
 * and all source-equivalent Bank Account rows.
 *
 * No D1, posting, RPC registration, authorization or cache in this module.
 */
import {normalizeReportRange,reportDefaultRange} from './report-date-range.js';

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function field(object,key){
  const desc=Object.getOwnPropertyDescriptor(object,key);
  if(desc && !Object.hasOwn(desc,'value'))
    throw new TypeError('Untrusted Cash Bank Report accessor: '+key);
  return desc?.value;
}
function rows(snapshot,key){
  const value=field(snapshot,key);
  if(!Array.isArray(value))
    throw new TypeError('Trusted Cash Bank Report snapshot needs '+key+' array');
  for(const row of value){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(d=>!Object.hasOwn(d,'value')))
      throw new TypeError('Invalid trusted Cash Bank Report row in '+key);
  }
  return value;
}
function money(value,label){
  if(value!==undefined && value!==null &&
      !['number','string','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted '+label+' amount');
  const n=Number(value);
  if(!Number.isFinite(n) && !Number.isNaN(n))
    throw new TypeError('Expected finite '+label+' amount');
  return n||0;
}
const round=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

function dateOnly(value){
  if(typeof value!=='string'||value.length<10)
    throw new TypeError('Expected canonical Cash Bank Report date prefix');
  const day=value.slice(0,10);
  reportDefaultRange(day); // validates calendar date and canonical YYYY-MM-DD
  return day;
}
function sortedByDateAndId(a,b){
  const ad=dateOnly(field(a,'Date')),bd=dateOnly(field(b,'Date'));
  if(ad!==bd)return ad<bd?-1:1;
  return String(field(a,'Entry ID')||'')
    .localeCompare(String(field(b,'Entry ID')||''));
}
function sortBy(map,key){
  return Object.keys(map).map(k=>map[k])
    .sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0));
}
function numericFields(row){
  money(field(row,'Credit'),'credit');
  money(field(row,'Debit'),'debit');
}

/**
 * Exact source output: {range,cash,banks,bankTotals,combined}.
 * Report combines CASH and BANK books as source; it never automatically
 * nets independent Customer/Supplier/Vendor/Finance Party obligations.
 */
export function projectCashBankReport(snapshot,filters,today){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Cash Bank Report snapshot');
  const cashRows=rows(snapshot,'cashRows');
  const bankRows=rows(snapshot,'bankRows');
  const bankAccounts=rows(snapshot,'bankAccounts');
  const range=normalizeReportRange(filters,today);

  // Validate all trusted source fields, not only the report window.
  for(const row of cashRows){
    dateOnly(field(row,'Date'));
    numericFields(row);
  }
  for(const row of bankRows){
    dateOnly(field(row,'Date'));
    numericFields(row);
  }
  const seenAccounts=new Set();
  for(const acct of bankAccounts){
    money(field(acct,'Opening Balance'),'bank opening');
    money(field(acct,'Current Balance'),'bank current balance');
    if(field(acct,'Status')==='Inactive')continue;
    const key=String(field(acct,'Bank Account ID')||'');
    if(seenAccounts.has(key))
      throw new Error('Duplicate Bank Account ID in Cash Bank Report: '+key);
    seenAccounts.add(key);
  }

  let cashOpening=0;
  const cashInRange=[];
  for(const row of cashRows.slice().sort(sortedByDateAndId)){
    const date=dateOnly(field(row,'Date'));
    const delta=money(field(row,'Credit'),'cash credit')-
      money(field(row,'Debit'),'cash debit');
    if(date<range.from)cashOpening=round(cashOpening+delta);
    else if(date<=range.to)cashInRange.push(row);
  }
  const cashByType=Object.create(null);
  let cashIn=0,cashOut=0;
  for(const row of cashInRange){
    const type=field(row,'Type')||'Other';
    const label=String(type);
    const credit=money(field(row,'Credit'),'cash credit');
    const debit=money(field(row,'Debit'),'cash debit');
    cashIn=round(cashIn+credit);
    cashOut=round(cashOut+debit);
    if(!cashByType[label])
      cashByType[label]={label:type,entries:0,inflow:0,outflow:0,net:0};
    const group=cashByType[label];
    group.entries++;
    group.inflow=round(group.inflow+credit);
    group.outflow=round(group.outflow+debit);
    group.net=round(group.net+credit-debit);
  }
  const cashClosing=round(cashOpening+cashIn-cashOut);

  // The source checks reversal targets across the entire unfiltered
  // BANK_BOOK before filtering statuses, not just within one account.
  const reversalTargets=new Set();
  for(const row of bankRows){
    const reversedId=field(row,'Reversal Of');
    if(reversedId)reversalTargets.add(String(reversedId));
  }
  const reportBankRows=bankRows.filter(row=>
    field(row,'Status')!=='Reversed' ||
    reversalTargets.has(String(field(row,'Entry ID')||'')));

  const banks=bankAccounts
    .filter(acct=>field(acct,'Status')!=='Inactive')
    .map(acct=>{
      const id=field(acct,'Bank Account ID');
      const accountRows=reportBankRows.filter(row=>
        field(row,'Bank Account ID')===id)
        .slice().sort(sortedByDateAndId);
      const hasOpeningRow=accountRows.some(row=>
        field(row,'Type')==='Opening Balance');
      let opening=hasOpeningRow?0:round(money(field(acct,'Opening Balance'),'bank opening'));
      const inRange=[];
      for(const row of accountRows){
        const day=dateOnly(field(row,'Date'));
        const delta=money(field(row,'Credit'),'bank credit')-
          money(field(row,'Debit'),'bank debit');
        if(day<range.from)opening=round(opening+delta);
        else if(day<=range.to)inRange.push(row);
      }
      let inflow=0,outflow=0;
      for(const row of inRange){
        inflow=round(inflow+money(field(row,'Credit'),'bank credit'));
        outflow=round(outflow+money(field(row,'Debit'),'bank debit'));
      }
      return {
        id,
        name:field(acct,'Account Name'),
        bankName:field(acct,'Bank Name')||'',
        opening,inflow,outflow,
        closing:round(opening+inflow-outflow),
        entries:inRange.length,
        currentBalance:round(money(field(acct,'Current Balance'),'bank current balance'))
      };
    });

  const bankTotals=banks.reduce((acc,bank)=>{
    acc.opening=round(acc.opening+bank.opening);
    acc.inflow=round(acc.inflow+bank.inflow);
    acc.outflow=round(acc.outflow+bank.outflow);
    acc.closing=round(acc.closing+bank.closing);
    return acc;
  },{opening:0,inflow:0,outflow:0,closing:0});

  return {
    range,
    cash:{
      opening:cashOpening,
      inflow:cashIn,
      outflow:cashOut,
      closing:cashClosing,
      entries:cashInRange.length,
      byType:sortBy(cashByType,'inflow')
    },
    banks,
    bankTotals,
    combined:{
      opening:round(cashOpening+bankTotals.opening),
      closing:round(cashClosing+bankTotals.closing)
    }
  };
}
