import test from 'node:test';
import assert from 'node:assert/strict';
// TDD RED: this M07-only batch virtual-reservation composer does not yet exist.
import {planHistoricalReturnBatch} from '../src/modules/m07-historical-batch-return.js';

const mixedSource=(invoiceId='INV-1',options={})=>({
 tenantId:'SHOP-A',invoiceId,productId:'PRODUCT-1',stockUnit:'Pcs',
 sourceLineHash:'b'.repeat(64),baseQty:145,shortageMode:'Own',
 shortfallBaseQty:0,lineTotal:1340,lineTotalPaisa:134000,
 activeReturnedBaseQty:0,
 unitBreakdownSnapshot:[
  {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
  {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
  {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
 ],
 unitPricingSnapshot:[
  {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1,unitPrice:900},
  {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2,unitPrice:190},
  {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5,unitPrice:12}
 ],
 fifoDraws:[{lotId:'LOT-OLD',baseQty:100},{lotId:'LOT-NEW',baseQty:45}],
 consumptionRows:[
  {rowIndex:options.oldRow??71,invoiceId,productId:'PRODUCT-1',
   lotId:'LOT-OLD',sourceLinkId:options.oldLink??'LINK-OLD',remainingBaseQty:100},
  {rowIndex:options.newRow??72,invoiceId,productId:'PRODUCT-1',
   lotId:'LOT-NEW',sourceLinkId:options.newLink??'LINK-NEW',remainingBaseQty:45}
 ]
});
const bundleSource=(invoiceId='INV-BUNDLE')=>({
 tenantId:'SHOP-A',invoiceId,bundleId:'BUNDLE-1',sourceHash:'c'.repeat(64),
 snapshotRevision:3,setsSold:2,activeReturnedSets:0,
 historicalComponents:[
  {productId:'PHYS-A',qtyPerSet:2,unit:'Pcs'},
  {productId:'PHYS-B',qtyPerSet:3,unit:'Pcs'}
 ],
 componentConsumptions:[
  {rowIndex:11,sourceLinkId:'B-A-OLD',invoiceId,
   sourceSaleProductId:'BUNDLE-1',productId:'PHYS-A',
   lotId:'B-LOT-A-OLD',originalBaseQty:1,remainingBaseQty:1,sourceKind:'LOT'},
  {rowIndex:12,sourceLinkId:'B-A-NEW',invoiceId,
   sourceSaleProductId:'BUNDLE-1',productId:'PHYS-A',
   lotId:'B-LOT-A-NEW',originalBaseQty:3,remainingBaseQty:3,sourceKind:'LOT'},
  {rowIndex:21,sourceLinkId:'B-B-OLD',invoiceId,
   sourceSaleProductId:'BUNDLE-1',productId:'PHYS-B',
   lotId:'B-LOT-B-OLD',originalBaseQty:4,remainingBaseQty:4,sourceKind:'LOT'},
  {rowIndex:22,sourceLinkId:'B-B-NEW',invoiceId,
   sourceSaleProductId:'BUNDLE-1',productId:'PHYS-B',
   lotId:'B-LOT-B-NEW',originalBaseQty:2,remainingBaseQty:2,sourceKind:'LOT'}
 ]
});
function mixed(returnId,units,source=mixedSource()){
 return {kind:'MIXED_UNIT',source,intent:{
  tenantId:'SHOP-A',invoiceId:source.invoiceId,productId:'PRODUCT-1',returnId,
  unitBreakdown:units
 }};
}
function bundle(returnId,returnSets=1,source=bundleSource()){
 return {kind:'BUNDLE',source,intent:{
  tenantId:'SHOP-A',invoiceId:source.invoiceId,bundleId:'BUNDLE-1',
  returnId,returnSets
 }};
}
const boxAndFive=[{conversionId:'C-BOX',qty:1},{conversionId:'BASE',qty:5}];
const bag=[{conversionId:'C-BAG',qty:1}];
const boxTwo=[{conversionId:'C-BOX',qty:2}];
const batch=(entries,extra={})=>
 planHistoricalReturnBatch({tenantId:'SHOP-A',batchId:'BATCH-ONE',entries,...extra});

test('two partial mixed-unit returns reserve 25 then 100 original Pcs against same original lots',()=>{
 const original=mixedSource(),entries=[
  mixed('RET-FIRST',boxAndFive,structuredClone(original)),
  mixed('RET-SECOND',bag,structuredClone(original))
 ];
 const before=structuredClone(entries),r=batch(entries);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.tenantId,'SHOP-A');
 assert.equal(r.data.batchId,'BATCH-ONE');
 assert.equal(r.data.children.length,2);
 assert.equal(r.data.children[0].plan.requestedBaseQty,25);
 assert.deepEqual(r.data.children[0].plan.restoreOriginalLots,[
  {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:25}
 ]);
 assert.equal(r.data.children[1].plan.requestedBaseQty,100);
 assert.equal(r.data.children[1].plan.remainingSaleBaseQty,120);
 assert.deepEqual(r.data.children[1].plan.restoreOriginalLots,[
  {lotId:'LOT-NEW',sourceLinkId:'LINK-NEW',sourceRowIndex:72,baseQty:20},
  {lotId:'LOT-OLD',sourceLinkId:'LINK-OLD',sourceRowIndex:71,baseQty:80}
 ]);
 assert.equal(r.data.readOnly,true);
 assert.equal(r.data.commitAuthorized,false);
 assert.equal(r.data.financialCalculationAuthorized,false);
 assert.deepEqual(entries,before);
});

test('overlapping original component quantities decline whole batch even if a standalone request passes',()=>{
 const s=mixedSource();
 const r=batch([
  mixed('RET-1',boxAndFive,structuredClone(s)),
  mixed('RET-2',bag,structuredClone(s)),
  mixed('RET-3',boxTwo,structuredClone(s))
 ]);
 assert.deepEqual(r,{
  status:'DECLINED',childIndex:2,
  reason:'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY'
 });
 assert.equal(Object.hasOwn(r,'data'),false,'No partial accepted plan after failure');
});

test('two independent one-set Bundle returns use the surviving original component lots in order',()=>{
 const s=bundleSource();
 const r=batch([bundle('RET-B-1',1,structuredClone(s)),
                bundle('RET-B-2',1,structuredClone(s))]);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.children.length,2);
 const first=r.data.children[0].plan.componentPlans;
 const second=r.data.children[1].plan.componentPlans;
 assert.deepEqual(first[0].restorations,[
  {lotId:'B-LOT-A-NEW',sourceLinkId:'B-A-NEW',sourceRowIndex:12,baseQty:2}
 ]);
 assert.deepEqual(second[0].restorations,[
  {lotId:'B-LOT-A-NEW',sourceLinkId:'B-A-NEW',sourceRowIndex:12,baseQty:1},
  {lotId:'B-LOT-A-OLD',sourceLinkId:'B-A-OLD',sourceRowIndex:11,baseQty:1}
 ]);
 assert.deepEqual(second[1].restorations,[
  {lotId:'B-LOT-B-OLD',sourceLinkId:'B-B-OLD',sourceRowIndex:21,baseQty:3}
 ]);
});

test('third Bundle return declines the entire three-child batch without partial results',()=>{
 const s=bundleSource(),r=batch([
  bundle('RET-B-1',1,structuredClone(s)),
  bundle('RET-B-2',1,structuredClone(s)),
  bundle('RET-B-3',1,structuredClone(s))
 ]);
 assert.deepEqual(r,{status:'DECLINED',childIndex:2,
  reason:'EXCEEDS_OUTSTANDING_BUNDLE_SETS'});
});

test('mixed-unit source already partly returned supports only its remaining original consumption',()=>{
 const s=mixedSource();
 s.activeReturnedBaseQty=25;
 s.consumptionRows[1].remainingBaseQty=20;
 const r=batch([
  mixed('RET-C-1',boxAndFive,structuredClone(s)),
  mixed('RET-C-2',bag,structuredClone(s))
 ]);
 assert.deepEqual(r,{status:'DECLINED',childIndex:1,
  reason:'EXCEEDS_OUTSTANDING_ORIGINAL_LOTS'});
});

test('two children claiming the same original Box twice cannot overrun original component count',()=>{
 const s=mixedSource(),r=batch([
  mixed('RET-A',boxTwo,structuredClone(s)),
  mixed('RET-B',boxTwo,structuredClone(s))
 ]);
 assert.deepEqual(r,{status:'DECLINED',childIndex:1,
  reason:'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY'});
});

test('multiple distinct sale lines can use same physical stock lot only with distinct source links',()=>{
 const other=mixedSource('INV-2',{
  oldRow:171,newRow:172,oldLink:'LINK-2-OLD',newLink:'LINK-2-NEW'
 });
 const r=batch([
  mixed('RET-SALE-1',boxAndFive,mixedSource()),
  mixed('RET-SALE-2',bag,other)
 ]);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.children[1].plan.invoiceId,'INV-2');
});

