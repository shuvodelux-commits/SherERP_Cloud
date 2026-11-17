import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSaleStockDemands_} from '../src/modules/pos-bundle-demands.js';

// Superpowers RED: this original-lot B13 read-only planner is absent here.
import {planHistoricalBundleReturn} from '../src/modules/m07-historical-bundle-return.js';

function source(){
 const historicalComponents=[
  {productId:'PHYS-A',qtyPerSet:2,unit:'Pcs'},
  {productId:'PHYS-B',qtyPerSet:3,unit:'Pcs'}
 ];
 const oracle=buildSaleStockDemands_([
  {productId:'BUNDLE-1',qty:2,productType:'Bundle'}
 ],{}, {'BUNDLE-1':{bundleId:'BUNDLE-1',revision:3,components:historicalComponents}});
 assert.deepEqual(oracle.requirementsByProductId,{'PHYS-A':4,'PHYS-B':6});
 return {
  tenantId:'SHOP-A',invoiceId:'INV-BUNDLE-A',
  bundleId:'BUNDLE-1',sourceHash:'c'.repeat(64),
  snapshotRevision:3,setsSold:2,activeReturnedSets:0,
  historicalComponents,
  componentConsumptions:[
   {rowIndex:11,sourceLinkId:'SRC-A-OLD',invoiceId:'INV-BUNDLE-A',
    sourceSaleProductId:'BUNDLE-1',productId:'PHYS-A',
    lotId:'LOT-A-OLD',originalBaseQty:1,remainingBaseQty:1,sourceKind:'LOT'},
   {rowIndex:12,sourceLinkId:'SRC-A-NEW',invoiceId:'INV-BUNDLE-A',
    sourceSaleProductId:'BUNDLE-1',productId:'PHYS-A',
    lotId:'LOT-A-NEW',originalBaseQty:3,remainingBaseQty:3,sourceKind:'LOT'},
   {rowIndex:21,sourceLinkId:'SRC-B-OLD',invoiceId:'INV-BUNDLE-A',
    sourceSaleProductId:'BUNDLE-1',productId:'PHYS-B',
    lotId:'LOT-B-OLD',originalBaseQty:4,remainingBaseQty:4,sourceKind:'LOT'},
   {rowIndex:22,sourceLinkId:'SRC-B-NEW',invoiceId:'INV-BUNDLE-A',
    sourceSaleProductId:'BUNDLE-1',productId:'PHYS-B',
    lotId:'LOT-B-NEW',originalBaseQty:2,remainingBaseQty:2,sourceKind:'LOT'}
  ]
 };
}
const intent=(patch={})=>({
 tenantId:'SHOP-A',invoiceId:'INV-BUNDLE-A',bundleId:'BUNDLE-1',
 returnId:'RET-BUNDLE-A',returnSets:1,...patch
});
const plan=(s=source(),i=intent())=>planHistoricalBundleReturn(s,i);

test('one returned bundle set restores both original physical components, split original lot rows',()=>{
 const s=source(),i=intent(),before=structuredClone({s,i});
 assert.deepEqual(plan(s,i),{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',invoiceId:'INV-BUNDLE-A',bundleId:'BUNDLE-1',
   returnId:'RET-BUNDLE-A',returnSets:1,bundleRevision:3,
   componentPlans:[
    {productId:'PHYS-A',baseQty:2,restorations:[
     {lotId:'LOT-A-NEW',sourceLinkId:'SRC-A-NEW',sourceRowIndex:12,baseQty:2}
    ]},
    {productId:'PHYS-B',baseQty:3,restorations:[
     {lotId:'LOT-B-NEW',sourceLinkId:'SRC-B-NEW',sourceRowIndex:22,baseQty:2},
     {lotId:'LOT-B-OLD',sourceLinkId:'SRC-B-OLD',sourceRowIndex:21,baseQty:1}
    ]}
   ],readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false
  }
 });
 assert.deepEqual({s,i},before);
});

test('two original bundle sets project all original component lots with unchanged historic revision',()=>{
 const r=plan(source(),intent({returnSets:2}));
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.bundleRevision,3);
 assert.deepEqual(r.data.componentPlans[0].restorations,[
  {lotId:'LOT-A-NEW',sourceLinkId:'SRC-A-NEW',sourceRowIndex:12,baseQty:3},
  {lotId:'LOT-A-OLD',sourceLinkId:'SRC-A-OLD',sourceRowIndex:11,baseQty:1}
 ]);
 assert.deepEqual(r.data.componentPlans[1].restorations,[
  {lotId:'LOT-B-NEW',sourceLinkId:'SRC-B-NEW',sourceRowIndex:22,baseQty:2},
  {lotId:'LOT-B-OLD',sourceLinkId:'SRC-B-OLD',sourceRowIndex:21,baseQty:4}
 ]);
});

