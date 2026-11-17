import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiUnitPurchasePreflight}
 from '../src/modules/m05-multi-unit-purchase-preflight.js';
// RED: the new M07-only, read-only historical purchase-return composer is absent.
import {planHistoricalMixedUnitPurchaseReturn}
 from '../src/modules/m07-historical-purchase-mixed-unit-return.js';

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
const unitBreakdown=[
 {conversionId:'C-BAG',qty:1},
 {conversionId:'C-BOX',qty:2},
 {conversionId:'BASE',qty:5}
];
function lot(id,purchaseId,original,remaining,index,date='2026-11-10'){
 return {'Lot ID':id,'Purchase ID':purchaseId,'Product ID':'P-MIX',
   'Supplier ID':purchaseId==='PUR-1'?'SUP-A':'SUP-OTHER',
   'Purchase Date':date,'Created At':date+'T09:00:00',
   'Original Quantity':original,'Remaining Quantity':remaining,
   'Purchase Price':5,'Sell Price':12,_rowIndex:index,Status:'Active'};
}
function source(){
 const preview=prepareMultiUnitPurchasePreflight({
  supplierId:'SUP-A',items:[{
   productId:'P-MIX',name:'not authoritative',qty:145,unitPrice:0.01,
   sellingPrice:12,unitBreakdown
  }],discount:0,paidAmount:0
 },{products:[product],suppliers:[supplier],conversionRows:conversions});
 assert.equal(preview.lines[0].qty,145);
 assert.equal(preview.lines[0].unit.lineTotal,730);
 return {
  tenantId:'SHOP-A',purchaseId:'PUR-1',supplierId:'SUP-A',
  productId:'P-MIX',sourceHash:'d'.repeat(64),
  originalLineTotalPaisa:73000,alreadyReturnedBaseQty:0,
  line:preview.lines[0],
  lots:[
   lot('LOT-A','PUR-1',100,10,11,'2026-11-10'),
   lot('LOT-B','PUR-1',45,40,12,'2026-11-11'),
   lot('OTHER','PUR-2',999,999,13,'2020-01-01')
  ]
 };
}
const intent=(extra={})=>({
 tenantId:'SHOP-A',purchaseId:'PUR-1',productId:'P-MIX',
 returnId:'RET-PUR-1',unitBreakdown:[
  {conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}
 ],...extra
});
const plan=(s=source(),i=intent())=>
 planHistoricalMixedUnitPurchaseReturn(s,i);

test('1 Box+5 Pcs returns 25 original base units via owned purchase lots FIFO, not older other-purchase stock',()=>{
 const s=source(),i=intent(),before=structuredClone({s,i});
 assert.deepEqual(plan(s,i),{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',purchaseId:'PUR-1',productId:'P-MIX',
   returnId:'RET-PUR-1',requestedBaseQty:25,
   historicalUnits:[
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:1},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
   ],
   sourcePurchaseLots:[
    {lotId:'LOT-A',sourceRowIndex:11,baseQty:10,remainingAfter:0},
    {lotId:'LOT-B',sourceRowIndex:12,baseQty:15,remainingAfter:25}
   ],
   readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false
  }
 });
 assert.deepEqual({s,i},before);
});

test('one historical Bag selection is rejected when same purchase has only 50 Pcs available',()=>{
 const r=plan(source(),intent({unitBreakdown:[{conversionId:'C-BAG',qty:1}]}));
 assert.deepEqual(r,{status:'DECLINED',reason:'INSUFFICIENT_ORIGINAL_PURCHASE_LOT_STOCK'});
});

test('already returned quantities count against original purchase even when stock shows more',()=>{
 const s=source();s.alreadyReturnedBaseQty=130;
 assert.deepEqual(plan(s),{
  status:'DECLINED',reason:'EXCEEDS_ORIGINAL_PURCHASE_REMAINING_QTY'
 });
});

