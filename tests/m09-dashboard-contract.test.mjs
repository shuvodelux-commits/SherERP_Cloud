import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const gas=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../legacy/source/dashboard.html',import.meta.url),'utf8');
function nativeFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start!==-1,'Pinned GAS source missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract '+name+' from frozen source');
  return source.slice(start,end+2);
}
const original=[
  ...['roundMoney_','economicReturnLineAmount_','duplicateSalesInvoiceIdMap_',
    'assertUniqueSalesInvoiceIds_'].map(name=>nativeFunction(utils,name)),
  ...['dashboardTodayNetSales_','dashboardTodayCollection_','dashboardTodayExpense_',
    'dashboardTodayPurchase_','getDashboardStats'].map(name=>nativeFunction(gas,name))
].join('\n');
const expectedKeys=['todaySalesTotal','todayCollectionTotal','todayExpenseTotal',
  'todayPurchaseTotal','dueReceivable','borrowerReceivable','supplierPayable',
  'outstandingLoan','cashBalance','lowStockCount','currencySymbol'];
const json=v=>JSON.parse(JSON.stringify(v));
const empty=()=>({
  sales:[],salesReturnItems:[],customerLedger:[],expenses:[],purchases:[],
  customers:[],suppliers:[],products:[],
  financeSummary:{borrowerReceivable:0,outstandingLoan:0},
  cashBalance:0,currencySymbol:''
});
const fixture=()=>({
  sales:[
    {'Invoice ID':'INV-A','Date':'2026-11-15','Created At':'2026-11-10',
      'Subtotal':200,'Grand Total':180,'Paid Amount':50},
    {'Invoice ID':'INV-B','Date':'2026-11-15','Subtotal':20,'Grand Total':20,'Paid Amount':5},
    {'Invoice ID':'INV-C','Date':'2026-11-14','Subtotal':500,'Grand Total':500,'Paid Amount':200}
  ],
  salesReturnItems:[
    {'Return ID':'RET-1','Invoice ID':'INV-A','Line Total':100,'Pricing Basis':'','Date':'2026-11-17'},
    {'Return ID':'RET-2','Invoice ID':'INV-B','Line Total':2,'Pricing Basis':'NetAfterInvoiceDiscount'},
    {'Return ID':'RET-3','Invoice ID':'INV-C','Line Total':50,'Pricing Basis':'NetAfterInvoiceDiscount','Date':'2026-11-15'}
  ],
  customerLedger:[
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':20,'Credit':100,'Discount Amount':80},
    {'Date':'2026-11-15','Type':'Payment','Payment Amount':'','Credit':60,'Discount Amount':10},
    {'Date':'2026-11-14','Type':'Payment','Payment Amount':80}
  ],
  expenses:[
    {'Date':'2026-11-15','Amount':70,'Status':'Approved'},
    {'Date':'2026-11-15','Amount':999,'Status':'Cancelled'}
  ],
  purchases:[{'Date':'2026-11-15','Grand Total':300}],
  customers:[
    {'Customer ID':'PARTY-1','Current Due':150.25},
    {'Customer ID':'C-2','Current Due':-200},
    {'Customer ID':'C-3','Current Due':'22.10'}
  ],
  suppliers:[
    {'Supplier ID':'PARTY-1','Current Due':85.1},
    {'Supplier ID':'S-2','Current Due':19.15},
    {'Supplier ID':'S-3','Current Due':-500}
  ],
  products:[
    {'Status':'Active','Current Stock':0,'Minimum Stock':0},
    {'Status':'Active','Current Stock':1,'Minimum Stock':2},
    {'Status':'Active','Current Stock':10,'Minimum Stock':5},
    {'Status':'Inactive','Current Stock':-2,'Minimum Stock':5},
    {'Status':'active','Current Stock':0,'Minimum Stock':2}
  ],
  financeSummary:{borrowerReceivable:360.125,outstandingLoan:999.75},
  cashBalance:-15.75,
  currencySymbol:'৳'
});
function oracle(snapshot,today){
  const tables={
    SALES:snapshot.sales,
    CUSTOMER_LEDGER:snapshot.customerLedger,
    EXPENSES:snapshot.expenses,
    PURCHASES:snapshot.purchases,
    CUSTOMERS:snapshot.customers,
    SUPPLIERS:snapshot.suppliers,
    PRODUCTS:snapshot.products,
    FINANCE_TRANSACTIONS:[]
  };
  const vm={
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-source-fixture');
      assert.equal(module,'dashboard');
      assert.equal(action,'view');
    },
    activeRows_:key=>{
      assert.ok(Object.hasOwn(tables,key),'Unexpected original source table '+key);
      return tables[key];
    },
    activeSalesReturnItems_:()=>snapshot.salesReturnItems,
    formatDate_:()=>today,
    safeDateOnly_:value=>!value?'':String(value).slice(0,10),
    financeBalanceSummary_:()=>snapshot.financeSummary,
    getCashBalance_:()=>snapshot.cashBalance,
    getSettingsMap_:()=>({'Currency Symbol':snapshot.currencySymbol}),
    ok_:response=>response,
    fail_:message=>{throw new Error('Original source rejected: '+message);},
    logError_:()=>{}
  };
  return json(runInNewContext(original+'\ngetDashboardStats("authorized-source-fixture")',vm));
}
const impl=await import('../src/modules/dashboard-contract.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,today){
  assert.equal(typeof impl?.projectDashboardStats,'function',
    'M09 full Dashboard contract composer not implemented');
  return impl.projectDashboardStats(snapshot,arguments.length<2?'2026-11-15':today);
}
function assertParity(snapshot,today='2026-11-15'){
  const expected=oracle(snapshot,today);
  const actual=project(snapshot,today);
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  assert.deepEqual(Object.keys(actual),expectedKeys);
  return actual;
}

