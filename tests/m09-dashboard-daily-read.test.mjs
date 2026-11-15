import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardDailyMovements}
  from '../src/modules/dashboard-daily-read.js';

const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function sourceFunction(text,name){
  const start=text.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source missing '+name);
  const end=text.indexOf('\n}\n',start);
  assert.ok(end>start,'Cannot extract frozen source function '+name);
  return text.slice(start,end+3);
}
const source=[
  sourceFunction(dashboard,'dashboardTodayCollection_'),
  sourceFunction(dashboard,'dashboardTodayExpense_'),
  sourceFunction(dashboard,'dashboardTodayPurchase_'),
  sourceFunction(utils,'roundMoney_')
].join('\n');
function oracle({today,todaySales,customerLedgerRows,expenseRows,purchaseRows}){
  const ctx={
    today,todaySales,customerLedgerRows,expenseRows,purchaseRows,
    safeDateOnly_:date=>date, // pre-normalized source rows, not raw timestamps
  };
  return JSON.parse(JSON.stringify(runInNewContext(source+`
    ({todayCollectionTotal:dashboardTodayCollection_(todaySales,customerLedgerRows,today),
      todayExpenseTotal:dashboardTodayExpense_(expenseRows,today),
      todayPurchaseTotal:dashboardTodayPurchase_(purchaseRows,today)})`,ctx)));
}
const empty=()=>({today:'2026-11-15',todaySales:[],customerLedgerRows:[],expenseRows:[],purchaseRows:[]});
test('M09 daily totals match frozen Dashboard.gs for noncash discounts and cancellations',()=>{
  const data={
    today:'2026-11-15',
    todaySales:[
      {'Paid Amount':'100.125'}, {'Paid Amount':-99}, {'Paid Amount':'not-number'},
    ],
    customerLedgerRows:[
      {Date:'2026-11-15',Type:'Payment','Payment Amount':'25.125',Credit:100,'Discount Amount':20},
      {Date:'2026-11-15',Type:'Payment','Payment Amount':'',Credit:70,'Discount Amount':10},
      {Date:'2026-11-15',Type:'Payment',Credit:45,'Discount Amount':4},
      {Date:'2026-11-15',Type:'Payment','Payment Amount':'0',Credit:500,'Discount Amount':12},
      {Date:'2026-11-15',Type:'Payment','Payment Amount':-100},
      {Date:'2026-11-15',Type:'Adjustment',Credit:200},
      {Date:'2026-11-14',Type:'Payment',Credit:999},
    ],
    expenseRows:[
      {Date:'2026-11-15',Amount:10.125,Status:'Active'},
      {Date:'2026-11-15',Amount:99,Status:'Cancelled'},
      {Date:'2026-11-14',Amount:999,Status:'Active'},
    ],
    purchaseRows:[
      {Date:'2026-11-15','Grand Total':83.125},
      {Date:'2026-11-14','Grand Total':998},
    ]
  };
  const actual=projectDashboardDailyMovements(data);
  assert.deepEqual(actual,oracle(data));
  assert.deepEqual(Object.keys(actual),[
    'todayCollectionTotal','todayExpenseTotal','todayPurchaseTotal'
  ]);
  assert.equal(actual.todayCollectionTotal,226.25);
  assert.equal(actual.todayExpenseTotal,10.13);
  assert.equal(actual.todayPurchaseTotal,83.13);
});
test('empty operational rows return three zero values with source order',()=>{
  const data=empty();
  assert.deepEqual(projectDashboardDailyMovements(data),oracle(data));
  assert.deepEqual(projectDashboardDailyMovements(data),{
    todayCollectionTotal:0,todayExpenseTotal:0,todayPurchaseTotal:0
  });
});
test('Payment Amount present zero differs from legacy blank fallback; negative payments clamp at zero',()=>{
  const data={...empty(),customerLedgerRows:[
    {Date:'2026-11-15',Type:'Payment','Payment Amount':0,Credit:100},
    {Date:'2026-11-15',Type:'Payment','Payment Amount':null,Credit:100,'Discount Amount':25},
    {Date:'2026-11-15',Type:'Payment','Payment Amount':-50,Credit:100},
    {Date:'2026-11-15',Type:'Payment','Payment Amount':undefined,Credit:20,'Discount Amount':40}
  ]};
  assert.deepEqual(projectDashboardDailyMovements(data),oracle(data));
  assert.equal(projectDashboardDailyMovements(data).todayCollectionTotal,75);
});
test('source expense cancellation exact match and purchase active-row preprocessing stay distinct',()=>{
  const data={...empty(),
    expenseRows:[
      {Date:'2026-11-15',Status:'Cancelled',Amount:50},
      {Date:'2026-11-15',Status:'cancelled',Amount:20},
      {Date:'2026-11-15',Status:'Active',Amount:-3}
    ],
    purchaseRows:[{Date:'2026-11-15',Status:'Cancelled','Grand Total':70}]
  };
  assert.deepEqual(projectDashboardDailyMovements(data),oracle(data));
  assert.equal(projectDashboardDailyMovements(data).todayExpenseTotal,17);
  assert.equal(projectDashboardDailyMovements(data).todayPurchaseTotal,70);
});
test('inputs remain untouched, outputs are per-call numeric results',()=>{
  const data=empty();
  data.todaySales=Object.freeze([Object.freeze({'Paid Amount':9.005})]);
  data.customerLedgerRows=Object.freeze([]);
  data.expenseRows=Object.freeze([]);
  data.purchaseRows=Object.freeze([]);
  Object.freeze(data);
  assert.deepEqual(projectDashboardDailyMovements(data),oracle(data));
  const next=projectDashboardDailyMovements({...empty(),todaySales:[{'Paid Amount':4}]});
  assert.equal(next.todayCollectionTotal,4);
});
test('noncanonical dates, bad rows, accessors and forged snapshot fields fail closed',()=>{
  for(const broken of [
    {...empty(),today:'2026-11-15T18:00:00+06:00'},
    {...empty(),today:'2026-02-30'},
    {...empty(),todaySales:[{Date:'2026-11-15T18:00:00Z','Paid Amount':12}]},
    {...empty(),expenseRows:[{Date:'2026-11-15T18:00:00Z',Amount:12}]},
    {...empty(),customerLedgerRows:[{Date:new Date(),Type:'Payment','Payment Amount':12}]},
    {...empty(),purchaseRows:[Promise.resolve({})]},
    {...empty(),expenseRows:[{get Amount(){throw Error('getter executed');}}]},
    {...empty(),actor:'Administrator'},
  ])assert.throws(()=>projectDashboardDailyMovements(broken),/invalid|trusted|source|row|date|snapshot/i);
});
test('pure source projection never adds public RPC, D1 queries, external integrations or fake finance balances',()=>{
  const sourceText=readFileSync(new URL('../src/modules/dashboard-daily-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(sourceText,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(dashboard,/function getDashboardStats\(token\)/);
  const result=projectDashboardDailyMovements(empty());
  assert.equal(Object.hasOwn(result,'cashBalance'),false);
  assert.equal(Object.hasOwn(result,'dueReceivable'),false);
  assert.equal(Object.hasOwn(result,'supplierPayable'),false);
});
