import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const functionBody=(source,name)=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start!==-1,'Missing pinned GAS source: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated pinned GAS source function: '+name);
  return source.slice(start,end+2);
};
const original=[
  ...['roundMoney_','economicReturnLineAmount_',
    'duplicateSalesInvoiceIdMap_','assertUniqueSalesInvoiceIds_'].map(name=>functionBody(utils,name)),
  ...['dashboardTodayNetSales_','dashboardTodayCollection_',
    'dashboardTodayExpense_','dashboardTodayPurchase_','getDashboardStats'].map(name=>functionBody(dashboard,name))
].join('\n');

const empty=()=>({sales:[],salesReturnItems:[],customerLedger:[],expenses:[],purchases:[]});
const base=()=>({
  sales:[
    {'Invoice ID':'INV-A','Date':'2026-11-15','Created At':'2026-11-10',
      'Subtotal':200,'Grand Total':180,'Paid Amount':50},
    {'Invoice ID':'INV-B','Date':'2026-11-15','Subtotal':20,'Grand Total':20,'Paid Amount':5},
    {'Invoice ID':'INV-C','Date':'2026-11-14','Subtotal':500,'Grand Total':500,'Paid Amount':200}
  ],
  salesReturnItems:[
    {'Return ID':'RET-1','Invoice ID':'INV-A','Line Total':100,'Pricing Basis':''},
    {'Return ID':'RET-2','Invoice ID':'INV-B','Line Total':2,'Pricing Basis':'NetAfterInvoiceDiscount'},
    {'Return ID':'RET-3','Invoice ID':'INV-C','Line Total':50,'Pricing Basis':'NetAfterInvoiceDiscount'}
  ],
  customerLedger:[
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':20,'Credit':100,'Discount Amount':80},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':'','Credit':60,'Discount Amount':10},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':0,'Credit':100},
    {'Date':'2026-11-15','Type':'Advance Refund','Payment Amount':100},
    {'Date':'2026-11-14','Type':'Payment','Payment Amount':500},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':-30},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':null,'Credit':40,'Discount Amount':60}
  ],
  expenses:[
    {'Date':'2026-11-15','Amount':70,'Status':'Approved'},
    {'Date':'2026-11-15','Amount':999,'Status':'Cancelled'},
    {'Date':'2026-11-14','Amount':20,'Status':'Approved'}
  ],
  purchases:[
    {'Date':'2026-11-15','Grand Total':300},
    {'Date':'2026-11-14','Grand Total':999}
  ]
});
const clone=x=>JSON.parse(JSON.stringify(x));

function sourceOracle(snapshot,today){
  const groups={
    SALES:snapshot.sales,
    CUSTOMER_LEDGER:snapshot.customerLedger,
    EXPENSES:snapshot.expenses,
    PURCHASES:snapshot.purchases,
    CUSTOMERS:[],SUPPLIERS:[],PRODUCTS:[],FINANCE_TRANSACTIONS:[]
  };
  const env={
    activeRows_:key=>{assert.ok(Object.hasOwn(groups,key),'Unexpected native table '+key);return groups[key];},
    activeSalesReturnItems_:()=>snapshot.salesReturnItems,
    requirePermission_:(token,module,action)=>{assert.equal(module,'dashboard');assert.equal(action,'view');return {};},
    formatDate_:()=>today,
    safeDateOnly_:v=>v==null?'':String(v).slice(0,10),
    financeBalanceSummary_:()=>({borrowerReceivable:0,outstandingLoan:0}),
    getSettingsMap_:()=>({'Currency Symbol':'৳'}),
    getCashBalance_:()=>0,
    ok_:v=>v,
    fail_:message=>{throw new Error(message);},
    logError_:()=>{}
  };
  const originalResult=runInNewContext(original+'\ngetDashboardStats("test-token")',env);
  return clone({
    todaySalesTotal:originalResult.todaySalesTotal,
    todayCollectionTotal:originalResult.todayCollectionTotal,
    todayExpenseTotal:originalResult.todayExpenseTotal,
    todayPurchaseTotal:originalResult.todayPurchaseTotal
  });
}
const impl=await import('../src/modules/dashboard-daily-activity.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot,today){
  assert.equal(typeof impl?.projectDashboardDailyActivity,'function','M09 dashboard daily adapter not implemented');
  return impl.projectDashboardDailyActivity(snapshot,arguments.length<2?'2026-11-15':today);
}
function matchesSource(snapshot,today='2026-11-15'){
  const expected=sourceOracle(snapshot,today);
  const actual=project(snapshot,today);
  assert.deepEqual(actual,expected);
  return actual;
}

