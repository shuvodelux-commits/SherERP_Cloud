import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const frozenReports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const frozenUtils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const originalUI=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
function nativeFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Pinned source missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract frozen source '+name);
  return source.slice(start,end+2);
}
const sourceCode=[
  ...['roundMoney_','economicReturnLineAmount_'].map(n=>nativeFunction(frozenUtils,n)),
  ...['reportRange_','inRange_','sortedByDesc_','getPurchaseReport'].map(n=>nativeFunction(frozenReports,n))
].join('\n');

const copy=v=>JSON.parse(JSON.stringify(v));
const empty=()=>({activePurchases:[],purchaseReturnItems:[],settlementsByPurchase:{}});
const fixture=()=>({
  activePurchases:[
    {'Purchase ID':'P-A','Date':'2026-11-15','Created At':'2026-11-16',
      'Subtotal':200,'Grand Total':180,'Discount':20,'Paid Amount':50,'Due Amount':130,
      'Supplier ID':'S1','Supplier Name':'Atlas'},
    {'Purchase ID':'P-B','Date':'2026-11-15',
      'Subtotal':100,'Grand Total':100,'Discount':0,'Paid Amount':100,'Due Amount':0,
      'Supplier ID':'','Supplier Name':''},
    {'Purchase ID':'P-C','Date':'2026-11-14',
      'Subtotal':80,'Grand Total':70,'Discount':10,'Paid Amount':0,'Due Amount':70,
      'Supplier ID':'S2','Supplier Name':'Bay'},
    {'Purchase ID':'P-D','Date':'2026-10-01',
      'Subtotal':30,'Grand Total':30,'Discount':0,'Paid Amount':30,'Due Amount':0,
      'Supplier ID':'','Supplier Name':'Atlas'}
  ],
  purchaseReturnItems:[
    {'Purchase ID':'P-A','Return ID':'RET-A','Date':'2026-12-22',
      'Line Total':100,'Pricing Basis':''},
    {'Purchase ID':'P-B','Return ID':'RET-B','Date':'2026-11-15',
      'Line Total':10,'Pricing Basis':'NetAfterInvoiceDiscount'},
    {'Purchase ID':'P-C','Return ID':'RET-C','Date':'2027-01-01',
      'Line Total':5,'Pricing Basis':'NetAfterInvoiceDiscount'}
  ],
  settlementsByPurchase:{
    'P-A':{paidLater:40,dueAmount:90},
    'P-C':{paidLater:20,dueAmount:50}
  }
});
function originalOracle(snapshot,filters,today='2026-11-15'){
  const states=Object.create(null);
  for(const purchase of snapshot.activePurchases){
    const sid=String(purchase['Supplier ID']||'');
    const id=String(purchase['Purchase ID']||'');
    if(!sid)continue;
    if(!states[sid])states[sid]={paymentByPurchase:{},dueByPurchase:{}};
    const rec=snapshot.settlementsByPurchase[id];
    if(rec){
      states[sid].paymentByPurchase[id]=rec.paidLater;
      states[sid].dueByPurchase[id]=rec.dueAmount;
    }
  }
  const env={
    nativeFilters:filters,
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(module,'reports');assert.equal(action,'view');
    },
    activeRows_:key=>{
      if(key==='PURCHASES')return snapshot.activePurchases;
      if(key==='PURCHASE_RETURN')return [];
      throw new Error('Unexpected native read '+key);
    },
    activePurchaseReturnItems_:()=>snapshot.purchaseReturnItems,
    getAllRows_:key=>{
      assert.equal(key,'SUPPLIER_LEDGER');return [];
    },
    supplierSettlementState_:sid=>states[sid]||{paymentByPurchase:{},dueByPurchase:{}},
    supplierPurchaseSettlementSnapshotFromState_:(purchase,state)=>{
      const due=state.dueByPurchase[purchase['Purchase ID']];
      return due===undefined?null:{dueAmount:due};
    },
    formatDate_:()=>today,
    safeDateOnly_:v=>v==null?'':String(v).slice(0,10),
    sanitizeInput_:v=>v==null?'':String(v).trim(),
    ok_:v=>v,
    fail_:message=>{throw new Error('Pinned GAS rejected: '+message);},
    logError_:()=>{}
  };
  const result=runInNewContext(sourceCode+'\ngetPurchaseReport("authorized-fixture",nativeFilters)',env);
  return copy(result);
}
const impl=await import('../src/modules/purchase-report-read.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot,filters,today){
  assert.equal(typeof impl?.projectPurchaseReport,'function',
    'M09 Purchase Report read projection not implemented');
  return impl.projectPurchaseReport(snapshot,filters,arguments.length<3?'2026-11-15':today);
}
function assertParity(snapshot,filters={from:'2026-11-14',to:'2026-11-15'},today='2026-11-15'){
  const expected=originalOracle(snapshot,filters,today);
  const actual=project(snapshot,filters,today);
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('original getPurchaseReport totals, sorted days and top supplier breakdown exactly match',()=>{
  const actual=assertParity(fixture());
  assert.deepEqual(actual.totals,{
    purchases:3,grossPurchases:350,discount:30,
    returned:105,netPurchases:245,paid:210,due:140
  });
  assert.deepEqual(actual.byDay,[
    {label:'2026-11-14',purchases:1,gross:70,returned:5,net:65},
    {label:'2026-11-15',purchases:2,gross:280,returned:100,net:180}
  ]);
  assert.deepEqual(actual.topSuppliers,[
    {label:'Atlas',purchases:1,gross:180,net:90,due:90},
    {label:'Unknown',purchases:1,gross:100,net:90,due:0},
    {label:'Bay',purchases:1,gross:70,net:65,due:50}
  ]);
});

test('original purchase business date prevails over creation/return date for net',()=>{
  const s=fixture();
  s.purchaseReturnItems[0].Date='2028-08-01';
  assert.equal(assertParity(s).totals.returned,105);
  s.activePurchases[0].Date='2026-11-13';
  const result=assertParity(s);
  assert.equal(result.totals.purchases,2);
  assert.equal(result.totals.returned,15);
  assert.equal(result.totals.netPurchases,155);
});

test('legacy return factor vs NetAfterInvoiceDiscount and per-purchase rounding',()=>{
  const s=fixture();
  s.purchaseReturnItems[0]['Pricing Basis']='NetAfterInvoiceDiscount';
  assert.equal(assertParity(s).totals.returned,115);
  s.purchaseReturnItems[0]['Pricing Basis']='';
  s.activePurchases[0].Subtotal=0;
  assert.equal(assertParity(s).totals.returned,115);
  s.activePurchases[0].Subtotal=200;
  s.purchaseReturnItems.push(
    {'Purchase ID':'P-A','Return ID':'RET-A2','Line Total':0.105,
      'Pricing Basis':'NetAfterInvoiceDiscount'});
  assertParity(s);
});

test('supplier Paid reflects money sent, not purchase-return settlement credits',()=>{
  const s=fixture();
  s.settlementsByPurchase['P-A']={paidLater:0,dueAmount:0};
  let r=assertParity(s);
  assert.equal(r.totals.paid,170);
  assert.equal(r.totals.due,50);
  s.settlementsByPurchase['P-A']={paidLater:9.125,dueAmount:88.21};
  r=assertParity(s);
  assert.equal(r.totals.paid,179.13);
  assert.equal(r.totals.due,138.21);
  assert.equal(r.topSuppliers[0].due,88.21);
});

test('inclusive, reverse and shop-month default date windows retain source semantics',()=>{
  const s=fixture();
  assert.equal(assertParity(s,{from:'2026-11-15',to:'2026-11-14'}).totals.purchases,3);
  assert.equal(assertParity(s,{from:'2026-11-15',to:'2026-11-15'}).totals.purchases,2);
  assert.equal(assertParity(s,{from:'2026-11-14',to:'2026-11-14'}).totals.purchases,1);
  assert.deepEqual(assertParity(s,{}).range,{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(assertParity(s,{},'2026-10-03').range,{from:'2026-10-01',to:'2026-10-03'});
  assert.equal(assertParity(s,{from:'2026-12-01',to:'2026-12-31'}).totals.purchases,0);
});

test('source stable top 15 suppliers, grouping names and fractional cents',()=>{
  const s=empty();
  s.activePurchases=Array.from({length:20},(_,i)=>({
    'Purchase ID':'P-'+i,'Date':'2026-11-15',
    'Grand Total':(i+1)*1.125,'Discount':0,
    'Paid Amount':i+1,'Due Amount':0,
    'Supplier Name':'Supplier '+i,'Supplier ID':''
  }));
  let r=assertParity(s);
  assert.equal(r.topSuppliers.length,15);
  assert.equal(r.topSuppliers[0].label,'Supplier 19');
  s.activePurchases.push({'Purchase ID':'P-X','Date':'2026-11-15',
    'Grand Total':0.105,'Paid Amount':0.105,
    'Due Amount':0,'Supplier Name':'Supplier 19'});
  r=assertParity(s);
  assert.equal(r.topSuppliers[0].purchases,2);
});

test('ambiguously duplicated selected Purchase ID fails closed instead of overwriting financial evidence',()=>{
  const s=fixture();
  s.activePurchases.push({...s.activePurchases[0],Date:'2026-11-14'});
  // Original getPurchaseReport overwrites its purchaseById; this is a deliberate
  // safety divergence only for corrupt duplicate purchase master IDs.
  assert.throws(()=>project(s,{from:'2026-11-14',to:'2026-11-15'}),
    /duplicate purchase id/i);
  const unrelated=fixture();
  unrelated.activePurchases.push({...unrelated.activePurchases[3],Date:'2026-10-02'});
  assertParity(unrelated); // source only selects the Nov period here
});

test('missing independently reconciled supplier settlement and invalid trust boundary reject',()=>{
  const s=fixture();
  delete s.settlementsByPurchase['P-A'];
  assert.throws(()=>project(s,{}),/settlement|missing|trusted/i);
  for(const invalid of [
    undefined,null,{}, {...fixture(),activePurchases:Promise.resolve([])},
    {...fixture(),purchaseReturnItems:[null]}, {...fixture(),settlementsByPurchase:null},
    {...fixture(),activePurchases:[{...fixture().activePurchases[0],Date:'2026-11-15T05:00:00Z'}]},
    {...fixture(),activePurchases:[{...fixture().activePurchases[0],'Grand Total':Infinity}]}
  ])assert.throws(()=>project(invalid,{}),/snapshot|array|trusted|row|date|canonical|settlement|amount|finite/i);
  for(const today of [undefined,'2026-02-30','2026-11-15T10:00:00Z'])
    assert.throws(()=>project(fixture(),{},today),/trusted|today|date/i);
  const accessor={...fixture(),get activePurchases(){throw Error('getter must not execute');}};
  assert.throws(()=>project(accessor,{}),/trusted|snapshot|accessor/i);
});

test('purity, frozen RPC and original purchase print/DOM contract remain intact',()=>{
  const s=fixture(),before=copy(s);
  assertParity(s);
  assert.deepEqual(s,before);
  assert.match(originalUI,/id="rpCount"/);
  assert.match(originalUI,/id="rpSupBody"/);
  const module=readFileSync(new URL('../src/modules/purchase-report-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(module,/function\s+getPurchaseReport\s*\(/);
});
