import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardTodayNetSales} from '../src/modules/dashboard-today-sales-read.js';

const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function sourceFunction(text,name){
  const start=text.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source missing '+name);
  const end=text.indexOf('\n}\n',start);
  assert.ok(end>start,'Cannot extract frozen source '+name);
  return text.slice(start,end+3);
}
const oracleCode=[
  sourceFunction(dashboard,'dashboardTodayNetSales_'),
  sourceFunction(utils,'economicReturnLineAmount_'),
  sourceFunction(utils,'roundMoney_')
].join('\n');
const invoice=(id,total,subtotal=total,date='2026-11-15')=>({
  'Invoice ID':id,Date:date,Subtotal:subtotal,'Grand Total':total
});
const snapshot=(sales=[],returns=[],today='2026-11-15')=>({
  today,todaySales:sales,activeReturnItems:returns
});
function oracle(s){
  return runInNewContext(oracleCode+'\ndashboardTodayNetSales_(todaySales)',{
    todaySales:s.todaySales,
    activeSalesReturnItems_:()=>s.activeReturnItems
  });
}
test('frozen Today Sales applies invoice-level discount to legacy returns, and not to already-net return lines',()=>{
  const s=snapshot(
    [invoice('INV-1',100,120),invoice('INV-2',150,200)],
    [
      {'Invoice ID':'INV-1','Line Total':24,'Pricing Basis':''},
      {'Invoice ID':'INV-2','Line Total':30,'Pricing Basis':'NetAfterInvoiceDiscount'},
      {'Invoice ID':'INV-OTHER','Line Total':1000},
    ]
  );
  assert.equal(projectDashboardTodayNetSales(s),oracle(s));
  assert.equal(projectDashboardTodayNetSales(s),200);
});
test('return date does not determine revenue attribution; later return reduces original invoice day',()=>{
  const s=snapshot([invoice('INV-OLD',100,125)],[
    {'Invoice ID':'INV-OLD',Date:'2026-12-20','Line Total':25},
    {'Invoice ID':'INV-OLD',Date:'2026-12-21','Line Total':12.50,'Pricing Basis':'NetAfterInvoiceDiscount'}
  ]);
  assert.equal(projectDashboardTodayNetSales(s),oracle(s));
  assert.equal(projectDashboardTodayNetSales(s),67.5);
});
test('empty source sales remains zero despite return rows; unrelated return rows ignored',()=>{
  const s=snapshot([],[{'Invoice ID':'INV-OTHER','Line Total':100}]);
  assert.equal(projectDashboardTodayNetSales(s),oracle(s));
  assert.equal(projectDashboardTodayNetSales(s),0);
  const s2=snapshot([invoice('INV-A',14.125,0)],[
    {'Invoice ID':'INV-Z','Line Total':999},{'Invoice ID':'INV-A','Line Total':'2.125'}
  ]);
  assert.equal(projectDashboardTodayNetSales(s2),oracle(s2));
});
test('source rounds only once and preserves negative totals for over-return, without monetary reclassification',()=>{
  const s=snapshot([invoice('INV-A',10)],[{'Invoice ID':'INV-A','Line Total':11.005}]);
  assert.equal(projectDashboardTodayNetSales(s),oracle(s));
  assert.equal(projectDashboardTodayNetSales(s),-1.01);
});
test('valid frozen source fixtures and arrays are never mutated',()=>{
  const s=snapshot(Object.freeze([Object.freeze(invoice('INV-1',10))]),
    Object.freeze([Object.freeze({'Invoice ID':'INV-1','Line Total':2})]));
  Object.freeze(s);
  assert.equal(projectDashboardTodayNetSales(s),oracle(s));
  assert.equal(projectDashboardTodayNetSales(s),8);
});
test('invalid shop-local date, malformed rows, duplicate IDs or forged authorization fail closed',()=>{
  const x=invoice('INV-1',10);
  for(const bad of [
    snapshot([x],[],'2026-02-30'),
    snapshot([x],[],'2026-11-15T01:00:00Z'),
    snapshot([{...x,Date:'2026-11-14'}]),
    snapshot([{...x,Date:'2026-11-15T00:00:00Z'}]),
    snapshot([x,{...x}]),
    snapshot([invoice('',10)]),
    snapshot([invoice('__proto__',10)]),
    snapshot([Promise.resolve(x)]),
    snapshot([{...x, 'Grand Total':{value:10}}]),
    snapshot([Object.defineProperty({...x},'Grand Total',{get(){throw Error('MALICIOUS GETTER');}})]),
    snapshot([x],[{'Invoice ID':'INV-1',get 'Line Total'(){throw Error('ACCESSOR');}}]),
    snapshot([x],[{'Invoice ID':'INV-1','Line Total':{raw:5}}]),
    {...snapshot([x]),actor:'Administrator'},
    {...snapshot([x]),permissions:{dashboard:{view:true}}},
  ])assert.throws(()=>projectDashboardTodayNetSales(bad),/invalid|trusted|source|date|duplicate|invoice|field/i);
});
test('source today sales projection does not mutate original GAS, enable RPC or query D1',()=>{
  const source=readFileSync(new URL('../src/modules/dashboard-today-sales-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(dashboard,/assertUniqueSalesInvoiceIds_\(todaySales/);
  assert.equal(Object.hasOwn(snapshot(),'cashBalance'),false);
});
