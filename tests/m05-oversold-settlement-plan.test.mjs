import test from 'node:test';
import assert from 'node:assert/strict';
import {planOversoldSettlement} from '../src/modules/m05-oversold-settlement-plan.js';

const T = 'shop-101', P = 'pipe-09';
const meta = (baseUnit = 'Foot', precision = 3, units = {Foot:1}) => ({baseUnit, precision, units});
function purchase({id='LOT-000940',qty=240,cost='64.75',date='2026-11-19',unit='Foot',productId=P,tenantId=T,original=qty,status='Active',purchaseId='PUR-000082'}={}) {
  return {'Lot ID':id, 'Product ID':productId, 'Tenant ID':tenantId,'Purchase ID':purchaseId,'Purchase Date':date,'Purchase Price':cost,'Original Quantity':original,'Remaining Quantity':qty,'Quantity Unit':unit,'Status':status};
}
function debt({id='LOT-000939',qty=229,cost=68,date='2026-11-01',unit='Foot',productId=P,tenantId=T,original=qty,status='Oversold'}={}) {
  return {'Lot ID':id, 'Product ID':productId,'Tenant ID':tenantId,'Purchase ID':'OVERSOLD','Purchase Date':date,'Purchase Price':cost,'Original Quantity':original,'Remaining Quantity':-qty,'Quantity Unit':unit,'Status':status};
}
function request(overrides={}) {return {tenantId:T,productId:P,operationId:'post-PUR-000082',effectiveDate:'2026-11-19',canonicalUnit:meta(),purchaseLot:purchase(),oversoldLots:[debt({id:'LOT-000939',qty:229}),debt({id:'LOT-OTHER-2',qty:2})],...overrides};}
function clean(x) {assert.deepEqual(x.reviewIssues,[]);return x;}

test('231 feet outstanding on 240-foot purchase: deterministic 9 remaining and +750.75 BDT provisional variance; never mutate',()=>{
 const input=request(),before=structuredClone(input);
 const p=clean(planOversoldSettlement(input));
 assert.equal(p.totalSettledBaseQty,231);
 assert.equal(p.purchaseRemainingBaseQty,9);
 assert.deepEqual(p.updatedDebtBaseQty,[{lotId:'LOT-000939',remainingBaseQty:0},{lotId:'LOT-OTHER-2',remainingBaseQty:0}]);
 assert.deepEqual(p.allocations.map(a=>[a.oversoldLotId,a.baseQty,a.purchaseLotId]),[['LOT-000939',229,'LOT-000940'],['LOT-OTHER-2',2,'LOT-000940']]);
 assert.equal(p.allocations.reduce((s,a)=>s+a.provisionalCostMinor,0),1570800);
 assert.equal(p.allocations.reduce((s,a)=>s+a.actualCostMinor,0),1495725);
 assert.equal(p.allocations.reduce((s,a)=>s+a.varianceMinor,0),75075);
 assert.equal(p.purchaseOriginalBaseQty,240);
 assert.deepEqual(input,before);
 assert.ok(Object.isFrozen(p) && Object.isFrozen(p.allocations) && Object.isFrozen(p.allocations[0]));
});

test('partial replenishment consumes only purchase quantity, preserving negative outstanding',()=>{
 const p=clean(planOversoldSettlement(request({purchaseLot:purchase({qty:100,original:100}),oversoldLots:[debt({qty:229})]})));
 assert.equal(p.totalSettledBaseQty,100);
 assert.equal(p.purchaseRemainingBaseQty,0);
 assert.deepEqual(p.updatedDebtBaseQty,[{lotId:'LOT-000939',remainingBaseQty:-129}]);
 assert.equal(p.allocations[0].varianceMinor,32500);
});

test('explicit no-debt snapshot leaves all bought units available and posts nothing',()=>{
 const p=clean(planOversoldSettlement(request({oversoldLots:[]})));
 assert.equal(p.totalSettledBaseQty,0);assert.equal(p.purchaseRemainingBaseQty,240);assert.deepEqual(p.allocations,[]);
});

