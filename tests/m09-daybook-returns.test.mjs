import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const slice=(from,to)=>{
  const a=source.indexOf(from),b=source.indexOf(to,a+from.length);
  assert.ok(a>=0 && b>a,'Frozen original DayBook.gs section missing: '+from);
  return source.slice(a,b);
};
const maps=slice('const DAY_BOOK_DELETE_MAP = {','function getDayBookBootstrap(');
const rowMethod=slice('function dayBookRow_(o) {','\n/**');
const salesReturnBlock=slice(
  '    // ---------------- Sales Returns ----------------',
  '    // ---------------- Purchases ----------------'
);
const purchaseReturnBlock=slice(
  '    // ---------------- Purchase Returns ----------------',
  '    // ---------------- Customer payments ----------------'
);
const oracle=runInNewContext('(function(snapshot,isAdmin,includeDeleted){\n'+
  maps+'\n'+rowMethod+'\n'+
  "function safeDateOnly_(date){return date;}\n"+
  "function isDeleted_(record){return record['Is Deleted']==='TRUE';}\n"+
  'const keep = r => (isAdmin && includeDeleted) || !isDeleted_(r);\n'+
  'const del = r => ({isDeleted:isDeleted_(r),'+
    "deletedBy:r['Deleted By']||'',deleteReason:r['Delete Reason']||''});\n"+
  "const supplierLedgerRows=snapshot.supplierLedgerRows;\n"+
  "function getAllRows_(table){ if(table==='SALES_RETURN')return snapshot.salesReturns;"+
  "if(table==='PURCHASE_RETURN')return snapshot.purchaseReturns;"+
  "throw new Error('Unexpected legacy source '+table); }\n"+
  'const rows=[];\n'+salesReturnBlock+'\n'+purchaseReturnBlock+
  '\nreturn rows;\n})');

const json=v=>JSON.parse(JSON.stringify(v));
const impl=await import('../src/modules/daybook-returns.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot,isAdmin=false,includeDeleted=false){
  assert.equal(typeof impl?.projectDayBookReturnRows,'function',
    'M09 Sales/Purchase Return Day Book projector not implemented');
  return impl.projectDayBookReturnRows(snapshot,isAdmin,includeDeleted);
}
function parity(snapshot,isAdmin=false,includeDeleted=false){
  const actual=json(project(snapshot,isAdmin,includeDeleted));
  const expected=json(oracle(json(snapshot),isAdmin,includeDeleted));
  assert.deepEqual(actual,expected,'Original GAS Return source blocks must match full Day Book row shape');
  return actual;
}
function salesReturn(id,extra={}){
  return {
    'Return ID':id,'Invoice ID':'S-1','Created At':'2026-11-16T11:15:00',
    'Date':'2026-11-16','Refund Method':'Cash',
    'Total Return Amount':'101.25','Customer Name':'রহিম',
    'Reason':'Damaged','Processed By':'MGR',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',...extra
  };
}
function purchaseReturn(id,extra={}){
  return {
    'Return ID':id,'Purchase ID':'P-1','Created At':'2026-11-16T11:20:00',
    'Date':'2026-11-16','Total Return Amount':'65.75',
    'Supplier Name':'Supplier A','Reason':'Wrong size','Processed By':'OWNER',
    'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',
    'Is Deleted':'','Deleted By':'','Delete Reason':'',...extra
  };
}
const snap=(salesReturns=[],purchaseReturns=[],supplierLedgerRows=[])=>({
  salesReturns,purchaseReturns,supplierLedgerRows
});
const credit=(ref,extra={})=>({
  'Ledger ID':'SL-'+ref,'Reference':ref,'Type':'Purchase Return Credit',...extra
});

test('original Sales Return Cash and Purchase Return Cash map exact signed source rows and navigation',()=>{
  const result=parity(snap([salesReturn('SR-1')],[purchaseReturn('PR-1')]));
  assert.deepEqual(result.map(r=>r.module),['Sales Return','Purchase Return']);
  assert.deepEqual(result.map(r=>r.amount),[-101.25,65.75]);
  assert.deepEqual(result.map(r=>r.referenceNo),['SR-1','PR-1']);
  assert.deepEqual(result.map(r=>r.sourceId),['SR-1','PR-1']);
  assert.deepEqual(result.map(r=>r.openId),['S-1','P-1']);
  assert.deepEqual(result.map(r=>r.openPage),['returnHistory','returns']);
  assert.equal(result[0].deleteModule,'sales return');
  assert.equal(result[1].deleteModule,'');
  assert.equal(result[0].deleteId,'SR-1');
  assert.equal(result[1].deleteId,'PR-1');
  assert.equal(result[0].cashOut,101.25);
  assert.equal(result[1].cashIn,65.75);
  assert.equal(result[0].bankOut,0);
  assert.equal(result[1].bankIn,0);
});