test('shared link between distinct original sale lines fails closed, not a double stock restore',()=>{
 const other=mixedSource('INV-2',{
  oldRow:171,newRow:172,oldLink:'LINK-OLD',newLink:'LINK-2-NEW'
 });
 assert.throws(()=>batch([
  mixed('RET-SALE-1',boxAndFive,mixedSource()),
  mixed('RET-SALE-2',bag,other)
 ]),/NEEDS_REVIEW|source link|collision/i);
});

test('shared source row index with different original owner fails closed',()=>{
 const other=mixedSource('INV-2',{
  oldRow:71,newRow:172,oldLink:'LINK-2-OLD',newLink:'LINK-2-NEW'
 });
 assert.throws(()=>batch([
  mixed('RET-SALE-1',boxAndFive,mixedSource()),
  mixed('RET-SALE-2',bag,other)
 ]),/NEEDS_REVIEW|row index|collision/i);
});

test('mixed-unit and Bundle returns can coexist without merging unrelated ledgers',()=>{
 const r=batch([mixed('RET-MIX',boxAndFive),bundle('RET-BUNDLE',1)]);
 assert.equal(r.status,'PLAN_ONLY');
 assert.deepEqual(r.data.children.map(c=>c.kind),['MIXED_UNIT','BUNDLE']);
 assert.equal(r.data.children[0].plan.productId,'PRODUCT-1');
 assert.equal(r.data.children[1].plan.bundleId,'BUNDLE-1');
});

