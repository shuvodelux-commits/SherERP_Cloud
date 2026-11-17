import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiUnitPurchasePreflight}
 from '../src/modules/m05-multi-unit-purchase-preflight.js';
// TDD RED: intentionally absent new M07-only internal batch composer.
import {planHistoricalMixedUnitPurchaseReturnBatch}
 from '../src/modules/m07-historical-purchase-batch-return.js';

const product={'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
 Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,
 Status:'Active','Is Deleted':'FALSE',_rowIndex:8};
const supplier={'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'};
const conversions=[
 {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
  'Conversion Factor':100,'Purchase Price':500,'Selling Price':900,
  'Sort Order':1,Status:'Active'},
 {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
  'Conversion Factor':20,'Purchase Price':100,'Selling Price':190,
  'Sort Order':2,Status:'Active'}
];
function lot(id,purchaseId,original,remaining,index,supplierId,date='2026-11-10'){
 return {'Lot ID':id,'Purchase ID':purchaseId,'Product ID':'P-MIX',
  'Supplier ID':supplierId,'Purchase Date':date,'Created At':date+'T09:00:00',
  'Original Quantity':original,'Remaining Quantity':remaining,
  'Purchase Price':5,'Sell Price':12,_rowIndex:index,Status:'Active'};
}
function originalLine(){
 const review=prepareMultiUnitPurchasePreflight({
  supplierId:'SUP-A',items:[{
   productId:'P-MIX',name:'not authoritative',qty:145,unitPrice:0.01,
   sellingPrice:12,unitBreakdown:[
    {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
    {conversionId:'BASE',qty:5}
   ]
  }],discount:0,paidAmount:0
 },{products:[product],suppliers:[supplier],conversionRows:conversions});
 assert.equal(review.lines[0].qty,145);
 assert.equal(review.lines[0].unit.lineTotal,730);
 return review.lines[0];
}
function source(){
 return {
  tenantId:'SHOP-A',purchaseId:'PUR-1',supplierId:'SUP-A',
  productId:'P-MIX',sourceHash:'d'.repeat(64),
  originalLineTotalPaisa:73000,alreadyReturnedBaseQty:0,
  line:originalLine(),lots:[
   lot('LOT-A','PUR-1',100,10,11,'SUP-A','2026-11-10'),
   lot('LOT-B','PUR-1',45,40,12,'SUP-A','2026-11-11'),
   lot('OTHER','PUR-X',999,999,13,'SUP-X','2020-01-01')
  ]
 };
}
function secondPurchase(){
 const s=source();
 s.purchaseId='PUR-2';s.supplierId='SUP-B';s.sourceHash='e'.repeat(64);
 s.lots=[
  lot('LOT-C','PUR-2',145,45,21,'SUP-B','2026-11-12'),
  lot('LOT-A','PUR-1',100,10,11,'SUP-A','2026-11-10')
 ];
 return s;
}
const intent=(returnId,rows=[{conversionId:'C-BOX',qty:1}],extra={})=>({
 tenantId:'SHOP-A',purchaseId:'PUR-1',productId:'P-MIX',
 returnId,unitBreakdown:rows,...extra
});
const child=(s,i)=>({source:s,intent:i});
const batch=entries=>({tenantId:'SHOP-A',batchId:'PUR-BATCH-1',entries});
const plan=entries=>planHistoricalMixedUnitPurchaseReturnBatch(batch(entries));
const two=()=>{const s=source();return [
 child(structuredClone(s),intent('RET-1',[{conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}])),
 child(structuredClone(s),intent('RET-2',[{conversionId:'C-BOX',qty:1}]))
];};

test('batch plans two original-Purchase returns in one virtual FIFO stock budget, without mutating source',()=>{
 const children=two(),raw=batch(children),original=structuredClone(raw);
 const result=planHistoricalMixedUnitPurchaseReturnBatch(raw);
 assert.equal(result.status,'PLAN_ONLY');
 assert.equal(result.data.children.length,2);
 assert.deepEqual(result.data.children.map(x=>x.plan.requestedBaseQty),[25,20]);
 assert.deepEqual(result.data.children[0].plan.sourcePurchaseLots,[
  {lotId:'LOT-A',sourceRowIndex:11,baseQty:10,remainingAfter:0},
  {lotId:'LOT-B',sourceRowIndex:12,baseQty:15,remainingAfter:25}
 ]);
 assert.deepEqual(result.data.children[1].plan.sourcePurchaseLots,[
  {lotId:'LOT-B',sourceRowIndex:12,baseQty:20,remainingAfter:5}
 ]);
 assert.deepEqual(raw,original);
 assert.deepEqual(result.data.children.map(x=>x.returnId),['RET-1','RET-2']);
 assert.equal(result.data.readOnly,true);
 assert.equal(result.data.commitAuthorized,false);
 assert.equal(result.data.financialCalculationAuthorized,false);
});

test('two individually valid requests cannot reuse one historical Box selection after total budget',()=>{
 const s=source();
 // Isolate the historical conversion count invariant from current lot stock:
 // 120 original-purchase physical Pcs remain, enough for both 40+20 requests.
 s.lots[0]['Remaining Quantity']=80;
 const entries=[
  child(structuredClone(s),intent('RET-1',[{conversionId:'C-BOX',qty:2}])),
  child(structuredClone(s),intent('RET-2',[{conversionId:'C-BOX',qty:1}]))
 ];
 assert.deepEqual(plan(entries),{
  status:'DECLINED',childIndex:1,reason:'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY'
 });
});

test('separate BASE unit choices cannot exceed original 5 Pcs even when physical stock is ample',()=>{
 const s=source(),entries=[
  child(structuredClone(s),intent('RET-1',[{conversionId:'BASE',qty:5}])),
  child(structuredClone(s),intent('RET-2',[{conversionId:'BASE',qty:5}]))
 ];
 assert.deepEqual(plan(entries),{
  status:'DECLINED',childIndex:1,reason:'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY'
 });
});

test('real original-purchase lot stock is consumed virtually; no borrowing from unrelated Purchase',()=>{
 const s=source();
 s.lots[0]['Remaining Quantity']=10;
 s.lots[1]['Remaining Quantity']=20;
 const entries=[
  child(structuredClone(s),intent('RET-1')),
  child(structuredClone(s),intent('RET-2'))
 ];
 assert.deepEqual(plan(entries),{
  status:'DECLINED',childIndex:1,reason:'INSUFFICIENT_ORIGINAL_PURCHASE_LOT_STOCK'
 });
});

test('virtual prior-return total cannot exceed original Purchase remaining even when lot stock is higher',()=>{
 const s=source();s.alreadyReturnedBaseQty=115;
 const entries=[
  child(structuredClone(s),intent('RET-1')),
  child(structuredClone(s),intent('RET-2'))
 ];
 assert.deepEqual(plan(entries),{
  status:'DECLINED',childIndex:1,reason:'EXCEEDS_ORIGINAL_PURCHASE_REMAINING_QTY'
 });
});

test('independent original Purchases retain separate units and physical lots',()=>{
 const first=source(),second=secondPurchase(),i=intent('RET-2');
 i.purchaseId='PUR-2';
 const result=plan([child(first,intent('RET-1')),child(second,i)]);
 assert.equal(result.status,'PLAN_ONLY');
 assert.equal(result.data.children[0].plan.sourcePurchaseLots[0].lotId,'LOT-A');
 assert.equal(result.data.children[1].plan.sourcePurchaseLots[0].lotId,'LOT-C');
 assert.equal(result.data.children[1].plan.purchaseId,'PUR-2');
});

test('a second purchase cannot claim first purchase original owned Lot ID or physical source row index',()=>{
 for(const mutate of [
  s=>{s.lots[0]['Lot ID']='LOT-A';},
  s=>{s.lots[0]._rowIndex=11;}
 ]){
  const second=secondPurchase();mutate(second);
  const i=intent('RET-2');i.purchaseId='PUR-2';
  assert.throws(()=>plan([child(source(),intent('RET-1')),child(second,i)]),
   /NEEDS_REVIEW|collision|provenance/i);
 }
});

test('same original Purchase/Product must provide identical starting source snapshot in every child',()=>{
 for(const mutate of [
  s=>{s.sourceHash='f'.repeat(64);},
  s=>{s.lots[0]['Remaining Quantity']=9;},
  s=>{s.alreadyReturnedBaseQty=1;}
 ]){
  const s=source(),different=structuredClone(s);mutate(different);
  assert.throws(()=>plan([
   child(s,intent('RET-1')),child(different,intent('RET-2'))
  ]),/NEEDS_REVIEW|contradictory|source/i);
 }
});

test('return IDs are unique across the entire batch, including distinct purchases',()=>{
 const i=intent('SAME');i.purchaseId='PUR-2';
 assert.throws(()=>plan([
  child(source(),intent('SAME')),child(secondPurchase(),i)
 ]),/duplicate|Return ID|invalid/i);
});

test('cross-tenant or cross-Purchase intent is rejected before any preview',()=>{
 const s=source(),foreign=source();foreign.tenantId='SHOP-B';
 assert.throws(()=>plan([
  child(s,intent('RET-1')),child(foreign,intent('RET-2',{},{tenantId:'SHOP-B'}))
 ]),/tenant|identity|invalid/i);
 assert.throws(()=>plan([
  child(s,intent('RET-1')),child(source(),intent('RET-2',undefined,{purchaseId:'PUR-X'}))
 ]),/identity|mismatch|invalid/i);
});

test('any first-child decline aborts entire batch, never returns later success',()=>{
 const s=source(),invalid=intent('RET-1',[{conversionId:'C-BAG',qty:1}]);
 assert.deepEqual(plan([child(structuredClone(s),invalid),child(s,intent('RET-2'))]),{
  status:'DECLINED',childIndex:0,reason:'INSUFFICIENT_ORIGINAL_PURCHASE_LOT_STOCK'
 });
});

test('unverifiable original-owned stock and corrupted historical price refuse batch preview',()=>{
 const empty=source();empty.lots=empty.lots.filter(l=>l['Purchase ID']!=='PUR-1');
 assert.deepEqual(plan([child(empty,intent('RET-1')),child(source(),intent('RET-2'))]),{
  status:'DECLINED',childIndex:0,reason:'UNVERIFIED_LEGACY_PURCHASE_LOT_ORIGIN'
 });
 const corrupt=source();corrupt.line.unit.pricingSnapshot[0].unitPrice=999;
 assert.throws(()=>plan([child(corrupt,intent('RET-1')),child(source(),intent('RET-2'))]),
  /NEEDS_REVIEW|price|snapshot/i);
});

test('caller cannot inject unit factors, lot selectors, refunds or root authorization',()=>{
 const s=source();
 for(const bad of [
  {...batch(two()),postingAuthorized:true},
  {...batch(two()),entries:[{...child(s,intent('RET-1')),refundPaisa:1},two()[1]]},
  batch([child(s,{...intent('RET-1'),factor:1}),child(s,intent('RET-2'))]),
  batch([child(s,{...intent('RET-1'),lotId:'LOT-A'}),child(s,intent('RET-2'))])
 ])assert.throws(()=>planHistoricalMixedUnitPurchaseReturnBatch(bad),
  /invalid|shape|untrusted|NEEDS_REVIEW/i);
});

test('getter-bearing or nonplain nested source cannot execute caller code during validation',()=>{
 const s=source(),entry=child(s,intent('RET-1'));
 Object.defineProperty(s.lots[0],'Remaining Quantity',{
  enumerable:true,get(){throw Error('UNTRUSTED_ACCESSOR_EXECUTED');}
 });
 assert.throws(()=>plan([entry,child(source(),intent('RET-2'))]),
  err=>err.message!=='UNTRUSTED_ACCESSOR_EXECUTED' && /NEEDS_REVIEW|invalid|accessor/i.test(err.message));
});

test('invalid root array, sparse array, oversized batch, malformed children fail closed',()=>{
 const s=source(),valid=child(s,intent('RET-1'));
 for(const bad of [
  batch([]),batch([valid]),batch(Array(21).fill(valid)),
  {...batch(two()),entries:[valid,{source:source()}]},
  {...batch(two()),entries:[valid,,valid]},
  {...batch(two()),batchId:''}
 ])assert.throws(()=>planHistoricalMixedUnitPurchaseReturnBatch(bad),
  /invalid|NEEDS_REVIEW|sparse|batch|shape/i);
});

test('outputs are deeply frozen and never expose refund, cash, supplier or ledger authority',()=>{
 const result=plan(two());
 assert.equal(result.status,'PLAN_ONLY');
 assert.ok(Object.isFrozen(result));
 assert.ok(Object.isFrozen(result.data));
 assert.ok(Object.isFrozen(result.data.children));
 assert.ok(Object.isFrozen(result.data.children[0]));
 assert.ok(Object.isFrozen(result.data.children[0].plan.sourcePurchaseLots));
 assert.ok(Object.isFrozen(result.data.children[0].plan.sourcePurchaseLots[0]));
 const raw=JSON.stringify(result);
 for(const forbidden of ['refundPaisa','creditPaisa','supplierId','cashSessionId',
  'cashBook','bankBook','partyId','Purchase Price','unitCost','unitSellPrice'])
  assert.equal(raw.includes('"'+forbidden+'"'),false,forbidden);
 assert.equal(result.data.commitAuthorized,false);
 assert.equal(result.data.financialCalculationAuthorized,false);
});
