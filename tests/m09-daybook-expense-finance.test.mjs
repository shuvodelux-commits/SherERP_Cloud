import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const dayBook=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const finance=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
function frozenSlice(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Pinned frozen-source section missing: '+start);
  return source.slice(a,b);
}
const maps=frozenSlice(dayBook,'const DAY_BOOK_DELETE_MAP = {','function getDayBookBootstrap(');
const row=frozenSlice(dayBook,'function dayBookRow_(o) {','\n/**');
const expenses=frozenSlice(dayBook,'    // ---------------- Expenses ----------------',
  '    // ---------------- Finance (Business Finance: capital & loans) ----------------');
const financeBlock=frozenSlice(dayBook,
  '    // ---------------- Finance (Business Finance: capital & loans) ----------------',
  '    // ---------------- Standalone bank activity ----------------');
const types=frozenSlice(finance,'const FINANCE_TRANSACTION_TYPES = [','function financeTxnPersonKey_(');
const oracle=runInNewContext('(function(snapshot,isAdmin,includeDeleted){\n'+
  maps+'\n'+row+'\n'+types+'\n'+
  "function safeDateOnly_(value){return value;}\n"+
  "function isDeleted_(r){return r['Is Deleted']==='TRUE';}\n"+
  "function isBankLikePaymentMethod_(method){return ['Bank','Mobile Banking'].includes(method);}\n"+
  'const keep=r=>(isAdmin&&includeDeleted)||!isDeleted_(r);\n'+
  'const del=r=>({isDeleted:isDeleted_(r),'+
    "deletedBy:r['Deleted By']||'',deleteReason:r['Delete Reason']||''});\n"+
  'const rows=[];\nconst expenseDocs=snapshot.expenses;\n'+
  'const expenses=expenseDocs.filter(keep);\n'+
  "function getAllRows_(name){if(name==='FINANCE_TRANSACTIONS')return snapshot.financeTransactions;"+
    "throw Error('unexpected frozen source '+name);}\n"+
  expenses+'\n'+financeBlock+'\nreturn rows;\n})');

const plain=x=>JSON.parse(JSON.stringify(x));
const impl=await import('../src/modules/daybook-expense-finance.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,isAdmin=false,includeDeleted=false){
  assert.equal(typeof impl?.projectDayBookExpenseFinanceRows,'function',
    'M09 Day Book Expense Finance projector not implemented');
  return impl.projectDayBookExpenseFinanceRows(snapshot,isAdmin,includeDeleted);
}
function compare(snapshot,isAdmin=false,includeDeleted=false){
  const actual=plain(project(snapshot,isAdmin,includeDeleted));
  const expected=plain(oracle(plain(snapshot),isAdmin,includeDeleted));
  assert.deepEqual(actual,expected,'Expense/Finance Day Book rows must equal pinned original GAS complete output');
  return actual;
}
function expense(id,fields={}){
  return {
    'Expense ID':id,'Date':'2026-11-16','Created At':'2026-11-16T12:10:00',
    'Payment Method':'Cash','Amount':'125.4',
    'Category Name':'Electricity','Ledger Name':'Power Company',
    'Description':'Shop bill','Status':'Paid','Created By':'MANAGER',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...fields
  };
}
function financeTx(id,type,fields={}){
  return {
    'Finance ID':id,'Date':'2026-11-16','Created At':'2026-11-16T12:20:00',
    'Transaction Type':type,'Payment Method':'Cash','Amount':'250.5',
    'Person':'Owner A','Notes':'','Reference No':'','Created By':'OWNER',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...fields
  };
}
const snap=(expenses=[],financeTransactions=[])=>({expenses,financeTransactions});

