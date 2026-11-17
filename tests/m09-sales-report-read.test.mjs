import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const frozenReports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const frozenUtils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const frozenDelete=readFileSync(new URL('../legacy/source/DeleteEngine.gs',import.meta.url),'utf8');
function nativeFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start!==-1,'Pinned GAS source missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Unable to extract pinned GAS '+name);
  return source.slice(start,end+2);
}
const frozenCode=[
  nativeFunction(frozenDelete,'isDeleted_'),
  ...['roundMoney_','economicReturnLineAmount_','duplicateSalesInvoiceIdMap_',
    'assertUniqueSalesInvoiceIds_'].map(n=>nativeFunction(frozenUtils,n)),
  ...['reportRange_','inRange_','sortedByDesc_','getSalesReport'].map(n=>nativeFunction(frozenReports,n))
].join('\n');
const clone=x=>JSON.parse(JSON.stringify(x));
const empty=()=>({allSales:[],salesReturnItems:[],settlementsByInvoice:{}});
const base=()=>({
  allSales:[
    {'Invoice ID':'INV-A','Date':'2026-11-15','Subtotal':200,'Grand Total':180,
      'Discount':20,'Paid Amount':50,'Due Amount':130,
      'Customer ID':'C1','Customer Name':'Alice','Payment Type':'Cash'},
    {'Invoice ID':'INV-B','Date':'2026-11-15','Subtotal':100,'Grand Total':100,
      'Discount':0,'Paid Amount':100,'Due Amount':0,
      'Customer ID':'','Customer Name':'','Payment Type':'Cash'},
    {'Invoice ID':'INV-C','Date':'2026-11-14','Subtotal':80,'Grand Total':70,
      'Discount':10,'Paid Amount':0,'Due Amount':70,
      'Customer ID':'C2','Customer Name':'Bob','Payment Type':'Credit'},
    {'Invoice ID':'INV-D','Date':'2026-10-01','Subtotal':30,'Grand Total':30,
      'Discount':0,'Paid Amount':30,'Due Amount':0,'Payment Type':'Cash'},
    {'Invoice ID':'INV-Z','Date':'2026-11-15','Grand Total':999,
      'Is Deleted':true,'Paid Amount':999}
  ],
  salesReturnItems:[
    {'Invoice ID':'INV-A','Return ID':'RET-A','Line Total':100,'Pricing Basis':'','Date':'2026-11-16'},
    {'Invoice ID':'INV-B','Return ID':'RET-B','Line Total':10,'Pricing Basis':'NetAfterInvoiceDiscount'},
    {'Invoice ID':'INV-C','Return ID':'RET-C','Line Total':5,'Pricing Basis':'NetAfterInvoiceDiscount','Date':'2026-12-01'}
  ],
  settlementsByInvoice:{
    'INV-A':{paidLater:40,dueAmount:90},
    'INV-C':{paidLater:20,dueAmount:50}
  }
});
function sourceOracle(snapshot,filters,today='2026-11-15'){
  const paymentsByCustomer={};
  for(const sale of snapshot.allSales){
    const cid=String(sale['Customer ID']||'');
    if(!cid)continue;
    if(!paymentsByCustomer[cid])paymentsByCustomer[cid]={paymentByInvoice:{},dueByInvoice:{}};
    const id=String(sale['Invoice ID']||'');
    const settlement=snapshot.settlementsByInvoice[id];
    if(settlement){
      paymentsByCustomer[cid].paymentByInvoice[id]=settlement.paidLater;
      paymentsByCustomer[cid].dueByInvoice[id]=settlement.dueAmount;
    }
  }
  const env={
    requirePermission_:(token,scope,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(scope,'reports');
      assert.equal(action,'view');
    },
    getAllRows_:key=>{
      if(key==='SALES')return snapshot.allSales;
      if(key==='CUSTOMER_LEDGER')return [];
      throw Error('Unexpected GAS table read '+key);
    },
    activeSalesReturnItems_:()=>snapshot.salesReturnItems,
    activeRows_:key=>{
      assert.equal(key,'SALES_RETURN');return [];
    },
    customerSettlementState_:(customerId)=>paymentsByCustomer[customerId]||{paymentByInvoice:{},dueByInvoice:{}},
    customerInvoiceSettlementSnapshotFromState_:(sale,state)=>{
      const due=state.dueByInvoice[sale['Invoice ID']];
      return due===undefined?null:{dueAmount:due};
    },
    formatDate_:()=>today,
    safeDateOnly_:value=>!value?'':String(value).slice(0,10),
    sanitizeInput_:value=>value==null?'':String(value).trim(),
    ok_:value=>value,
    fail_:message=>{throw new Error(String(message));},
    logError_:()=>{}
  };
  return clone(runInNewContext(frozenCode+'\ngetSalesReport("authorized-fixture", nativeFilters)',{
    ...env,nativeFilters:filters
  }));
}
const impl=await import('../src/modules/sales-report-read.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,filters,today){
  assert.equal(typeof impl?.projectSalesReport,'function',
    'M09 Sales Report read projection not implemented');
  return impl.projectSalesReport(snapshot,filters,arguments.length<3?'2026-11-15':today);
}
function parity(snapshot,filters={from:'2026-11-14',to:'2026-11-15'},today='2026-11-15'){
  const expected=sourceOracle(snapshot,filters,today);
  const actual=project(snapshot,filters,today);
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('frozen getSalesReport: exact totals, grouping, default names and invoice-date returns',()=>{
  const result=parity(base());
  assert.deepEqual(result.totals,{
    invoices:3,grossSales:350,discount:30,
    returned:105,netSales:245,paid:210,due:140
  });
  assert.deepEqual(result.byDay,[
    {label:'2026-11-14',invoices:1,gross:70,returned:5,net:65},
    {label:'2026-11-15',invoices:2,gross:280,returned:100,net:180}
  ]);
  assert.deepEqual(result.byPaymentType,[
    {label:'Cash',invoices:2,gross:280,net:180},
    {label:'Credit',invoices:1,gross:70,net:65}
  ]);
  assert.deepEqual(result.topCustomers.map(c=>c.label),
    ['Alice','Walk-in Customer','Bob']);
});

test('refund date never moves return; old invoice discount vs new net return basis',()=>{
  const s=base();
  s.salesReturnItems[0].Date='2027-01-01';
  assert.equal(parity(s).totals.returned,105);
  s.salesReturnItems[0]['Pricing Basis']='NetAfterInvoiceDiscount';
  assert.equal(parity(s).totals.returned,115);
  s.salesReturnItems[0]['Pricing Basis']='';
  s.allSales[0].Subtotal=0; // original factor defaults to one when subtotal <= 0
  assert.equal(parity(s).totals.returned,115);
});

test('customer settlement counts actual later money, not noncash return credits',()=>{
  const s=base();
  s.settlementsByInvoice['INV-A']={paidLater:0,dueAmount:0};
  let r=parity(s);
  assert.equal(r.totals.paid,170);
  assert.equal(r.totals.due,50);
  s.settlementsByInvoice['INV-A']={paidLater:9.125,dueAmount:88.21};
  r=parity(s);
  assert.equal(r.totals.paid,179.13);
  assert.equal(r.totals.due,138.21);
});

test('date windows are inclusive, reverse automatically and default current month',()=>{
  const s=base();
  const r=parity(s,{from:'2026-11-15',to:'2026-11-14'});
  assert.deepEqual(r.range,{from:'2026-11-14',to:'2026-11-15'});
  assert.equal(r.totals.invoices,3);
  assert.equal(parity(s,{from:'2026-11-15',to:'2026-11-15'}).totals.invoices,2);
  assert.equal(parity(s,{from:'2026-11-14',to:'2026-11-14'}).totals.invoices,1);
  assert.deepEqual(parity(s,{}).range,{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(parity(s,{},'2026-10-03').range,{from:'2026-10-01',to:'2026-10-03'});
});

test('deleted source invoice omitted but duplicate ID anywhere fails selected invoice integrity',()=>{
  const s=base();
  assert.equal(parity(s).totals.invoices,3);
  s.allSales.push({...s.allSales[0],Date:'2026-10-30','Is Deleted':'TRUE'});
  assert.throws(()=>sourceOracle(s,{from:'2026-11-14',to:'2026-11-15'}),/Duplicate invoice ID/);
  assert.throws(()=>project(s,{from:'2026-11-14',to:'2026-11-15'}),/Duplicate invoice ID/);
  const historical=base();
  historical.allSales.push({...historical.allSales[3],Date:'2026-10-31'});
  assert.equal(parity(historical).totals.invoices,3);
});

test('stable top-15 ranking, same-customer grouping, empty window and floating cents match GAS',()=>{
  const s=empty();
  s.allSales=Array.from({length:20},(_,i)=>({
    'Invoice ID':'I-'+i,'Date':'2026-11-15','Grand Total':(i+1)*1.125,
    'Discount':0,'Paid Amount':i+1,'Due Amount':0,
    'Customer Name':'Customer '+i,'Payment Type':i%2?'Cash':'Bank'
  }));
  let r=parity(s);
  assert.equal(r.topCustomers.length,15);
  assert.equal(r.topCustomers[0].label,'Customer 19');
  assert.equal(r.byPaymentType.length,2);
  assert.equal(parity(s,{from:'2026-12-01',to:'2026-12-02'}).totals.invoices,0);
  s.allSales.push({'Invoice ID':'I-21','Date':'2026-11-15',
    'Grand Total':0.105,'Paid Amount':0.105,'Due Amount':0,'Customer Name':'Customer 19'});
  r=parity(s);
  assert.equal(r.topCustomers[0].invoices,2);
});

test('missing independently reconciled settlement, malformed rows or noncanonical dates fail closed',()=>{
  const d=base();
  delete d.settlementsByInvoice['INV-A'];
  assert.throws(()=>project(d,{}),/settlement|trusted|missing/i);
  for(const broken of [
    null,{}, {...base(),allSales:Promise.resolve([])},
    {...base(),salesReturnItems:[null]},
    {...base(),settlementsByInvoice:null},
    {...base(),allSales:[{Date:'2026-11-15T12:00:00Z'}]}
  ])assert.throws(()=>project(broken,{}),/snapshot|array|trusted|row|date|settlement|canonical/i);
  for(const today of [undefined,'2026-02-30','2026-11-15T00:00:00Z'])
    assert.throws(()=>project(base(),{},today),/trusted|today|date/i);
  const accessor={...base(),get allSales(){throw Error('getter executed');}};
  assert.throws(()=>project(accessor,{}),/trusted|snapshot|accessor/i);
  const badNumber={...base(),allSales:[{...base().allSales[0],'Grand Total':Infinity}]};
  assert.throws(()=>project(badNumber,{}),/finite|number|amount/i);
});

test('report is pure and never exposes RPC or changes source, frontend or financial writers',()=>{
  const d=base(),before=clone(d);
  parity(d);
  assert.deepEqual(d,before);
  const source=readFileSync(new URL('../src/modules/sales-report-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(source,/function\s+getSalesReport\s*\(/);
});


test('frozen DeleteEngine mixed-case TRUE excludes deleted invoices from Sales Report',()=>{
  const s=base();
  s.allSales[0]['Is Deleted']='true';
  s.allSales[1]['Is Deleted']='TrUe';
  const before=clone(s);
  const result=parity(s);
  assert.equal(result.totals.invoices,1);
  assert.equal(result.totals.grossSales,70);
  assert.equal(result.totals.returned,5);
  assert.equal(result.totals.netSales,65);
  assert.deepEqual(s,before);
});

test('frozen DeleteEngine keeps FALSE, false and numeric zero source invoices active',()=>{
  for(const status of ['false','FALSE',false,0,'']){
    const s=base();
    s.allSales[4]['Is Deleted']=status;
    assert.equal(parity(s).totals.invoices,4);
  }
});
