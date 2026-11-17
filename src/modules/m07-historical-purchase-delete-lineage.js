/**
 * M07-B17: INTERNAL ONLY, read-only native Purchase Delete source lineage.
 *
 * M05's existing native-shaped inventory delete BLOCK phase decides whether
 * a historical single-product purchase could be reversed physically.
 * Independently preserve the original M05 unit/price snapshot and lot source.
 *
 * This is NOT the deletion engine, an exact-once journal or a financial writer.
 * M03 must recompute inside authenticated SQL-atomic D1 posting and decide
 * actual idempotency/replay, M04 authorizes and M08 reconciles gross accounts.
 */
import {auditMultiUnitPurchaseSnapshot}
 from './m05-purchase-unit-snapshot-conservation.js';
import {planPurchaseInventoryDelete}
 from './purchase-correction-guards.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const SOURCE_KEYS='line,lots,originalLineTotalPaisa,product,purchase,purchaseId,returns,sourceHash,supplierId,tenantId';
const INTENT_KEYS='correctionId,expectedSourceHash,purchaseId,reason,tenantId';
const id=value=>typeof value==='string'&&ID.test(value);
const pos=value=>Number.isSafeInteger(value)&&value>0;
const nonneg=value=>Number.isSafeInteger(value)&&value>=0;
const plain=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 return (proto===Object.prototype||proto===null) &&
  Object.values(Object.getOwnPropertyDescriptors(value))
   .every(d=>Object.hasOwn(d,'value'));
};
function review(message){throw new Error('NEEDS_REVIEW: '+message);}
function safeAdd(a,b){
 const sum=a+b;
 if(!Number.isSafeInteger(sum)||sum<0)review('historical source quantity overflow');
 return sum;
}
function clone(value,depth=0){
 if(depth>16)review('excessive source nesting');
 if(value===null||typeof value==='string'||typeof value==='boolean')
  return value;
 if(typeof value==='number'){
  if(!Number.isFinite(value))review('nonfinite source number');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>10000)review('excessive historical source rows');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.some(k=>typeof k!=='string'||
    (k!=='length'&&!/^(0|[1-9]\d*)$/.test(k))))
   review('invalid historical source array keys');
  const output=[];
  for(let index=0;index<value.length;index++){
   const row=descriptors[String(index)];
   if(!row||!Object.hasOwn(row,'value'))
    review('sparse or accessor-bearing historical source array');
   output.push(clone(row.value,depth+1));
  }
  return output;
 }
 if(!plain(value))review('invalid or accessor-bearing source');
 const output=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))
   review('untrusted historical source field');
  output[key]=clone(Object.getOwnPropertyDescriptor(value,key).value,depth+1);
 }
 return output;
}
const deleted=row=>row?.['Is Deleted']===true||
 String(row?.['Is Deleted']??'').trim().toLowerCase()==='true';

/** Check historical original Purchase snapshot, never the current unit catalog. */
function reviewSource(source){
 if(!plain(source)||Object.keys(source).sort().join(',')!==SOURCE_KEYS||
  !id(source.tenantId)||!id(source.purchaseId)||!id(source.supplierId)||
  !HASH.test(source.sourceHash)||!nonneg(source.originalLineTotalPaisa)||
  !plain(source.purchase)||!plain(source.product)||!plain(source.line)||
  !plain(source.line.unit)||!Array.isArray(source.lots)||
  !Array.isArray(source.returns))
  review('invalid original mixed-unit Purchase Delete source');
 if(source.purchase['Purchase ID']!==source.purchaseId||
    source.purchase['Supplier ID']!==source.supplierId||
    !id(source.line.productId)||
    source.product['Product ID']!==source.line.productId||
    !pos(source.line.qty)||!nonneg(source.product['Current Stock']))
  review('original Purchase, Supplier, Product or stock identity mismatch');
 if(deleted(source.product))review('original product deleted');
 if(!Array.isArray(source.line.unit.unitSnapshot)||
    !source.line.unit.unitSnapshot.length||
    !Array.isArray(source.line.unit.pricingSnapshot))
  review('missing original historical Purchase unit snapshot');
 const units=source.line.unit.unitSnapshot;
 const seenConversions=new Set();
 for(const row of units){
  if(!plain(row)||!id(row.conversionId)||!id(row.unitName)||
    !pos(row.factor)||!pos(row.qty)||seenConversions.has(row.conversionId))
   review('invalid historical Purchase conversion/quantity');
  seenConversions.add(row.conversionId);
  if(row.conversionId==='BASE'&&
     (row.factor!==1||row.unitName!==source.line.unit.stockUnit))
   review('invalid original Purchase BASE unit');
 }
 if(!seenConversions.has('BASE'))review('missing original Purchase BASE unit');
 const audit=auditMultiUnitPurchaseSnapshot({
  lines:[source.line],subtotal:source.line.unit.lineTotal
 });
 if(!audit.ready||audit.summary.unitLines!==1||
    audit.summary.legacyLines!==0)
  review('original historical Purchase quantity/price snapshot mismatch');
 const paisa=Math.round((source.line.unit.lineTotal+Number.EPSILON)*100);
 if(!nonneg(paisa)||paisa!==source.originalLineTotalPaisa)
  review('original historical Purchase price mismatch');

 const seenLots=new Set(),seenRows=new Set(),owned=[];
 let qty=0;
 for(const row of source.lots){
  if(!plain(row)||!id(row['Lot ID'])||!id(row['Purchase ID'])||
    !id(row['Product ID'])||!pos(row._rowIndex)||
    !nonneg(row['Original Quantity'])||!nonneg(row['Remaining Quantity'])||
    row['Remaining Quantity']>row['Original Quantity']||
    seenLots.has(row['Lot ID'])||seenRows.has(row._rowIndex))
   review('invalid/duplicate original Purchase lot or source row');
  seenLots.add(row['Lot ID']);seenRows.add(row._rowIndex);
  if(row['Purchase ID']!==source.purchaseId)continue;
  if(row['Product ID']!==source.line.productId||
     row['Supplier ID']!==source.supplierId||
     !pos(row['Original Quantity']))
   review('original Purchase lot Product or Supplier provenance mismatch');
  qty=safeAdd(qty,row['Original Quantity']);
  owned.push(row);
 }
 if(!owned.length)return {decline:'UNVERIFIED_ORIGINAL_PURCHASE_LOTS'};
 if(qty!==source.line.qty)
  review('original Purchase lots do not conserve historical base quantity');
 for(const row of source.returns)
  if(!plain(row)||!id(row['Return ID'])||!id(row['Purchase ID']))
   review('invalid original Purchase Return source reference');
 return {owned};
}