test('Sales Return Bank refund moves bankOut, source other refund methods create Store Credit with zero money',()=>{
  const result=parity(snap([
    salesReturn('SR-BANK',{'Refund Method':'Bank','Total Return Amount':'11'}),
    salesReturn('SR-STORE',{'Refund Method':'Store Credit','Total Return Amount':'19'}),
    salesReturn('SR-MOBILE',{'Refund Method':'Mobile Banking','Total Return Amount':'21'}),
    salesReturn('SR-OTHER',{'Refund Method':'Cheque','Total Return Amount':'35'}),
    salesReturn('SR-LEGACY',{'Refund Method':'','Total Return Amount':'10'})
  ]));
  assert.deepEqual(result.map(r=>r.amount),[-11,0,0,0,-10]);
  assert.deepEqual(result.map(r=>r.paymentMethod),
    ['Bank','Store Credit','Store Credit','Store Credit','Cash']);
  assert.deepEqual(result.map(r=>r.transactionType),
    ['Bank Refund','Store Credit Refund','Mobile Banking Refund','Cheque Refund','Cash Refund']);
  assert.equal(result[0].bankOut,11);
  assert.equal(result[4].cashOut,10);
});

test('Purchase Return Supplier Credit derived from exact complete Supplier Ledger Type and Reference',()=>{
  const snapshot=snap([],[
    purchaseReturn('PR-CREDIT'),
    purchaseReturn('PR-CASH',{'Total Return Amount':'22'}),
    purchaseReturn('PR-CREDIT-DELETED',{'Total Return Amount':'31'})
  ],[
    credit('PR-CREDIT'),
    {'Ledger ID':'SL-OTHER','Reference':'PR-CASH','Type':'Payment'},
    credit('PR-CREDIT-DELETED',{'Is Deleted':'TRUE'}),
    credit('DOES-NOT-MATCH')
  ]);
  const result=parity(snapshot);
  assert.deepEqual(result.map(r=>r.paymentMethod),['Supplier Credit','Cash','Supplier Credit']);
  assert.deepEqual(result.map(r=>r.cashIn),[0,22,0]);
  assert.deepEqual(result.map(r=>r.amount),[0,22,0]);
  assert.equal(result[0].transactionType,'Purchase Return');
  assert.equal(result[0].cashOut,0);
  assert.equal(result[0].bankIn,0);
  assert.equal(result[0].bankOut,0);
});

test('Admin-only deleted return rows preserve source amounts, marked Deleted but excluded from report totals',()=>{
  const data=snap([
    salesReturn('SR-VOID',{'Is Deleted':'TRUE','Deleted By':'ADMIN','Delete Reason':'Duplicate refund'}),
    salesReturn('SR-LIVE',{'Total Return Amount':'5'})
  ],[purchaseReturn('PR-VOID',{'Is Deleted':'TRUE','Deleted By':'OWNER',
     'Delete Reason':'Reversed purchase return'})]);
  assert.deepEqual(parity(data).map(r=>r.referenceNo),['SR-LIVE']);
  assert.deepEqual(parity(data,false,true).map(r=>r.referenceNo),['SR-LIVE']);
  assert.deepEqual(parity(data,true,false).map(r=>r.referenceNo),['SR-LIVE']);
  const admin=parity(data,true,true);
  assert.deepEqual(admin.map(r=>r.referenceNo),['SR-VOID','SR-LIVE','PR-VOID']);
  assert.deepEqual(admin.map(r=>r.status),['Deleted','Active','Deleted']);
  assert.equal(admin[0].deletedBy,'ADMIN');
  assert.equal(admin[2].deleteReason,'Reversed purchase return');
  assert.equal(admin[0].cashOut,101.25);
  assert.equal(admin[2].cashIn,65.75);
  const filtered=projectDayBookWindow(admin,{includeDeleted:true},true);
  assert.equal(filtered.count,3);
  assert.equal(filtered.totals.cashOut,5);
  assert.equal(filtered.totals.cashIn,0);
});

