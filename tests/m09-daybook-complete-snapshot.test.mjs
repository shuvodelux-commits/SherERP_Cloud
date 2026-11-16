import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const GAS=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const sections=[
  'Sales','Sales Returns','Purchases','Purchase Returns','Customer payments',
  'Customer Advance Refunds','Supplier payments','Expenses','Finance (Business Finance: capital & loans)',
  'Standalone bank activity','Bank transfers','Stock adjustments'
];
const positions=sections.map(x=>GAS.indexOf('// ---------------- '+x+' ----------------'));
assert.ok(positions.every((x,i)=>x>=0 && (i===0 || x>positions[i-1])),
  'Pinned GAS DayBook section sequence changed; re-audit before composing');

const mod=await import('../src/modules/daybook-complete-snapshot.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
const render=(snapshot,filters={},isAdmin=false)=>{
  assert.equal(typeof mod?.projectDayBookCompleteSnapshot,'function',
    'M09 complete Day Book snapshot composer not implemented');
  return mod.projectDayBookCompleteSnapshot(snapshot,filters,isAdmin);
};
const names=[
  'sales','salesReturns','purchases','purchaseReturns','customerLedgerRows',
  'supplierLedgerRows','expenses','financeTransactions','bankTransfers',
  'bankEntries','stockMovements','cashBookRows'
];
const blank=()=>Object.fromEntries(names.map(k=>[k,[]]));
const sale=(id,props={})=>({
  'Invoice ID':id,'Date':'2026-11-16','Time':'10:00:00',
  'Created At':'2026-11-16T10:00:00','Paid Amount':'100',
  'Payment Method':'Cash','Payment Type':'Full','Payment Status':'Paid',
  'Customer Name':'Cash Counter','Customer Phone':'','Created By':'CLERK',
  'Is Deleted':'','Deleted By':'','Delete Reason':'',
  'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...props
});
const salesReturn=(id,props={})=>({
  'Return ID':id,'Invoice ID':'S-1','Date':'2026-11-16','Created At':'2026-11-16T10:01:00',
  'Refund Method':'Cash','Total Return Amount':'20','Customer Name':'Cash Counter',
  'Reason':'Returned','Processed By':'CLERK','Is Deleted':'',
  'Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...props
});
const purchase=(id,props={})=>({
  'Purchase ID':id,'Date':'2026-11-16','Created At':'2026-11-16T10:02:00',
  'Paid Amount':'50','Payment Method':'Bank','Payment Status':'Paid',
  'Supplier Name':'Vendor','Notes':'','Created By':'OWNER',
  'Is Deleted':'','Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...props
});
const purchaseReturn=(id,props={})=>({
  'Return ID':id,'Purchase ID':'P-1','Created At':'2026-11-16T10:03:00',
  'Date':'2026-11-16','Total Return Amount':'12','Supplier Name':'Vendor',
  'Reason':'Bad lot','Processed By':'OWNER',
  'Is Deleted':'','Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...props
});
const custPayment=(id,props={})=>({
  'Ledger ID':id,'Type':'Payment','Date':'2026-11-16',
  'Created At':'2026-11-16T10:04:00','Payment Method':'Bank',
  'Payment Amount':'30','Credit':'30','Discount Amount':'0',
  'Customer ID':'C-1','Customer Name':'Customer','Notes':'Paid debt',
  'Created By':'OWNER','Is Deleted':'','Is Backdated':false,
  'Backdated Days':'0','Backdated Reason':'',...props
});
const custRefund=(id,props={})=>({
  'Ledger ID':id,'Type':'Advance Refund','Date':'2026-11-16',
  'Created At':'2026-11-16T10:05:00','Payment Method':'Cash',
  'Debit':'5','Payment Amount':'5','Customer ID':'C-1','Customer Name':'Customer',
  'Notes':'Advance returned','Created By':'OWNER',
  'Is Deleted':'','Is Backdated':false,'Backdated Days':'0','Backdated Reason':'',...props
});
const suppPayment=(id,props={})=>({
  'Ledger ID':id,'Type':'Payment','Date':'2026-11-16',
  'Created At':'2026-11-16T10:06:00','Payment Method':'Cash',
  'Payment Amount':'7','Credit':'7','Discount Amount':'0',
  'Supplier ID':'SUP-1','Supplier Name':'Vendor','Notes':'Supplier paid',
  'Created By':'OWNER','Is Deleted':'','Is Backdated':false,
  'Backdated Days':'0','Backdated Reason':'',...props
});
const expense=(id,props={})=>({
  'Expense ID':id,'Date':'2026-11-16','Created At':'2026-11-16T10:07:00',
  'Payment Method':'Cash','Amount':'9','Category Name':'Rent',
  'Ledger Name':'Landlord','Description':'Rent paid','Status':'Paid',
  'Created By':'OWNER','Is Deleted':'','Is Backdated':false,
  'Backdated Days':'0','Backdated Reason':'',...props
});
const finance=(id,props={})=>({
  'Finance ID':id,'Date':'2026-11-16','Created At':'2026-11-16T10:08:00',
  'Transaction Type':'Opening Loan','Payment Method':'Cash','Amount':'9999',
  'Person':'Lender','Notes':'Opening liability','Reference No':'',
  'Created By':'OWNER','Is Deleted':'','Is Backdated':false,
  'Backdated Days':'0','Backdated Reason':'',...props
});
const bank=(id,ref='',props={})=>({
  'Entry ID':id,'Reference':ref,'Date':'2026-11-16',
  'Created At':'2026-11-16T10:09:00','Type':'Deposit','Bank Account Name':'Bank',
  'Description':'Manual deposit','Credit':'13','Debit':'','Status':'Active',
  'Created By':'OWNER','Notes':'',...props
});
const transfer=(id,props={})=>({
  'Transfer ID':id,'Date':'2026-11-16','Created At':'2026-11-16T10:10:00',
  'From Account Name':'A','To Account Name':'B','Notes':'Sweep','Created By':'OWNER',...props
});
const movement=(id,props={})=>({
  'Movement ID':id,'Product ID':'SKU-1','Product Name':'Wire',
  'Type':'Adjust In','Date':'2026-11-16T10:11:00',
  'Quantity In':'3','Quantity Out':'0','Notes':'Audit',...props
});
const cash=(id,ref,credit='',debit='',stamp='')=>({
  'Entry ID':id,'Reference':ref,'Date':'2026-11-16',
  'Created At':stamp,'Credit':credit,'Debit':debit
});
function filled(){
  const x=blank();
  x.sales=[sale('S-1')];x.salesReturns=[salesReturn('SR-1')];
  x.purchases=[purchase('P-1')];x.purchaseReturns=[purchaseReturn('PR-1')];
  x.customerLedgerRows=[custPayment('CP-1'),custRefund('CR-1')];
  x.supplierLedgerRows=[
    {'Ledger ID':'SL-1','Type':'Purchase Return Credit','Reference':'PR-1'},
    suppPayment('SP-1')
  ];
  x.expenses=[expense('E-1')];x.financeTransactions=[finance('F-1')];
  x.bankEntries=[bank('B-OWNED','P-1',{Credit:'50'}),bank('B-STANDALONE')];
  x.bankTransfers=[transfer('BT-1')];x.stockMovements=[movement('SM-1')];
  x.cashBookRows=[
    cash('CB-1','S-1','100','','2026-11-16T10:00:00'),
    cash('CB-2','SR-1','','20','2026-11-16T10:01:00'),
    cash('CB-3','CR-1','','5','2026-11-16T10:05:00'),
    cash('CB-4','SP-1','','7','2026-11-16T10:06:00'),
    cash('CB-5','E-1','','9','2026-11-16T10:07:00')
  ];
  return x;
}

test('complete empty authorized snapshot is empty without synthetic movement',()=>{
  const r=render(blank());
  assert.deepEqual(r,{rows:[],totals:{cashIn:0,cashOut:0,bankIn:0,bankOut:0,netCash:0,netBank:0},isAdmin:false,count:0});
});

test('all twelve frozen GAS source sections compose once with Bank Book owner dedup, finance openings and Stock/Transfer zeros',()=>{
  const r=render(filled());
  assert.equal(r.count,12);
  const byModule=Object.fromEntries(r.rows.map(x=>[x.module,x]));
  assert.deepEqual(Object.keys(byModule).sort(),[
    'Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
    'Customer Advance Refund','Supplier Payment','Expense','Finance','Bank',
    'Bank Transfer','Stock Adjustment'
  ].sort());
  assert.equal(byModule.Bank.referenceNo,'B-STANDALONE');
  assert.equal(r.rows.some(x=>x.referenceNo==='B-OWNED'),false,'owned Bank Book row must not double-count purchase');
  assert.equal(byModule['Purchase Return'].paymentMethod,'Supplier Credit');
  assert.equal(byModule['Purchase Return'].amount,0);
  assert.equal(byModule['Customer Payment'].bankIn,30);
  assert.equal(byModule['Customer Advance Refund'].cashOut,5);
  assert.equal(byModule.Finance.amount,0,'historical Loan opening does not create live money');
  assert.equal(byModule['Bank Transfer'].amount,0);
  assert.equal(byModule['Stock Adjustment'].amount,0);
  assert.deepEqual(r.totals,{
    cashIn:100,cashOut:41,bankIn:43,bankOut:50,netCash:59,netBank:-7
  });
  assert.equal(byModule['Stock Adjustment'].runningCashBalance,59);
  assert.equal(byModule.Sales.runningCashBalance,100);
  assert.equal(byModule['Sales Return'].runningCashBalance,80);
  assert.equal(r.rows[0].referenceNo,'SM-1','final Day Book presentation sorts descending by created timestamp');
  assert.equal(r.rows.at(-1).referenceNo,'S-1');
});

test('Cash Book remains authoritative, with no Cash movement inferred from display amounts',()=>{
  const x=filled();x.cashBookRows=[];
  const r=render(x);
  assert.equal(r.totals.netCash,59,'daybook display totals remain source rows');
  assert.equal(r.rows.every(row=>row.runningCashBalance===null),true,
    'no Cash Book means no running drawer balance');
});

test('original report filtering happens AFTER chronological Cash Book projection',()=>{
  const x=blank();
  x.sales=[
    sale('EARLY',{'Date':'2026-11-15','Created At':'2026-11-15T09:00:00','Time':'09:00:00','Paid Amount':'25'}),
    sale('LATE',{'Created At':'2026-11-16T09:00:00','Time':'09:00:00','Paid Amount':'8'})
  ];
  x.cashBookRows=[
    {'Entry ID':'CB-EARLY','Reference':'EARLY','Date':'2026-11-15',
      'Created At':'2026-11-15T09:00:00','Credit':'25','Debit':''},
    cash('CB-LATE','LATE','8','','2026-11-16T09:00:00')
  ];
  const r=render(x,{dateFrom:'2026-11-16',dateTo:'2026-11-16',module:'Sales'});
  assert.equal(r.count,1);
  assert.equal(r.rows[0].referenceNo,'LATE');
  assert.equal(r.rows[0].runningCashBalance,33);
  assert.equal(r.totals.cashIn,8);
});

test('deleted document visibility is Administrator-only, with source Bank Book de-dup based on visible documents',()=>{
  const x=blank();
  x.sales=[sale('S-DELETED',{'Is Deleted':'TRUE','Deleted By':'OWNER','Paid Amount':'100'})];
  x.bankEntries=[bank('B-REMAIN','S-DELETED',{'Credit':'7'})];
  const normal=render(x,{includeDeleted:true},false);
  assert.deepEqual(normal.rows.map(r=>r.module),['Bank']);
  assert.equal(normal.totals.bankIn,7);
  const admin=render(x,{includeDeleted:true},true);
  assert.deepEqual(admin.rows.map(r=>r.module),['Sales']);
  assert.equal(admin.rows[0].isDeleted,true);
  assert.equal(admin.rows[0].status,'Deleted');
  assert.equal(admin.totals.cashIn,0,'deleted sale excluded from totals');
  assert.equal(admin.totals.bankIn,0,'admin view suppresses bank duplicate for visible source');
  assert.deepEqual(render(x,{},true).rows.map(r=>r.module),['Bank']);
});

test('Bank Transfer never creates two displayed Bank Book rows or bank income and cash/expense netting',()=>{
  const x=blank();
  x.bankTransfers=[transfer('TR-1')];
  x.bankEntries=[
    bank('BANK-DEBIT','TR-1',{'Credit':'','Debit':'50'}),
    bank('BANK-CREDIT','TR-1',{'Credit':'50','Debit':''})
  ];
  const r=render(x);
  assert.equal(r.count,1);
  assert.equal(r.rows[0].module,'Bank Transfer');
  assert.equal(r.rows[0].amount,0);
  assert.equal(r.totals.netBank,0);
  assert.equal(r.totals.netCash,0);
});

test('source records and arrays not modified by composition; repeated projections independent',()=>{
  const source=filled();
  const frozen=Object.fromEntries(Object.entries(source).map(([k,v])=>
    [k,Object.freeze(v.map(row=>Object.freeze(row)))]));
  Object.freeze(frozen);
  const a=render(frozen);a.rows[0].party='tampered';
  const b=render(frozen);
  assert.notEqual(b.rows[0].party,'tampered');
  assert.equal(source.cashBookRows[0].Credit,'100');
  assert.equal(source.sales[0]['Customer Name'],'Cash Counter');
});

test('reject partial, unknown, sparse, accessor, nonplain or nonfinite trusted complete source',()=>{
  const extra={...blank(),intruder:[]};
  const partial=blank();delete partial.bankTransfers;
  const badField=blank();badField.stockMovements=[{Type:'Adjust',Price:Infinity}];
  const getter=blank();getter.bankEntries=[
    Object.defineProperty(bank('B-1'),'Reference',{
      enumerable:true,get(){throw Error('getter executed');}
    })
  ];
  const sparse=blank();sparse.sales=new Array(2);
  const arrayExtra=blank();arrayExtra.sales=[];arrayExtra.sales.extra='untrusted';
  const instances=blank();instances.sales=[new Date()];
  const invalid=[{},[],null,extra,partial,badField,getter,sparse,arrayExtra,instances];
  for(const x of invalid)assert.throws(()=>render(x),
    /invalid|trusted|accessor|sparse|complete|array|snapshot|finite|record/i);
  assert.throws(()=>render(blank(),{},'Administrator'),/invalid|boolean|admin|trusted/i);
  const record=blank();record.customerLedgerRows=[{'Type':'Unrelated','Credit':NaN}];
  assert.throws(()=>render(record),/invalid|finite|trusted/i,
    'must validate ignored ledger rows before filtering');
});

test('input filters remain fail closed, and no new public RPC, D1 or source mutation is introduced',()=>{
  const x=blank();
  assert.throws(()=>render(x,{dateFrom:'2026-02-30'}),/invalid|date/i);
  assert.throws(()=>render(x,{includeDeleted:'true'}),/invalid|boolean|filter/i);
  const file=readFileSync(new URL('../src/modules/daybook-complete-snapshot.js',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.doesNotMatch(file,/\b(?:prepare|batch|exec|fetch)\s*\(|\bCacheService\b|globalThis|new Date\(/);
});
