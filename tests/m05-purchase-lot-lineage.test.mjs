import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPurchaseLotLineage} from '../src/modules/m05-purchase-lot-lineage.js';

const sources={
  purchase:readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8'),
  update:readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8'),
  deletion:readFileSync(new URL('../legacy/source/DeleteEngine.gs',import.meta.url),'utf8'),
  lots:readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8')
};
const purchase=(id='PUR-001',supplier='SUP-A',extra={})=>({
  'Purchase ID':id,'Supplier ID':supplier,'Date':'2026-11-09','Is Deleted':'',...extra
});
const item=(id='PUR-001',product='P-1',qty=5,cost=12,extra={})=>({
  'Purchase ID':id,'Product ID':product,'Quantity':qty,'Unit Price':cost,...extra
});
const lot=(id='LOT-1',purchaseId='PUR-001',product='P-1',supplier='SUP-A',extra={})=>({
  'Lot ID':id,'Purchase ID':purchaseId,'Product ID':product,
  'Supplier ID':supplier,'Purchase Date':'2026-11-09','Purchase Price':12,
  'Original Quantity':5,'Remaining Quantity':3,'Status':'Active',...extra
});
const fixture=()=>({
  purchases:[purchase()],
  purchaseItems:[item()],
  stockLots:[lot()]
});
const run=s=>auditPurchaseLotLineage(s);
const codes=s=>run(s).issues.map(x=>x.code);