test('source metadata, original reason descriptions and backdated flags preserved',()=>{
  const result=parity(snap([
    salesReturn('SR-OLDER',{'Invoice ID':'S-OLD','Reason':'Faulty switch',
      'Is Backdated':'TRUE','Backdated Days':'3','Backdated Reason':'Supervisor approved',
      'Processed By':'COUNTER','Customer Name':'মোহিম'})
  ],[purchaseReturn('PR-OLDER',{'Purchase ID':'P-OLD','Reason':'Damaged pipe',
    'Is Backdated':'TRUE','Backdated Days':'2','Backdated Reason':'Original goods date'})]));
  assert.equal(result[0].party,'মোহিম');
  assert.equal(result[0].description,'Return against S-OLD — Faulty switch');
  assert.equal(result[1].description,'Return against P-OLD — Damaged pipe');
  assert.deepEqual(result.map(r=>r.isBackdated),[true,true]);
  assert.deepEqual(result.map(r=>r.backdatedDays),[3,2]);
  assert.equal(result[0].backdatedReason,'Supervisor approved');
  assert.equal(result[1].createdBy,'OWNER');
});

test('zero values, blanks and empty source groups match frozen source and do not create phantom cash',()=>{
  assert.deepEqual(parity(snap()),[]);
  const result=parity(snap([
    salesReturn('SR-ZERO',{'Total Return Amount':'','Refund Method':'','Reason':''})
  ],[purchaseReturn('PR-ZERO',{'Total Return Amount':'0','Reason':''})]));
  assert.deepEqual(result.map(r=>r.amount),[0,0]);
  assert.deepEqual(result.map(r=>r.description),['Return against S-1','Return against P-1']);
});

test('source snapshots stay immutable and output records detached from inputs',()=>{
  const a=Object.freeze(salesReturn('SR-1'));
  const b=Object.freeze(purchaseReturn('PR-1'));
  const c=Object.freeze(credit('PR-1'));
  const snapshot=Object.freeze({salesReturns:Object.freeze([a]),
    purchaseReturns:Object.freeze([b]),supplierLedgerRows:Object.freeze([c])});
  const first=parity(snapshot),second=project(snapshot);
  first[0].party='MUTATED';
  assert.equal(second[0].party,'রহিম');
  assert.equal(a['Customer Name'],'রহিম');
  assert.equal(b['Total Return Amount'],'65.75');
  assert.equal(c.Reference,'PR-1');
});

test('fail closed for incomplete supplier-ledger feed, unsafe IDs, invalid money or malformed dates',()=>{
  const invalid=[
    null,{},[],{salesReturns:[],purchaseReturns:[]},
    {salesReturns:[],purchaseReturns:[],supplierLedgerRows:undefined},
    {...snap(),notes:'extra source'},
    snap([salesReturn('SR-A'),salesReturn('SR-A')]),
    snap([],[purchaseReturn('PR-A'),purchaseReturn('PR-A')]),
    snap([salesReturn('__proto__')]),
    snap([],[purchaseReturn('constructor')]),
    snap([],[purchaseReturn('PR-X')],[credit('__proto__')]),
    snap([salesReturn('SR-1',{'Total Return Amount':'not-money'})]),
    snap([],[purchaseReturn('PR-1',{'Total Return Amount':Infinity})]),
    snap([salesReturn('SR-1',{'Date':'2026-02-30'})]),
    snap([],[purchaseReturn('PR-1',{'Created At':'no timestamp'})]),
    snap([Object.defineProperty(salesReturn('SR-1'),'Refund Method',{
      enumerable:true,get(){throw Error('unsafe getter');}
    })]),
    snap([],[purchaseReturn('PR-1')],[Object.defineProperty(credit('PR-1'),'Type',{
      enumerable:true,get(){throw Error('unsafe ledger getter');}
    })])
  ];
  for(const candidate of invalid)
    assert.throws(()=>project(candidate),/invalid|trusted|duplicate|unsafe|amount|date|timestamp|reference|array|accessor|snapshot|finite/i);
  assert.throws(()=>project(snap(),'Administrator'),/invalid|trusted|boolean|admin/i);
  assert.throws(()=>project(snap(),true,'true'),/invalid|trusted|boolean|admin/i);
});

test('source UI remains intact, RPC denylist frozen and no D1/financial writes',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookReturnRows,'function',
    'M09 Sales/Purchase Return Day Book projector not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-returns.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/CacheService|globalThis|new Date\(/);
});
