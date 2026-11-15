import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const nativeDashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const nativeUtils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function sourceFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract frozen source function '+name);
  return source.slice(start,end+2);
}
const nativeCode=sourceFunction(nativeUtils,'roundMoney_')+'\n'+
  sourceFunction(nativeDashboard,'getDashboardStats');

const blank=()=>({customers:[],suppliers:[],products:[]});
const fixture=()=>({
  customers:[
    {'Customer ID':'IDENTITY-1','Current Due':150.25},
    {'Customer ID':'C-2','Current Due':-200},
    {'Customer ID':'C-3','Current Due':'22.10'},
    {'Customer ID':'C-4','Current Due':null}
  ],
  suppliers:[
    {'Supplier ID':'IDENTITY-1','Current Due':85.1},
    {'Supplier ID':'S-2','Current Due':19.15},
    {'Supplier ID':'S-3','Current Due':-500}
  ],
  products:[
    {'Product ID':'P-1','Status':'Active','Current Stock':0,'Minimum Stock':0},
    {'Product ID':'P-2','Status':'Active','Current Stock':'1','Minimum Stock':'2'},
    {'Product ID':'P-3','Status':'Active','Current Stock':10,'Minimum Stock':3},
    {'Product ID':'P-4','Status':'Inactive','Current Stock':-5,'Minimum Stock':1},
    {'Product ID':'P-5','Status':'inactive','Current Stock':0,'Minimum Stock':2},
    {'Product ID':'P-6','Status':'','Current Stock':'','Minimum Stock':''},
    {'Product ID':'P-7','Status':'Active','Current Stock':0},
    {'Product ID':'P-8','Status':'Active','Current Stock':-1,'Minimum Stock':-0.5}
  ]
});
const clone=x=>JSON.parse(JSON.stringify(x));
function oracle(snapshot){
  const groups={
    SALES:[],CUSTOMER_LEDGER:[],EXPENSES:[],PURCHASES:[],FINANCE_TRANSACTIONS:[],
    CUSTOMERS:snapshot.customers,SUPPLIERS:snapshot.suppliers,PRODUCTS:snapshot.products
  };
  const ctx={
    requirePermission_:(token,scope,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(scope,'dashboard');assert.equal(action,'view');
    },
    activeRows_:key=>{
      assert.ok(Object.hasOwn(groups,key),'Unexpected original active rows: '+key);
      return groups[key];
    },
    formatDate_:()=> '2026-11-15',
    safeDateOnly_:value=>String(value||'').slice(0,10),
    assertUniqueSalesInvoiceIds_:()=>true,
    dashboardTodayNetSales_:()=>0,
    dashboardTodayCollection_:()=>0,
    dashboardTodayExpense_:()=>0,
    dashboardTodayPurchase_:()=>0,
    financeBalanceSummary_:()=>({borrowerReceivable:0,outstandingLoan:0}),
    getSettingsMap_:()=>({}),
    getCashBalance_:()=>0,
    ok_:result=>result,
    fail_:message=>{throw new Error('Original source: '+message);},
    logError_:()=>{}
  };
  const response=runInNewContext(nativeCode+'\ngetDashboardStats("authorized-fixture")',ctx);
  return clone({dueReceivable:response.dueReceivable,
    supplierPayable:response.supplierPayable,lowStockCount:response.lowStockCount});
}

const impl=await import('../src/modules/dashboard-due-stock.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot){
  assert.equal(typeof impl?.projectDashboardDueStock,'function','M09 due/stock dashboard adapter not implemented');
  return impl.projectDashboardDueStock(snapshot);
}
function compare(snapshot){
  const actual=project(snapshot),expected=oracle(snapshot);
  assert.deepEqual(actual,expected);
  return actual;
}

test('source Dashboard.gs oracle: Customer Due, Supplier Payable and Low Stock are exact',()=>{
  assert.deepEqual(compare(fixture()),{
    dueReceivable:172.35,
    supplierPayable:104.25,
    lowStockCount:5
  });
});

test('one real-world Party ID across customer and supplier roles never offsets gross balances',()=>{
  const input={
    customers:[{'Customer ID':'PARTY-1','Current Due':1000},
      {'Customer ID':'PARTY-2','Current Due':-900}],
    suppliers:[{'Supplier ID':'PARTY-1','Current Due':700},
      {'Supplier ID':'PARTY-2','Current Due':-400}],
    products:[]
  };
  assert.deepEqual(compare(input),{
    dueReceivable:1000,
    supplierPayable:700,
    lowStockCount:0
  });
});

