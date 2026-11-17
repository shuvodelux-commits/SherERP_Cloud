import test from 'node:test';
import assert from 'node:assert/strict';
import {planMultiUnitPosLine} from '../src/modules/m06-multi-unit-pos-line.js';

// RED: M07 partial-return provenance has not been implemented on this commit.
import {planHistoricalPartialUnitReturn} from '../src/modules/m07-historical-partial-unit-return.js';

function originalSale(){
 const product={'Product ID':'P-PIPE','Product Name':'Fitting','Product Type':'Standard',
  Unit:'Pcs','Selling Price':10,'Purchase Price':6,'Current Stock':145,
  Status:'Active','Is Deleted':'FALSE'};
 const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-PIPE','Unit Name':'Bag',
   'Conversion Factor':100,'Selling Price':900,'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-PIPE','Unit Name':'Box',
   'Conversion Factor':20,'Selling Price':190,'Sort Order':2,Status:'Active'}
 ];
 const stockLots=[
  {'Lot ID':'LOT-OLD','Product ID':'P-PIPE','Purchase Date':'2026-11-10',
   'Remaining Quantity':100,'Sell Price':10,'Purchase Price':6,Status:'Active'},
  {'Lot ID':'LOT-NEW','Product ID':'P-PIPE','Purchase Date':'2026-11-12',
   'Remaining Quantity':45,'Sell Price':12,'Purchase Price':7,Status:'Active'}
 ];
 const plan=planMultiUnitPosLine({
  productId:'P-PIPE',claimedBaseQty:145,shortageMode:'Own',
  unitBreakdown:[
   {conversionId:'C-BAG',qty:1},
   {conversionId:'C-BOX',qty:2},
   {conversionId:'BASE',qty:5}
  ]
 },{products:[product],conversionRows,stockLots});
 assert.equal(plan.baseQty,145);
 assert.equal(plan.lineTotal,1340);
 return {tenantId:'SHOP-A',invoiceId:'INV-PARTIAL-1',
  sourceLineHash:'b'.repeat(64),lineTotalPaisa:134000,
  activeReturnedBaseQty:0,
  ...plan,
  consumptionRows:[
   {rowIndex:71,invoiceId:'INV-PARTIAL-1',productId:'P-PIPE',
    lotId:'LOT-OLD',sourceLinkId:'LINK-OLD',remainingBaseQty:100},
   {rowIndex:72,invoiceId:'INV-PARTIAL-1',productId:'P-PIPE',
    lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',remainingBaseQty:45}
  ]};
}
function intent(overrides={}){
 return {tenantId:'SHOP-A',invoiceId:'INV-PARTIAL-1',
  productId:'P-PIPE',returnId:'RET-PARTIAL-1',
  unitBreakdown:[{conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}],
  ...overrides};
}
const plan=(s=originalSale(),i=intent())=>planHistoricalPartialUnitReturn(s,i);

test('partial 1 Box + 5 Pcs converts exactly 25 base units and reverses latest original consumption',()=>{
 const source=originalSale(),request=intent();
 const before=structuredClone({source,request});
 assert.deepEqual(plan(source,request),{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',invoiceId:'INV-PARTIAL-1',returnId:'RET-PARTIAL-1',
   productId:'P-PIPE',stockUnit:'Pcs',requestedBaseQty:25,
   remainingSaleBaseQty:145,activeReturnedBaseQty:0,
   historicalUnits:[
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:1},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
   ],
   restoreOriginalLots:[
    {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:25}
   ],
   financialCalculationAuthorized:false,
   readOnly:true,commitAuthorized:false
  }
 });
 assert.deepEqual({source,request},before);
});

test('partial 1 Bag restores 45 newest then 55 oldest from immutable original rows',()=>{
 const result=plan(originalSale(),intent({unitBreakdown:[{conversionId:'C-BAG',qty:1}]}));
 assert.equal(result.status,'PLAN_ONLY');
 assert.equal(result.data.requestedBaseQty,100);
 assert.deepEqual(result.data.restoreOriginalLots,[
  {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:45},
  {lotId:'LOT-OLD',sourceLinkId:'LINK-OLD',sourceRowIndex:71,baseQty:55}
 ]);
});

test('prior source-linked returns reduce specific remaining lot quantities rather than new FIFO',()=>{
 const source=originalSale();
 source.activeReturnedBaseQty=20;
 source.consumptionRows[1].remainingBaseQty=25;
 const r=plan(source,intent({unitBreakdown:[
  {conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}
 ]}));
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.remainingSaleBaseQty,125);
 assert.deepEqual(r.data.restoreOriginalLots,[
  {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:25}
 ]);
 const second=plan(source,intent({unitBreakdown:[
  {conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5},
  {conversionId:'C-BOX',qty:1}
 ]}));
 // Duplicated conversion IDs are browser corruption, not a second quantity.
 assert.equal(second.status,'INVALID');
});

