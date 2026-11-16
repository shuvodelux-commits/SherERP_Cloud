import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {auditSourceStockLotBalances} from '../src/modules/m05-source-lot-reconciliation.js';

const source=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
const legacy=ast.body.find(x=>x.type==='FunctionDeclaration' &&
  x.id.name==='reconcileProductStocksFromLots_');
assert.ok(legacy,'frozen source contains original stock reconciliation routine');
const frozen=source.slice(legacy.start,legacy.end);

const product=(id,stock,extra={})=>({
  'Product ID':id,'Product Name':'Synthetic '+id,'Current Stock':stock,
  '_rowIndex':3,...extra
});
const lot=(id,productId,qty,extra={})=>({
  'Lot ID':id,'Product ID':productId,'Remaining Quantity':qty,
  'Status':'Active','Purchase ID':'PUR-1','Supplier ID':'SUP-A',
  '_rowIndex':5,...extra
});
const audit=(products,stockLots)=>auditSourceStockLotBalances({products,stockLots});
const codes=report=>report.issues.map(x=>x.code);

/** Execute source GAS with inert, in-memory stubs. Never update the repository. */
function legacyAudit(products,stockLots){
  const updates=[];
  const context=vm.createContext({
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    CONFIG:{LOCK_TIMEOUT_MS:100},
    getAllRows_:group=>group==='STOCK_LOTS'?stockLots:products,
    updateRowFields_:(group,rowIndex,changes)=>{
      assert.equal(group,'PRODUCTS');
      updates.push({rowIndex,stock:changes['Current Stock']});
    },
    SpreadsheetApp:{flush:()=>{}},
    ok_:value=>({ok:true,data:value}),
    fail_:message=>({ok:false,message}),
    logError_:()=>{}
  });
  vm.runInContext(frozen,context);
  const result=context.reconcileProductStocksFromLots_();
  assert.equal(result.ok,true);
  return updates;
}

test('source reconciliation compares all supplier lots including OVERSOLD negative quantities',()=>{
  const products=[product('P-A',2),product('P-B',0),product('P-Z',0)];
  const stockLots=[
    lot('LOT-1','P-A',4,{'Supplier ID':'SUP-A'}),
    lot('LOT-2','P-A',1,{'Supplier ID':'SUP-B'}),
    lot('LOT-3','P-A',-3,{Status:'Oversold'}),
    lot('LOT-4','P-B',0,{Status:'Consumed'})
  ];
  const before=structuredClone({products,stockLots});
  const report=audit(products,stockLots);
  assert.equal(report.ready,true);
  assert.deepEqual(report.issues,[]);
  assert.equal(report.products.find(x=>x.productId==='P-A').lotStock,2);
  assert.equal(report.products.find(x=>x.productId==='P-A').status,'MATCH');
  assert.equal(report.products.find(x=>x.productId==='P-Z').status,'NO_LOTS_ZERO');
  assert.equal(report.summary.oversoldLots,1);
  assert.deepEqual(legacyAudit(products,stockLots),[]);
  assert.deepEqual({products,stockLots},before);
});

test('read-only mismatch candidates equal legacy GAS proposed Current Stock updates',()=>{
  const products=[product('P-A',7,{_rowIndex:8}),product('P-B',-2,{_rowIndex:9})];
  const stockLots=[lot('L-A1','P-A',8),lot('L-A2','P-A',-3,{Status:'Oversold'}),
    lot('L-B','P-B',-2,{Status:'Oversold'})];
  const report=audit(products,stockLots);
  assert.equal(report.ready,false);
  const a=report.products.find(x=>x.productId==='P-A');
  assert.equal(a.cachedStock,7);
  assert.equal(a.lotStock,5);
  assert.equal(a.difference,-2);
  assert.equal(a.status,'MISMATCH');
  assert.equal(report.products.find(x=>x.productId==='P-B').status,'MATCH');
  assert.equal(report.summary.mismatchedProducts,1);
  assert.deepEqual(codes(report),['STOCK_MISMATCH']);
  const fromSource=legacyAudit(products,stockLots).map(x=>({rowIndex:x.rowIndex,stock:x.stock}));
  assert.deepEqual(fromSource,[{rowIndex:8,stock:5}]);
  assert.equal(products[0]['Current Stock'],7,'audit and source oracle do not mutate supplied fixtures');
});

