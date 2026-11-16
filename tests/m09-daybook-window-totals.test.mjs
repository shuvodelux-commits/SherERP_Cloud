import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const start=source.indexOf('const filtered = rows.filter(function (row)');
const end=source.indexOf('const result = { rows: filtered, totals: totals, isAdmin: isAdmin, count: filtered.length };',start);
const moneyStart=utils.indexOf('function roundMoney_(value) {');
const moneyEnd=utils.indexOf('\n}',moneyStart);
assert.ok(start>=0 && end>start && moneyStart>=0 && moneyEnd>moneyStart,
  'Frozen Day Book window and money oracle must exist');
const rawCode=utils.slice(moneyStart,moneyEnd+2)+'\n'+source.slice(start,end);
const oracle=runInNewContext('(function (rows, f, isAdmin) {'+
  'const dateFrom=f.dateFrom||"",dateTo=f.dateTo||"",'+
  'moduleFilter=f.module||"",methodFilter=f.paymentMethod||"",'+
  'query=(f.query||"").trim().toLowerCase(),backdatedOnly=!!f.backdatedOnly;'+
  rawCode+
  'return {rows:filtered,totals,isAdmin,count:filtered.length};})');
const json=x=>JSON.parse(JSON.stringify(x));

const impl=await import('../src/modules/daybook-window-totals.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(rows,filters={},isAdmin=false){
  assert.equal(typeof impl?.projectDayBookWindow,'function',
    'M09 Day Book window and totals projection not implemented');
  return impl.projectDayBookWindow(rows,filters,isAdmin);
}
function expected(rows,filters={},isAdmin=false){
  const permitted=rows.filter(r=>!r.isDeleted || (isAdmin && !!filters.includeDeleted));
  return json(oracle(json(permitted),filters,isAdmin));
}
function parity(rows,filters={},isAdmin=false){
  const actual=json(project(rows,filters,isAdmin));
  assert.deepEqual(actual,expected(rows,filters,isAdmin));
  assert.deepEqual(Object.keys(actual),['rows','totals','isAdmin','count']);
  assert.deepEqual(Object.keys(actual.totals),
    ['cashIn','cashOut','bankIn','bankOut','netCash','netBank']);
  return actual;
}
function row(id,changes={}){
  return {
    ts:'2026-11-16T12:00:00',date:'2026-11-16',referenceNo:id,
    module:'Sales',transactionType:'Cash Sale',party:'Customer',description:'Source document',
    paymentMethod:'Cash',cashIn:0,cashOut:0,bankIn:0,bankOut:0,
    isDeleted:false,isBackdated:false,runningCashBalance:88,...changes
  };
}
const sample=()=>[
  row('S-1',{ts:'2026-11-15T09:00:00',date:'2026-11-15',bankIn:200,
    paymentMethod:'Bank',party:'মোহিম হার্ডওয়্যার',description:'Card sale'}),
  row('P-1',{ts:'2026-11-16T10:00:00',module:'Purchase',
    transactionType:'Purchase',cashOut:80,party:'Supplier'}),
  row('B-1',{ts:'2026-11-16T11:00:00',module:'Bank',paymentMethod:'Bank',
    transactionType:'Bank Interest',bankIn:25}),
  row('C-1',{ts:'2026-11-16T12:00:00',module:'Customer Payment',cashIn:55,
    transactionType:'Due Collection',isBackdated:true,party:'রহিম'}),
  row('T-1',{ts:'2026-11-16T13:00:00',module:'Bank Transfer',
    transactionType:'Bank Transfer',paymentMethod:'Bank'}),
  row('X-1',{ts:'2026-11-16T14:00:00',module:'Bank',paymentMethod:'Bank',
    bankOut:999,isDeleted:true,transactionType:'Deleted Bank Entry'})
];