test('frozen source establishes purchase ID/line/lot supplier and update/delete provenance invariants',()=>{
  assert.match(sources.purchase,/createLot_\(line\.productId, line\.name, purchaseId, dateStr, line\.price, line\.qty, payload\.supplierId/);
  assert.match(sources.update,/'Original Quantity': original \+ c\.delta/);
  assert.match(sources.update,/'Supplier ID': supplierId/);
  assert.match(sources.update,/deleteRow_\('PURCHASE_ITEMS'/);
  assert.match(sources.deletion,/'Remaining Quantity': 0, 'Status': 'Deleted'/);
  assert.match(sources.lots,/source === 'OPENING'/);
  assert.match(sources.lots,/source === 'ADJUSTMENT'/);
});

test('active purchase with partly sold lot, separate suppliers, source internal lots and retired zero lot stays valid',()=>{
  const s=fixture();
  s.purchases.push(purchase('PUR-002','SUP-B'));
  s.purchaseItems.push(item('PUR-002','P-2',7,3));
  s.stockLots.push(lot('LOT-2','PUR-002','P-2','SUP-B',{
    'Original Quantity':7,'Remaining Quantity':0,'Purchase Price':3,'Status':'Consumed'
  }));
  s.stockLots.push(lot('LOT-RETIRED','PUR-001','P-OLD','SUP-A',{
    'Original Quantity':0,'Remaining Quantity':0,'Purchase Price':15,'Status':'Consumed'
  }));
  s.stockLots.push(lot('LOT-OVER','OVERSOLD','P-1','',{
    'Original Quantity':2,'Remaining Quantity':-2,'Status':'Oversold'
  }));
  s.stockLots.push(lot('LOT-OPEN','OPENING-MIGRATION','P-1','',{
    'Original Quantity':1,'Remaining Quantity':1,'Status':'Active'
  }));
  const before=structuredClone(s);
  const result=run(s);
  assert.equal(result.ready,true);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(result.summary,{
    purchaseCount:2,activePurchases:2,deletedPurchases:0,purchaseItemCount:2,
    stockLotCount:5,linkedPurchaseLots:3,internalLots:2,retiredLots:1
  });
  assert.deepEqual(s,before,'audit cannot alter source records');
});

test('supplier mismatches and blank legacy supplier IDs need review without auto-relinking',()=>{
  const s=fixture();
  s.stockLots[0]['Supplier ID']='SUP-B';
  assert.deepEqual(codes(s),['SUPPLIER_MISMATCH']);
  s.stockLots[0]['Supplier ID']='';
  assert.deepEqual(codes(s),['UNVERIFIED_SUPPLIER_ID']);
  assert.equal(s.stockLots[0]['Supplier ID'],'');
  s.purchases[0]['Supplier ID']='';
  assert.ok(codes(s).includes('MISSING_PURCHASE_SUPPLIER'));
});

test('original purchase item quantity, unit cost, purchase date and remaining bounds are reviewed independently',()=>{
  const s=fixture();
  s.stockLots[0]['Original Quantity']=4;
  s.stockLots[0]['Purchase Price']=13;
  s.stockLots[0]['Purchase Date']='2026-11-10';
  s.stockLots[0]['Remaining Quantity']=6;
  for(const code of ['ORIGINAL_QUANTITY_MISMATCH','PURCHASE_COST_MISMATCH',
    'PURCHASE_DATE_MISMATCH','INVALID_PURCHASE_LOT_QUANTITY']) assert.ok(codes(s).includes(code));
  s.stockLots[0]['Original Quantity']='invalid';
  assert.ok(codes(s).includes('INVALID_PURCHASE_LOT_QUANTITY'));
  assert.equal(run(s).ready,false);
});

test('duplicate purchase IDs, duplicate purchase products and duplicated lot IDs block import',()=>{
  const s=fixture();
  s.purchases.push(purchase());
  s.purchaseItems.push(item());
  s.stockLots.push(lot());
  for(const code of ['DUPLICATE_PURCHASE_ID','DUPLICATE_PURCHASE_PRODUCT',
    'DUPLICATE_LOT_ID','MULTIPLE_PURCHASE_LOTS'])
    assert.ok(codes(s).includes(code),code);
  assert.equal(run(s).ready,false);
});

test('unknown purchase references and orphan items cannot become inferred Party relations',()=>{
  const s=fixture();
  s.purchaseItems.push(item('PUR-MISSING','P-X',4,2));
  s.stockLots.push(lot('LOT-UNMATCHED','PUR-UNKNOWN','P-X','SUP-Z'));
  assert.ok(codes(s).includes('ORPHAN_PURCHASE_ITEM'));
  assert.ok(codes(s).includes('UNVERIFIED_LOT_SOURCE'));
  assert.equal(run(s).ready,false);
});

test('missing lot for an active product line and positive orphan line lot are both blocked',()=>{
  const s=fixture();
  s.purchaseItems.push(item('PUR-001','P-2',3,2));
  s.stockLots.push(lot('LOT-OTHER','PUR-001','P-3','SUP-A',{
    'Original Quantity':5,'Remaining Quantity':3,'Purchase Price':4
  }));
  assert.ok(codes(s).includes('MISSING_PURCHASE_LOT'));
  assert.ok(codes(s).includes('LOT_WITHOUT_PURCHASE_ITEM'));
  assert.equal(run(s).ready,false);
});

test('deleted purchase retains matching consumed item/lot provenance, but active stock or nondeleted lot blocks',()=>{
  const s=fixture();
  s.purchases[0]['Is Deleted']='TRUE';
  s.stockLots[0]['Remaining Quantity']=0;
  s.stockLots[0].Status='Deleted';
  assert.equal(run(s).ready,true);
  assert.equal(run(s).summary.deletedPurchases,1);
  s.stockLots[0]['Remaining Quantity']=1;
  s.stockLots[0].Status='Active';
  assert.ok(codes(s).includes('DELETED_PURCHASE_LOT_NOT_REVERSED'));
  assert.equal(run(s).ready,false);
});

test('no rows is valid, but missing identifiers, invalid item quantities and accessors fail closed',()=>{
  assert.equal(run({purchases:[],purchaseItems:[],stockLots:[]}).ready,true);
  const s=fixture();
  s.purchases[0]['Purchase ID']='';
  s.purchaseItems[0]['Product ID']='';
  s.stockLots[0]['Lot ID']='';
  s.purchaseItems[0]['Quantity']=Infinity;
  for(const code of ['MISSING_PURCHASE_ID','MISSING_PURCHASE_ITEM_PRODUCT',
    'MISSING_LOT_ID','INVALID_PURCHASE_ITEM_QUANTITY'])
    assert.ok(codes(s).includes(code),code);
  assert.throws(()=>run({purchases:[],purchaseItems:[],stockLots:null}),/snapshot/i);
  assert.throws(()=>run({purchases:[new Date()],purchaseItems:[],stockLots:[]}),/row/i);
  const a=Object.defineProperty({},'Purchase ID',{get(){throw new Error('getter invoked');}});
  assert.throws(()=>run({purchases:[a],purchaseItems:[],stockLots:[]}),/row|accessor/i);
});

test('internal pure audit has no direct RPC, D1, Sheet or migration writes',()=>{
  const code=readFileSync(new URL('../src/modules/m05-purchase-lot-lineage.js',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/m05-purchase-lot-lineage|auditPurchaseLotLineage/);
  assert.doesNotMatch(code,/SpreadsheetApp|LockService|\bfetch\s*\(|\b(?:batch|exec|run)\s*\(|\.put\s*\(/);
});
