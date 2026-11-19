import test from 'node:test';
import assert from 'node:assert/strict';
import {planSettlementReversal} from '../src/modules/m07-settlement-reversal-plan.js';

const TENANT='SHOP-A', PRODUCT='PIPE';
const purchase=()=>({tenantId:TENANT,productId:PRODUCT,purchaseId:'PUR-082',lotId:'LOT-940',originalQtyTicks:240,availableQtyTicks:9,otherConsumedQtyTicks:0});
const link=(x={})=>({settlementId:'STL-001',tenantId:TENANT,productId:PRODUCT,purchaseLotId:'LOT-940',oversoldLotId:'LOT-939',sourceSaleItemLotId:'SIL-001',allocatedQtyTicks:229,reversedQtyTicks:0,provisionalCostMinor:1557200,actualCostMinor:1482775,reversedProvisionalCostMinor:0,reversedActualCostMinor:0,status:'ACTIVE',...x});
const links=()=>[link(),link({settlementId:'STL-002',oversoldLotId:'LOT-OTHER-2',sourceSaleItemLotId:'SIL-002',allocatedQtyTicks:2,provisionalCostMinor:13600,actualCostMinor:12950})];
const source=(x={})=>({kind:'OVERSOLD_SALE_ITEM_LOT',sourceId:'SIL-001',oversoldLotId:'LOT-939',originalQtyTicks:229,returnedQtyTicks:0,...x});
const input=(x={})=>({tenantId:TENANT,productId:PRODUCT,operationId:'RETURN-1',quantityScale:1,purchaseLot:purchase(),settlements:links(),source:source(),correction:{kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:1},priorCorrections:[],...x});
const clean=r=>{assert.deepEqual(r.reviewIssues,[]);assert.equal(r.postable,false);return r;};

test('partial sale return proposes linked compensation, but never a postable DB delta',()=>{
  const original=input(),before=structuredClone(original),r=clean(planSettlementReversal(original));
  assert.equal(r.status,'CANDIDATE_ONLY');
  assert.equal(r.correctionQtyTicks,1);
  assert.deepEqual(r.settlementDeltas.map(x=>({id:x.settlementId,qty:x.reversedQtyTicks})),[{id:'STL-001',qty:1}]);
  assert.equal(r.settlementDeltas[0].reversedProvisionalCostMinor,6800);
  assert.equal(r.settlementDeltas[0].reversedActualCostMinor,6475);
  assert.equal(r.settlementDeltas[0].varianceReversalMinor,325);
  assert.equal(r.virtualLotSteps.length,2);
  assert.deepEqual(r.virtualLotSteps[0],{kind:'UNALLOCATE_PURCHASE_DEBT',purchaseLotDeltaTicks:1,oversoldLotDeltaTicks:-1,netStockDeltaTicks:0});
  assert.deepEqual(r.virtualLotSteps[1],{kind:'SOURCE_SALE_RETURN_RESTORE',stockDeltaTicks:1});
  assert.equal(r.netStockDeltaTicks,1);
  assert.deepEqual(original,before);
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.settlementDeltas));
});

test('sale return cannot exceed exact original sale-item lot source',()=>{
  const r=planSettlementReversal(input({correction:{kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:230}}));
  assert.equal(r.status,'NEEDS_REVIEW');assert.ok(r.reviewIssues.some(i=>i.code==='OVER_RETURN'));
  assert.equal(r.settlementDeltas.length,0);
});

test('sale return cannot consume more of this link than remains unreversed',()=>{
  const r=planSettlementReversal(input({source:source({originalQtyTicks:240}),correction:{kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:230}}));
  assert.ok(r.reviewIssues.some(i=>i.code==='LINK_QTY_EXCEEDED'));
});

test('multiple partial sale returns use cumulative paisa allocation without double-rounding',()=>{
  const small=link({allocatedQtyTicks:3,provisionalCostMinor:101,actualCostMinor:100,reversedQtyTicks:1,reversedProvisionalCostMinor:34,reversedActualCostMinor:33});
  const old={operationId:'RETURN-OLD',tenantId:TENANT,productId:PRODUCT,kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:1,status:'COMMITTED',resultRef:'REV-OLD'};
  const r=clean(planSettlementReversal(input({purchaseLot:{...purchase(),originalQtyTicks:12,availableQtyTicks:10},settlements:[small],source:source({originalQtyTicks:3,returnedQtyTicks:1}),correction:{kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:1},priorCorrections:[old]})));
  assert.equal(r.settlementDeltas[0].reversedProvisionalCostMinor,33);
  assert.equal(r.settlementDeltas[0].reversedActualCostMinor,34);
  assert.equal(r.settlementDeltas[0].varianceReversalMinor,-1);
});

