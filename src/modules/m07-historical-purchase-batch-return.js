/**
 * M07-B16 — INTERNAL read-only historical Purchase Return batch preflight.
 *
 * Compose the merged M07-B15 single-return original Purchase/lot planner.
 * The virtual source never reaches SQL/RPC or reserves real stock. M03 owns
 * all eventual atomic SQL posting, reversal, idempotency and Cash Session
 * authority; M04 owns actor/session/tenant enforcement.
 */
import {planHistoricalMixedUnitPurchaseReturn}
 from './m07-historical-purchase-mixed-unit-return.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const id=value=>typeof value==='string'&&ID.test(value);
const plain=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 return (proto===null||proto===Object.prototype)&&
  Object.values(Object.getOwnPropertyDescriptors(value))
   .every(d=>Object.hasOwn(d,'value'));
};
function review(message){throw new Error('NEEDS_REVIEW: '+message);}
function add(a,b){
 const value=a+b;
 if(!Number.isSafeInteger(value)||value<0)review('unsafe historical quantity');
 return value;
}
function copy(value,depth=0){
 if(depth>16)review('excessive historical source nesting');
 if(value===null||typeof value==='string'||typeof value==='boolean')
  return value;
 if(typeof value==='number'){
  if(!Number.isFinite(value))review('nonfinite historical source');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>10000)review('excessive historical source array');
  const ds=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(ds).some(k=>typeof k!=='string'||
     (k!=='length'&&!/^(0|[1-9]\d*)$/.test(k))))
   review('unexpected array source property');
  const result=[];
  for(let i=0;i<value.length;i++){
   const d=ds[String(i)];
   if(!d||!Object.hasOwn(d,'value'))
    review('sparse or accessor historical array');
   result.push(copy(d.value,depth+1));
  }
  return result;
 }
 if(!plain(value))review('invalid or accessor-bearing original source');
 const result=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))
   review('untrusted original source key');
  const d=Object.getOwnPropertyDescriptor(value,key);
  result[key]=copy(d.value,depth+1);
 }
 return result;
}
const decline=(childIndex,reason)=>
 Object.freeze({status:'DECLINED',childIndex,reason});

/**
 * Batch result is ALL-OR-NOTHING and internal PLAN_ONLY. All children start
 * with identical persisted original evidence per Purchase/Product owner;
 * only our own virtual copy is decremented between accepted children.
 */
export function planHistoricalMixedUnitPurchaseReturnBatch(input){
 const batch=copy(input);
 if(!plain(batch)||Object.keys(batch).sort().join(',')!=='batchId,entries,tenantId'||
   !id(batch.tenantId)||!id(batch.batchId)||
   !Array.isArray(batch.entries)||batch.entries.length<2||
   batch.entries.length>20)
  throw new TypeError('Invalid historical Purchase Return batch identity or shape');

 const owners=new Map(),lotOwners=new Map(),rowOwners=new Map();
 const returnIds=new Set(),children=[];
 for(const [index,entry] of batch.entries.entries()){
  if(!plain(entry)||Object.keys(entry).sort().join(',')!=='intent,source')
   throw new TypeError('Invalid historical Purchase Return batch child shape');
  const {source,intent}=entry;
  if(!plain(source)||!plain(intent)||source.tenantId!==batch.tenantId||
     intent.tenantId!==batch.tenantId)
   throw new TypeError('Invalid historical Purchase Return batch tenant identity');
  if(!id(intent.returnId)||returnIds.has(intent.returnId))
   throw new TypeError('Invalid duplicate historical Purchase Return ID');
  returnIds.add(intent.returnId);
  if(!id(source.purchaseId)||!id(source.productId))
   throw new TypeError('Invalid original Purchase Return source identity');
  const key=[source.tenantId,source.purchaseId,source.productId].join('|');
  const signature=JSON.stringify(source);
  let state=owners.get(key);
  if(state&&state.signature!==signature)
   review('contradictory original Purchase snapshot across batch');
  if(!state){
   state={signature,virtual:copy(source),unitUse:new Map()};
   owners.set(key,state);
  }

  // Reuse B15 source/price/lot provenance, FIFO and original Purchase only.
  const result=planHistoricalMixedUnitPurchaseReturn(state.virtual,intent);
  if(result.status==='DECLINED')return decline(index,result.reason);
  if(result.status!=='PLAN_ONLY'||!result.data||
     result.data.commitAuthorized!==false||
     result.data.financialCalculationAuthorized!==false||
     result.data.readOnly!==true)
   review('unverified historical Purchase Return plan');

  // Historical conversion-row budget is distinct from aggregate base units:
  // two individually valid Box requests may reuse an original Box row.
  for(const requested of intent.unitBreakdown){
   const original=state.virtual.line.unit.unitSnapshot.find(
    row=>row.conversionId===requested.conversionId);
   if(!original)review('missing historical approved conversion row');
   const total=add(state.unitUse.get(requested.conversionId)||0,requested.qty);
   if(total>original.qty)
    return decline(index,'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY');
  }

  // Distinct original purchases must not claim the same physical lot/row.
  // Ignore foreign-purchase rows included for original FIFO anti-borrow QA.
  if(!state.registered){
   for(const lot of state.virtual.lots){
    if(lot['Purchase ID']!==source.purchaseId)continue;
    const lotKey=batch.tenantId+'|'+lot['Lot ID'];
    const rowKey=batch.tenantId+'|'+lot._rowIndex;
    if((lotOwners.has(lotKey)&&lotOwners.get(lotKey)!==key)||
       (rowOwners.has(rowKey)&&rowOwners.get(rowKey)!==key))
     review('conflicting historical purchase-owned lot/row collision');
    lotOwners.set(lotKey,key);
    rowOwners.set(rowKey,key);
   }
   state.registered=true;
  }

  const drawn=new Set();
  for(const draw of result.data.sourcePurchaseLots){
   const row=state.virtual.lots.find(l=>
    l['Purchase ID']===source.purchaseId&&
    l['Product ID']===source.productId&&
    l['Lot ID']===draw.lotId&&l._rowIndex===draw.sourceRowIndex);
   if(!row||drawn.has(draw.lotId)||
      !Number.isSafeInteger(draw.baseQty)||draw.baseQty<=0||
      row['Remaining Quantity']<draw.baseQty||
      row['Remaining Quantity']-draw.baseQty!==draw.remainingAfter)
    review('conflicting original Purchase lot virtual reduction');
   drawn.add(draw.lotId);
   row['Remaining Quantity']=draw.remainingAfter;
  }
  state.virtual.alreadyReturnedBaseQty=add(
   state.virtual.alreadyReturnedBaseQty,result.data.requestedBaseQty);
  if(state.virtual.alreadyReturnedBaseQty>state.virtual.line.qty)
   review('historical Purchase Return over original quantity');
  for(const requested of intent.unitBreakdown)
   state.unitUse.set(requested.conversionId,
    add(state.unitUse.get(requested.conversionId)||0,requested.qty));

  children.push(Object.freeze({
   returnId:intent.returnId,plan:result.data
  }));
 }
 return Object.freeze({status:'PLAN_ONLY',data:Object.freeze({
  tenantId:batch.tenantId,batchId:batch.batchId,
  children:Object.freeze(children),readOnly:true,commitAuthorized:false,
  financialCalculationAuthorized:false
 })});
}
