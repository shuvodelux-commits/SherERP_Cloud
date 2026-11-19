/**
 * M07: pure, non-postable preflight for corrections touching OVERSOLD settlement.
 * This module NEVER performs SQL, inventory/financial posting or authorizes an
 * actor. M03/M04/M08 must separately approve transactional posting and policy.
 * Canonical quantities are safe INTEGER base-unit ticks. Costs are BDT paisa.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const isId=x=>typeof x==='string'&&ID.test(x);
const isQty=n=>Number.isSafeInteger(n)&&n>=0;
const isMoney=n=>Number.isSafeInteger(n)&&n>=0;
const freeze=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
function trusted(x,seen=new WeakSet()){
  if(x===null||typeof x!=='object')return true;
  if(seen.has(x))return false;
  seen.add(x);
  if(!Array.isArray(x)&&![Object.prototype,null].includes(Object.getPrototypeOf(x)))return false;
  const ds=Object.getOwnPropertyDescriptors(x);
  return Reflect.ownKeys(ds).every(k=>{
    const d=ds[k];return Object.hasOwn(d,'value')&&trusted(d.value,seen);
  });
}
function roundPart(total,portion,original){
  // Exact integer half-up proportional allocation; all operands safe ints.
  const n=BigInt(total)*BigInt(portion), d=BigInt(original);
  const value=(n+d/2n)/d;
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Unsafe cost allocation');
  return Number(value);
}
function result(status,issues=[],other={}){
  return freeze({status,postable:false,reviewIssues:issues,correctionQtyTicks:0,
    settlementDeltas:[],virtualLotSteps:[],netStockDeltaTicks:0,
    existingResultRef:null,...other});
}

/**
 * @param {object} input Authenticated tenant-scoped evidence supplied by M03.
 * @returns {Readonly<object>} CANDIDATE_ONLY, REPLAY or NEEDS_REVIEW.
 */