test('sort by effective date and then immutable lot ID regardless of input order',()=>{
 const p=clean(planOversoldSettlement(request({purchaseLot:purchase({qty:5,original:5}),oversoldLots:[debt({id:'LZ',date:'2026-11-10',qty:2}),debt({id:'LB',date:'2026-11-09',qty:2}),debt({id:'LA',date:'2026-11-09',qty:2})]})));
 assert.deepEqual(p.allocations.map(a=>a.oversoldLotId),['LA','LB','LZ']);
 assert.deepEqual(p.allocations.map(a=>a.baseQty),[2,2,1]);
 assert.deepEqual(p.updatedDebtBaseQty,[{lotId:'LA',remainingBaseQty:0},{lotId:'LB',remainingBaseQty:0},{lotId:'LZ',remainingBaseQty:-1}]);
});

test('duplicate oversold ID and purchase ID collision must fail closed without partial allocation',()=>{
 for(const oversoldLots of [[debt({id:'DUP'}),debt({id:'DUP',qty:2})],[debt({id:'LOT-000940'})]]) {
   const p=planOversoldSettlement(request({oversoldLots}));
   assert.deepEqual(p.allocations,[]);
   assert.equal(p.purchaseRemainingBaseQty,null);
   assert.ok(p.reviewIssues.some(x=>x.code==='DUPLICATE_LOT_ID'));
 }
});

test('tenant and product mismatches block all settlement; never allow cross-tenant stock',()=>{
 for(const patch of [{tenantId:'another-tenant'},{productId:'other-product'}]) {
   const p=planOversoldSettlement(request({oversoldLots:[debt(patch)]}));
   assert.deepEqual(p.allocations,[]);
   assert.ok(p.reviewIssues.some(x=>x.code==='LOT_SCOPE_MISMATCH'));
 }
});

test('invalid status, non-OVERSOLD reference or positive debt quantities are blocked',()=>{
 const invalid=[debt({status:'Deleted'}), {...debt(), 'Purchase ID':'ADJUSTMENT'}, {...debt(),'Remaining Quantity':5}];
 for(const entry of invalid){const p=planOversoldSettlement(request({oversoldLots:[entry]}));assert.deepEqual(p.allocations,[]);assert.ok(p.reviewIssues.length>0);}
});

test('purchase preceding oversold debt in transaction time is a backdated Needs Review, not automatic assignment',()=>{
 const p=planOversoldSettlement(request({effectiveDate:'2026-11-05',purchaseLot:purchase({date:'2026-11-05'}),oversoldLots:[debt({date:'2026-11-06'})]}));
 assert.deepEqual(p.allocations,[]);assert.ok(p.reviewIssues.some(x=>x.code==='BACKDATED_PURCHASE_REVIEW'));
});

test('effective date must match this purchase lot and reject invalid calendar dates',()=>{
 const mismatch=planOversoldSettlement(request({effectiveDate:'2026-11-18'}));
 assert.ok(mismatch.reviewIssues.some(i=>i.code==='PURCHASE_DATE_MISMATCH'));
 assert.throws(()=>planOversoldSettlement(request({effectiveDate:'2026-02-30'})),/effectiveDate|date/i);
});

test('fractional Foot in canonical unit uses precise decimal quantities and integer cents',()=>{
 const p=clean(planOversoldSettlement(request({canonicalUnit:meta('Foot',3,{Foot:1}),purchaseLot:purchase({qty:'2.75',original:'2.75'}),oversoldLots:[debt({qty:'1.5'})]})));
 assert.equal(p.purchaseRemainingBaseQty,1.25);assert.equal(p.totalSettledBaseQty,1.5);
 assert.equal(p.allocations[0].provisionalCostMinor,10200);
 assert.equal(p.allocations[0].actualCostMinor,9713);
 assert.equal(p.allocations[0].varianceMinor,487);
});

test('explicit Box/Pcs product ratio handles purchase Box costs and oversold Pcs costs as canonical Pcs',()=>{
 const units=meta('Pcs',0,{Pcs:1,Box:20});
 const p=clean(planOversoldSettlement(request({canonicalUnit:units,purchaseLot:purchase({qty:2,original:2,unit:'Box',cost:1200}),oversoldLots:[debt({qty:25,unit:'Pcs',cost:68})]})));
 assert.equal(p.purchaseOriginalBaseQty,40);assert.equal(p.purchaseRemainingBaseQty,15);
 assert.equal(p.allocations[0].baseQty,25);
 assert.equal(p.allocations[0].provisionalCostMinor,170000);
 assert.equal(p.allocations[0].actualCostMinor,150000);
 assert.equal(p.allocations[0].varianceMinor,20000);
});

