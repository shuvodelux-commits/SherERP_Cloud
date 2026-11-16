import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const util=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const slice=(s,start,end)=>{
  const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,'Pinned frozen oracle section missing: '+start);
  return s.slice(a,b);
};
const maps=slice(source,'const DAY_BOOK_DELETE_MAP = {','function getDayBookBootstrap(');
const rowFunc=slice(source,'function dayBookRow_(o) {','\n/**');
const salesFunc=slice(source,'function dayBookSalePaymentMethod_(','\n/**');
const purchaseFunc=slice(source,'function dayBookPurchasePaymentMethod_(','\n/**');
const salesBlock=slice(source,'    // ---------------- Sales ----------------','    // ---------------- Sales Returns ----------------');
const purchasesBlock=slice(source,'    // ---------------- Purchases ----------------','    // ---------------- Purchase Returns ----------------');
const oracle=runInNewContext('(function(snapshot,isAdmin,includeDeleted){\n'+
  maps+'\n'+rowFunc+'\n'+salesFunc+'\n'+purchaseFunc+'\n'+
  "function isBankLikePaymentMethod_(method){return ['Bank','Mobile Banking'].includes(method);}\n"+
  "function safeDateOnly_(value){return value;}\n"+
  "function safeTimeOnly_(value){return value||'';}\n"+
  "function isDeleted_(record){return record['Is Deleted']==='TRUE';}\n"+
  'const keep=r=>includeDeleted||!isDeleted_(r);\n'+
  'const sales=snapshot.sales.filter(keep),purchases=snapshot.purchases.filter(keep);\n'+
  "const del=function(r){return {isDeleted:isDeleted_(r),deletedBy:r['Deleted By']||'',"+
  "deleteReason:r['Delete Reason']||''};};\n"+
  'const rows=[];\n'+salesBlock+'\n'+purchasesBlock+'\nreturn rows;\n})');
