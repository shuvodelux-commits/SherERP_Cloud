/**
 * M07-B14: read-only batch validator for original sale-source lot reservations.
 *
 * Original StockLots.gs::planSaleReturnRestoration_ coordinates a shared
 * virtualState across return children before any write. This internal proof
 * composes the independently tested B12/B13 planners in the same spirit.
 * It is NOT durable state, M03 SQL atomicity, a Cash/Bank writer, or a public
 * Return endpoint. Do not post anything based on this preview alone.
 */
import {planHistoricalPartialUnitReturn} from './m07-historical-partial-unit-return.js';
import {planHistoricalBundleReturn} from './m07-historical-bundle-return.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const BATCH_KEYS='batchId,entries,tenantId';
const CHILD_KEYS='intent,kind,source';
const plain=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return (prototype===Object.prototype||prototype===null) &&
  Object.values(Object.getOwnPropertyDescriptors(value))
   .every(d=>Object.hasOwn(d,'value'));
};
const id=value=>typeof value==='string'&&ID.test(value);
function fail(message){throw new Error('NEEDS_REVIEW: '+message);}
function copyData(value,depth=0){
 if(depth>12)fail('untrusted source nesting');
 if(value===null||typeof value==='string'||typeof value==='boolean')
  return value;
 if(typeof value==='number'){
  if(!Number.isFinite(value))fail('nonfinite trusted source');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>512)fail('too many historical source rows');
  // Read property descriptors first to avoid invoking getters accidentally.
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(let i=0;i<value.length;i++)
   if(!Object.hasOwn(descriptors,String(i))||
      !Object.hasOwn(descriptors[String(i)],'value'))
    fail('sparse/accessor historical source array');
  return value.map(v=>copyData(v,depth+1));
 }
 if(!plain(value))fail('invalid or accessor-bearing original source');
 const copy=Object.create(null);
 for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
  if(key==='__proto__'||key==='constructor'||key==='prototype')
   fail('untrusted source key');
  copy[key]=copyData(descriptor.value,depth+1);
 }
 return copy;
}
function sourceId(kind,source){
 return kind==='BUNDLE'?source.bundleId:source.productId;
}
function sourceKey(kind,source){
 return [source.tenantId,source.invoiceId,kind,sourceId(kind,source)].join('|');
}
function links(kind,source){
 const rows=kind==='BUNDLE'?source.componentConsumptions:source.consumptionRows;
 return rows.map(row=>({link:row.sourceLinkId,rowIndex:row.rowIndex}));
}
function decline(childIndex,reason){
 return Object.freeze({status:'DECLINED',childIndex,reason});
}
function addSafe(a,b){
 const n=a+b;
 if(!Number.isSafeInteger(n)||n<0)fail('source quantity overflow');
 return n;
}
function applyMixed(virtual,plan){
 virtual.activeReturnedBaseQty=addSafe(
  virtual.activeReturnedBaseQty,plan.requestedBaseQty);
 for(const draw of plan.restoreOriginalLots){
  const r=virtual.consumptionRows.find(row=>
   row.sourceLinkId===draw.sourceLinkId &&
   row.rowIndex===draw.sourceRowIndex &&
   row.lotId===draw.lotId);
  if(!r||r.remainingBaseQty<draw.baseQty)
   fail('conflicting original mixed-unit consumption link');
  r.remainingBaseQty-=draw.baseQty;
 }
}
function applyBundle(virtual,plan){
 virtual.activeReturnedSets=addSafe(
  virtual.activeReturnedSets,plan.returnSets);
 for(const component of plan.componentPlans){
  for(const draw of component.restorations){
   const r=virtual.componentConsumptions.find(row=>
    row.productId===component.productId &&
    row.sourceLinkId===draw.sourceLinkId &&
    row.rowIndex===draw.sourceRowIndex &&
    row.lotId===draw.lotId);
   if(!r||r.remainingBaseQty<draw.baseQty)
    fail('conflicting original Bundle source consumption link');
   r.remainingBaseQty-=draw.baseQty;
  }
 }
}

/**
 * Result is a frozen ALL-OR-NOTHING proposal. There is never a partial batch
 * success and there are zero database writes or financial calculations.
 *
 * Each repeated original sale ID must provide identical *initial* saved
 * snapshot evidence; only the virtual copy accumulates planned changes.
 */
