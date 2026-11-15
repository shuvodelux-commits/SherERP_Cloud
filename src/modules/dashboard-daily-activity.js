/**
 * Internal M09 daily operational Dashboard read projection.
 *
 * Mirrors the four daily cards from frozen Dashboard.gs::getDashboardStats.
 * The caller must authorize the read and supply trusted, already-active
 * SALES, SALES_RETURN_ITEMS (whose return parents are also active),
 * CUSTOMER_LEDGER, EXPENSES and PURCHASES rows. This module does not
 * read D1, authenticate, query cash/Party balances or expose an RPC.
 */
import {reportDefaultRange} from './report-date-range.js';

const DATE_ONLY=/^\d{4}-\d{2}-\d{2}$/;
const groups=['sales','salesReturnItems','customerLedger','expenses','purchases'];

function isPlain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function field(row,key){
  const descriptor=Object.getOwnPropertyDescriptor(row,key);
  return descriptor?.value;
}
function trustedRows(snapshot){
  if(!isPlain(snapshot))throw new TypeError('Missing trusted dashboard snapshot');
  const result={};
  for(const name of groups){
    const value=Object.getOwnPropertyDescriptor(snapshot,name);
    if(!value || !Object.hasOwn(value,'value') || !Array.isArray(value.value))
      throw new TypeError('Trusted dashboard snapshot must contain active row arrays: '+name);
    for(const row of value.value){
      if(!isPlain(row) ||
        Object.values(Object.getOwnPropertyDescriptors(row)).some(d=>!Object.hasOwn(d,'value')))
        throw new TypeError('Invalid trusted dashboard row: '+name);
    }
    result[name]=value.value;
  }
  return result;
}
function businessDate(row){
  const value=field(row,'Date');
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string'||!DATE_ONLY.test(value))
    throw new TypeError('Dashboard rows require normalized canonical date-only values');
  reportDefaultRange(value); // Valid canonical shop date, not raw UTC timestamp.
  return value;
}
const number=value=>Number(value)||0;
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

function invoiceIntegrity(sales,todaySales){
  const selected=new Set(todaySales.map(row=>String(field(row,'Invoice ID')||'').trim()).filter(Boolean));
  const count=new Map();
  for(const row of sales){
    const id=String(field(row,'Invoice ID')||'').trim();
    if(id)count.set(id,(count.get(id)||0)+1);
  }
  const duplicates=[...count].filter(([id,total])=>selected.has(id)&&total>1).map(([id])=>id).sort();
  if(duplicates.length)
    throw new Error('Dashboard today sales: Duplicate invoice ID detected: '+duplicates.join(', '));
}

/**
 * Four source-faithful operational cards, using the invoice business date.
 * `today` is explicitly supplied in the authorized shop's local calendar.
 */
export function projectDashboardDailyActivity(snapshot,today){
  reportDefaultRange(today);
  const rows=trustedRows(snapshot);
  const selected=rows.sales.filter(s=>businessDate(s)===today);
  // Reject malformed business dates even on historical active rows.
  for(const sale of rows.sales)businessDate(sale);
  invoiceIntegrity(rows.sales,selected);

  let salesTotal=0;
  if(selected.length){
    const byInvoice=new Map();
    let gross=0,returned=0;
    for(const sale of selected){
      byInvoice.set(String(field(sale,'Invoice ID')),sale);
      gross+=number(field(sale,'Grand Total'));
    }
    for(const item of rows.salesReturnItems){
      const parent=byInvoice.get(String(field(item,'Invoice ID')));
      if(!parent)continue;
      const raw=number(field(item,'Line Total'));
      if(field(item,'Pricing Basis')==='NetAfterInvoiceDiscount'){
        returned+=raw;
      }else{
        const sub=number(field(parent,'Subtotal'));
        const grand=number(field(parent,'Grand Total'));
        returned+=raw*(sub>0?grand/sub:1);
      }
    }
    salesTotal=roundMoney(gross-returned);
  }

  let collected=selected.reduce((sum,s)=>sum+Math.max(0,number(field(s,'Paid Amount'))),0);
  for(const row of rows.customerLedger){
    const date=businessDate(row);
    if(date!==today || field(row,'Type')!=='Payment')continue;
    const raw=field(row,'Payment Amount');
    const money=raw!=='' && raw!==null && raw!==undefined
      ? number(raw)
      : number(field(row,'Credit'))-number(field(row,'Discount Amount'));
    collected+=Math.max(0,money);
  }

  let expense=0;
  for(const row of rows.expenses){
    if(businessDate(row)===today && field(row,'Status')!=='Cancelled')
      expense+=number(field(row,'Amount'));
  }

  let purchase=0;
  for(const row of rows.purchases){
    if(businessDate(row)===today)purchase+=number(field(row,'Grand Total'));
  }

  return {
    todaySalesTotal:salesTotal,
    todayCollectionTotal:roundMoney(collected),
    todayExpenseTotal:roundMoney(expense),
    todayPurchaseTotal:roundMoney(purchase)
  };
}