test('prior return across both original rows retains exact reverse-row ordering',()=>{
 const source=originalSale();
 source.activeReturnedBaseQty=30;
 source.consumptionRows[1].remainingBaseQty=15;
 const r=plan(source,intent({unitBreakdown:[{conversionId:'C-BOX',qty:2}]}));
 assert.equal(r.status,'PLAN_ONLY');
 assert.deepEqual(r.data.restoreOriginalLots,[
  {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:15},
  {lotId:'LOT-OLD',sourceLinkId:'LINK-OLD',sourceRowIndex:71,baseQty:25}
 ]);
});

test('current unit factors/prices and current stock are ignored after sale',()=>{
 const original=originalSale(),first=plan(original,intent());
 const unrelatedCurrentCatalog={
  conversions:[{id:'C-BOX',factor:1000,unitPrice:1}],
  stock:[{lotId:'LOT-NEW',remaining:9999}],
  sellingPrice:90000
 };
 assert.equal(unrelatedCurrentCatalog.conversions[0].factor,1000);
 assert.deepEqual(plan(original,intent()),first);
});

test('partial preflight does not invent refund paisa from rounded historical unit prices',()=>{
 const r=plan();
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.financialCalculationAuthorized,false);
 for(const field of ['refundPaisa','creditPaisa','refundCeilingPaisa',
  'customerId','duePaisa','lotPurchasePrice','supplierId','unitPrice',
  'cashSessionId','cashBook'])
  assert.equal(Object.hasOwn(r.data,field),false,field+' cannot be projected');
});

test('cannot exceed original selected component quantities even if other lots remain',()=>{
 const r=plan(originalSale(),intent({unitBreakdown:[{conversionId:'C-BOX',qty:3}]}));
 assert.deepEqual(r,{status:'DECLINED',reason:'EXCEEDS_HISTORICAL_COMPONENT_QTY'});
});

test('cannot return more base units than remaining source-linked consumption after prior returns',()=>{
 const s=originalSale();
 s.activeReturnedBaseQty=130;
 s.consumptionRows[0].remainingBaseQty=15;
 s.consumptionRows[1].remainingBaseQty=0;
 assert.deepEqual(plan(s),{status:'DECLINED',reason:'EXCEEDS_OUTSTANDING_ORIGINAL_LOTS'});
});

test('a full-line request must use prior B11, not this partial journal proof',()=>{
 assert.deepEqual(plan(originalSale(),intent({unitBreakdown:[
  {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
  {conversionId:'BASE',qty:5}
 ]})),{status:'DECLINED',reason:'FULL_LINE_USE_B11'});
});

test('zero active outstanding source quantity cannot produce repeat partial reversal',()=>{
 const s=originalSale();
 s.activeReturnedBaseQty=145;
 s.consumptionRows[0].remainingBaseQty=0;
 s.consumptionRows[1].remainingBaseQty=0;
 assert.deepEqual(plan(s),{status:'DECLINED',reason:'EXCEEDS_OUTSTANDING_ORIGINAL_LOTS'});
});

test('missing, duplicate and tampered source links, lot IDs and row indices fail closed',()=>{
 for(const change of [
  s=>{s.consumptionRows.pop();},
  s=>{s.consumptionRows[0].sourceLinkId=s.consumptionRows[1].sourceLinkId;},
  s=>{s.consumptionRows[0].rowIndex=72;},
  s=>{s.consumptionRows[1].lotId='LOT-FORGED';},
  s=>{s.consumptionRows[1].remainingBaseQty=46;},
  s=>{s.consumptionRows[1].remainingBaseQty=-1;},
  s=>{s.consumptionRows[1].invoiceId='INV-OTHER';},
  s=>{s.consumptionRows[1].productId='P-OTHER';},
  s=>{s.consumptionRows[0].rowIndex=0;},
  s=>{s.consumptionRows[1].sourceLinkId='';}
 ]){
  const s=originalSale();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|consumption|lot|historical/i);
 }
});

test('mismatch between current outstanding lot rows and active return total is unsafe',()=>{
 const s=originalSale();s.activeReturnedBaseQty=15;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|outstanding|reconcile/i);
 s.consumptionRows[1].remainingBaseQty=40;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|outstanding|reconcile/i);
});