test('same correction operation ID and same committed intent replays without any new effects',()=>{
  const old={operationId:'RETURN-1',tenantId:TENANT,productId:PRODUCT,kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:1,status:'COMMITTED',resultRef:'REV-OLD'};
  const r=clean(planSettlementReversal(input({source:source({returnedQtyTicks:1}),priorCorrections:[old]})));
  assert.equal(r.status,'REPLAY');assert.equal(r.existingResultRef,'REV-OLD');
  assert.deepEqual(r.settlementDeltas,[]);assert.deepEqual(r.virtualLotSteps,[]);
});

test('reused operation ID with different intent is a conflict and never discloses old result reference',()=>{
  const old={operationId:'RETURN-1',tenantId:TENANT,productId:PRODUCT,kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:2,status:'COMMITTED',resultRef:'SECRET'};
  const r=planSettlementReversal(input({source:source({returnedQtyTicks:2}),priorCorrections:[old]}));
  assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.existingResultRef,null);
  assert.ok(r.reviewIssues.some(i=>i.code==='OPERATION_CONFLICT'));
});

test('a different operation with source already returned but no matched history fails closed',()=>{
  const r=planSettlementReversal(input({source:source({returnedQtyTicks:1})}));
  assert.ok(r.reviewIssues.some(i=>i.code==='RETURN_HISTORY_MISMATCH'));
});

test('source sale item lot must match exact settlement link, not guess by product/date',()=>{
  const r=planSettlementReversal(input({source:source({sourceId:'UNKNOWN'}),correction:{kind:'SALE_RETURN',sourceId:'UNKNOWN',qtyTicks:1}}));
  assert.ok(r.reviewIssues.some(i=>i.code==='MISSING_SETTLEMENT_LINK'));
  assert.deepEqual(r.settlementDeltas,[]);
});

test('two historical settlement links on one sale item cannot be blindly grouped',()=>{
  const duplicated=link({settlementId:'STL-OTHER',oversoldLotId:'LOT-OTHER',allocatedQtyTicks:1,provisionalCostMinor:6800,actualCostMinor:6475});
  const r=planSettlementReversal(input({purchaseLot:{...purchase(),originalQtyTicks:241},settlements:[...links(),duplicated]}));
  assert.ok(r.reviewIssues.some(i=>i.code==='AMBIGUOUS_SALE_LINKS'));
});

test('purchase return of 1 uses only 1 unsold unit and never unallocates settled debt',()=>{
  const r=clean(planSettlementReversal(input({source:{kind:'PURCHASE',sourceId:'PUR-082',originalQtyTicks:240,returnedQtyTicks:0},correction:{kind:'PURCHASE_RETURN',sourceId:'PUR-082',qtyTicks:1}})));
  assert.equal(r.status,'CANDIDATE_ONLY');assert.deepEqual(r.settlementDeltas,[]);
  assert.equal(r.netStockDeltaTicks,-1);
  assert.deepEqual(r.virtualLotSteps,[{kind:'PURCHASE_RETURN_UNALLOCATED',purchaseLotDeltaTicks:-1,netStockDeltaTicks:-1}]);
});

test('purchase return exceeding unallocated 9 Foot must not silently consume 231 funded units',()=>{
  const r=planSettlementReversal(input({source:{kind:'PURCHASE',sourceId:'PUR-082',originalQtyTicks:240,returnedQtyTicks:0},correction:{kind:'PURCHASE_RETURN',sourceId:'PUR-082',qtyTicks:15}}));
  assert.equal(r.status,'NEEDS_REVIEW');assert.ok(r.reviewIssues.some(i=>i.code==='FUNDED_STOCK_RETURN_BLOCKED'));
});

test('purchase delete with any active settlement link is refused',()=>{
  const r=planSettlementReversal(input({source:{kind:'PURCHASE',sourceId:'PUR-082',originalQtyTicks:240,returnedQtyTicks:0},correction:{kind:'PURCHASE_DELETE',sourceId:'PUR-082',qtyTicks:240}}));
  assert.equal(r.status,'NEEDS_REVIEW');assert.ok(r.reviewIssues.some(i=>i.code==='PURCHASE_DELETE_LINKED'));
});

test('purchase delete with no allocations and all stock unsold is candidate only',()=>{
  const lot={...purchase(),originalQtyTicks:6,availableQtyTicks:6};
  const r=clean(planSettlementReversal(input({purchaseLot:lot,settlements:[],source:{kind:'PURCHASE',sourceId:'PUR-082',originalQtyTicks:6,returnedQtyTicks:0},correction:{kind:'PURCHASE_DELETE',sourceId:'PUR-082',qtyTicks:6}})));
  assert.equal(r.netStockDeltaTicks,-6);assert.equal(r.status,'CANDIDATE_ONLY');
});

