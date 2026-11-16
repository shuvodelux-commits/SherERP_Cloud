import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardCoreTiles} from '../src/modules/dashboard-core-tiles-read.js';

const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const finance=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function fn(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source function missing: '+name);
  const end=source.indexOf('\n}\n',start);
  assert.ok(end>start,'Frozen source function end missing: '+name);
  return source.slice(start,end+3);
}
const typeStart=finance.indexOf('const FINANCE_TRANSACTION_TYPES = [');
const typeEnd=finance.indexOf('\n];',typeStart);
assert.ok(typeStart>=0&&typeEnd>typeStart,'Frozen original transaction metadata missing');
const oracleCode=[
  finance.slice(typeStart,typeEnd+3),
  ...['roundMoney_','economicReturnLineAmount_'].map(x=>fn(utils,x)),
  ...['financeTransactionType_','financeTxnPersonKey_','financeSignedBalances_',
      'financeBalanceSummary_'].map(x=>fn(finance,x)),
  ...['dashboardTodayNetSales_','dashboardTodayCollection_',
      'dashboardTodayExpense_','dashboardTodayPurchase_','getDashboardStats'
  ].map(x=>fn(dashboard,x))
].join('\n');
const fields=[
  'todaySalesTotal','todayCollectionTotal','todayExpenseTotal',
  'todayPurchaseTotal','dueReceivable','borrowerReceivable','supplierPayable',
  'outstandingLoan','lowStockCount'
];
function empty(){
  return {today:'2026-11-15',todaySales:[],activeReturnItems:[],
    customerLedgerRows:[],expenseRows:[],purchaseRows:[],
    activeCustomers:[],activeSuppliers:[],activeProducts:[],activeTransactions:[]};
}
function original(snapshot){
  const sourceGroups={
    SALES:snapshot.todaySales,CUSTOMER_LEDGER:snapshot.customerLedgerRows,
    EXPENSES:snapshot.expenseRows,PURCHASES:snapshot.purchaseRows,
    CUSTOMERS:snapshot.activeCustomers,SUPPLIERS:snapshot.activeSuppliers,
    PRODUCTS:snapshot.activeProducts,FINANCE_TRANSACTIONS:snapshot.activeTransactions
  };
  const raw=runInNewContext(oracleCode+'\ngetDashboardStats("SYNTHETIC_TEST_TOKEN")',{
    requirePermission_:(token,module,operation)=>{
      assert.equal(token,'SYNTHETIC_TEST_TOKEN');
      assert.deepEqual([module,operation],['dashboard','view']);
    },
    activeRows_:group=>{
      if(!Object.hasOwn(sourceGroups,group))throw Error('Unexpected source group: '+group);
      return sourceGroups[group];
    },
    formatDate_:()=>snapshot.today,
    safeDateOnly_:date=>date, // dates are already shop-normalized by the trusted caller
    // Original full-active-Sales identity preflight belongs to the caller, not to this composer.
    assertUniqueSalesInvoiceIds_:()=>{},
    activeSalesReturnItems_:()=>snapshot.activeReturnItems,
    getCashBalance_:()=>12345.67, // intentionally never copied to composer
    getSettingsMap_:()=>({'Currency Symbol':'৳'}),
    ok_:x=>x,fail_:reason=>{throw Error(String(reason));},
    logError_:()=>{}
  });
  const out={};
  for(const field of fields)out[field]=raw[field];
  return JSON.parse(JSON.stringify(out));
}
function sourceParity(snapshot){
  const result=projectDashboardCoreTiles(snapshot);
  assert.deepEqual(result,original(snapshot));
  assert.deepEqual(Object.keys(result),fields);
  assert.equal(Object.hasOwn(result,'cashBalance'),false);
  assert.equal(Object.hasOwn(result,'currencySymbol'),false);
  return result;
}