test('previous active returned set is reflected in remaining original consumption per component',()=>{
 const s=source();
 s.activeReturnedSets=1;
 s.componentConsumptions[1].remainingBaseQty=1;
 s.componentConsumptions[2].remainingBaseQty=3;
 s.componentConsumptions[3].remainingBaseQty=0;
 const r=plan(s,intent());
 assert.equal(r.status,'PLAN_ONLY');
 assert.deepEqual(r.data.componentPlans[0].restorations,[
  {lotId:'LOT-A-NEW',sourceLinkId:'SRC-A-NEW',sourceRowIndex:12,baseQty:1},
  {lotId:'LOT-A-OLD',sourceLinkId:'SRC-A-OLD',sourceRowIndex:11,baseQty:1}
 ]);
 assert.deepEqual(r.data.componentPlans[1].restorations,[
  {lotId:'LOT-B-OLD',sourceLinkId:'SRC-B-OLD',sourceRowIndex:21,baseQty:3}
 ]);
});

test('bundle current master recipe revisions are never consulted to rewrite historical component demands',()=>{
 const s=source(),first=plan(s,intent());
 const currentMaster={
  revision:77,components:[
   {productId:'PHYS-C',qtyPerSet:99},
   {productId:'PHYS-B',qtyPerSet:10}
  ]
 };
 assert.equal(currentMaster.revision,77);
 assert.deepEqual(plan(s,intent()),first);
});

test('deleting historical bundle components or changing saved recipe quantity fails closed',()=>{
 for(const change of [
  s=>s.historicalComponents.pop(),
  s=>s.historicalComponents[0].qtyPerSet=3,
  s=>s.historicalComponents[1].productId='PHYS-A',
  s=>s.historicalComponents[0].qtyPerSet=0,
  s=>s.historicalComponents[0].qtyPerSet=1.5,
  s=>s.historicalComponents[0].unit=''
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|historical|component|source/i);
 }
});

test('bundle count cannot exceed remaining original sets after previous returns',()=>{
 assert.deepEqual(plan(source(),intent({returnSets:3})),
  {status:'DECLINED',reason:'EXCEEDS_OUTSTANDING_BUNDLE_SETS'});
 const s=source();s.activeReturnedSets=1;
 s.componentConsumptions[1].remainingBaseQty=1;
 s.componentConsumptions[2].remainingBaseQty=3;
 s.componentConsumptions[3].remainingBaseQty=0;
 assert.deepEqual(plan(s,intent({returnSets:2})),
  {status:'DECLINED',reason:'EXCEEDS_OUTSTANDING_BUNDLE_SETS'});
});

test('fully returned bundle is not restorable a second time',()=>{
 const s=source();s.activeReturnedSets=2;
 for(const row of s.componentConsumptions)row.remainingBaseQty=0;
 assert.deepEqual(plan(s,intent()),
  {status:'DECLINED',reason:'EXCEEDS_OUTSTANDING_BUNDLE_SETS'});
});

test('consumption source links must be unique, exact and source-bundle owned',()=>{
 for(const change of [
  s=>{s.componentConsumptions[0].sourceLinkId=s.componentConsumptions[1].sourceLinkId;},
  s=>{s.componentConsumptions[0].sourceLinkId='';},
  s=>{s.componentConsumptions[0].sourceSaleProductId='BUNDLE-2';},
  s=>{s.componentConsumptions[0].invoiceId='INV-FOREIGN';},
  s=>{s.componentConsumptions[0].lotId='';},
  s=>{s.componentConsumptions[1].rowIndex=11;},
  s=>{s.componentConsumptions[0].rowIndex=-1;},
  s=>{s.componentConsumptions[0].lotId=s.componentConsumptions[1].lotId;}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|consumption|duplicate|lot/i);
 }
});

test('missing original lot or over-restored outstanding consumption is not silently replaced with FIFO',()=>{
 for(const change of [
  s=>{s.componentConsumptions.pop();},
  s=>{s.componentConsumptions[0].originalBaseQty=0;},
  s=>{s.componentConsumptions[1].originalBaseQty=4;},
  s=>{s.componentConsumptions[2].remainingBaseQty=5;},
  s=>{s.componentConsumptions[0].remainingBaseQty=-1;},
  s=>{s.componentConsumptions[2].productId='PHYS-OTHER';}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|consumption|lot|quantity/i);
 }
});