test('same origin may not claim inconsistent original lineage snapshots across batch entries',()=>{
 const first=mixedSource(),second=mixedSource();
 second.sourceLineHash='e'.repeat(64);
 assert.throws(()=>batch([
  mixed('RET-1',boxAndFive,first),
  mixed('RET-2',bag,second)
 ]),/NEEDS_REVIEW|original|contradictory|snapshot/i);
 const bundleA=bundleSource(),bundleB=bundleSource();
 bundleB.snapshotRevision=4;
 assert.throws(()=>batch([
  bundle('RET-B-1',1,bundleA),bundle('RET-B-2',1,bundleB)
 ]),/NEEDS_REVIEW|original|contradictory|snapshot/i);
});

test('duplicate Return ID across different invoices or kinds rejects before planning',()=>{
 assert.throws(()=>batch([
  mixed('RET-DUP',boxAndFive),
  bundle('RET-DUP',1)
 ]),/duplicate|invalid/i);
});

test('unknown or corrupt child shape and extra claimed authority rejected',()=>{
 for(const entry of [
  {kind:'OTHER',source:mixedSource(),intent:mixed('RET',boxAndFive).intent},
  {...mixed('RET',boxAndFive),sql:'UPDATE STOCK_LOTS'},
  {...mixed('RET',boxAndFive),cashSessionId:'CS-001'},
  {kind:'BUNDLE',source:bundleSource(),intent:null}
 ])assert.throws(()=>batch([entry,bundle('RET-X')]),/invalid|shape|untrusted|NEEDS_REVIEW/i);
});

test('wrong tenant and missing batch identity rejected with no readback',()=>{
 const wrong=mixed('RET',boxAndFive);
 wrong.intent.tenantId='SHOP-B';
 assert.throws(()=>batch([wrong,bundle('RET-B')]),/invalid|tenant|identity|mismatch/i);
 assert.throws(()=>batch([mixed('RET',boxAndFive),bundle('RET-B')],{batchId:''}),
  /invalid|batch/i);
});

test('read-only producer refuses one or more than twenty return children',()=>{
 assert.throws(()=>batch([mixed('RET-ONLY',boxAndFive)]),/invalid|batch|count/i);
 const many=Array.from({length:21},(_,i)=>{
  const s=mixedSource('INV-'+(i+1),{
   oldRow:1000+i*2,newRow:1001+i*2,
   oldLink:'LINK-'+i+'-A',newLink:'LINK-'+i+'-B'
  });
  return mixed('RET-'+i,boxAndFive,s);
 });
 assert.throws(()=>batch(many),/invalid|batch|count/i);
});

test('declined individual child suppresses even successful sibling previews',()=>{
 const s=mixedSource();s.shortageMode='Vendor';
 const r=batch([bundle('RET-GOOD'),mixed('RET-BAD',boxAndFive,s)]);
 assert.deepEqual(r,{
  status:'DECLINED',childIndex:1,
  reason:'UNSUPPORTED_ORIGINAL_SHORTAGE_PROVENANCE'
 });
 assert.equal(Object.hasOwn(r,'data'),false);
});

test('no money amount, cash session, Customer/Party settlement, or posting authority ever exposed',()=>{
 const r=batch([mixed('RET-ONE',boxAndFive),bundle('RET-TWO')]);
 assert.equal(r.status,'PLAN_ONLY');
 const raw=JSON.stringify(r);
 for(const name of ['refundPaisa','creditPaisa','customerId','supplierId',
  'cashBook','bankBook','partyId','duePaisa','cashSessionId'])
  assert.equal(raw.includes('"'+name+'"'),false,name);
 assert.equal(raw.includes('"commitAuthorized":true'),false);
 assert.equal(raw.includes('"financialCalculationAuthorized":true'),false);
});

test('final output is deeply frozen and original source/intent arrays are unchanged',()=>{
 const entries=[mixed('RET-ONE',boxAndFive),bundle('RET-TWO')],before=structuredClone(entries);
 const r=batch(entries);
 assert.deepEqual(entries,before);
 assert.ok(Object.isFrozen(r));
 assert.ok(Object.isFrozen(r.data));
 assert.ok(Object.isFrozen(r.data.children));
 assert.ok(Object.isFrozen(r.data.children[0]));
 assert.ok(Object.isFrozen(r.data.children[0].plan));
 assert.ok(Object.isFrozen(r.data.children[0].plan.restoreOriginalLots[0]));
});

test('malicious getter in a trusted original source must not execute as a side effect',()=>{
 const s=mixedSource();
 Object.defineProperty(s.consumptionRows[0],'remainingBaseQty',{
  enumerable:true,get(){throw new Error('getter-executed');}
 });
 assert.throws(()=>batch([
  mixed('RET-1',boxAndFive,s),bundle('RET-2')
 ]),/NEEDS_REVIEW|invalid|untrusted|source/i);
});
