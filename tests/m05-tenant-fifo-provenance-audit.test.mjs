import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditTenantPurchaseFifoEvidence} from '../src/modules/m05-tenant-fifo-provenance-audit.js';
import {compareLotsFifo_} from '../src/modules/stock-fifo-planning.js';

const T='shop-101', P='PRD-000001';
const product=()=>({'Tenant ID':T,'Product ID':P,'Product Name':'Pipe',
  'Current Stock':5,'Purchase Price':10,'Selling Price':20});
const purchase=(id,supplier='SUP-A',date='2026-11-08')=>({
  'Tenant ID':T,'Purchase ID':id,'Supplier ID':supplier,'Date':date,'Is Deleted':''
});
const item=(purchaseId,qty,cost=10)=>({
  'Tenant ID':T,'Purchase ID':purchaseId,'Product ID':P,'Quantity':qty,'Unit Price':cost
});
const lot=(id,purchaseId,supplier,qty,original,cost=10,date='2026-11-08',extra={})=>({
  'Tenant ID':T,'Lot ID':id,'Product ID':P,'Purchase ID':purchaseId,
  'Supplier ID':supplier,'Purchase Date':date,'Original Quantity':original,
  'Remaining Quantity':qty,'Purchase Price':cost,'Sell Price':20,
  'Status':'Active',...extra
});
const movement=(id,purchaseId,qty)=>({
  'Tenant ID':T,'Movement ID':id,'Type':'Purchase','Reference':purchaseId,
  'Product ID':P,'Lot ID':purchaseId==='PUR-000001'?'LOT-01':'LOT-02',
  'Quantity In':qty,'Quantity Out':''
});
function fixture(){
  return {tenantId:T,productId:P,requestedQty:4,productRow:product(),
    purchases:[purchase('PUR-000002','SUP-B'),purchase('PUR-000001','SUP-A')],
    purchaseItems:[item('PUR-000002',3,12),item('PUR-000001',4,10)],
    stockLots:[lot('LOT-02','PUR-000002','SUP-B',3,3,12),
      lot('LOT-01','PUR-000001','SUP-A',2,4,10)],
    stockMovements:[movement('MOV-02','PUR-000002',3),
      movement('MOV-01','PUR-000001',4)]};
}
const run=s=>auditTenantPurchaseFifoEvidence(s);
const codes=r=>r.issues.map(x=>x.code);

test('frozen source FIFO comparator sorts Purchase Date first and Lot ID within date',()=>{
  const early={'Lot ID':'LOT-09','Purchase Date':'2026-11-07'};
  const late={'Lot ID':'LOT-01','Purchase Date':'2026-11-08'};
  assert.ok(compareLotsFifo_(early,late)<0);
  assert.ok(compareLotsFifo_({'Lot ID':'LOT-01','Purchase Date':late['Purchase Date']},
    {'Lot ID':'LOT-02','Purchase Date':late['Purchase Date']})<0);
  const source=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8');
  assert.match(source,/compareLotsFifo_/);
});

test('two independent suppliers, original IDs and FIFO dates preserve 5 owned units and purchase movements',()=>{
  const input=fixture(),before=structuredClone(input);
  const r=run(input);
  assert.equal(r.auditPassed,true,JSON.stringify(r.issues));
  assert.equal(r.postingAllowed,false);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.stock.products[0].lotStock,5);
  assert.equal(r.lotLineage.summary.linkedPurchaseLots,2);
  assert.equal(r.purchaseMovements.summary.purchaseMovements,2);
  assert.deepEqual(r.fifo.consumption.draws.map(x=>[x.lotId,x.take]),
    [['LOT-01',2],['LOT-02',2]]);
  assert.equal(r.fifo.consumption.shortfall,0);
  assert.deepEqual(input,before);
});

test('original purchase date precedes lexical lot ID and cannot be replaced by array order',()=>{
  const input=fixture();
  input.purchases[0].Date='2026-11-07';
  input.stockLots[0]['Purchase Date']='2026-11-07';
  const r=run(input);
  assert.equal(r.auditPassed,true,JSON.stringify(r.issues));
  assert.deepEqual(r.fifo.consumption.draws.map(x=>[x.lotId,x.take]),
    [['LOT-02',3],['LOT-01',1]]);
});

test('source OVERSOLD and later replenishment quote NET stock only without settling historical debt',()=>{
  const input=fixture();
  input.purchases=input.purchases.filter(x=>x['Purchase ID']==='PUR-000001');
  input.purchaseItems=input.purchaseItems.filter(x=>x['Purchase ID']==='PUR-000001');
  input.stockMovements=input.stockMovements.filter(x=>x.Reference==='PUR-000001');
  input.stockLots=input.stockLots.filter(x=>x['Lot ID']==='LOT-01');
  input.stockLots[0]['Remaining Quantity']=3;
  input.stockLots.push(lot('LOT-OVER','OVERSOLD','',-2,2,8,'2026-11-01',
    {Status:'Oversold'}));
  input.productRow['Current Stock']=1;
  input.requestedQty=2;
  const before=structuredClone(input);
  const r=run(input);
  assert.equal(r.auditPassed,true,JSON.stringify(r.issues));
  assert.equal(r.fifo.netOwnedQty,1);
  assert.equal(r.fifo.reservedOversoldQty,2);
  assert.deepEqual(r.fifo.consumption.draws.map(x=>[x.lotId,x.take]),[['LOT-01',1]]);
  assert.equal(r.fifo.consumption.shortfall,1);
  assert.equal(r.fifo.postable,false);
  assert.equal(r.postingAllowed,false);
  assert.deepEqual(input,before);
});

