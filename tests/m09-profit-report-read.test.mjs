import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const reports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const frozenDelete=readFileSync(new URL('../legacy/source/DeleteEngine.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
function native(text,name){
  const start=text.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source missing '+name);
  const end=text.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract frozen function '+name);
  return text.slice(start,end+2);
}
const computeStart=reports.indexOf('function computeProfit_(');
const computeEnd=reports.indexOf('/** filters = { from, to }. FIFO-costed profit',computeStart);
assert.ok(computeStart>0 && computeEnd>computeStart);
const sourceCode=[
  native(frozenDelete,'isDeleted_'),
  native(frozenDelete,'activeRows_'),
  ...['roundMoney_','economicReturnLineAmount_','isValidNonNegativeNumber_',
    'duplicateSalesInvoiceIdMap_','assertUniqueSalesInvoiceIds_']
    .map(n=>native(utils,n)),
  ...['reportRange_','inRange_','sortedByDesc_'].map(n=>native(reports,n)),
  reports.slice(computeStart,computeEnd),
  native(reports,'getProfitReport')
].join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({
  allSales:[],saleItems:[],saleReturnItems:[],lotConsumptions:[],
  vendorSourcing:[],expenses:[],saleBundleComponents:[],
  settlementDiscount:{
    customerDiscountGiven:0,supplierDiscountReceived:0,netProfitImpact:0
  }
});
function fixture(){
  return {
    ...empty(),
    allSales:[
      {'Invoice ID':'INV-A','Date':'2026-11-15','Subtotal':200,'Grand Total':180,'Discount':20},
      {'Invoice ID':'INV-B','Date':'2026-11-14','Subtotal':100,'Grand Total':100,'Discount':0},
      {'Invoice ID':'INV-OLD','Date':'2026-10-01','Subtotal':800,'Grand Total':800},
      {'Invoice ID':'INV-DEL','Date':'2026-11-15','Grand Total':999,'Is Deleted':true}
    ],
    saleItems:[
      {'Invoice ID':'INV-A','Product ID':'P1','Product Name':'Cable','Quantity':2,
        'Unit Price':100,'Line Total':200},
      {'Invoice ID':'INV-B','Product ID':'P2','Product Name':'Switch','Quantity':1,
        'Unit Price':100,'Line Total':100},
      {'Invoice ID':'INV-OLD','Product ID':'P3','Quantity':50,'Unit Price':10}
    ],
    saleReturnItems:[
      {'Invoice ID':'INV-A','Product ID':'P1','Product Name':'Cable',
        'Return Quantity':1,'Line Total':100,'Pricing Basis':'','Date':'2027-01-01'}
    ],
    lotConsumptions:[
      {'Invoice ID':'INV-A','Product ID':'P1','Source Sale Product ID':'P1',
        'Quantity':1,'Unit Cost':30},
      {'Invoice ID':'INV-B','Product ID':'P2','Quantity':0.5,'Unit Cost':50},
      {'Invoice ID':'INV-OLD','Product ID':'P3','Quantity':90,'Unit Cost':1000}
    ],
    vendorSourcing:[
      {'Invoice ID':'INV-B','Product ID':'P2','Product Name':'Switch',
        'Quantity':0.5,'Unit Cost':20,'Total Cost':10}
    ],
    expenses:[
      {'Date':'2026-11-15','Category Name':'Rent','Amount':10,'Status':'Active'},
      {'Date':'2026-11-14','Category Name':'Fees','Amount':5,'Status':'Active'},
      {'Date':'2026-11-15','Category Name':'Fees','Amount':999,'Status':'Cancelled'},
      {'Date':'2026-10-01','Category Name':'Rent','Amount':900,'Status':'Active'}
    ],
    settlementDiscount:{
      customerDiscountGiven:5,supplierDiscountReceived:2,netProfitImpact:-3
    }
  };
}
function oracle(snapshot,filters,today='2026-11-15'){
  const table={
    SALES:snapshot.allSales,
    SALE_ITEMS:snapshot.saleItems,
    SALE_ITEM_LOTS:snapshot.lotConsumptions,
    SALE_BUNDLE_COMPONENTS:snapshot.saleBundleComponents,
    VENDOR_SOURCING:snapshot.vendorSourcing,
    EXPENSES:snapshot.expenses
  };
  const ctx={
    nativeFilters:filters,
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(module,'reports');
      assert.equal(action,'view');
    },
    getAllRows_:name=>{
      assert.ok(Object.hasOwn(table,name),'Unexpected source table '+name);
      return table[name];
    },
    activeSalesReturnItems_:()=>snapshot.saleReturnItems,
    computeSettlementDiscountProfit_:()=>snapshot.settlementDiscount,
    safeDateOnly_:value=>value==null?'':String(value).slice(0,10),
    sanitizeInput_:value=>value==null?'':String(value).trim(),
    formatDate_:()=>today,
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    ok_:v=>v,
    fail_:message=>{throw Error('Frozen GAS rejected: '+message);},
    logError_:()=>{}
  };
  return clone(runInNewContext(
    sourceCode+'\ngetProfitReport("authorized-fixture",nativeFilters)',ctx
  ));
}
const impl=await import('../src/modules/profit-report-read.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,filters,today){
  assert.equal(typeof impl?.projectProfitReport,'function',
    'M09 Profit Report read projection not implemented');
  return impl.projectProfitReport(snapshot,filters,arguments.length<3?'2026-11-15':today);
}
function parity(snapshot,filters={from:'2026-11-14',to:'2026-11-15'},today='2026-11-15'){
  const expected=oracle(snapshot,filters,today);
  const actual=clone(project(snapshot,filters,today));
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('frozen Profit Report: complete totals, FIFO+vendor COGS, returns and all grouped outputs',()=>{
  const report=parity(fixture());
  assert.deepEqual(report.totals,{
    invoices:2,grossSales:280,discount:20,returned:90,netRevenue:190,
    cogs:65,grossProfit:125,grossMarginPercent:125/190*100,
    expenses:15,customerSettlementDiscount:5,
    supplierSettlementDiscountReceived:2,settlementDiscountNetImpact:-3,
    netProfit:107,netMarginPercent:107/190*100
  });
  assert.deepEqual(report.coverage,{
    invoicesInRange:2,invoicesWithLotData:2,
    invoicesMissingLotData:0,missingSample:[]
  });
  assert.equal(report.byProduct.find(x=>x.productId==='P1').qtySold,2);
  assert.equal(report.byProduct.find(x=>x.productId==='P1').qtyReturned,1);
  assert.equal(report.byProduct.find(x=>x.productId==='P1').profit,60);
  assert.equal(report.byProduct.find(x=>x.productId==='P2').profit,65);
  assert.deepEqual(report.expenseByCategory.map(e=>e.label),['Rent','Fees']);
  assert.deepEqual(report.topProducts,report.byProduct.slice(0,15));
  assert.deepEqual(report.lossMakers,[]);
});

test('return attributed to original invoice date and costs already net of returns',()=>{
  const s=fixture();
  assert.equal(parity(s).totals.cogs,65);
  s.saleReturnItems[0].Date='2090-12-25';
  assert.equal(parity(s).totals.returned,90);
  s.saleReturnItems[0]['Pricing Basis']='NetAfterInvoiceDiscount';
  const r=parity(s);
  assert.equal(r.totals.returned,100);
  assert.equal(r.totals.cogs,65);
  s.saleReturnItems[0]['Pricing Basis']='';
  s.allSales[0].Subtotal=0;
  assert.equal(parity(s).totals.returned,100);
});

test('vendor cost uses authoritative Total Cost or falls back to quantity by Unit Cost',()=>{
  const s=fixture();
  s.vendorSourcing[0]['Total Cost']=15;
  assert.equal(parity(s).totals.cogs,70);
  s.vendorSourcing[0]['Total Cost']='';
  assert.equal(parity(s).totals.cogs,65);
  s.vendorSourcing[0]['Total Cost']=-1;
  assert.equal(parity(s).totals.cogs,65);
  s.vendorSourcing[0]['Total Cost']=0;
  assert.equal(parity(s).totals.cogs,55);
});

test('missing inventory cost evidence is exposed, never fabricated or silently ignored',()=>{
  const s=fixture();
  s.lotConsumptions=s.lotConsumptions.filter(l=>l['Invoice ID']!=='INV-A');
  const r=parity(s);
  assert.equal(r.coverage.invoicesMissingLotData,1);
  assert.deepEqual(r.coverage.missingSample,[{
    invoiceId:'INV-A',date:'2026-11-15',grandTotal:180
  }]);
  assert.equal(r.totals.cogs,35);
  assert.equal(r.totals.grossProfit,155);
  s.allSales.push({'Invoice ID':'INV-M','Date':'2026-11-15','Grand Total':20});
  assert.equal(parity(s).coverage.invoicesMissingLotData,2);
});

test('bundle stock coverage replaces virtual kits with saved physical component demands',()=>{
  const s=empty();
  s.allSales=[{'Invoice ID':'KIT-1','Date':'2026-11-15','Subtotal':100,
    'Grand Total':100,'Discount':0}];
  s.saleItems=[{'Invoice ID':'KIT-1','Product ID':'KIT','Product Name':'Kit',
    'Quantity':2,'Line Total':100}];
  s.saleBundleComponents=[{'Invoice ID':'KIT-1','Bundle Product ID':'KIT',
    'Component Product ID':'WIRE','Quantity Per Set':3}];
  let r=parity(s);
  assert.equal(r.coverage.invoicesMissingLotData,1);
  s.lotConsumptions=[{'Invoice ID':'KIT-1','Product ID':'WIRE',
    'Source Sale Product ID':'KIT','Quantity':6,'Unit Cost':2}];
  r=parity(s);
  assert.equal(r.coverage.invoicesMissingLotData,0);
  assert.equal(r.totals.cogs,12);
  assert.equal(r.byProduct.find(p=>p.productId==='KIT').cost,12);
  s.lotConsumptions[0].Quantity=5;
  assert.equal(parity(s).coverage.invoicesMissingLotData,1);
});

test('active expense dates, cancellation and independent settlement discount determine net profit',()=>{
  const s=fixture();
  s.expenses[0].Status='Cancelled';
  assert.equal(parity(s).totals.expenses,5);
  s.expenses[0].Status='Active';
  s.settlementDiscount={customerDiscountGiven:20,supplierDiscountReceived:7,netProfitImpact:-13};
  let r=parity(s);
  assert.equal(r.totals.netProfit,97);
  assert.equal(r.totals.customerSettlementDiscount,20);
  assert.equal(r.totals.supplierSettlementDiscountReceived,7);
  s.settlementDiscount={customerDiscountGiven:0,supplierDiscountReceived:0,netProfitImpact:0};
  assert.equal(parity(s).totals.netProfit,110);
});

test('date window reverse, inclusive and shop-local month defaults match source, duplicates stop',()=>{
  const s=fixture();
  assert.equal(parity(s,{from:'2026-11-15',to:'2026-11-14'}).totals.invoices,2);
  assert.equal(parity(s,{from:'2026-11-15',to:'2026-11-15'}).totals.invoices,1);
  assert.deepEqual(parity(s,{}).range,{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(parity(s,{},'2026-10-03').range,{from:'2026-10-01',to:'2026-10-03'});
  s.allSales.push({...s.allSales[0],'Is Deleted':true,'Date':'2026-10-30'});
  assert.throws(()=>oracle(s,{from:'2026-11-14',to:'2026-11-15'}),/Duplicate invoice ID/);
  assert.throws(()=>project(s,{from:'2026-11-14',to:'2026-11-15'}),/Duplicate invoice ID/);
});

test('zero or negative revenue does not produce a fabricated margin',()=>{
  const s=empty();
  s.allSales=[{'Invoice ID':'ONLY','Date':'2026-11-15','Grand Total':0,
    'Subtotal':0,'Discount':0}];
  let r=parity(s);
  assert.equal(r.totals.grossMarginPercent,0);
  assert.equal(r.totals.netMarginPercent,0);
  assert.equal(r.coverage.invoicesMissingLotData,1);
  s.saleItems=[{'Invoice ID':'ONLY','Product ID':'P',
    'Product Name':'Loss','Quantity':1,'Unit Price':0,'Line Total':0}];
  s.lotConsumptions=[{'Invoice ID':'ONLY','Product ID':'P','Quantity':1,'Unit Cost':30}];
  r=parity(s);
  assert.equal(r.lossMakers[0].profit,-30);
  assert.equal(r.totals.netProfit,-30);
});

test('source ranking and top-15 limit, loss-maker sample maximum 10 and coverage sample maximum 10',()=>{
  const s=empty();
  s.allSales=Array.from({length:20},(_,i)=>({
    'Invoice ID':'INV-'+i,'Date':'2026-11-15',
    'Subtotal':10,'Grand Total':10,'Discount':0
  }));
  s.saleItems=Array.from({length:20},(_,i)=>({
    'Invoice ID':'INV-'+i,'Product ID':'P-'+i,'Product Name':'Product '+i,
    'Quantity':1,'Line Total':10
  }));
  s.lotConsumptions=Array.from({length:20},(_,i)=>({
    'Invoice ID':'INV-'+i,'Product ID':'P-'+i,
    'Quantity':1,'Unit Cost':i%2?15:5
  }));
  let r=parity(s);
  assert.equal(r.topProducts.length,15);
  assert.equal(r.lossMakers.length,10);
  assert.equal(r.coverage.invoicesMissingLotData,0);
  s.lotConsumptions=[];
  r=parity(s);
  assert.equal(r.coverage.invoicesMissingLotData,20);
  assert.equal(r.coverage.missingSample.length,10);
});

test('reject untrusted Promise/accessor rows, invalid dates/money, missing settlement evidence',()=>{
  const s=fixture();
  for(const bad of [
    null,undefined,{},[],{...s,allSales:Promise.resolve([])},
    {...s,saleItems:[null]}, {...s,settlementDiscount:undefined},
    {...s,expenses:[{Date:'2026-02-30','Amount':10}]},
    {...s,lotConsumptions:[{'Invoice ID':'INV-A','Quantity':Infinity,'Unit Cost':10}]},
    {...s,vendorSourcing:[{'Invoice ID':'INV-A','Quantity':{},'Unit Cost':10}]}
  ])assert.throws(()=>project(bad,{}),/snapshot|trusted|row|array|date|finite|amount|settlement|invalid/i);
  const getter={...s,get saleItems(){throw Error('getter invoked');}};
  assert.throws(()=>project(getter,{}),/trusted|accessor|snapshot/i);
  for(const today of [undefined,'2026-02-30','2026-11-15T00:00:00Z'])
    assert.throws(()=>project(s,{},today),/today|trusted|date/i);
  const inconsistent={...s,settlementDiscount:{customerDiscountGiven:5,
    supplierDiscountReceived:2,netProfitImpact:0}};
  assert.throws(()=>project(inconsistent,{}),/settlement|reconcile|impact/i);
});

test('projection does not mutate snapshots, query D1, create RPCs or change original report UI',()=>{
  const s=fixture(),before=clone(s);
  parity(s);
  assert.deepEqual(s,before);
  assert.match(html,/id="rptProfit"/);
  assert.match(reports,/function getProfitReport\(token, filters\)/);
  const source=readFileSync(new URL('../src/modules/profit-report-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(source,/function\s+getProfitReport\s*\(/);
});


test('frozen DeleteEngine excludes mixed-case deleted invoices from Profit and FIFO coverage',()=>{
  const s=fixture();
  s.allSales[0]['Is Deleted']='true';
  s.allSales[1]['Is Deleted']='TrUe';
  const original=clone(s);
  const result=parity(s);
  assert.equal(result.totals.invoices,0);
  assert.equal(result.totals.grossSales,0);
  assert.equal(result.totals.cogs,0);
  assert.equal(result.coverage.invoicesInRange,0);
  assert.deepEqual(s,original);
});

test('frozen DeleteEngine retains explicitly false and zero source Sales in Profit',()=>{
  for(const status of ['false','FALSE',false,0,'']){
    const s=fixture();
    s.allSales[0]['Is Deleted']=status;
    assert.equal(parity(s).totals.invoices,2);
  }
});

test('frozen activeRows_ filters mixed-case deleted Vendor Sourcing before Profit COGS',()=>{
  for(const marker of [true,'true','TrUe','TRUE']){
    const s=fixture();
    s.vendorSourcing[0]['Is Deleted']=marker;
    const before=clone(s);
    const report=parity(s);
    assert.equal(report.totals.cogs,55,'deleted source Vendor Sourcing must not be costed');
    assert.equal(report.totals.netProfit,117);
    assert.equal(report.coverage.invoicesMissingLotData,1);
    assert.deepEqual(s,before);
  }
});

test('frozen activeRows_ filters mixed-case deleted Expenses before Profit totals',()=>{
  for(const marker of [true,'true','TrUe','TRUE']){
    const s=fixture();
    s.expenses[0]['Is Deleted']=marker;
    const report=parity(s);
    assert.equal(report.totals.expenses,5,'deleted expense cannot reduce net profit');
    assert.equal(report.totals.netProfit,117);
    assert.deepEqual(report.expenseByCategory.map(e=>e.label),['Fees']);
  }
});

test('deleted historical Vendor Sourcing and Expenses are not resurrected by current invoices',()=>{
  const s=fixture();
  s.vendorSourcing.push({
    'Invoice ID':'INV-B','Product ID':'P2','Product Name':'Switch',
    'Quantity':0.5,'Unit Cost':200,'Total Cost':100,'Is Deleted':'tRue'
  });
  s.expenses.push({
    'Date':'2026-11-15','Category Name':'Deleted Historic Rent',
    'Amount':800,'Status':'Active','Is Deleted':'TRUE'
  });
  const before=clone(s);
  const report=parity(s);
  assert.equal(report.totals.cogs,65);
  assert.equal(report.totals.expenses,15);
  assert.equal(report.totals.netProfit,107);
  assert.equal(report.expenseByCategory.some(x=>x.label==='Deleted Historic Rent'),false);
  assert.deepEqual(s,before);
});

test('explicit false and zero deletion flags retain active vendor costs and expenses',()=>{
  for(const marker of ['false','FALSE',false,0,'']){
    const s=fixture();
    s.vendorSourcing[0]['Is Deleted']=marker;
    s.expenses[0]['Is Deleted']=marker;
    const report=parity(s);
    assert.equal(report.totals.cogs,65);
    assert.equal(report.totals.expenses,15);
    assert.equal(report.totals.netProfit,107);
  }
});