test('24-by-24 tile conversion: 356 Sqft is exactly 89 Pcs and can settle 80 Pcs',()=>{
 const units=meta('Pcs',0,{Pcs:1,Box:25,Sqft:'0.25'});
 const p=clean(planOversoldSettlement(request({canonicalUnit:units,purchaseLot:purchase({qty:356,original:356,unit:'Sqft',cost:10}),oversoldLots:[debt({qty:80,unit:'Pcs',cost:60})]})));
 assert.equal(p.purchaseOriginalBaseQty,89);assert.equal(p.purchaseRemainingBaseQty,9);
 assert.equal(p.allocations[0].actualCostMinor,320000);
 assert.equal(p.allocations[0].varianceMinor,160000);
});

test('tiles 355 Sqft cannot silently round 88.75 Pcs or create fractional physical tiles',()=>{
 const p=planOversoldSettlement(request({canonicalUnit:meta('Pcs',0,{Pcs:1,Sqft:'0.25'}),purchaseLot:purchase({qty:355,original:355,unit:'Sqft',cost:10}),oversoldLots:[debt({qty:20,unit:'Pcs'})]}));
 assert.deepEqual(p.allocations,[]);assert.ok(p.reviewIssues.some(i=>i.code==='NON_CANONICAL_QUANTITY'));
});

test('unknown unit and fractional cost invalidates plan instead of guessing ratio',()=>{
 const a=planOversoldSettlement(request({purchaseLot:purchase({unit:'Box'})}));
 assert.ok(a.reviewIssues.some(i=>i.code==='UNKNOWN_QUANTITY_UNIT'));
 const b=planOversoldSettlement(request({purchaseLot:purchase({cost:'not a cost'})}));
 assert.ok(b.reviewIssues.some(i=>i.code==='INVALID_LOT_COST'));
});

test('original purchased quantity cannot be smaller than remaining units',()=>{
 const p=planOversoldSettlement(request({purchaseLot:purchase({qty:30,original:20}),oversoldLots:[debt({qty:5})]}));
 assert.ok(p.reviewIssues.some(i=>i.code==='ORIGINAL_QTY_INCONSISTENT'));
 assert.deepEqual(p.allocations,[]);
});

test('same operation and immutable snapshot always return identical plan without mutating arguments',()=>{
 const input=request(),first=planOversoldSettlement(input),second=planOversoldSettlement(input);
 assert.deepEqual(first,second);
 assert.equal(input.purchaseLot['Remaining Quantity'],240);
 assert.equal(input.oversoldLots[0]['Remaining Quantity'],-229);
});

test('allocation rounding on one Box cost is cumulative across multiple oversold lots',()=>{
 const p=clean(planOversoldSettlement(request({canonicalUnit:meta('Pcs',0,{Pcs:1,Box:3}),purchaseLot:purchase({qty:1,original:1,unit:'Box',cost:1}),oversoldLots:[debt({id:'DEBT-1',qty:1,unit:'Pcs',cost:1}),debt({id:'DEBT-2',qty:2,unit:'Pcs',cost:1})]})));
 assert.deepEqual(p.allocations.map(x=>x.actualCostMinor),[33,67]);
 assert.equal(p.allocations.reduce((s,x)=>s+x.actualCostMinor,0),100);
 assert.equal(p.purchaseRemainingBaseQty,0);
});

test('negative cost variance remains signed when actual replenishment costs more',()=>{
 const p=clean(planOversoldSettlement(request({oversoldLots:[debt({qty:10,cost:60})]})));
 assert.equal(p.allocations[0].provisionalCostMinor,60000);
 assert.equal(p.allocations[0].actualCostMinor,64750);
 assert.equal(p.allocations[0].varianceMinor,-4750);
});

test('purchase lot from another tenant rejects settlement before any calculation',()=>{
 const p=planOversoldSettlement(request({purchaseLot:purchase({tenantId:'other-shop'})}));
 assert.deepEqual(p.allocations,[]);
 assert.ok(p.reviewIssues.some(x=>x.code==='LOT_SCOPE_MISMATCH'));
});

test('trusted snapshot boundary rejects accessor properties without running them',()=>{
 const a=request();let accessed=false;
 Object.defineProperty(a.purchaseLot,'Lot ID',{get(){accessed=true;throw Error('getter executed');}});
 assert.throws(()=>planOversoldSettlement(a),/Trusted explicit purchase/);
 assert.equal(accessed,false);
});