test('foreign Tenant ID anywhere in product, Purchase, Item, Lot or Movement blocks the ENTIRE preview',()=>{
  for(const [key,index] of [['productRow',null],['purchases',0],
    ['purchaseItems',0],['stockLots',0],['stockMovements',0]]){
    const input=fixture();
    const row=index===null?input[key]:input[key][index];
    row['Tenant ID']='shop-OTHER';
    const result=run(input);
    assert.equal(result.auditPassed,false,key);
    assert.equal(result.fifo,null,key);
    assert.ok(codes(result).includes('TENANT_SCOPE_MISMATCH'),key);
    assert.equal(result.postingAllowed,false);
  }
});

test('missing tenant lineage never falls back to mixed or unscoped source rows',()=>{
  const input=fixture();
  delete input.stockLots[0]['Tenant ID'];
  const result=run(input);
  assert.equal(result.auditPassed,false);
  assert.ok(codes(result).includes('TENANT_SCOPE_MISMATCH'));
  assert.equal(result.fifo,null);
});

test('wrong Product ID on a lot, line, movement or product prevents silent filter-by-product',()=>{
  for(const [key,index] of [['productRow',null],['purchaseItems',0],
    ['stockLots',0],['stockMovements',0]]){
    const input=fixture();
    const row=index===null?input[key]:input[key][index];
    row['Product ID']='PRD-FOREIGN';
    const result=run(input);
    assert.equal(result.auditPassed,false,key);
    assert.ok(codes(result).includes('PRODUCT_SCOPE_MISMATCH'),key);
    assert.equal(result.fifo,null,key);
  }
});

test('supplier mismatch is reported from existing Purchase-to-lot source lineage, never relinked by name',()=>{
  const input=fixture();
  input.stockLots[0]['Supplier ID']='SUP-A';
  const r=run(input);
  assert.equal(r.auditPassed,false);
  assert.ok(codes(r).includes('SUPPLIER_MISMATCH'));
  assert.equal(r.fifo,null);
  assert.equal(input.stockLots[0]['Supplier ID'],'SUP-A');
});

test('duplicate Lot ID and duplicate purchase movement ID cannot masquerade as conservation',()=>{
  const a=fixture();a.stockLots.push({...a.stockLots[0]});
  const r1=run(a);
  assert.equal(r1.auditPassed,false);
  assert.ok(codes(r1).includes('DUPLICATE_LOT_ID'));
  assert.equal(r1.fifo,null);
  const b=fixture();b.stockMovements.push({...b.stockMovements[0]});
  const r2=run(b);
  assert.equal(r2.auditPassed,false);
  assert.ok(codes(r2).includes('DUPLICATE_MOVEMENT_ID'));
  assert.equal(r2.fifo,null);
});

test('missing original IDs, mismatched stock, and deleted positive lots are review blockers',()=>{
  const a=fixture();a.stockLots[0]['Lot ID']='';
  assert.ok(codes(run(a)).includes('MISSING_LOT_ID'));
  const b=fixture();b.productRow['Current Stock']=6;
  assert.ok(codes(run(b)).includes('STOCK_MISMATCH'));
  const c=fixture();c.stockLots[0].Status='Deleted';
  assert.ok(codes(run(c)).includes('DELETED_POSITIVE_LOT'));
  assert.equal(run(c).fifo,null);
});

test('ambiguous TWO-positive-lot history with existing OVERSOLD fails closed rather than guessing funding lot',()=>{
  const input=fixture();
  input.stockLots.push(lot('LOT-OVER','OVERSOLD','',-1,1,8,'2026-11-01',
    {Status:'Oversold'}));
  input.productRow['Current Stock']=4;
  const r=run(input);
  assert.equal(r.auditPassed,false);
  assert.ok(codes(r).includes('FIFO_PREVIEW_BLOCKED'));
  assert.equal(r.fifo,null);
});

test('zero-stock source with no lots can report shortage without inventing purchase history',()=>{
  const input=fixture();
  input.purchases=[];input.purchaseItems=[];input.stockLots=[];input.stockMovements=[];
  input.productRow['Current Stock']=0;input.requestedQty=3;
  const r=run(input);
  assert.equal(r.auditPassed,true,JSON.stringify(r.issues));
  assert.deepEqual(r.fifo.consumption.draws,[]);
  assert.equal(r.fifo.consumption.shortfall,3);
  assert.equal(r.postingAllowed,false);
});

test('invalid identity, nonfinite/negative requested quantity and untrusted accessor fail closed',()=>{
  for(const requestedQty of [-1,NaN,Infinity,'2',null]){
    assert.throws(()=>run({...fixture(),requestedQty}),/quantity/i);
  }
  assert.throws(()=>run({...fixture(),tenantId:'  '}),/tenant/i);
  assert.throws(()=>run({...fixture(),productId:''}),/product/i);
  assert.throws(()=>run({...fixture(),stockLots:null}),/stockLots|snapshot/i);
  const accessor=Object.defineProperty({},'Tenant ID',{get(){throw Error('getter executed');}});
  assert.throws(()=>run({...fixture(),stockLots:[accessor]}),/accessor|trusted|row/i);
});

test('gate is not a Worker RPC, SQL writer or financial rounding/settlement policy',()=>{
  const code=readFileSync(new URL('../src/modules/m05-tenant-fifo-provenance-audit.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/auditTenantPurchaseFifoEvidence|m05-tenant-fifo-provenance-audit/);
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|run)\s*\(|\bfetch\s*\(|SpreadsheetApp|LockService|roundMoney_|\.put\s*\(/);
});