test('full getDashboardStats original response has all 11 exact fields and native values',()=>{
  const actual=assertParity(fixture());
  assert.deepEqual(actual,{
    todaySalesTotal:108,todayCollectionTotal:125,
    todayExpenseTotal:70,todayPurchaseTotal:300,
    dueReceivable:172.35,borrowerReceivable:360.125,
    supplierPayable:104.25,outstandingLoan:999.75,
    cashBalance:-15.75,lowStockCount:3,currencySymbol:'৳'
  });
});

test('Finance and Cash figures are passed through unchanged, never inferred or rounded by M09',()=>{
  const input=fixture();
  input.financeSummary={borrowerReceivable:-123.456,outstandingLoan:0.105};
  input.cashBalance=-0.105;
  const x=assertParity(input);
  assert.equal(x.borrowerReceivable,-123.456);
  assert.equal(x.outstandingLoan,0.105);
  assert.equal(x.cashBalance,-0.105);
  assert.equal(x.dueReceivable,172.35);
  assert.equal(x.supplierPayable,104.25);
});

test('return dates do not move discounted sales revenue; noncash discount is not collection',()=>{
  const input=fixture();
  input.salesReturnItems[0].Date='2026-11-28';
  input.customerLedger[0]['Discount Amount']=50000;
  assert.equal(assertParity(input).todaySalesTotal,108);
  assert.equal(assertParity(input).todayCollectionTotal,125);
  input.sales[0].Date='2026-11-14';
  const x=assertParity(input);
  assert.equal(x.todaySalesTotal,18);
  assert.equal(x.todayCollectionTotal,75);
});

test('empty active source rows have explicit trusted zero values and blank currency',()=>{
  assert.deepEqual(assertParity(empty()),{
    todaySalesTotal:0,todayCollectionTotal:0,
    todayExpenseTotal:0,todayPurchaseTotal:0,
    dueReceivable:0,borrowerReceivable:0,
    supplierPayable:0,outstandingLoan:0,
    cashBalance:0,lowStockCount:0,currencySymbol:''
  });
  const x=empty();x.currencySymbol='৳';x.cashBalance=42;
  assert.equal(assertParity(x).cashBalance,42);
  assert.equal(assertParity(x).currencySymbol,'৳');
});

test('source duplicate invoice and invalid shop-local dates remain fail-closed',()=>{
  const d=fixture();
  d.sales.push({...d.sales[0],Date:'2026-11-14'});
  assert.throws(()=>oracle(d,'2026-11-15'),/Duplicate invoice ID/);
  assert.throws(()=>project(d),/Duplicate invoice ID/);
  for(const today of [undefined,'','2026-02-30','2026-11-15T00:00:00Z'])
    assert.throws(()=>project(fixture(),today),/today|trusted|date/i);
  const raw=fixture();
  raw.sales[0].Date='2026-11-15T08:30:00Z';
  assert.throws(()=>project(raw),/date|normalized|canonical/i);
});

test('missing trusted Finance/Cash/currency never fabricate financial zeros',()=>{
  const d=fixture();
  for(const missing of ['financeSummary','cashBalance','currencySymbol']){
    const broken={...d};delete broken[missing];
    assert.throws(()=>project(broken),/trusted|Finance|Cash|currency|missing|snapshot/i);
  }
  for(const invalid of [null,undefined,{},Promise.resolve({}),
    {borrowerReceivable:1},{outstandingLoan:1},
    {borrowerReceivable:Infinity,outstandingLoan:1},
    {borrowerReceivable:0,outstandingLoan:NaN},
    {borrowerReceivable:'0',outstandingLoan:0}]){
    assert.throws(()=>project({...d,financeSummary:invalid}),
      /finance|trusted|numeric|finite|summary/i);
  }
  for(const cashBalance of [undefined,null,'0',NaN,Infinity,Promise.resolve(0)])
    assert.throws(()=>project({...d,cashBalance}),/cash|trusted|finite|number/i);
  for(const currencySymbol of [undefined,null,7,Promise.resolve('৳')])
    assert.throws(()=>project({...d,currencySymbol}),/currency|trusted|string/i);
});

test('accessors, stale object shapes and leaked Promises do not invoke unsafe getters',()=>{
  const d=fixture();
  for(const bad of [null,undefined,[],{}, {...d,sales:Promise.resolve([])},
    {...d,customers:[null]}, {...d,products:undefined}]){
    assert.throws(()=>project(bad),/snapshot|row|trusted|active|array/i);
  }
  const bad={...d,get financeSummary(){throw Error('should not call getter');}};
  assert.throws(()=>project(bad),/trusted|finance|snapshot|accessor/i);
  const badCash={...d,get cashBalance(){throw Error('should not call getter');}};
  assert.throws(()=>project(badCash),/trusted|cash|snapshot|accessor/i);
  const badInside={...d,financeSummary:{
    get borrowerReceivable(){throw Error('should not call getter');},outstandingLoan:0
  }};
  assert.throws(()=>project(badInside),/finance|trusted|numeric|accessor/i);
});

test('no mutation, no live RPC/export drift, and all original UI card fields are represented',()=>{
  const d=fixture(),before=json(d);
  assertParity(d);
  assert.deepEqual(d,before);
  for(const key of expectedKeys)
    assert.ok(gas.includes(key),'Original GAS response no longer includes '+key);
  assert.match(html,/serverCall\('getDashboardStats', authToken\)/);
  const code=readFileSync(new URL('../src/modules/dashboard-contract.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(code,/function\s+getDashboardStats\s*\(/);
});
