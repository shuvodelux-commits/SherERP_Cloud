import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const frozenReports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const frozenUI=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
function native(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen Reports.gs missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated frozen function '+name);
  return source.slice(start,end+2);
}
const nativeCode=[
  native(frozenReports,'sortedByDesc_'),
  native(frozenReports,'getStockReport')
].join('\n');
const clone=x=>JSON.parse(JSON.stringify(x));
const blank=()=>({activeProducts:[],stockLots:[]});
const fixture=()=>({
  activeProducts:[
    {'Product ID':'P-A','Product Name':'Cable','Status':'Active',
      'Category':'Tools','Unit':'Box','Current Stock':10,'Minimum Stock':5,
      'Purchase Price':11,'Selling Price':30},
    {'Product ID':'P-B','Product Name':'Bolts','Status':'Active',
      'Category':'Tools','Unit':'Pcs','Current Stock':2,'Minimum Stock':5,
      'Purchase Price':9,'Selling Price':20},
    {'Product ID':'P-C','Product Name':'Switch','Status':'Active',
      'Category':'Electrical','Current Stock':0,'Minimum Stock':0,
      'Purchase Price':7,'Selling Price':50},
    {'Product ID':'P-D','Product Name':'Discontinued','Status':'Inactive',
      'Category':'Electrical','Current Stock':5,'Minimum Stock':10,
      'Purchase Price':100,'Selling Price':100},
    {'Product ID':'P-E','Product Name':'Oversold','Status':'Active',
      'Category':'','Current Stock':-2,'Minimum Stock':0,
      'Purchase Price':8,'Selling Price':15},
    {'Product ID':'P-F','Product Name':'Socket','Status':'Active',
      'Category':'Electrical','Current Stock':3,'Minimum Stock':3,
      'Purchase Price':1,'Selling Price':10}
  ],
  stockLots:[
    {'Lot ID':'LOT-A1','Product ID':'P-A','Remaining Quantity':6,'Purchase Price':8},
    {'Lot ID':'LOT-A2','Product ID':'P-A','Remaining Quantity':4,'Purchase Price':12},
    {'Lot ID':'LOT-B','Product ID':'P-B','Remaining Quantity':1,'Purchase Price':9},
    {'Lot ID':'LOT-D','Product ID':'P-D','Remaining Quantity':5,'Purchase Price':100},
    {'Lot ID':'LOT-F','Product ID':'P-F','Remaining Quantity':3,'Purchase Price':1},
    {'Lot ID':'LOT-ORPHAN','Product ID':'GONE','Remaining Quantity':25,'Purchase Price':999},
    {'Lot ID':'LOT-ZERO','Product ID':'P-C','Remaining Quantity':0,'Purchase Price':20},
    {'Lot ID':'LOT-NEGATIVE','Product ID':'P-E','Remaining Quantity':-2,'Purchase Price':9}
  ]
});
function oracle(snapshot){
  const context={
    requirePermission_:(token,domain,action)=>{
      assert.equal(token,'authorized-internal-fixture');
      assert.equal(domain,'reports');
      assert.equal(action,'view');
    },
    activeRows_:key=>{
      assert.equal(key,'PRODUCTS');
      return snapshot.activeProducts;
    },
    getAllRows_:key=>{
      assert.equal(key,'STOCK_LOTS');
      return snapshot.stockLots;
    },
    ok_:x=>x,
    fail_:message=>{throw new Error('Original GAS: '+message);},
    logError_:()=>{}
  };
  return clone(runInNewContext(
    nativeCode+'\ngetStockReport("authorized-internal-fixture")',context
  ));
}
const impl=await import('../src/modules/stock-report-read.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot){
  assert.equal(typeof impl?.projectStockReport,'function',
    'M09 Stock Report read projection not implemented');
  return impl.projectStockReport(snapshot);
}
function matchesSource(snapshot){
  const expected=oracle(snapshot);
  // Both sides are compared as the JSON payload actually sent by serverCall.
  // JSON omits undefined optional fields and serializes -0 as 0.
  const actual=clone(project(snapshot));
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('original Stock Report: full totals, exact products, category ordering, and low-stock list',()=>{
  const actual=matchesSource(fixture());
  assert.deepEqual(actual.totals,{
    products:6,activeProducts:5,inventoryValue:108,retailValue:340,
    potentialMargin:232,lowStockCount:2,outOfStockCount:2,mismatchCount:2
  });
  assert.deepEqual(actual.products.map(p=>p.productId),
    ['P-D','P-A','P-B','P-F','P-C','P-E']);
  assert.deepEqual(actual.byCategory,[
    {label:'Tools',products:2,stock:12,value:105},
    {label:'Electrical',products:2,stock:3,value:3},
    {label:'Uncategorized',products:1,stock:-2,value:0}
  ]);
  assert.deepEqual(actual.lowStock.map(p=>p.productId),['P-B','P-F','P-C','P-E']);
});

test('inactive product lots remain visible per row but excluded from active totals and categories',()=>{
  const s=fixture();
  const r=matchesSource(s);
  const inactive=r.products.find(p=>p.productId==='P-D');
  assert.equal(inactive.lotValue,500);
  assert.equal(inactive.retailValue,500);
  assert.equal(inactive.lotMismatch,false);
  assert.equal(r.totals.inventoryValue,108);
  assert.equal(r.totals.retailValue,340);
  assert.ok(!r.lowStock.some(p=>p.productId==='P-D'));
  s.activeProducts[3].Status='inactive'; // exact source Inactive check, case-sensitive
  const nowActive=matchesSource(s);
  assert.equal(nowActive.totals.activeProducts,6);
  assert.equal(nowActive.totals.inventoryValue,608);
  assert.equal(nowActive.totals.retailValue,840);
});

test('out-of-stock is distinct from low-stock count, while details include both at threshold',()=>{
  const r=matchesSource(fixture());
  assert.equal(r.totals.outOfStockCount,2);
  assert.equal(r.totals.lowStockCount,2);
  assert.equal(r.lowStock.length,4);
  for(const id of ['P-C','P-E'])
    assert.ok(r.lowStock.some(p=>p.productId===id));
  const s=blank();
  s.activeProducts=[
    {'Product ID':'X','Current Stock':0,'Minimum Stock':0},
    {'Product ID':'Y','Current Stock':1,'Minimum Stock':1},
    {'Product ID':'Z','Current Stock':-1,'Minimum Stock':-5},
    {'Product ID':'W','Current Stock':1,'Minimum Stock':0},
    {'Product ID':'V','Status':'Inactive','Current Stock':0,'Minimum Stock':100}
  ];
  const z=matchesSource(s);
  assert.equal(z.totals.outOfStockCount,2);
  assert.equal(z.totals.lowStockCount,1);
  assert.deepEqual(z.lowStock.map(p=>p.productId),['X','Y']);
});

test('all source lots include positive orphan/inactive lots, skip zero and negatives, no date filter',()=>{
  const s=fixture();
  s.stockLots.push(
    {'Lot ID':'FUTURE','Product ID':'P-A','Date':'2090-01-01',
      'Remaining Quantity':2,'Purchase Price':2.625},
    {'Lot ID':'DELETED-RAW','Product ID':'P-A','Is Deleted':true,
      'Remaining Quantity':1,'Purchase Price':0.1},
    {'Lot ID':'NEGATIVE','Product ID':'P-A',
      'Remaining Quantity':-40,'Purchase Price':1000}
  );
  const z=matchesSource(s);
  assert.equal(z.products.find(p=>p.productId==='P-A').lotQuantity,13);
  assert.equal(z.products.find(p=>p.productId==='P-A').lotValue,101.35);
  assert.equal(z.totals.mismatchCount,3); // A (13 vs 10), B (1 vs 2), E (0 vs -2)
});

test('source preserves unrounded fractions, sort ties and missing defaults',()=>{
  const s=blank();
  s.activeProducts=[
    {'Product ID':'A','Product Name':'Alpha','Current Stock':'2',
      'Minimum Stock':'2','Category':'','Status':'',
      'Selling Price':'1.23','Purchase Price':'0.4','Unit':''},
    {'Product ID':'B','Product Name':'Beta','Current Stock':2,'Minimum Stock':0,
      'Selling Price':1.5,'Category':'Other'},
    {'Product ID':'C','Product Name':'Gamma','Current Stock':0,'Minimum Stock':0}
  ];
  s.stockLots=[
    {'Product ID':'A','Remaining Quantity':2,'Purchase Price':0.1},
    {'Product ID':'B','Remaining Quantity':2,'Purchase Price':0.1}
  ];
  const result=matchesSource(s);
  assert.deepEqual(result.products.map(p=>p.productId),['A','B','C']);
  assert.equal(result.products[0].status,'Active');
  assert.equal(result.products[0].category,'Uncategorized');
  assert.equal(result.products[0].retailValue,2.46);
  assert.equal(result.products[0].lotValue,0.2);
  assert.equal(result.totals.inventoryValue,0.4);
  assert.equal(result.totals.retailValue,5.46);
});

test('lot mismatch compares numeric lot quantity against original Current Stock only for active rows',()=>{
  const s=fixture();
  const x=matchesSource(s);
  assert.deepEqual(x.products.filter(p=>p.lotMismatch).map(p=>p.productId),['P-B','P-E']);
  s.activeProducts[1]['Current Stock']=1;
  s.activeProducts[4]['Current Stock']=0;
  const corrected=matchesSource(s);
  assert.equal(corrected.totals.mismatchCount,0);
  assert.equal(corrected.products.find(p=>p.productId==='P-B').lotMismatch,false);
});

test('empty snapshot, unknown categories and no lots preserve exact source empty amounts',()=>{
  assert.deepEqual(matchesSource(blank()),{
    totals:{products:0,activeProducts:0,inventoryValue:0,retailValue:0,
      potentialMargin:0,lowStockCount:0,outOfStockCount:0,mismatchCount:0},
    byCategory:[],products:[],lowStock:[]
  });
  const s=blank();
  s.activeProducts=[{'Product ID':'P-X','Product Name':'Unnamed',
    'Status':'Inactive','Current Stock':20,'Minimum Stock':21,'Selling Price':42}];
  const z=matchesSource(s);
  assert.equal(z.totals.products,1);
  assert.equal(z.totals.activeProducts,0);
  assert.equal(z.products[0].category,'Uncategorized');
});

test('ambiguous duplicate active Product IDs fail closed rather than double counting stock value',()=>{
  const s=fixture();
  s.activeProducts.push({...s.activeProducts[0],'Product Name':'Other Cable'});
  // Frozen getStockReport has no duplicate-ID guard. This corruption case
  // deliberately fails closed to prevent certified doubled inventory value.
  assert.throws(()=>project(s),/duplicate product id/i);
});

test('malformed trusted snapshots, Promise values, getters, nonfinite numbers fail closed',()=>{
  const s=fixture();
  for(const input of [
    null,undefined,{},[],{...s,activeProducts:undefined},
    {...s,stockLots:Promise.resolve([])},
    {...s,activeProducts:[null]},
    {...s,stockLots:['invalid']},
    {...s,stockLots:[Object.create({'Product ID':'P-A'})]}
  ])assert.throws(()=>project(input),/snapshot|array|trusted|row|invalid/i);
  const accessor={...s,get activeProducts(){throw Error('getter executed');}};
  assert.throws(()=>project(accessor),/snapshot|accessor|trusted/i);
  const accessorRow={'Product ID':'P-A',get 'Current Stock'(){throw Error('getter executed');}};
  assert.throws(()=>project({...s,activeProducts:[accessorRow]}),/row|accessor|trusted/i);
  for(const bad of [Infinity,-Infinity,'Infinity',{},Promise.resolve(2)])
    assert.throws(()=>project({...s,stockLots:[{
      'Product ID':'P-A','Remaining Quantity':bad,'Purchase Price':2
    }]}),/finite|amount|number|quantity|trusted|invalid/i);
});

test('source and original Stock Report DOM remain unchanged; projection is pure and no RPC',()=>{
  const s=fixture(),before=clone(s);
  matchesSource(s);
  assert.deepEqual(s,before);
  assert.match(frozenUI,/id="rkMismatchCard"/);
  assert.match(frozenUI,/id="rkProdBody"/);
  const module=readFileSync(new URL('../src/modules/stock-report-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(module,/function\s+getStockReport\s*\(/);
});