test('pinned GAS source produces exactly ordered Expense/Finance rows with original navigation',()=>{
  const rows=compare(snap([expense('E-1')],[financeTx('F-1','Owner Investment')]));
  assert.deepEqual(rows.map(r=>r.module),['Expense','Finance']);
  assert.deepEqual(rows.map(r=>r.referenceNo),['E-1','F-1']);
  assert.deepEqual(rows.map(r=>r.sourceId),['E-1','F-1']);
  assert.deepEqual(rows.map(r=>r.openPage),['expenseList','financeLedger']);
  assert.deepEqual(rows.map(r=>r.openId),['E-1','F-1']);
  assert.deepEqual(rows.map(r=>r.deleteModule),['expense','finance']);
  assert.deepEqual(rows.map(r=>r.deleteId),['E-1','F-1']);
  assert.deepEqual(rows.map(r=>r.amount),[-125.4,250.5]);
  assert.equal(rows[0].transactionType,'Electricity');
  assert.equal(rows[1].transactionType,'Owner Credit');
  assert.equal(rows[1].description,'Owner Credit');
  assert.equal(rows[0].description,'Shop bill');
});

test('Expense cash/Bank/Mobile Banking directions, fallback Cash and unknown noncash methods',()=>{
  const rows=compare(snap([
    expense('E-CASH',{'Amount':'100','Payment Method':'Cash'}),
    expense('E-BANK',{'Amount':'45','Payment Method':'Bank'}),
    expense('E-MOBILE',{'Amount':'12.5','Payment Method':'Mobile Banking'}),
    expense('E-LEGACY',{'Amount':'20','Payment Method':'','Category Name':'',
      'Ledger Name':'','Description':''}),
    expense('E-CREDIT',{'Amount':'200','Payment Method':'Store Credit'})
  ]));
  assert.deepEqual(rows.map(r=>r.amount),[-100,-45,-12.5,-20,0]);
  assert.deepEqual(rows.map(r=>r.cashOut),[100,0,0,20,0]);
  assert.deepEqual(rows.map(r=>r.bankOut),[0,45,12.5,0,0]);
  assert.equal(rows[3].transactionType,'Expense');
  assert.equal(rows[3].party,'');
  assert.equal(rows[3].paymentMethod,'Cash');
});

test('cancelled Expenses stay visible but zero both Cash and Bank; deleted Admin Expenses also zero',()=>{
  const records=snap([
    expense('E-CANCELLED',{'Status':'Cancelled','Amount':'400'}),
    expense('E-CANCELLED-BANK',{'Status':'Cancelled','Payment Method':'Bank','Amount':'250'}),
    expense('E-DELETED',{'Is Deleted':'TRUE','Deleted By':'ADMIN','Delete Reason':'Duplicate',
      'Amount':'999','Payment Method':'Mobile Banking'}),
    expense('E-LIVE',{'Amount':'7'})
  ]);
  const normal=compare(records);
  assert.deepEqual(normal.map(r=>r.referenceNo),['E-CANCELLED','E-CANCELLED-BANK','E-LIVE']);
  assert.deepEqual(normal.map(r=>r.status),['Cancelled','Cancelled','Active']);
  assert.deepEqual(normal.map(r=>r.amount),[0,0,-7]);
  const admin=compare(records,true,true);
  assert.deepEqual(admin.map(r=>r.status),['Cancelled','Cancelled','Deleted','Active']);
  assert.deepEqual(admin.map(r=>r.amount),[0,0,0,-7]);
  assert.equal(admin[2].deletedBy,'ADMIN');
  assert.equal(admin[2].deleteReason,'Duplicate');
  const visible=projectDayBookWindow(admin,{includeDeleted:true},true);
  assert.equal(visible.count,4);
  assert.equal(visible.totals.cashOut,7);
  assert.equal(visible.totals.bankOut,0);
});