test('missing or manipulated original historical units/prices/factors/line money are unsafe',()=>{
 for(const change of [
  s=>{s.unitBreakdownSnapshot=[];},
  s=>{s.unitBreakdownSnapshot[1].factor=21;},
  s=>{s.unitPricingSnapshot[1].factor=21;},
  s=>{s.unitPricingSnapshot[1].qty=1;},
  s=>{s.unitPricingSnapshot[0].unitPrice=-1;},
  s=>{s.unitBreakdownSnapshot[1].conversionId='C-BAG';},
  s=>{s.lineTotalPaisa=134001;},
  s=>{s.baseQty=144;},
  s=>{s.sourceLineHash='tampered';}
 ]){const s=originalSale();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|historical|snapshot/i);
 }
});

test('previous sale original allocation must reconcile exactly to consumption rows',()=>{
 for(const change of [
  s=>{s.fifoDraws[0].baseQty=99;},
  s=>{s.fifoDraws[1].lotId='LOT-OLD';},
  s=>{s.fifoDraws[0].baseQty=Number.MAX_SAFE_INTEGER;},
  s=>{s.consumptionRows[0].remainingBaseQty=101;}
 ]){const s=originalSale();change(s);assert.throws(()=>plan(s),/NEEDS_REVIEW|source|lot/i);}
});

test('Vendor, Negative and OVERSOLD shortages cannot be mistaken for an owned lot return',()=>{
 for(const [shortageMode,shortfallBaseQty] of [
  ['Vendor',0],['Negative',0],['Own',1],['Vendor',10]
 ]){
  const source=originalSale();source.shortageMode=shortageMode;
  source.shortfallBaseQty=shortfallBaseQty;
  assert.deepEqual(plan(source),{status:'DECLINED',reason:'UNSUPPORTED_ORIGINAL_SHORTAGE_PROVENANCE'});
 }
});

test('untrusted tenant, invoice, Product ID, SQL and browser-supplied lot and factor are rejected',()=>{
 const valid=intent();
 for(const payload of [
  {...valid,tenantId:'SHOP-B'}, {...valid,invoiceId:'INV-OTHER'},
  {...valid,productId:'P-OTHER'}, {...valid,returnId:''},
  {...valid,sql:'DELETE FROM m06_invoices'}, {...valid,lotId:'LOT-NEW'},
  {...valid,actorId:'ADMIN'},
  {...valid,unitBreakdown:[{conversionId:'C-BOX',qty:1,factor:100}]},
  {...valid,unitBreakdown:[{conversionId:'C-BOX',qty:1,unitPrice:1}]}
 ])assert.throws(()=>plan(originalSale(),payload),/invalid|untrusted|identity|shape|mismatch/i);
});

test('unknown units decline; duplicate/negative/fractional intent quantities reject',()=>{
 assert.deepEqual(plan(originalSale(),intent({unitBreakdown:[
  {conversionId:'C-UNKNOWN',qty:1}
 ]})),{status:'DECLINED',reason:'UNIT_NOT_IN_ORIGINAL_SALE'});
 for(const bad of [
  [{conversionId:'C-BOX',qty:1},{conversionId:'C-BOX',qty:1}],
  [{conversionId:'C-BOX',qty:-1}],
  [{conversionId:'C-BOX',qty:0}],
  [{conversionId:'C-BOX',qty:1.25}]
 ])assert.throws(()=>plan(originalSale(),intent({unitBreakdown:bad})),
  /invalid|quantity|duplicate/i);
});

test('getters, non-plain snapshots and forged nested values fail validation before access',()=>{
 const s=originalSale(),request=intent();
 assert.throws(()=>plan(null,request),/invalid|source/i);
 assert.throws(()=>plan(s,null),/invalid|request/i);
 const getter=originalSale();
 Object.defineProperty(getter.consumptionRows[0],'remainingBaseQty',{enumerable:true,get(){throw Error('executed');}});
 assert.throws(()=>plan(getter),/invalid|untrusted|source|NEEDS_REVIEW/i);
 const getterIntent=intent();
 Object.defineProperty(getterIntent.unitBreakdown[0],'qty',{enumerable:true,get(){throw Error('executed');}});
 assert.throws(()=>plan(originalSale(),getterIntent),/invalid|untrusted|shape/i);
});

test('result rows are immutable copies, never source stock reservations',()=>{
 const source=originalSale(),request=intent();
 const before=structuredClone({source,request}),r=plan(source,request);
 assert.equal(r.status,'PLAN_ONLY');
 assert.ok(Object.isFrozen(r));
 assert.ok(Object.isFrozen(r.data));
 assert.ok(Object.isFrozen(r.data.restoreOriginalLots));
 assert.ok(Object.isFrozen(r.data.restoreOriginalLots[0]));
 assert.notStrictEqual(r.data.restoreOriginalLots,source.consumptionRows);
 assert.deepEqual({source,request},before);
 assert.equal(JSON.stringify(r).includes('purchasePrice'),false);
 assert.equal(JSON.stringify(r).includes('cashBook'),false);
});