test('source oracle: original four-field response, separate cash/bank totals and descending order',()=>{
  const result=parity(sample());
  assert.equal(result.count,5);
  assert.deepEqual(result.totals,{
    cashIn:55,cashOut:80,bankIn:225,bankOut:0,netCash:-25,netBank:225
  });
  assert.deepEqual(result.rows.map(r=>r.referenceNo),['T-1','C-1','B-1','P-1','S-1']);
  assert.equal(result.rows[0].runningCashBalance,88);
});
test('inclusive same-day, one-sided and reversed source date windows are lexical',()=>{
  const rows=sample();
  assert.deepEqual(parity(rows,{dateFrom:'2026-11-16',dateTo:'2026-11-16'})
    .rows.map(r=>r.referenceNo),['T-1','C-1','B-1','P-1']);
  assert.equal(parity(rows,{dateFrom:'2026-11-17',dateTo:'2026-11-15'}).count,0);
  assert.deepEqual(parity(rows,{dateTo:'2026-11-15'}).rows.map(r=>r.referenceNo),['S-1']);
});
test('module and payment filters use strict exact strings',()=>{
  assert.deepEqual(parity(sample(),{module:'Bank',paymentMethod:'Bank'})
    .rows.map(r=>r.referenceNo),['B-1']);
  assert.equal(parity(sample(),{module:'bank'}).count,0);
  assert.deepEqual(parity(sample(),{paymentMethod:'Cash'}).rows.map(r=>r.referenceNo),['C-1','P-1']);
});
test('case-insensitive English and Bangla search covers reference, party and type',()=>{
  assert.deepEqual(parity(sample(),{query:'মোহিম'}).rows.map(r=>r.referenceNo),['S-1']);
  assert.deepEqual(parity(sample(),{query:'b-1'}).rows.map(r=>r.referenceNo),['B-1']);
  assert.deepEqual(parity(sample(),{query:'INTEREST'}).rows.map(r=>r.referenceNo),['B-1']);
  assert.deepEqual(parity(sample(),{query:'  DUE  '}).rows.map(r=>r.referenceNo),['C-1']);
});
test('backdated filter only includes qualifying source transactions',()=>{
  const result=parity(sample(),{backdatedOnly:true});
  assert.deepEqual(result.rows.map(r=>r.referenceNo),['C-1']);
  assert.equal(result.totals.cashIn,55);
  assert.equal(result.totals.bankIn,0);
});
test('only Administrator includeDeleted can display deleted records; totals always exclude them',()=>{
  const rows=sample();
  assert.equal(parity(rows,{includeDeleted:true},false).count,5);
  const admin=parity(rows,{includeDeleted:true},true);
  assert.equal(admin.count,6);
  assert.equal(admin.rows[0].referenceNo,'X-1');
  assert.equal(admin.totals.bankOut,0);
  assert.equal(admin.totals.netBank,225);
  assert.equal(parity(rows,{includeDeleted:false},true).count,5);
});
test('frozen cents-rounding parity, no input sorting/mutation or result aliasing',()=>{
  const rows=Object.freeze([
    Object.freeze(row('A',{ts:'2026-11-15T12:00:00',cashIn:0.015,bankOut:0.1})),
    Object.freeze(row('B',{ts:'2026-11-16T12:00:00',cashIn:0.015,bankOut:0.2}))
  ]);
  const result=parity(rows);
  assert.equal(result.totals.cashIn,0.04);
  assert.equal(result.totals.bankOut,0.3);
  assert.equal(rows[0].referenceNo,'A');
  const first=project(rows),second=project(rows);
  assert.notStrictEqual(first.rows[0],rows[1]);
  first.rows[0].party='changed';
  assert.equal(second.rows[0].party,'Customer');
});
test('invalid financial values, inherited/accessor data, invalid dates and forged actor fail closed',()=>{
  for(const bad of [null,{},[row('A',{cashIn:'100'})],[row('A',{bankOut:Infinity})],
    [row('A',{cashOut:NaN})],[row('A',{date:'16/11/2026'})],
    [Object.defineProperty(row('A'),'cashIn',{get(){throw Error('GETTER EXECUTED');},enumerable:true})]])
    assert.throws(()=>project(bad),/trusted|invalid|row|money|numeric|date|finite|accessor/i);
  for(const f of [[],Object.create({includeDeleted:true}),
    {query:{value:'a'}},{backdatedOnly:'true'},{includeDeleted:1},
    {dateFrom:'2026-02-30'},{role:'Administrator'},
    Object.defineProperty({},'module',{get(){throw Error('GETTER EXECUTED');},enumerable:true})])
    assert.throws(()=>project(sample(),f,false),/filter|invalid|trusted|date|unknown|accessor/i);
  assert.throws(()=>project(sample(),{},'Administrator'),/actor|admin|boolean|trusted/i);
});
test('original Day Book UI/RPC unmodified; new projection contains no D1 or financial posting',()=>{
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(ui,/id="dbTotalIn"/);
  assert.match(ui,/id="dbTotalOut"/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(typeof impl?.projectDayBookWindow,'function',
    'M09 Day Book window and totals projection not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-window-totals.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/getDayBookTransactions\s*\(/);
  assert.doesNotMatch(code,/globalThis|CacheService|Date\.parse|new Date\(/);
});