test('other purchases cannot be silently used to fill exhausted original purchase lots',()=>{
 const s=source();s.lots[0]['Remaining Quantity']=0;
 s.lots[1]['Remaining Quantity']=0;
 assert.deepEqual(plan(s),{
  status:'DECLINED',reason:'INSUFFICIENT_ORIGINAL_PURCHASE_LOT_STOCK'
 });
});

test('one earlier return does not rewrite the preserved historical unit and price snapshots',()=>{
 const s=source();s.alreadyReturnedBaseQty=10;
 const r=plan(s);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.requestedBaseQty,25);
 assert.deepEqual(r.data.sourcePurchaseLots.map(x=>x.lotId),['LOT-A','LOT-B']);
});

test('current supplier catalog, conversion factor and current product price are irrelevant',()=>{
 const s=source(),expected=plan(s);
 const currentConversions=structuredClone(conversions);
 currentConversions[0]['Conversion Factor']=7000;
 currentConversions[0]['Purchase Price']=1;
 const currentProduct={...product,'Purchase Price':999};
 assert.equal(currentProduct['Purchase Price'],999);
 assert.deepEqual(plan(s),expected);
});

test('unknown unit IDs and over-return from original unit selection decline',()=>{
 assert.deepEqual(plan(source(),intent({unitBreakdown:[{conversionId:'FOREIGN',qty:1}]})),{
  status:'DECLINED',reason:'UNIT_NOT_IN_HISTORICAL_PURCHASE'
 });
 assert.deepEqual(plan(source(),intent({unitBreakdown:[{conversionId:'C-BOX',qty:3}]})),{
  status:'DECLINED',reason:'EXCEEDS_HISTORICAL_UNIT_QTY'
 });
});

test('malformed duplicate, fractional, zero, negative or browser-priced requests are rejected',()=>{
 for(const rows of [
  [{conversionId:'C-BOX',qty:1},{conversionId:'C-BOX',qty:1}],
  [{conversionId:'C-BOX',qty:0}],
  [{conversionId:'C-BOX',qty:-1}],
  [{conversionId:'C-BOX',qty:1.5}],
  [{conversionId:'C-BOX',qty:1,factor:1}],
  [{conversionId:'C-BOX',qty:1,unitPrice:1}]
 ]){
  assert.throws(()=>plan(source(),intent({unitBreakdown:rows})),
   /invalid|quantity|duplicate|untrusted/i);
 }
});

test('original M05 pricing and immutable line totals cannot be tampered after purchase',()=>{
 for(const change of [
  s=>{s.line.unit.pricingSnapshot[0].unitPrice=501;},
  s=>{s.line.unit.pricingSnapshot[1].factor=21;},
  s=>{s.line.unit.unitSnapshot[0].factor=101;},
  s=>{s.line.unit.unitSnapshot[1].qty=3;},
  s=>{s.line.price=999;},
  s=>{s.line.unit.lineTotal=731;},
  s=>{s.originalLineTotalPaisa=73001;},
  s=>{s.line.qty=144;},
  s=>{s.sourceHash='corrupt';}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|pricing|snapshot|original/i);
 }
});

test('original source purchase lot quantities must exactly match historical purchased units',()=>{
 for(const change of [
  s=>{s.lots[0]['Original Quantity']=101;},
  s=>{s.lots[1]['Original Quantity']=44;},
  s=>{s.lots.splice(1,1);},
  s=>{s.lots[0]['Original Quantity']=Number.MAX_SAFE_INTEGER+1;},
  s=>{s.lots[1]['Original Quantity']=0;}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|original|lot|source/i);
 }
});

test('duplicate lot IDs, row index and mismatched supplier identity fail closed',()=>{
 for(const change of [
  s=>{s.lots[1]['Lot ID']='LOT-A';},
  s=>{s.lots[1]._rowIndex=11;},
  s=>{s.lots[1]['Supplier ID']='SUP-WRONG';},
  s=>{s.lots[1]['Purchase ID']='PUR-2';}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|duplicate|source|supplier|lot/i);
 }
});