test('cancelling a settled sale never silently credits Cash/Bank/Party ledgers',()=>{
  const r=clean(planSettlementReversal(input()));
  assert.equal(r.postable,false);assert.equal('journal' in r,false);assert.equal('cash' in r,false);
  assert.equal('ledger' in r,false);
});

test('tenant/product or purchase-lot mismatch refuses even otherwise balanced quantities',()=>{
  const overrides=[{settlements:links().map(x=>({...x,tenantId:'SHOP-B'}))},{settlements:links().map(x=>({...x,productId:'OTHER'}))},{settlements:links().map(x=>({...x,purchaseLotId:'ANOTHER'}))},{purchaseLot:{...purchase(),tenantId:'SHOP-B'}}];
  for(const override of overrides){const r=planSettlementReversal(input(override));assert.ok(r.reviewIssues.some(i=>i.code==='SCOPE_MISMATCH'));}
});

test('contradictory purchase stock or duplicate settlement IDs fail closed',()=>{
  const bad=planSettlementReversal(input({purchaseLot:{...purchase(),availableQtyTicks:200}}));
  assert.ok(bad.reviewIssues.some(i=>i.code==='PURCHASE_CONSERVATION_MISMATCH'));
  const dup=planSettlementReversal(input({settlements:[...links(),links()[0]]}));
  assert.ok(dup.reviewIssues.some(i=>i.code==='DUPLICATE_SETTLEMENT_ID'));
});

test('wrong return history and wrong source linkage cannot create a candidate',()=>{
  const r=planSettlementReversal(input({priorCorrections:[{operationId:'OLD',tenantId:TENANT,productId:PRODUCT,kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:2,status:'COMMITTED',resultRef:'REV'}]}));
  assert.ok(r.reviewIssues.some(i=>i.code==='RETURN_HISTORY_MISMATCH'));
});

test('invalid quantity, pending correction, negative stock or accessor input refuse without mutation',()=>{
  const invalid=planSettlementReversal(input({correction:{kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:-1}}));
  assert.ok(invalid.reviewIssues.some(i=>i.code==='INVALID_CORRECTION_QUANTITY'));
  const pending=planSettlementReversal(input({priorCorrections:[{operationId:'OLD',tenantId:TENANT,productId:PRODUCT,kind:'SALE_RETURN',sourceId:'SIL-001',qtyTicks:1,status:'PENDING',resultRef:'REV'}]}));
  assert.ok(pending.reviewIssues.some(i=>i.code==='UNRESOLVED_CORRECTION'));
  const broken=planSettlementReversal(input({purchaseLot:{...purchase(),availableQtyTicks:-1}}));
  assert.ok(broken.reviewIssues.some(i=>i.code==='INVALID_PURCHASE_BALANCE'));
  const data=input();let triggered=false;
  Object.defineProperty(data.settlements[0],'allocatedQtyTicks',{get(){triggered=true;throw Error('unsafe');}});
  assert.throws(()=>planSettlementReversal(data),/trusted/i);assert.equal(triggered,false);
});

test('large separately safe quantities must not overflow aggregate conservation',()=>{
  const max=Number.MAX_SAFE_INTEGER;
  const x=input({purchaseLot:{...purchase(),originalQtyTicks:max,availableQtyTicks:max},settlements:[
    link({allocatedQtyTicks:max,provisionalCostMinor:1,actualCostMinor:1}),
    link({settlementId:'SECOND',sourceSaleItemLotId:'SIL-002',oversoldLotId:'OTHER',allocatedQtyTicks:max,provisionalCostMinor:1,actualCostMinor:1})
  ]});
  const r=planSettlementReversal(x);
  assert.ok(r.reviewIssues.some(i=>i.code==='UNSAFE_QUANTITY_AGGREGATE'));
});

test('untrusted status or altered reversal history cannot be treated as a committed source correction',()=>{
 const x=input({settlements:[link({reversedQtyTicks:1,reversedActualCostMinor:6476,reversedProvisionalCostMinor:6800}),links()[1]]});
 const r=planSettlementReversal(x);
 assert.ok(r.reviewIssues.some(i=>i.code==='LINK_COST_HISTORY_MISMATCH'));
});

test('source quantityScale must be an explicitly verified integer tick conversion',()=>{
 for(const quantityScale of [0,1.1,-1,NaN,Infinity]){
   assert.throws(()=>planSettlementReversal(input({quantityScale})),/trusted/i);
 }
});