test('all six Finance source cash-bearing types preserve original labels and Cash movement direction',()=>{
  const kinds=[
    ['Owner Investment','Owner Credit',250.5],
    ['Owner Withdrawal','Owner Debit',-250.5],
    ['Loan Received','Lender Credit',250.5],
    ['Loan Repayment','Lender Debit',-250.5],
    ['Borrower Loan','Borrower Debit',-250.5],
    ['Borrower Repayment','Borrower Credit',250.5]
  ];
  const rows=compare(snap([],kinds.map((k,i)=>financeTx('F-'+i,k[0]))));
  assert.deepEqual(rows.map(r=>r.transactionType),kinds.map(k=>k[1]));
  assert.deepEqual(rows.map(r=>r.amount),kinds.map(k=>k[2]));
  assert.deepEqual(rows.map(r=>r.cashIn),[250.5,0,250.5,0,0,250.5]);
  assert.deepEqual(rows.map(r=>r.cashOut),[0,250.5,0,250.5,250.5,0]);
  assert.equal(rows.every(r=>r.bankIn===0&&r.bankOut===0),true);
});

test('Finance Bank and Mobile Banking use original finance type directions without cash movements',()=>{
  const rows=compare(snap([],[
    financeTx('F-BANK-IN','Loan Received',{'Payment Method':'Bank','Amount':'100'}),
    financeTx('F-BANK-OUT','Loan Repayment',{'Payment Method':'Bank','Amount':'15'}),
    financeTx('F-MOBILE-IN','Owner Investment',{'Payment Method':'Mobile Banking','Amount':'8'}),
    financeTx('F-MOBILE-OUT','Borrower Loan',{'Payment Method':'Mobile Banking','Amount':'5'}),
    financeTx('F-UNKNOWN-METHOD','Borrower Repayment',{'Payment Method':'Store Credit','Amount':'3'}),
    financeTx('F-BLANK-METHOD','Owner Withdrawal',{'Payment Method':'','Amount':'2'})
  ]));
  assert.deepEqual(rows.map(r=>r.amount),[100,-15,8,-5,0,-2]);
  assert.deepEqual(rows.map(r=>r.bankIn),[100,0,8,0,0,0]);
  assert.deepEqual(rows.map(r=>r.bankOut),[0,15,0,5,0,0]);
  assert.deepEqual(rows.map(r=>r.cashOut),[0,0,0,0,0,2]);
});

test('opening Owner/Lender/Borrower records are NEVER new Cash or Bank activity, even if method populated',()=>{
  const kinds=['Opening Owner Capital','Opening Loan','Opening Borrower Loan'];
  const rows=compare(snap([],[
    financeTx('F-O1',kinds[0],{'Payment Method':'Cash','Amount':'1000'}),
    financeTx('F-O2',kinds[1],{'Payment Method':'Bank','Amount':'1000'}),
    financeTx('F-O3',kinds[2],{'Payment Method':'Mobile Banking','Amount':'1000'})
  ]));
  assert.deepEqual(rows.map(r=>r.transactionType),kinds);
  assert.deepEqual(rows.map(r=>r.paymentMethod),['','','']);
  assert.equal(rows.every(r=>r.cashIn===0&&r.cashOut===0&&r.bankIn===0&&r.bankOut===0&&r.amount===0),true);
});

test('unknown Finance type is a cash-neutral source display row; note/ref and Created At date-only fallback',()=>{
  const rows=compare(snap([],[
    financeTx('F-UNKNOWN','Custom Opening Adjustment',{'Amount':'180','Payment Method':'Bank',
      'Created At':'','Notes':'','Reference No':'AC-4'}),
    financeTx('F-NOTE','Borrower Loan',{'Notes':'Emergency vendor fund','Reference No':'REF-7',
      'Created At':null,'Date':'2026-11-15'}),
    financeTx('F-EMPTY','Loan Received',{'Notes':'','Reference No':''})
  ]));
  assert.equal(rows[0].paymentMethod,'');
  assert.equal(rows[0].amount,0);
  assert.equal(rows[0].transactionType,'Custom Opening Adjustment');
  assert.equal(rows[0].description,'Finance entry — AC-4');
  assert.equal(rows[0].ts,'2026-11-16');
  assert.equal(rows[1].description,'Emergency vendor fund — REF-7');
  assert.equal(rows[1].ts,'2026-11-15');
  assert.equal(rows[2].description,'Lender Credit');
});