test('legacy no-original-purchase-lot path declines instead of borrowing stock',()=>{
 const s=source();
 s.lots=s.lots.filter(l=>l['Purchase ID']!=='PUR-1');
 assert.deepEqual(plan(s),{status:'DECLINED',reason:'UNVERIFIED_LEGACY_PURCHASE_LOT_ORIGIN'});
});

test('cross-tenant, wrong purchase, wrong product and missing Return ID cannot return source facts',()=>{
 for(const bad of [
  {tenantId:'SHOP-B'},{purchaseId:'PUR-2'},
  {productId:'OTHER'},{returnId:''}
 ])assert.throws(()=>plan(source(),intent(bad)),/invalid|identity|mismatch/i);
});

test('source purchase ID, supplier and Product must be stable from original source',()=>{
 for(const change of [
  s=>{s.supplierId='';},
  s=>{s.supplierId='SUP-2';},
  s=>{s.productId='ANOTHER';},
  s=>{s.line.productId='ANOTHER';},
  s=>{s.line.unit.stockUnit='';}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|supplier|original/i);
 }
});

test('getter-bearing trusted source/lot/unit rows rejected without reading accessor',()=>{
 const s=source();
 Object.defineProperty(s.lots[0],'Original Quantity',{enumerable:true,get(){throw Error('ACCESSOR');}});
 assert.throws(()=>plan(s),/invalid|source|lot|NEEDS_REVIEW/i);
 const x=source();
 Object.defineProperty(x.line.unit.unitSnapshot[0],'factor',{enumerable:true,get(){throw Error('ACCESSOR');}});
 assert.throws(()=>plan(x),/invalid|source|snapshot|NEEDS_REVIEW/i);
});

test('input financial authority and Caller lot selectors are never accepted',()=>{
 const base=intent();
 for(const bad of [
  {...base,lotId:'LOT-A'},
  {...base,refundPaisa:1000},
  {...base,supplierId:'SUP-A'},
  {...base,actorId:'ADMIN'},
  {...base,sql:'DELETE FROM STOCK_LOTS'}
 ]){
  assert.throws(()=>plan(source(),bad),/invalid|shape|untrusted/i);
 }
});

test('pure output strips lot unit cost and excludes Cash/Bank/Party/Supplier settlement',()=>{
 const r=plan();assert.equal(r.status,'PLAN_ONLY');
 const json=JSON.stringify(r);
 for(const k of ['unitCost','unitSellPrice','refundPaisa','creditPaisa',
  'supplierId','cashSessionId','cashBook','bankBook','partyId',
  'Purchase Price'])
  assert.equal(json.includes('"'+k+'"'),false,k);
 assert.equal(r.data.financialCalculationAuthorized,false);
});

test('planner never changes original source and returns deeply frozen independent lot rows',()=>{
 const s=source(),i=intent(),before=structuredClone({s,i});
 const r=plan(s,i);
 assert.deepEqual({s,i},before);
 assert.ok(Object.isFrozen(r));
 assert.ok(Object.isFrozen(r.data));
 assert.ok(Object.isFrozen(r.data.sourcePurchaseLots));
 assert.ok(Object.isFrozen(r.data.sourcePurchaseLots[0]));
 assert.notStrictEqual(r.data.sourcePurchaseLots,s.lots);
});

test('original non-unit legacy purchase cannot claim historical mixed-unit return proof',()=>{
 const s=source();delete s.line.unit;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|original|unit|snapshot/i);
});

test('refund price is not inferred from saved 730 BDT before invoice-level discount and payment checks',()=>{
 const r=plan();
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal('refundPaisa' in r.data,false);
 assert.equal('originalLineTotalPaisa' in r.data,false);
 assert.equal('unitPrice' in r.data,false);
});
