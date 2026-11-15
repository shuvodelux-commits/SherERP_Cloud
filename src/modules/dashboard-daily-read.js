/**
 * M09 internal, source-faithful Dashboard operational day totals.
 * Frozen original: Dashboard.gs dashboardTodayCollection_/Expense_/Purchase_.
 * Accept only trusted, already shop-local date-only source-shaped rows.
 * No D1 query, RPC registration, cache, Party balance, financial posting or
 * source time-zone guessing. Full DashboardStats is NOT implemented here.
 */
import {reportDefaultRange} from './report-date-range.js';

const required=['today','todaySales','customerLedgerRows','expenseRows','purchaseRows'];

function trustedRecord(value,context){
  try{
    if(!value || typeof value!=='object' || Array.isArray(value) ||
       (Object.getPrototypeOf(value)!==Object.prototype &&
        Object.getPrototypeOf(value)!==null))
      throw new TypeError('Invalid '+context);
    const desc=Object.getOwnPropertyDescriptors(value);
    for(const [key,d] of Object.entries(desc)){
      if(!Object.hasOwn(d,'value') ||
         d.value!==null &&
         (typeof d.value==='object' || typeof d.value==='function'))
        throw new TypeError('Invalid '+context+' field: '+key);
    }
    return value;
  }catch{
    throw new TypeError('Invalid trusted '+context);
  }
}

function validRows(rows,context){
  if(!Array.isArray(rows))throw new TypeError('Invalid trusted '+context+' rows');
  return rows.map(row=>{
    const value=trustedRecord(row,context+' row');
    if(Object.hasOwn(value,'Date') && value.Date!=='' &&
       value.Date!==undefined && value.Date!==null){
      // No implicit UTC/date-object conversion. The trusted repository must
      // normalize original safeDateOnly_ before calling this read model.
      reportDefaultRange(value.Date);
    }
    return value;
  });
}

function roundMoney(value){
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}
const amount=value=>Number(value)||0;

/**
 * Returns only three source operational metrics, never aggregate Parties,
 * cash/bank balances or full DashboardStats. Input arrays must already be
 * filtered as the frozen source's activeRows_ would filter them.
 */
export function projectDashboardDailyMovements(snapshot){
  const s=trustedRecord(snapshot,'Dashboard snapshot');
  const keys=Reflect.ownKeys(s);
  if(keys.length!==required.length ||
     keys.some(key=>typeof key!=='string'||!required.includes(key)))
    throw new TypeError('Invalid trusted Dashboard snapshot fields');
  reportDefaultRange(s.today);
  const sales=validRows(s.todaySales,'sales');
  const ledger=validRows(s.customerLedgerRows,'customer ledger');
  const expenses=validRows(s.expenseRows,'expense');
  const purchases=validRows(s.purchaseRows,'purchase');

  let collected=sales.reduce((sum,sale)=>
    sum+Math.max(0,amount(sale['Paid Amount'])),0);
  for(const row of ledger){
    if(row.Date!==s.today || row.Type!=='Payment')continue;
    const explicit=row['Payment Amount'];
    const payment=explicit!=='' && explicit!==null && explicit!==undefined
      ?amount(explicit)
      :amount(row.Credit)-amount(row['Discount Amount']);
    collected+=Math.max(0,payment);
  }
  const expenseTotal=expenses.reduce((sum,row)=>
    row.Date!==s.today || row.Status==='Cancelled'
      ?sum:sum+amount(row.Amount),0);
  const purchaseTotal=purchases.reduce((sum,row)=>
    row.Date!==s.today?sum:sum+amount(row['Grand Total']),0);

  return {
    todayCollectionTotal:roundMoney(collected),
    todayExpenseTotal:roundMoney(expenseTotal),
    todayPurchaseTotal:roundMoney(purchaseTotal),
  };
}