test('Admin deletion is filtered by source but displayed Finance amount remains until downstream totals',()=>{
  const records=snap([],[financeTx('F-DEL','Loan Received',{
    'Is Deleted':'TRUE','Deleted By':'OWNER','Delete Reason':'Wrong loan',
    'Amount':'999'}),financeTx('F-LIVE','Loan Repayment',{'Amount':'30'})]);
  assert.deepEqual(compare(records).map(r=>r.referenceNo),['F-LIVE']);
  assert.deepEqual(compare(records,false,true).map(r=>r.referenceNo),['F-LIVE']);
  assert.deepEqual(compare(records,true,false).map(r=>r.referenceNo),['F-LIVE']);
  const rows=compare(records,true,true);
  assert.deepEqual(rows.map(r=>r.amount),[999,-30]);
  assert.equal(rows[0].status,'Deleted');
  assert.equal(rows[0].deletedBy,'OWNER');
  assert.equal(rows[0].deleteReason,'Wrong loan');
  const view=projectDayBookWindow(rows,{includeDeleted:true},true);
  assert.equal(view.count,2);
  assert.equal(view.totals.cashIn,0);
  assert.equal(view.totals.cashOut,30);
});

test('original backdated/audit and section order remain source-shaped, input is never mutated or aliased',()=>{
  const e=Object.freeze(expense('E-BD',{'Is Backdated':'TRUE','Backdated Days':'3',
    'Backdated Reason':'Manager approval'}));
  const f=Object.freeze(financeTx('F-BD','Owner Withdrawal',{'Is Backdated':'TRUE',
    'Backdated Days':'2','Backdated Reason':'Previous event'}));
  const source=Object.freeze({expenses:Object.freeze([e]),financeTransactions:Object.freeze([f])});
  const result=compare(source);
  assert.deepEqual(result.map(r=>r.isBackdated),[true,true]);
  assert.deepEqual(result.map(r=>r.backdatedDays),[3,2]);
  assert.equal(result[0].backdatedReason,'Manager approval');
  const again=project(source);
  result[0].party='tampered';
  assert.equal(again[0].party,'Power Company');
  assert.equal(e.Amount,'125.4');
  assert.equal(f.Amount,'250.5');
  assert.deepEqual(compare(snap()),[]);
});

test('reject malformed, missing, hostile accessor, duplicate IDs and unsafe Finance/Expense values',()=>{
  const invalid=[
    null,[],{}, {expenses:[],financeTransactions:undefined},
    {...snap(),extra:'unknown'},
    snap([expense('E-1'),expense('E-1')]),
    snap([],[financeTx('F-1','Owner Investment'),financeTx('F-1','Owner Withdrawal')]),
    snap([expense('__proto__')]),
    snap([],[financeTx('constructor','Loan Received')]),
    snap([expense('E-BAD',{'Amount':'not money'})]),
    snap([],[financeTx('F-BAD','Owner Investment',{'Amount':Infinity})]),
    snap([expense('E-BAD',{'Date':'2026-02-30'})]),
    snap([],[financeTx('F-BAD','Loan Received',{'Created At':'not an ISO timestamp'})]),
    snap([Object.defineProperty(expense('E-1'),'Amount',{
      enumerable:true,get(){throw Error('getter executed');}
    })]),
    snap([],[Object.defineProperty(financeTx('F-1','Loan Received'),'Transaction Type',{
      enumerable:true,get(){throw Error('getter executed');}
    })])
  ];
  for(const candidate of invalid)
    assert.throws(()=>project(candidate),/trusted|invalid|duplicate|unsafe|amount|date|timestamp|reference|array|accessor|snapshot|finite|field/i);
  assert.throws(()=>project(snap(),'Administrator'),/trusted|boolean|admin/i);
  assert.throws(()=>project(snap(),true,'true'),/trusted|boolean|admin/i);
});

test('original UI/serverCall and closed public RPC remain unchanged, no D1/financial posting added',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookExpenseFinanceRows,'function',
    'M09 Day Book Expense Finance projector not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-expense-finance.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/CacheService|globalThis|new Date\(/);
});
