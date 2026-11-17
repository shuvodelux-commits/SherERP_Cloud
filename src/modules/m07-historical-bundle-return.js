/**
 * M07-B13: testable, read-only historical Bundle return stock provenance.
 *
 * The financial sale and future return are ONE Bundle display line. Physical
 * stock belongs to sale-time component rows from SALE_BUNDLE_COMPONENTS and
 * exact component-owned SALE_ITEM_LOTS, never the current Bundle master or
 * current FIFO. The original Source Consumption Link ID must survive import.
 *
 * Not a D1 writer, inventory reservation, refund or privileged RPC. A future
 * M03/M04 authorized atomic transaction must recheck source, lot, version,
 * current Cash Session and M08 financial records before posting any change.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Bundles.gs::getSaleBundleSnapshot_, StockLots.gs restoration/undo planners.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SHA=/^[0-9a-f]{64}$/;
const INTENT_KEYS='bundleId,invoiceId,returnId,returnSets,tenantId';
const RECIPE_KEYS='productId,qtyPerSet,unit';
const CONSUMPTION_KEYS='invoiceId,lotId,originalBaseQty,productId,remainingBaseQty,rowIndex,sourceKind,sourceLinkId,sourceSaleProductId';

function plain(x){
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const p=Object.getPrototypeOf(x);
 return (p===Object.prototype||p===null)&&
  Object.values(Object.getOwnPropertyDescriptors(x))
   .every(d=>Object.hasOwn(d,'value'));
}
const id=x=>typeof x==='string'&&ID.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const fail=message=>{throw new Error('NEEDS_REVIEW: '+message);};
const decline=reason=>Object.freeze({status:'DECLINED',reason});
function safeAdd(a,b){
 const sum=a+b;
 if(!Number.isSafeInteger(sum))fail('unsafe component quantity total');
 return sum;
}
function rowShape(row,keys,label){
 if(!plain(row)||Object.keys(row).sort().join(',')!==keys)
  fail('invalid historical '+label+' source row');
}
function intentValue(intent){
 if(!plain(intent)||Object.keys(intent).sort().join(',')!==INTENT_KEYS||
  ![intent.tenantId,intent.invoiceId,intent.bundleId,intent.returnId].every(id)||
  !positive(intent.returnSets))
  throw new TypeError('Invalid historical Bundle return intent shape or quantity');
 return intent;
}
function sourceEvidence(source){
 if(!plain(source))throw new TypeError('Invalid historical Bundle source snapshot');
 if(![source.tenantId,source.invoiceId,source.bundleId].every(id)||
  typeof source.sourceHash!=='string'||!SHA.test(source.sourceHash)||
  !positive(source.snapshotRevision)||!positive(source.setsSold)||
  !nonnegative(source.activeReturnedSets)||
  source.activeReturnedSets>source.setsSold||
  !Array.isArray(source.historicalComponents)||
  source.historicalComponents.length===0||
  source.historicalComponents.length>64||
  !Array.isArray(source.componentConsumptions)||
  source.componentConsumptions.length===0||
  source.componentConsumptions.length>512)
  fail('invalid or missing original Bundle recipe / source revision');

 const recipe=new Map();
 for(const row of source.historicalComponents){
  rowShape(row,RECIPE_KEYS,'Bundle recipe');
  if(!id(row.productId)||!id(row.unit)||!positive(row.qtyPerSet)||
   row.productId===source.bundleId||recipe.has(row.productId))
   fail('missing, duplicated or invalid original Bundle component');
  const originalQty=source.setsSold*row.qtyPerSet;
  const outstandingQty=(source.setsSold-source.activeReturnedSets)*row.qtyPerSet;
  if(!nonnegative(originalQty)||!nonnegative(outstandingQty))
   fail('original Bundle physical quantity overflow');
  recipe.set(row.productId,{
   originalQty,outstandingQty,component:row,
   originalSum:0,remainingSum:0,rows:[]
  });
 }
 const sourceLinks=new Set(),indices=new Set(),lotIds=new Set();
 let unsupported=false;
 for(const row of source.componentConsumptions){
  rowShape(row,CONSUMPTION_KEYS,'Bundle consumption');
  if(row.invoiceId!==source.invoiceId||
   row.sourceSaleProductId!==source.bundleId||
   !id(row.productId)||!id(row.lotId)||!id(row.sourceLinkId)||
   !positive(row.rowIndex)||!positive(row.originalBaseQty)||
   !nonnegative(row.remainingBaseQty)||
   row.remainingBaseQty>row.originalBaseQty||
   !recipe.has(row.productId)||
   sourceLinks.has(row.sourceLinkId)||indices.has(row.rowIndex)||
   lotIds.has(row.lotId)||
   typeof row.sourceKind!=='string'||!row.sourceKind)
   fail('missing/ambiguous original physical source-link or lot evidence');
  sourceLinks.add(row.sourceLinkId);indices.add(row.rowIndex);
  lotIds.add(row.lotId);
  if(row.sourceKind!=='LOT')unsupported=true;
  const item=recipe.get(row.productId);
  item.originalSum=safeAdd(item.originalSum,row.originalBaseQty);
  item.remainingSum=safeAdd(item.remainingSum,row.remainingBaseQty);
  item.rows.push(row);
 }
 for(const item of recipe.values()){
  if(item.originalSum!==item.originalQty||
     item.remainingSum!==item.outstandingQty)
   fail('historical component consumed vs returned totals do not reconcile');
 }
 return {recipe,unsupported};
}

/**
 * Request returns any positive whole original Bundle sets, including a final
 * partial return of a multi-set original sale. Each component follows its own
 * descending original consumption row order, not physical lot FIFO today.
 * Projection exposes neither per-component prices nor refund authority.
 */
export function planHistoricalBundleReturn(source,input){
 const intent=intentValue(input);
 const {recipe,unsupported}=sourceEvidence(source);
 if(source.tenantId!==intent.tenantId||
    source.invoiceId!==intent.invoiceId||
    source.bundleId!==intent.bundleId)
  throw new TypeError('Original Bundle source identity mismatch');
 if(unsupported)return decline('UNSUPPORTED_ORIGINAL_COMPONENT_SOURCE');
 if(intent.returnSets>source.setsSold-source.activeReturnedSets)
  return decline('EXCEEDS_OUTSTANDING_BUNDLE_SETS');
 const componentPlans=[];
 for(const [productId,item] of recipe){
  const needInitial=intent.returnSets*item.component.qtyPerSet;
  if(!positive(needInitial))fail('requested original component quantity overflow');
  let need=needInitial;
  const restorations=[];
  for(const row of [...item.rows].sort((a,b)=>b.rowIndex-a.rowIndex)){
   if(need===0)break;
   const take=Math.min(need,row.remainingBaseQty);
   if(take===0)continue;
   restorations.push(Object.freeze({
    lotId:row.lotId,sourceLinkId:row.sourceLinkId,
    sourceRowIndex:row.rowIndex,baseQty:take
   }));
   need-=take;
  }
  if(need!==0)fail('source-linked component restoration cannot be satisfied');
  componentPlans.push(Object.freeze({
   productId,baseQty:needInitial,
   restorations:Object.freeze(restorations)
  }));
 }
 const data=Object.freeze({
  tenantId:source.tenantId,invoiceId:source.invoiceId,
  bundleId:source.bundleId,returnId:intent.returnId,
  returnSets:intent.returnSets,bundleRevision:source.snapshotRevision,
  componentPlans:Object.freeze(componentPlans),
  readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false
 });
 return Object.freeze({status:'PLAN_ONLY',data});
}