test('active return history must reconcile to each individual original physical component',()=>{
 const s=source();s.activeReturnedSets=1;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|reconcile|outstanding/i);
 s.componentConsumptions[1].remainingBaseQty=1;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|reconcile|outstanding/i);
});

test('unsupported source kinds and real-vendor/OVERSOLD/LEGACY fallbacks decline without fictitious lots',()=>{
 for(const kind of ['FALLBACK','OVERSOLD','LEGACY','VENDOR']){
  const s=source();s.componentConsumptions[0].sourceKind=kind;
  assert.deepEqual(plan(s),{status:'DECLINED',reason:'UNSUPPORTED_ORIGINAL_COMPONENT_SOURCE'});
 }
});

test('return displays one bundle return line but never a Cash, Bank or Customer credit amount',()=>{
 const r=plan();
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.returnSets,1);
 assert.equal(r.data.financialCalculationAuthorized,false);
 for(const key of ['refundPaisa','cashRefund','supplierId','customerId','partyId',
  'lineTotalPaisa','componentUnitPrice','purchasePrice','cashSessionId'])
  assert.equal(Object.hasOwn(r.data,key),false);
});

test('tenant, invoice, bundle or invalid ID mismatches cannot leak original stock evidence',()=>{
 for(const change of [
  {tenantId:'SHOP-B'},{invoiceId:'INV-WRONG'},
  {bundleId:'BUNDLE-OTHER'},{returnId:''}
 ]){
  assert.throws(()=>plan(source(),intent(change)),/invalid|mismatch|identity/i);
 }
});

test('client-supplied revision, recipe, lot, amount, SQL or role claims are rejected',()=>{
 const valid=intent();
 for(const p of [
  {...valid,revision:3},{...valid,recipe:[{productId:'PHYS-A'}]},
  {...valid,sourceLinkId:'SRC-A-NEW'},{...valid,lotId:'LOT-A-NEW'},
  {...valid,refundPaisa:0},{...valid,sql:'UPDATE STOCK_LOTS'},
  {...valid,permission:'returns:add'},{...valid,actorId:'ADMIN'}
 ]){
  assert.throws(()=>plan(source(),p),/invalid|shape|untrusted/i);
 }
});

test('all quantities must be strictly safe positive integer whole bundle sets',()=>{
 for(const qty of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN,'1']){
  assert.throws(()=>plan(source(),intent({returnSets:qty})),/invalid|quantity/i);
 }
 const s=source();s.setsSold=Number.MAX_SAFE_INTEGER+1;
 assert.throws(()=>plan(s),/NEEDS_REVIEW|source|bundle/i);
});

test('stale or malformed historical revision/hash and duplicate component row are rejected',()=>{
 for(const change of [
  s=>{s.snapshotRevision=0;},
  s=>{s.sourceHash='not-sha256';},
  s=>{s.componentConsumptions.push({...s.componentConsumptions[0]});},
  s=>{s.historicalComponents.push({...s.historicalComponents[0]});},
  s=>{s.setsSold=3;}
 ]){
  const s=source();change(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|duplicate|original/i);
 }
});

test('getters and non-plain nested rows cannot execute inside trusted snapshot validation',()=>{
 const s=source();
 assert.throws(()=>plan(null,intent()),/invalid|source/i);
 assert.throws(()=>plan(source(),null),/invalid|intent/i);
 Object.defineProperty(s.historicalComponents[0],'qtyPerSet',{
  enumerable:true,get(){throw new Error('exfiltration');}
 });
 assert.throws(()=>plan(s),/invalid|NEEDS_REVIEW|source/i);
 const y=source();
 Object.defineProperty(y.componentConsumptions[0],'remainingBaseQty',{
  enumerable:true,get(){throw new Error('exfiltration');}
 });
 assert.throws(()=>plan(y),/invalid|NEEDS_REVIEW|source/i);
});

test('projection is frozen and independent of original source arrays and current mutable catalog',()=>{
 const s=source(),request=intent(),before=structuredClone({s,request});
 const r=plan(s,request);
 assert.deepEqual({s,request},before);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.data));
 assert.ok(Object.isFrozen(r.data.componentPlans));
 assert.ok(Object.isFrozen(r.data.componentPlans[0]));
 assert.ok(Object.isFrozen(r.data.componentPlans[0].restorations[0]));
 assert.notStrictEqual(r.data.componentPlans,s.historicalComponents);
 assert.equal(JSON.stringify(r).includes('purchasePrice'),false);
 assert.equal(JSON.stringify(r).includes('supplier'),false);
});