export function planSettlementReversal(input){
  if(!trusted(input)||!input||typeof input!=='object'||Array.isArray(input))
    throw new TypeError('Trusted plain snapshot evidence required');
  const {tenantId,productId,operationId,quantityScale,purchaseLot,settlements,
    source,correction,priorCorrections}=input;
  if(!isId(tenantId)||!isId(productId)||!isId(operationId)||
    !Number.isSafeInteger(quantityScale)||quantityScale<1||quantityScale>1e6||
    !purchaseLot||!Array.isArray(settlements)||!source||!correction||
    !Array.isArray(priorCorrections))throw new TypeError('Trusted correction context, identity and snapshots required');
  const issues=[];const fail=(code,detail={})=>issues.push({code,...detail});
  const kind=correction.kind;
  if(!['SALE_RETURN','PURCHASE_RETURN','PURCHASE_DELETE'].includes(kind))fail('UNSUPPORTED_CORRECTION');
  if(!isId(correction.sourceId)||correction.sourceId!==source.sourceId)fail('SOURCE_ID_MISMATCH');
  if(!isQty(correction.qtyTicks)||correction.qtyTicks===0)fail('INVALID_CORRECTION_QUANTITY');
  if(!isId(source.sourceId)||!isQty(source.originalQtyTicks)||!isQty(source.returnedQtyTicks)||
    source.returnedQtyTicks>source.originalQtyTicks)fail('INVALID_SOURCE_QUANTITY');
  const purchaseKind=kind!=='SALE_RETURN';
  if(source.kind!==(purchaseKind?'PURCHASE':'OVERSOLD_SALE_ITEM_LOT'))fail('WRONG_SOURCE_KIND');
  const p=purchaseLot;
  if(p.tenantId!==tenantId||p.productId!==productId||!isId(p.lotId)||!isId(p.purchaseId))fail('SCOPE_MISMATCH');
  if(!isQty(p.originalQtyTicks)||p.originalQtyTicks===0||!isQty(p.availableQtyTicks)||
    !isQty(p.otherConsumedQtyTicks??0)||!isQty(p.returnedQtyTicks??0))fail('INVALID_PURCHASE_BALANCE');
  if(purchaseKind&&(source.sourceId!==p.purchaseId||source.originalQtyTicks!==p.originalQtyTicks||
    source.returnedQtyTicks!==(p.returnedQtyTicks??0)))fail('SOURCE_PURCHASE_MISMATCH');
  const seen=new Set();let pendingUnits=0;
  for(const link of settlements){
    if(!isId(link.settlementId)||seen.has(link.settlementId))fail('DUPLICATE_SETTLEMENT_ID');
    seen.add(link.settlementId);
    if(link.tenantId!==tenantId||link.productId!==productId||
      link.purchaseLotId!==p.lotId||!isId(link.oversoldLotId)||!isId(link.sourceSaleItemLotId))fail('SCOPE_MISMATCH');
    if(!isQty(link.allocatedQtyTicks)||link.allocatedQtyTicks===0||
      !isQty(link.reversedQtyTicks)||link.reversedQtyTicks>link.allocatedQtyTicks||
      !isMoney(link.provisionalCostMinor)||!isMoney(link.actualCostMinor)||
      !isMoney(link.reversedProvisionalCostMinor)||!isMoney(link.reversedActualCostMinor)||
      link.status!=='ACTIVE')fail('INVALID_SETTLEMENT_LINK');
    else {
      if(link.reversedProvisionalCostMinor!==roundPart(link.provisionalCostMinor,link.reversedQtyTicks,link.allocatedQtyTicks)||
         link.reversedActualCostMinor!==roundPart(link.actualCostMinor,link.reversedQtyTicks,link.allocatedQtyTicks))
        fail('LINK_COST_HISTORY_MISMATCH');
      const pending=link.allocatedQtyTicks-link.reversedQtyTicks;
      if(!Number.isSafeInteger(pendingUnits+pending))fail('UNSAFE_QUANTITY_AGGREGATE');
      else pendingUnits+=pending;
    }
  }
  if(isQty(p.originalQtyTicks)&&isQty(p.availableQtyTicks)&&
    isQty(p.otherConsumedQtyTicks??0)&&isQty(p.returnedQtyTicks??0)) {
    const conserved=BigInt(p.availableQtyTicks)+BigInt(pendingUnits)+
      BigInt(p.otherConsumedQtyTicks??0)+BigInt(p.returnedQtyTicks??0);
    if(conserved>BigInt(Number.MAX_SAFE_INTEGER))fail('UNSAFE_QUANTITY_AGGREGATE');
    else if(conserved!==BigInt(p.originalQtyTicks))fail('PURCHASE_CONSERVATION_MISMATCH');
  }
  const ops=new Set();let historyReturned=0,priorSame=null;
  for(const h of priorCorrections){
    if(!isId(h.operationId)||ops.has(h.operationId))fail('DUPLICATE_CORRECTION_OPERATION');
    ops.add(h.operationId);
    if(h.tenantId!==tenantId||h.productId!==productId)fail('SCOPE_MISMATCH');
    if(!['SALE_RETURN','PURCHASE_RETURN','PURCHASE_DELETE'].includes(h.kind)||!isId(h.sourceId)||
      !isQty(h.qtyTicks)||h.qtyTicks===0||h.status!=='COMMITTED'||!isId(h.resultRef))fail('UNRESOLVED_CORRECTION');
    if(h.kind===kind&&h.sourceId===source.sourceId){
      if(!Number.isSafeInteger(historyReturned+h.qtyTicks))fail('UNSAFE_QUANTITY_AGGREGATE');
      else historyReturned+=h.qtyTicks;
    }
    if(h.operationId===operationId)priorSame=h;
  }
  if(historyReturned!==source.returnedQtyTicks)fail('RETURN_HISTORY_MISMATCH');
  if(issues.length)return result('NEEDS_REVIEW',issues);
  if(priorSame){
    if(priorSame.kind===kind&&priorSame.sourceId===correction.sourceId&&priorSame.qtyTicks===correction.qtyTicks)
      return result('REPLAY',[],{existingResultRef:priorSame.resultRef});
    return result('NEEDS_REVIEW',[{code:'OPERATION_CONFLICT'}]);
  }
  if(correction.qtyTicks>source.originalQtyTicks-source.returnedQtyTicks)
    return result('NEEDS_REVIEW',[{code:'OVER_RETURN'}]);
  if(purchaseKind){
    if(kind==='PURCHASE_DELETE'){
      if(pendingUnits>0)return result('NEEDS_REVIEW',[{code:'PURCHASE_DELETE_LINKED'}]);
      if(source.returnedQtyTicks!==0||p.otherConsumedQtyTicks!==0||
        correction.qtyTicks!==p.originalQtyTicks||p.availableQtyTicks!==p.originalQtyTicks)
        return result('NEEDS_REVIEW',[{code:'PURCHASE_DELETE_DEPENDENCIES'}]);
      return result('CANDIDATE_ONLY',[],{correctionQtyTicks:correction.qtyTicks,
        netStockDeltaTicks:-correction.qtyTicks,
        virtualLotSteps:[{kind:'PURCHASE_DELETE_UNALLOCATED',purchaseLotDeltaTicks:-correction.qtyTicks,netStockDeltaTicks:-correction.qtyTicks}]});
    }
    if(correction.qtyTicks>p.availableQtyTicks)
      return result('NEEDS_REVIEW',[{code:'FUNDED_STOCK_RETURN_BLOCKED'}]);
    return result('CANDIDATE_ONLY',[],{correctionQtyTicks:correction.qtyTicks,
      netStockDeltaTicks:-correction.qtyTicks,
      virtualLotSteps:[{kind:'PURCHASE_RETURN_UNALLOCATED',purchaseLotDeltaTicks:-correction.qtyTicks,netStockDeltaTicks:-correction.qtyTicks}]});
  }
  if(!isId(source.oversoldLotId))return result('NEEDS_REVIEW',[{code:'UNVERIFIED_SOURCE_LOT'}]);
  const matched=settlements.filter(s=>s.sourceSaleItemLotId===source.sourceId&&s.oversoldLotId===source.oversoldLotId);
  if(!matched.length)return result('NEEDS_REVIEW',[{code:'MISSING_SETTLEMENT_LINK'}]);
  if(matched.length>1||settlements.some(s=>s.sourceSaleItemLotId===source.sourceId&&s.oversoldLotId!==source.oversoldLotId))
    return result('NEEDS_REVIEW',[{code:'AMBIGUOUS_SALE_LINKS'}]);
  const link=matched[0];const take=correction.qtyTicks;
  if(take>link.allocatedQtyTicks-link.reversedQtyTicks)
    return result('NEEDS_REVIEW',[{code:'LINK_QTY_EXCEEDED'}]);
  const prospective=link.reversedQtyTicks+take;
  const provisional=roundPart(link.provisionalCostMinor,prospective,link.allocatedQtyTicks)-link.reversedProvisionalCostMinor;
  const actual=roundPart(link.actualCostMinor,prospective,link.allocatedQtyTicks)-link.reversedActualCostMinor;
  return result('CANDIDATE_ONLY',[],{correctionQtyTicks:take,
    netStockDeltaTicks:take,
    settlementDeltas:[{settlementId:link.settlementId,oversoldLotId:link.oversoldLotId,
      purchaseLotId:p.lotId,reversedQtyTicks:take,
      reversedProvisionalCostMinor:provisional,reversedActualCostMinor:actual,
      varianceReversalMinor:provisional-actual}],
    virtualLotSteps:[
      {kind:'UNALLOCATE_PURCHASE_DEBT',purchaseLotDeltaTicks:take,oversoldLotDeltaTicks:-take,netStockDeltaTicks:0},
      {kind:'SOURCE_SALE_RETURN_RESTORE',stockDeltaTicks:take}
    ]});
}