test('legacy source totals Deleted positive lots but audit explicitly blocks their use',()=>{
  const products=[product('P-A',5)];
  const stockLots=[lot('L-DELETED','P-A',5,{Status:'Deleted'})];
  const report=audit(products,stockLots);
  assert.equal(report.ready,false);
  assert.equal(report.products[0].lotStock,5,'parity includes Deleted lot quantity');
  assert.equal(report.products[0].status,'MATCH');
  assert.deepEqual(codes(report),['DELETED_POSITIVE_LOT']);
  assert.equal(report.summary.deletedPositiveLots,1);
  assert.deepEqual(legacyAudit(products,stockLots),[]);
});

test('nonzero legacy stock with no lots is held for import review, never silently zeroed',()=>{
  const products=[product('P-A',5),product('P-B',-4),product('P-C',0)];
  const report=audit(products,[]);
  assert.equal(report.ready,false);
  assert.deepEqual(report.products.map(p=>p.status),[
    'NO_LOTS_NONZERO','NO_LOTS_NONZERO','NO_LOTS_ZERO']);
  assert.deepEqual(codes(report),['NO_LOTS_NONZERO','NO_LOTS_NONZERO']);
  assert.deepEqual(legacyAudit(products,[]),[],'original does not update absent-lot products');
});

test('duplicate Product IDs or Lot IDs and orphan lots prevent import-ready evidence',()=>{
  const report=audit([product('P-A',1),product('P-A',1)],
    [lot('L1','P-A',1),lot('L1','P-A',1),lot('L2','P-MISSING',7)]);
  assert.equal(report.ready,false);
  for(const flag of ['DUPLICATE_PRODUCT_ID','DUPLICATE_LOT_ID','ORPHAN_LOT']) {
    assert.ok(codes(report).includes(flag),flag);
  }
  assert.equal(report.summary.orphanLots,1);
});

test('missing Product/Lot identifiers and invalid numeric source values fail closed',()=>{
  const report=audit(
    [product('',3),product('P-B','Infinity'),product('P-C',0)],
    [lot('','P-C',1),lot('L1','P-C','NaN'),lot('L2','',1)]
  );
  for(const flag of ['MISSING_PRODUCT_ID','INVALID_CURRENT_STOCK',
    'MISSING_LOT_ID','INVALID_LOT_QUANTITY','MISSING_LOT_PRODUCT_ID']) {
    assert.ok(codes(report).includes(flag),flag);
  }
  assert.equal(report.ready,false);
  assert.equal(report.products.find(x=>x.productId==='P-C').status,'INVALID');
});

test('source exact numeric comparison is preserved without rounding or tolerance',()=>{
  const products=[product('P-A',0.3)];
  const stockLots=[lot('L1','P-A',0.1),lot('L2','P-A',0.2)];
  const report=audit(products,stockLots);
  const row=report.products[0];
  assert.equal(row.status,'MISMATCH');
  assert.equal(row.lotStock,0.1+0.2);
  assert.equal(row.difference,(0.1+0.2)-0.3);
  assert.equal(report.ready,false);
  assert.deepEqual(legacyAudit(products,stockLots).map(x=>x.stock),[0.1+0.2]);
});

test('trusted snapshots reject accessors, nonplain rows and missing arrays',()=>{
  assert.throws(()=>auditSourceStockLotBalances(),/snapshot/i);
  assert.throws(()=>auditSourceStockLotBalances({products:[],stockLots:null}),/snapshot/i);
  assert.throws(()=>audit([new Date()],[]),/row/i);
  const getter=Object.defineProperty({},'Product ID',{get(){throw Error('should never execute');}});
  assert.throws(()=>audit([getter],[]),/row|accessor/i);
  assert.throws(()=>audit([],[[1,2]]),/row/i);
});

test('audit is not registered as Worker RPC and never writes or performs D1 lookups',()=>{
  const code=readFileSync(new URL('../src/modules/m05-source-lot-reconciliation.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/m05-source-lot-reconciliation|auditSourceStockLotBalances/);
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|run)\s*\(|\bfetch\s*\(|SpreadsheetApp|LockService|\.put\s*\(/);
});