/**
 * Returns immutable source evidence ONLY, never a runnable SQL plan.
 * The correction ID/expected hash are a future M03 replay handoff,
 * NOT evidence that its database has ever committed or authorized a reversal.
 */
export function planHistoricalMixedUnitPurchaseDeleteLineage(rawSource,rawIntent){
 const source=clone(rawSource),intent=clone(rawIntent);
 if(!plain(intent)||Object.keys(intent).sort().join(',')!==INTENT_KEYS||
   !id(intent.tenantId)||!id(intent.purchaseId)||
   typeof intent.correctionId!=='string'||
   !/^[A-Za-z0-9][A-Za-z0-9_.:-]{11,99}$/.test(intent.correctionId)||
   !HASH.test(intent.expectedSourceHash)||
   typeof intent.reason!=='string'||
   !intent.reason.trim()||intent.reason.trim().length>200)
  throw new TypeError('Invalid native Purchase Delete correction intent');
 const result=reviewSource(source);
 if(source.tenantId!==intent.tenantId||
    source.purchaseId!==intent.purchaseId)
  throw new TypeError('Invalid original Purchase Delete tenant/purchase identity');
 if(source.sourceHash!==intent.expectedSourceHash)
  review('historical Purchase source hash changed; reload before deleting');
 if(result.decline)return Object.freeze({status:'DECLINED',reason:result.decline});

 const item={
  'Purchase ID':source.purchaseId,
  'Product ID':source.line.productId,
  'Product Name':source.product['Product Name']||source.line.productId,
  'Quantity':source.line.qty,'Unit Price':source.line.price
 };
 // Source single-product mixed-unit evidence builds the same native BLOCK
 // inputs as M05 (not a second stock/due/cash deletion implementation).
 const inventory=planPurchaseInventoryDelete(source.purchaseId,{
  purchases:[source.purchase],items:[item],
  lots:result.owned,products:[source.product],returns:source.returns
 });
 const stocks=inventory.stockReversals;
 if(stocks.length!==1||stocks[0].productId!==source.line.productId||
    stocks[0].qty!==source.line.qty||
    stocks[0].newStock!==source.product['Current Stock']-source.line.qty||
    stocks[0].lotIds.length!==result.owned.length||
    stocks[0].lotIds.some((lotId,i)=>lotId!==result.owned[i]['Lot ID']))
  review('M05 native Purchase Delete inventory source mismatch');

 const historicalUnits=Object.freeze(source.line.unit.unitSnapshot.map(row=>
  Object.freeze({
   conversionId:row.conversionId,unitName:row.unitName,
   factor:row.factor,qty:row.qty
  })));
 const ownedLots=Object.freeze(result.owned.map(row=>Object.freeze({
  lotId:row['Lot ID'],sourceRowIndex:row._rowIndex,
  originalBaseQty:row['Original Quantity'],
  remainingBaseQty:row['Remaining Quantity']
 })));
 return Object.freeze({status:'PLAN_ONLY',data:Object.freeze({
  tenantId:source.tenantId,purchaseId:source.purchaseId,
  correctionId:intent.correctionId,sourceHash:source.sourceHash,
  originalBaseQty:source.line.qty,historicalUnits,ownedLots,
  stockProof:Object.freeze({
   productId:stocks[0].productId,reduceBaseQty:stocks[0].qty,
   newStock:stocks[0].newStock
  }),
  readOnly:true,commitAuthorized:false,
  financialCalculationAuthorized:false,replayResolved:false
 })});
}