test('source getDashboardStats: four cards retain return discounts and cash/payment fallback',()=>{
  const actual=matchesSource(base());
  assert.deepEqual(actual,{
    todaySalesTotal:108,
    todayCollectionTotal:125,
    todayExpenseTotal:70,
    todayPurchaseTotal:300
  });
});

test('source parity: original business date beats Created At and later return date',()=>{
  const s=base();
  s.sales[0]['Date']='2026-11-14'; // Invoice A entered a day after its backdated business date.
  const actual=matchesSource(s);
  assert.equal(actual.todaySalesTotal,18); // Only B minus its net return.
  assert.equal(actual.todayCollectionTotal,75); // Only B POS paid plus today's ledger money.
  s.salesReturnItems[0]['Date']='2026-11-15'; // Return today, original invoice yesterday.
  assert.equal(matchesSource(s).todaySalesTotal,18);
  s.sales[0]['Date']='2026-11-15';
  assert.equal(matchesSource(s).todaySalesTotal,108);
});

test('source parity: old return rows use parent discount, new rows do not double-discount',()=>{
  const s=base();
  s.salesReturnItems[0]['Pricing Basis']='NetAfterInvoiceDiscount';
  assert.equal(matchesSource(s).todaySalesTotal,98);
  s.salesReturnItems[0]['Pricing Basis']='';
  s.sales[0]['Subtotal']=0;
  assert.equal(matchesSource(s).todaySalesTotal,98); // zero subtotal falls back to undiscounted factor 1
});

test('source parity: rounded cents, negative receipts, legacy fallback and canceled expenses',()=>{
  const s=empty();
  s.sales=[
    {'Invoice ID':'A','Date':'2026-11-15','Grand Total':'0.105','Paid Amount':'0.105'},
    {'Invoice ID':'B','Date':'2026-11-15','Grand Total':'0.125','Paid Amount':'-100'}
  ];
  s.customerLedger=[
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':'','Credit':3.125,'Discount Amount':1.1},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':-5,'Credit':1000},
    {'Date':'2026-11-16','Type':'Payment','Payment Amount':100}
  ];
  s.expenses=[
    {'Date':'2026-11-15','Amount':10.125},
    {'Date':'2026-11-15','Amount':50,'Status':'Cancelled'},
    {'Date':'2026-11-15','Amount':'2.2'}
  ];
  s.purchases=[{'Date':'2026-11-15','Grand Total':'5.235'}];
  matchesSource(s);
});

test('source parity: empty day, other-day records and blank dates yield exact zero cards',()=>{
  matchesSource(empty());
  const s=base();
  const actual=matchesSource(s,'2026-11-16');
  assert.deepEqual(actual,{todaySalesTotal:0,todayCollectionTotal:0,todayExpenseTotal:0,todayPurchaseTotal:0});
  for(const rows of [s.sales,s.customerLedger,s.expenses,s.purchases])for(const row of rows)row.Date='';
  matchesSource(s,'2026-11-15');
});

test('selected-today invoice duplicate fails closed even when other occurrence is on another date',()=>{
  const s=base();
  s.sales.push({...s.sales[0],Date:'2026-11-13'});
  assert.throws(()=>sourceOracle(s,'2026-11-15'),/Duplicate invoice ID/);
  assert.throws(()=>project(s),/duplicate invoice/i);
  const other=base();
  other.sales.push({...other.sales[2],Date:'2026-11-13'});
  matchesSource(other); // unrelated historical duplicate is outside the source selected-today guard
});

test('trusted active-row snapshots reject noncanonical row dates, malformed date, Promises and accessors',()=>{
  const s=base();
  s.customerLedger[0].Date='2026-11-15T00:01:00Z';
  assert.throws(()=>project(s),/date|normalized|canonical/i);
  s.customerLedger[0].Date='2026-11-15';
  for(const today of ['',undefined,'2026-02-30','2026-11-15T00:00:00Z'])
    assert.throws(()=>project(s,today),/today|trusted|date/i);
  for(const broken of [{},null,undefined,{...s,sales:Promise.resolve([])},{...s,sales:[null]},
    {...s,expenses:undefined}])
    assert.throws(()=>project(broken),/snapshot|array|row|trusted/i);
  const accessor={...s, get sales(){throw Error('must not call getter');}};
  assert.throws(()=>project(accessor),/snapshot|trusted|accessor/i);
});

test('no input mutation and no bundled authorization, D1 query, or live Dashboard RPC',()=>{
  const s=base(),before=clone(s);
  matchesSource(s);
  assert.deepEqual(s,before);
  assert.equal(typeof impl?.projectDashboardDailyActivity,'function');
  const file=readFileSync(new URL('../src/modules/dashboard-daily-activity.js',import.meta.url),'utf8');
  assert.doesNotMatch(file,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(file,/getDashboardStats\s*\(/);
});