const clean=x=>JSON.parse(JSON.stringify(x));
const impl=await import('../src/modules/daybook-sales-purchases.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,isAdmin=false,includeDeleted=false){
  assert.equal(typeof impl?.projectDayBookSalesPurchases,'function',
    'M09 Sales and Purchase Day Book projector not implemented');
  return impl.projectDayBookSalesPurchases(snapshot,isAdmin,includeDeleted);
}
function compare(snapshot,isAdmin=false,includeDeleted=false){
  const actual=clean(project(snapshot,isAdmin,includeDeleted));
  const frozen=clean(oracle(clean(snapshot),isAdmin,isAdmin&&includeDeleted));
  assert.deepEqual(actual,frozen,'Day Book source rows must equal pinned GAS output');
  return actual;
}
function sale(id,fields={}){
  return {'Invoice ID':id,'Date':'2026-11-16','Time':'14:31:05',
    'Created At':'2026-11-16T14:31:05','Payment Method':'Cash',
    'Paid Amount':'120.5','Payment Type':'Full','Payment Status':'Paid',
    'Customer Name':'Cash Customer','Customer Phone':'','Created By':'CASHIER',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',...fields};
}
function purchase(id,fields={}){
  return {'Purchase ID':id,'Date':'2026-11-16',
    'Created At':'2026-11-16T14:32:00','Payment Method':'Cash',
    'Paid Amount':'80.75','Payment Status':'Paid',
    'Supplier Name':'Rana Supplier','Notes':'',
    'Created By':'MANAGER','Is Backdated':false,'Backdated Days':'0',
    'Backdated Reason':'','Is Deleted':'','Deleted By':'','Delete Reason':'',...fields};
}
const snapshot=(sales=[],purchases=[])=>({sales,purchases});

test('pinned GAS oracle: source Sales and Purchases exact row shapes, sections, signs and navigation',()=>{
  const result=compare(snapshot([sale('S-1')],[purchase('P-1')]));
  assert.deepEqual(result.map(r=>r.module),['Sales','Purchase']);
  assert.deepEqual(result.map(r=>r.amount),[120.5,-80.75]);
  assert.deepEqual(result.map(r=>r.sourceId),['S-1','P-1']);
  assert.deepEqual(result.map(r=>r.openPage),['sales','purchase']);
  assert.deepEqual(result.map(r=>r.deleteModule),['sales','purchase']);
  assert.equal(result[0].time,'14:31:05');
  assert.equal(result[0].description,'POS sale');
  assert.equal(result[1].description,'Stock purchase');
  assert.equal(result[0].runningCashBalance,undefined);
});

test('legacy blank Payment Method defaults to Cash, but due zero does not fabricate any payment',()=>{
  const result=compare(snapshot([
    sale('S-CASH',{'Payment Method':'','Paid Amount':'60'}),
    sale('S-DUE',{'Payment Type':'Due','Payment Status':'Due','Paid Amount':'0','Payment Method':''})
  ],[
    purchase('P-CASH',{'Payment Method':'','Paid Amount':'45'}),
    purchase('P-DUE',{'Payment Status':'Due','Paid Amount':'0','Payment Method':''})
  ]));
  assert.deepEqual(result.map(x=>x.paymentMethod),['Cash','Cash','Cash','Cash']);
  assert.deepEqual(result.map(x=>x.amount),[60,0,-45,0]);
});

test('Bank and Mobile Banking post to bank book columns, not drawer; unrecognized method remains noncash',()=>{
  const result=compare(snapshot([
    sale('S-BANK',{'Payment Method':'Bank','Paid Amount':'11'}),
    sale('S-MOBILE',{'Payment Method':'Mobile Banking','Paid Amount':'29.5'}),
    sale('S-CREDIT',{'Payment Method':'Store Credit','Paid Amount':'7'})
  ],[
    purchase('P-BANK',{'Payment Method':'Bank','Paid Amount':'100'}),
    purchase('P-MOBILE',{'Payment Method':'Mobile Banking','Paid Amount':'19'}),
    purchase('P-OTHER',{'Payment Method':'Cheque','Paid Amount':'50'})
  ]));
  assert.deepEqual(result.map(x=>x.amount),[11,29.5,0,-100,-19,0]);
  assert.equal(result.every(x=>x.cashIn===0 && x.cashOut===0),true);
  assert.deepEqual(result.map(x=>[x.bankIn,x.bankOut]),[[11,0],[29.5,0],[0,0],[0,100],[0,19],[0,0]]);
});

test('source backdated metadata and Customer Phone/Notes display remain identical',()=>{
  const result=compare(snapshot([
    sale('S-LATE',{'Is Backdated':'TRUE','Backdated Days':'2','Backdated Reason':'Owner approved',
      'Customer Name':'রহিম','Customer Phone':'01700000000'})
  ],[
    purchase('P-LATE',{'Is Backdated':'TRUE','Backdated Days':'3',
      'Backdated Reason':'Previous-day receipt','Notes':'Goods from supplier'})
  ]));
  assert.equal(result[0].isBackdated,true);
  assert.equal(result[0].backdatedDays,2);
  assert.equal(result[0].description,'POS sale — 01700000000');
  assert.equal(result[1].description,'Goods from supplier');
  assert.equal(result[1].backdatedDays,3);
  assert.equal(result[1].isBackdated,true);
});

test('delete rows hidden normally, admin includeDeleted shows source money but window totals exclude it',()=>{
  const rows=snapshot([
    sale('S-VOID',{'Is Deleted':'TRUE','Deleted By':'ADMIN',
      'Delete Reason':'Mistaken entry','Paid Amount':'500'}),
    sale('S-LIVE',{'Paid Amount':'5'})
  ],[
    purchase('P-VOID',{'Is Deleted':'TRUE','Deleted By':'ADMIN',
      'Delete Reason':'Cancelled purchase','Paid Amount':'100'})
  ]);
  assert.deepEqual(compare(rows).map(x=>x.referenceNo),['S-LIVE']);
  assert.deepEqual(compare(rows,false,true).map(x=>x.referenceNo),['S-LIVE']);
  assert.deepEqual(compare(rows,true,false).map(x=>x.referenceNo),['S-LIVE']);
  const admin=compare(rows,true,true);
  assert.deepEqual(admin.map(x=>x.referenceNo),['S-VOID','S-LIVE','P-VOID']);
  assert.equal(admin[0].isDeleted,true);
  assert.equal(admin[0].deletedBy,'ADMIN');
  assert.equal(admin[0].status,'Deleted');
  assert.equal(admin[2].deleteReason,'Cancelled purchase');
  const result=projectDayBookWindow(admin,{includeDeleted:true},true);
  assert.equal(result.count,3);
  assert.equal(result.totals.cashIn,5);
  assert.equal(result.totals.cashOut,0);
});

test('original source order stable and no source snapshot mutation or aliasing',()=>{
  const sold=Object.freeze(sale('S-1'));
  const bought=Object.freeze(purchase('P-1'));
  const s=Object.freeze({sales:Object.freeze([sold]),purchases:Object.freeze([bought])});
  const output=compare(s);
  const second=project(s);
  assert.deepEqual(s.sales.map(x=>x['Invoice ID']),['S-1']);
  assert.notStrictEqual(second[0],sold);
  output[0].party='changed';
  assert.equal(second[0].party,'Cash Customer');
});

test('fail closed on missing arrays, duplicate IDs, wrong actor flags and unsafe references',()=>{
  const samples=[null,{},[],{sales:[],purchases:undefined},
    {sales:[],purchases:[],admin:true},
    snapshot([sale('DUP'),sale('DUP')]),
    snapshot([],[purchase('P-1'),purchase('P-1')]),
    snapshot([sale('__proto__')]),
    snapshot([],[purchase('constructor')]),
    snapshot([sale('S-1',{'Paid Amount':'Not a number'})]),
    snapshot([],[purchase('P-1',{'Paid Amount':Infinity})]),
    snapshot([sale('S-1',{'Date':'2026-02-30'})]),
    snapshot([sale('S-1',{'Created At':'bad'})]),
    snapshot([Object.defineProperty(sale('S-1'),'Paid Amount',
      {enumerable:true,get(){throw Error('getter executed');}})])
  ];
  for(const value of samples)
    assert.throws(()=>project(value),/trusted|invalid|duplicate|date|amount|money|unsafe|array|reference|accessor/i);
  assert.throws(()=>project(snapshot(),'Administrator'),/trusted|admin|boolean/i);
  assert.throws(()=>project(snapshot(),true,'true'),/trusted|admin|boolean/i);
});

test('read-only source projection cannot register RPC, write D1 or alter original UI contract',()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const originalUI=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(originalUI,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookSalesPurchases,'function',
    'M09 Sales and Purchase Day Book projector not implemented');
  const implementation=readFileSync(new URL('../src/modules/daybook-sales-purchases.js',import.meta.url),'utf8');
  assert.doesNotMatch(implementation,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(implementation,/CacheService|globalThis|new Date\(/);
});