test('original DashboardStats empty operational groups exactly match the nine delegated tiles',()=>{
  const result=sourceParity(empty());
  assert.ok(fields.every(key=>result[key]===0));
});
test('frozen DashboardStats with return, payments, gross Party due, finance openings and stock matches in full',()=>{
  const data={
    ...empty(),
    todaySales:[
      {'Invoice ID':'INV-A',Date:'2026-11-15',Subtotal:120,'Grand Total':100,'Paid Amount':60},
      {'Invoice ID':'INV-B',Date:'2026-11-15',Subtotal:80,'Grand Total':80,'Paid Amount':80}
    ],
    activeReturnItems:[
      {'Invoice ID':'INV-A','Line Total':24,'Pricing Basis':'',Date:'2026-12-01'},
      {'Invoice ID':'INV-B','Line Total':10,'Pricing Basis':'NetAfterInvoiceDiscount'}
    ],
    customerLedgerRows:[
      {Date:'2026-11-15',Type:'Payment','Payment Amount':20,Credit:50,'Discount Amount':15},
      {Date:'2026-11-15',Type:'Payment','Payment Amount':'',Credit:30,'Discount Amount':5},
      {Date:'2026-11-14',Type:'Payment',Credit:900}
    ],
    expenseRows:[
      {Date:'2026-11-15',Amount:25,Status:'Active'},
      {Date:'2026-11-15',Amount:100,Status:'Cancelled'}
    ],
    purchaseRows:[{Date:'2026-11-15','Grand Total':150}],
    activeCustomers:[
      {'Customer ID':'C-1','Name':'Same Person','Current Due':100},
      {'Customer ID':'C-2','Current Due':-45}
    ],
    activeSuppliers:[{'Supplier ID':'S-1','Name':'Same Person','Current Due':220}],
    activeProducts:[
      {Status:'Active','Current Stock':0,'Minimum Stock':5},
      {Status:'Active','Current Stock':20,'Minimum Stock':5},
      {Status:'Inactive','Current Stock':0,'Minimum Stock':50}
    ],
    activeTransactions:[
      {'Person ID':'P-1',Person:'Same Person','Transaction Type':'Opening Loan',Amount:70},
      {'Person ID':'P-1',Person:'Same Person','Transaction Type':'Loan Repayment',Amount:20},
      {'Person ID':'P-2',Person:'Same Person','Transaction Type':'Borrower Loan',Amount:35},
      {'Person ID':'P-3',Person:'Same Person','Transaction Type':'Borrower Repayment',Amount:5}
    ]
  };
  const result=sourceParity(data);
  assert.equal(result.todaySalesTotal,150);
  assert.equal(result.todayCollectionTotal,185);
  assert.equal(result.outstandingLoan,50);
  assert.equal(result.borrowerReceivable,35);
  assert.equal(result.lowStockCount,1);
  assert.equal(result.dueReceivable,100);
  assert.equal(result.supplierPayable,220);
});
test('immutable snapshot stays untouched; repeat calls neither cache nor leak cross-shop data',()=>{
  const rows=Object.freeze([Object.freeze({'Invoice ID':'X',Date:'2026-11-15','Grand Total':50,Subtotal:50,'Paid Amount':30})]);
  const data=Object.freeze({...empty(),todaySales:rows});
  sourceParity(data);
  assert.equal(projectDashboardCoreTiles({...empty()}).todaySalesTotal,0);
  assert.equal(projectDashboardCoreTiles({...empty(),todaySales:rows}).todaySalesTotal,50);
});
test('incomplete or forged top-level snapshots fail closed; no implicit empty source groups',()=>{
  const good=empty();
  for(const bad of [
    null,undefined,[],Promise.resolve(good),
    {today:'2026-11-15'}, {...good,activeTransactions:undefined},
    {...good,actor:'Administrator'},
    {...good,token:'FORGED'},
    {...good,cashBalance:0},
    {...good,currencySymbol:'৳'},
    {...good,tenantId:'OTHER-BUSINESS'},
    {...good,permissions:{dashboard:{view:true}}},
    {...good,todaySales:[Promise.resolve({})]},
    {...good,activeSuppliers:[new Date()]},
    {...good,activeTransactions:[{'Person ID':'P-1','Transaction Type':'Loan Received',Amount:Infinity}]},
    {...good,todaySales:[{'Invoice ID':'X',Date:'2026-11-14',Subtotal:10,'Grand Total':10}]},
    {...good,todaySales:[{'Invoice ID':'X',Date:'2026-11-15',Subtotal:10,'Grand Total':10},
                          {'Invoice ID':'X',Date:'2026-11-15',Subtotal:10,'Grand Total':10}]},
    Object.defineProperty({...good},'activeProducts',{get(){throw Error('GETTER');}}),
  ])assert.throws(()=>projectDashboardCoreTiles(bad),/invalid|trusted|array|row|date|duplicate|invoice|field|snapshot/i);
});
test('composer only imports merged pure projectors; never opens RPC, Cash/Bank D1 or UI',()=>{
  const source=readFileSync(new URL('../src/modules/dashboard-core-tiles-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE)\s+/i);
  assert.doesNotMatch(source,/\b(?:getCashBalance_|cashBalance|currencySymbol)\b/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(dashboard,/requirePermission_\(token, 'dashboard', 'view'\)/);
  assert.equal(fields.length,9);
});
