import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const settlement=readFileSync(new URL('../legacy/source/SettlementDiscount.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function segment(data,a,b){
  const start=data.indexOf(a),end=data.indexOf(b,start+a.length);
  assert.ok(start>=0&&end>start,'Original source oracle section missing: '+a);
  return data.slice(start,end);
}
const maps=segment(source,'const DAY_BOOK_DELETE_MAP = {','function getDayBookBootstrap(');
const rowMethod=segment(source,'function dayBookRow_(o) {','\n/**');
const paidBlock=segment(source,
  '    // ---------------- Customer payments ----------------',
  '    // ---------------- Expenses ----------------'
);
const settlementHelpers=segment(settlement,'function settlementPaymentAmount_(row) {',
  'function settlementTotalAmount_(row) {');
const moneyHelper=segment(utils,'function roundMoney_(value) {','\n/**');
const bankMethods=segment(utils,'const BANK_LIKE_PAYMENT_METHODS = ',
  '\n/**');
const oracle=runInNewContext('(function(snapshot,isAdmin,includeDeleted){\n'+
  maps+'\n'+rowMethod+'\n'+moneyHelper+'\n'+bankMethods+'\n'+settlementHelpers+'\n'+
  "function safeDateOnly_(value){return value;}\n"+
  "function isDeleted_(record){return record['Is Deleted']==='TRUE';}\n"+
  'const keep = row => (isAdmin&&includeDeleted)||!isDeleted_(row);\n'+
  'const custPayments=snapshot.customerLedgerRows.filter(row=>row.Type==="Payment"&&keep(row));\n'+
  'const custAdvanceRefunds=snapshot.customerLedgerRows.filter(row=>row.Type==="Advance Refund"&&keep(row));\n'+
  'const supPayments=snapshot.supplierLedgerRows.filter(row=>row.Type==="Payment"&&keep(row));\n'+
  "const del = row => ({isDeleted:isDeleted_(row),"+
  "deletedBy:row['Deleted By']||'',deleteReason:row['Delete Reason']||''});\n"+
  'const rows=[];\n'+paidBlock+'\nreturn rows;\n})');

const plain=v=>JSON.parse(JSON.stringify(v));
const impl=await import('../src/modules/daybook-party-settlements.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,isAdmin=false,includeDeleted=false){
  assert.equal(typeof impl?.projectDayBookPartySettlements,'function',
    'M09 Day Book Party settlements projector not implemented');
  return impl.projectDayBookPartySettlements(snapshot,isAdmin,includeDeleted);
}
function parity(snapshot,isAdmin=false,includeDeleted=false){
  const actual=plain(project(snapshot,isAdmin,includeDeleted));
  const expected=plain(oracle(plain(snapshot),isAdmin,includeDeleted));
  assert.deepEqual(actual,expected,'Day Book Party settlement rows must match frozen GAS output');
  return actual;
}
function customerPayment(id,changes={}){
  return {
    'Ledger ID':id,'Type':'Payment','Date':'2026-11-16',
    'Created At':'2026-11-16T11:01:00','Payment Method':'Cash',
    'Payment Amount':'70.25','Credit':'80.25','Discount Amount':'10',
    'Customer ID':'C-1','Customer Name':'রহিম',
    'Notes':'Dues received','Created By':'CASHIER',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',...changes
  };
}
function customerAdvanceRefund(id,changes={}){
  return {
    'Ledger ID':id,'Type':'Advance Refund','Date':'2026-11-16',
    'Created At':'2026-11-16T11:02:00','Payment Method':'Cash',
    'Debit':'30','Payment Amount':'30','Customer ID':'C-1',
    'Customer Name':'রহিম','Notes':'Advance returned',
    'Created By':'CASHIER','Is Backdated':false,'Backdated Days':'0',
    'Backdated Reason':'','Is Deleted':'','Deleted By':'','Delete Reason':'',...changes
  };
}
function supplierPayment(id,changes={}){
  return {
    'Ledger ID':id,'Type':'Payment','Date':'2026-11-16',
    'Created At':'2026-11-16T11:03:00','Payment Method':'Cash',
    'Payment Amount':'45.5','Credit':'50.5','Discount Amount':'5',
    'Supplier ID':'SUP-1','Supplier Name':'Supplier',
    'Notes':'Paid invoice','Created By':'OWNER',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',...changes
  };
}
const sample=(customerLedgerRows=[],supplierLedgerRows=[])=>({customerLedgerRows,supplierLedgerRows});

test('pinned source exact Customer Payment, Advance Refund, Supplier Payment rows and original navigation',()=>{
  const rows=parity(sample([customerPayment('CP-1'),customerAdvanceRefund('CA-1')],[supplierPayment('SP-1')]));
  assert.deepEqual(rows.map(x=>x.module),['Customer Payment','Customer Advance Refund','Supplier Payment']);
  assert.deepEqual(rows.map(x=>x.amount),[70.25,-30,-45.5]);
  assert.deepEqual(rows.map(x=>x.sourceId),['CP-1','CA-1','SP-1']);
  assert.deepEqual(rows.map(x=>x.openId),['C-1','C-1','SUP-1']);
  assert.deepEqual(rows.map(x=>x.openPage),['customers','customerLedger','suppliers']);
  assert.deepEqual(rows.map(x=>x.deleteModule),['customer payment','','supplier payment']);
  assert.deepEqual(rows.map(x=>x.deleteId),['CP-1','CA-1','SP-1']);
  assert.deepEqual(rows.map(x=>x.transactionType),['Due Collection','Advance Refund','Due Payment']);
  assert.equal(rows[0].description,'Dues received — Discount 10');
  assert.equal(rows[2].description,'Paid invoice — Discount 5');
  assert.equal(rows[1].description,'Advance returned');
});

test('settlement Payment Amount is actual cash/bank; Discount Amount never becomes movement',()=>{
  const rows=parity(sample([
    customerPayment('CP-1',{'Payment Amount':'20.015','Discount Amount':'10.015','Credit':'30.03',
      'Notes':'','Payment Method':'Bank'})
  ],[supplierPayment('SP-1',{'Payment Amount':'40.005','Discount Amount':'11',
    'Credit':'51','Payment Method':'Mobile Banking','Notes':''})]));
  assert.deepEqual(rows.map(x=>x.amount),[20.02,-40.01]);
  assert.equal(rows[0].cashIn,0);
  assert.equal(rows[0].bankIn,20.02);
  assert.equal(rows[0].description,'Payment received — Discount 10.02');
  assert.equal(rows[1].bankOut,40.01);
  assert.equal(rows[1].description,'Payment made — Discount 11');
});

test('legacy blank Payment Amount falls back to Credit; explicit zero does not',()=>{
  const result=parity(sample([
    customerPayment('CP-OLD',{'Payment Amount':'','Credit':'75','Discount Amount':''}),
    customerPayment('CP-NULL',{'Payment Amount':null,'Credit':'12.345','Discount Amount':null}),
    customerPayment('CP-EXPLICIT',{'Payment Amount':'0','Credit':'999'})
  ],[supplierPayment('SP-OLD',{'Payment Amount':'','Credit':'37.555','Discount Amount':''})]));
  assert.deepEqual(result.map(x=>x.amount),[75,12.35,0,-37.56]);
});

test('Advance Refund uses Debit first, then Payment Amount, without interpreting Credit',()=>{
  const rows=parity(sample([
    customerAdvanceRefund('CA-DEBIT',{'Debit':'25','Payment Amount':'100','Credit':'300'}),
    customerAdvanceRefund('CA-FALLBACK',{'Debit':'0','Payment Amount':'60','Credit':'500',
      'Payment Method':'Bank'}),
    customerAdvanceRefund('CA-MOBILE',{'Debit':'','Payment Amount':'23',
      'Payment Method':'Mobile Banking'}),
    customerAdvanceRefund('CA-NONCASH',{'Debit':'10','Payment Amount':'10',
      'Payment Method':'Store Credit'}),
    customerAdvanceRefund('CA-ZERO',{'Debit':'','Payment Amount':'','Credit':'800'})
  ]));
  assert.deepEqual(rows.map(x=>x.amount),[-25,-60,-23,0,0]);
  assert.deepEqual(rows.map(x=>x.paymentMethod),['Cash','Bank','Mobile Banking','Store Credit','Cash']);
  assert.deepEqual(rows.map(x=>x.cashOut),[25,0,0,0,0]);
  assert.deepEqual(rows.map(x=>x.bankOut),[0,60,23,0,0]);
});

test('all recognized methods, unknown noncash, and blank historical Cash method agree with frozen source',()=>{
  const result=parity(sample([
    customerPayment('C-MOBILE',{'Payment Method':'Mobile Banking','Payment Amount':'50'}),
    customerPayment('C-BLANK',{'Payment Method':'','Payment Amount':'6'}),
    customerPayment('C-CREDIT',{'Payment Method':'Store Credit','Payment Amount':'999'})
  ],[
    supplierPayment('S-BANK',{'Payment Method':'Bank','Payment Amount':'20'}),
    supplierPayment('S-CHEQUE',{'Payment Method':'Cheque','Payment Amount':'500'}),
    supplierPayment('S-BLANK',{'Payment Method':'','Payment Amount':'30'})
  ]));
  assert.deepEqual(result.map(x=>x.amount),[50,6,0,-20,0,-30]);
  assert.deepEqual(result.map(x=>x.paymentMethod),
    ['Mobile Banking','Cash','Store Credit','Bank','Cheque','Cash']);
});

test('full ledger groups filter by original Type, preserve section order and date-only timestamps',()=>{
  const rows=parity(sample([
    customerAdvanceRefund('CA-1',{'Created At':''}),
    customerPayment('CP-1',{'Created At':null}),
    {'Type':'Opening Balance','Ledger ID':'OB-1','Customer Name':'Do not project'},
    customerPayment('CP-2',{'Created At':'2026-11-15T23:00:00','Date':'2026-11-15'})
  ],[
    {'Type':'Purchase Return Credit','Ledger ID':'SUP-NONPAY','Reference':'PR-1'},
    supplierPayment('SP-1',{'Created At':''})
  ]));
  assert.deepEqual(rows.map(x=>x.referenceNo),['CP-1','CP-2','CA-1','SP-1']);
  assert.deepEqual(rows.map(x=>x.ts),['2026-11-16','2026-11-15T23:00:00',
    '2026-11-16','2026-11-16']);
});

test('admin-only deleted rows retain source amounts but downstream report skips totals',()=>{
  const snapshot=sample([
    customerPayment('CP-DEL',{'Is Deleted':'TRUE','Deleted By':'ADMIN',
      'Delete Reason':'Duplicate collection'}),
    customerPayment('CP-LIVE',{'Payment Amount':'5','Discount Amount':''}),
    customerAdvanceRefund('CA-DEL',{'Is Deleted':'TRUE','Deleted By':'ADMIN',
      'Delete Reason':'Reverse advance'})
  ],[supplierPayment('SP-DEL',{'Is Deleted':'TRUE','Deleted By':'OWNER',
    'Delete Reason':'Wrong supplier'})]);
  assert.deepEqual(parity(snapshot).map(x=>x.referenceNo),['CP-LIVE']);
  assert.deepEqual(parity(snapshot,false,true).map(x=>x.referenceNo),['CP-LIVE']);
  const rows=parity(snapshot,true,true);
  assert.deepEqual(rows.map(x=>x.status),['Deleted','Active','Deleted','Deleted']);
  assert.deepEqual(rows.map(x=>x.amount),[70.25,5,-30,-45.5]);
  assert.equal(rows[0].deletedBy,'ADMIN');
  assert.equal(rows[3].deleteReason,'Wrong supplier');
  const window=projectDayBookWindow(rows,{includeDeleted:true},true);
  assert.equal(window.count,4);
  assert.equal(window.totals.cashIn,5);
  assert.equal(window.totals.cashOut,0);
});

test('source backdated/audit metadata, no notes fallback and no input mutation',()=>{
  const cust=Object.freeze(customerPayment('CP-BD',{'Notes':'',
    'Is Backdated':'TRUE','Backdated Days':'2','Backdated Reason':'Owner approval'}));
  const supplier=Object.freeze(supplierPayment('SP-BD',{'Notes':'',
    'Is Backdated':'TRUE','Backdated Days':'4','Backdated Reason':'Historical check'}));
  const sourceSnapshot=Object.freeze({
    customerLedgerRows:Object.freeze([cust]),
    supplierLedgerRows:Object.freeze([supplier])
  });
  const result=parity(sourceSnapshot);
  assert.deepEqual(result.map(x=>x.description),
    ['Payment received — Discount 10','Payment made — Discount 5']);
  assert.deepEqual(result.map(x=>x.isBackdated),[true,true]);
  assert.deepEqual(result.map(x=>x.backdatedDays),[2,4]);
  const next=project(sourceSnapshot);
  result[0].party='tampered';
  assert.equal(next[0].party,'রহিম');
  assert.equal(cust['Payment Amount'],'70.25');
});

test('reject incomplete, unsafe, accessor-based or financially corrupt trusted source snapshots',()=>{
  const bad=[
    null,[],{},{customerLedgerRows:[],supplierLedgerRows:undefined},
    {...sample(),unexpected:'external'},
    sample([customerPayment('CP-X'),customerPayment('CP-X')]),
    sample([customerPayment('__proto__')]),
    sample([],[supplierPayment('constructor')]),
    sample([customerPayment('CP-1',{'Payment Amount':Infinity})]),
    sample([customerPayment('CP-1',{'Discount Amount':'nan value'})]),
    sample([],[supplierPayment('SP-1',{'Payment Amount':'not-money'})]),
    sample([customerAdvanceRefund('CA-1',{'Debit':'Infinity'})]),
    sample([customerPayment('CP-1',{'Date':'2026-02-30'})]),
    sample([],[supplierPayment('SP-1',{'Created At':'bad'})]),
    sample([Object.defineProperty(customerPayment('CP-1'),'Credit',
      {enumerable:true,get(){throw Error('getter executed');}})]),
    sample([],[Object.defineProperty(supplierPayment('SP-1'),'Payment Method',
      {enumerable:true,get(){throw Error('getter executed');}})])
  ];
  for(const s of bad)
    assert.throws(()=>project(s),/trusted|invalid|duplicate|unsafe|amount|money|date|timestamp|reference|array|accessor|snapshot|finite|field/i);
  assert.throws(()=>project(sample(),'Administrator'),/trusted|boolean|admin/i);
  assert.throws(()=>project(sample(),true,'true'),/trusted|boolean|admin/i);
});

test('read-only helper leaves original Day Book UI, RPC denylist and Cloudflare preview DB-free',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookPartySettlements,'function',
    'M09 Day Book Party settlements projector not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-party-settlements.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/CacheService|globalThis|new Date\(/);
});