test('negative balances do not cancel positive due; decimals round only after gross sum',()=>{
  const input={
    customers:[{'Current Due':0.105},{'Current Due':0.105},
      {'Current Due':-1000},{'Current Due':'not-a-number'}],
    suppliers:[{'Current Due':'7.125'},{'Current Due':'0.125'},
      {'Current Due':'-90'},{'Current Due':null}],
    products:[]
  };
  compare(input);
  assert.equal(compare(input).dueReceivable,0.21);
});

test('low stock uses exact <=, exact inactive status and source Number coercion',()=>{
  const input=blank();
  input.products=[
    {'Status':'Active','Current Stock':5,'Minimum Stock':5},
    {'Status':'Active','Current Stock':4.99,'Minimum Stock':5},
    {'Status':'Active','Current Stock':5.01,'Minimum Stock':5},
    {'Status':'Inactive','Current Stock':-99,'Minimum Stock':100},
    {'Status':'inactive','Current Stock':0,'Minimum Stock':1},
    {'Status':'','Current Stock':'','Minimum Stock':''},
    {'Status':'Active','Current Stock':undefined,'Minimum Stock':0},
    {'Status':'Active','Current Stock':0,'Minimum Stock':undefined},
    {'Status':'Active','Current Stock':null,'Minimum Stock':null},
    {'Status':'Active','Current Stock':'-1','Minimum Stock':'-2'}
  ];
  assert.equal(compare(input).lowStockCount,5);
});

test('empty active snapshots and all-negative balances return independent zero metrics',()=>{
  assert.deepEqual(compare(blank()),{
    dueReceivable:0,supplierPayable:0,lowStockCount:0
  });
  const input={
    customers:[{'Current Due':-10},{'Current Due':0}],
    suppliers:[{'Current Due':-50},{'Current Due':'-0.2'}],
    products:[{'Status':'Inactive','Current Stock':0,'Minimum Stock':100}]
  };
  assert.deepEqual(compare(input),{
    dueReceivable:0,supplierPayable:0,lowStockCount:0
  });
});

test('source parity across independently varied customer and supplier row ordering',()=>{
  const initial=fixture();
  const x=compare(initial);
  const reversed={
    customers:[...initial.customers].reverse(),
    suppliers:[...initial.suppliers].reverse(),
    products:[...initial.products].reverse()
  };
  assert.deepEqual(compare(reversed),x);
  const input={
    customers:[{'Current Due':'15.15'},{'Current Due':30.2},{'Current Due':-500}],
    suppliers:[{'Current Due':110.13},{'Current Due':'0.12'},{'Current Due':-800}],
    products:[{'Status':'Active','Current Stock':-2,'Minimum Stock':-1}]
  };
  compare(input);
});

test('missing active-row arrays, Promises, malformed row/accessor and nonfinite amounts fail closed',()=>{
  const cases=[
    null,undefined,{},[],{...fixture(),customers:undefined},
    {...fixture(),suppliers:Promise.resolve([])},
    {...fixture(),products:null},
    {...fixture(),customers:[null]},
    {...fixture(),products:['bad row']},
    {...fixture(),suppliers:[Object.create({ 'Current Due':5 })]}
  ];
  for(const input of cases)
    assert.throws(()=>project(input),/snapshot|active|array|trusted|row/i);
  const input={...fixture(),get customers(){throw Error('Unexpected accessor executed');}};
  assert.throws(()=>project(input),/snapshot|accessor|trusted/i);
  const fieldGetter={get 'Current Due'(){throw Error('Unexpected getter');}};
  assert.throws(()=>project({...fixture(),customers:[fieldGetter]}),/row|accessor|trusted/i);
  assert.throws(()=>project({...fixture(),customers:[{'Current Due':'Infinity'}]}),/finite|amount|number/i);
  assert.throws(()=>project({...fixture(),products:[{'Current Stock':'Infinity','Minimum Stock':0}]}),/finite|stock|number/i);
});

test('projection is pure and cannot launch RPC, mutate source, or combine role accounts',()=>{
  const input=fixture();
  const before=clone(input);
  compare(input);
  assert.deepEqual(input,before);
  assert.equal(typeof impl?.projectDashboardDueStock,'function');
  const source=readFileSync(new URL('../src/modules/dashboard-due-stock.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(source,/function\s+getDashboardStats\s*\(/);
});