export function planHistoricalReturnBatch(raw){
 if(!plain(raw)||Object.keys(raw).sort().join(',')!==BATCH_KEYS||
   !id(raw.tenantId)||!id(raw.batchId)||
   !Array.isArray(raw.entries)||raw.entries.length<2||raw.entries.length>20)
  throw new TypeError('Invalid historical batch shape, tenant or count');
 const origins=new Map(),linkOwners=new Map(),rowOwners=new Map();
 const returnIds=new Set(),children=[];
 for(const [index,rawEntry] of raw.entries.entries()){
  if(!plain(rawEntry)||Object.keys(rawEntry).sort().join(',')!==CHILD_KEYS||
     (rawEntry.kind!=='MIXED_UNIT'&&rawEntry.kind!=='BUNDLE'))
   throw new TypeError('Invalid historical batch child kind or shape');
  // This copy also rejects own-data accessors and cannot read arbitrary
  // browser claimed SQL, cash authorizations or linked current catalogs.
  const entry=copyData(rawEntry);
  const {kind,intent,source}=entry;
  if(!plain(intent)||!plain(source)||
     source.tenantId!==raw.tenantId||intent.tenantId!==raw.tenantId)
   throw new TypeError('Invalid historical return tenant identity');
  if(!id(intent.returnId))
   throw new TypeError('Invalid original return identity');
  if(returnIds.has(intent.returnId))
   throw new TypeError('Invalid duplicate historical Return ID in batch');
  returnIds.add(intent.returnId);
  const key=sourceKey(kind,source);
  let state=origins.get(key);
  // Keep exactly the provided original *starting* snapshots across repeated
  // children of one sale. Never accept a later client supplied stock revision.
  const signature=JSON.stringify(source);
  if(state&&state.signature!==signature)
   fail('contradictory original sale source snapshot for batch');
  if(!state){
   const virtual=copyData(source);
   state={signature,virtual,usedUnits:new Map()};
   origins.set(key,state);
   // B12/B13 enforce valid individual row identity. These global checks
   // additionally detect double attribution of the same original source row
   // between *different* sale lines, including mixed Bundle/Standard sales.
   const first=kind==='BUNDLE'
     ?planHistoricalBundleReturn(source,intent)
     :planHistoricalPartialUnitReturn(source,intent);
   // We intentionally let a declined first child report its own reason;
   // provenance rows are still inspectable from its strict source checks.
   for(const row of links(kind,source)){
    const linkKey=source.tenantId+'|'+row.link;
    const rowKey=source.tenantId+'|'+row.rowIndex;
    if((linkOwners.has(linkKey)&&linkOwners.get(linkKey)!==key)||
       (rowOwners.has(rowKey)&&rowOwners.get(rowKey)!==key))
     fail('original source link or row index collision between sale owners');
    linkOwners.set(linkKey,key);
    rowOwners.set(rowKey,key);
   }
   if(first.status==='DECLINED')
    return decline(index,first.reason);
   // Do not use first plan as the final value when repeated children need
   // virtual state; recompute below with identical deterministic inputs.
  }

  // Untrusted per-unit price and lot IDs are already rejected by B12; this
  // extra batch-only component budget prevents two previews independently
  // reusing the same historical Bag/Box/Pcs count.
  if(kind==='MIXED_UNIT'){
   if(!Array.isArray(intent.unitBreakdown))
    throw new TypeError('Invalid batch mixed-unit return breakdown');
   for(const row of intent.unitBreakdown){
    const original=state.virtual.unitBreakdownSnapshot.find(
     unit=>unit.conversionId===row.conversionId);
    if(original&&Number.isSafeInteger(row.qty)&&row.qty>0){
     const used=addSafe(state.usedUnits.get(row.conversionId)||0,row.qty);
     if(used>original.qty)
      return decline(index,'EXCEEDS_HISTORICAL_COMPONENT_BATCH_QTY');
    }
   }
  }

  const result=kind==='BUNDLE'
    ?planHistoricalBundleReturn(state.virtual,intent)
    :planHistoricalPartialUnitReturn(state.virtual,intent);
  if(result.status==='DECLINED')return decline(index,result.reason);
  if(result.status!=='PLAN_ONLY'||!result.data||
    result.data.commitAuthorized!==false||
    result.data.financialCalculationAuthorized!==false)
   fail('unverified historical return plan');

  if(kind==='BUNDLE')applyBundle(state.virtual,result.data);
  else{
   for(const row of intent.unitBreakdown)
    state.usedUnits.set(row.conversionId,addSafe(
     state.usedUnits.get(row.conversionId)||0,row.qty));
   applyMixed(state.virtual,result.data);
  }
  children.push(Object.freeze({
   kind,returnId:intent.returnId,plan:result.data
  }));
 }
 return Object.freeze({
  status:'PLAN_ONLY',
  data:Object.freeze({
   tenantId:raw.tenantId,batchId:raw.batchId,
   children:Object.freeze(children),
   readOnly:true,commitAuthorized:false,
   financialCalculationAuthorized:false
  })
 });
}
