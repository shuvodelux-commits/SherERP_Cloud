/**
 * M07-B12: internal-only, READ-ONLY partial mixed-unit Sales Return preflight.
 *
 * Strictly from original M06 sale-time snapshots plus the surviving original
 * SALE_ITEM_LOTS consumption-link/row-index evidence. Original GAS
 * StockLots.gs::planSaleReturnRestoration_ takes consumption rows in reverse
 * row-index order; current FIFO/current product conversion cannot replace it.
 *
 * No refund/discount derivation, public RPC, D1 write, stock reservation,
 * tenant/session authentication or Cash/Customer ledger authorization.
 * M03 must recheck original source identity and all remaining quantities
 * atomically with M04/M05/M06/M08 before any production return is possible.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[0-9a-f]{64}$/;
const INTENT_KEYS='invoiceId,productId,returnId,tenantId,unitBreakdown';
const UNIT_KEYS='conversionId,factor,qty,unitName';
const PRICE_KEYS='conversionId,factor,qty,unitName,unitPrice';
const LOT_KEYS='baseQty,lotId';
const CONSUMPTION_KEYS='invoiceId,lotId,productId,remainingBaseQty,rowIndex,sourceLinkId';

function plain(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const p=Object.getPrototypeOf(row);
 return (p===Object.prototype||p===null)&&
  Object.values(Object.getOwnPropertyDescriptors(row))
   .every(d=>Object.hasOwn(d,'value'));
}
const id=value=>typeof value==='string'&&ID.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const nonnegative=value=>Number.isSafeInteger(value)&&value>=0;
const needsReview=reason=>{
 throw new Error('NEEDS_REVIEW: '+reason);
};
const decline=reason=>Object.freeze({status:'DECLINED',reason});
function safeSum(a,b){
 const result=a+b;
 if(!Number.isSafeInteger(result))needsReview('unsafe original quantity');
 return result;
}
function trustedRow(row,keys,kind){
 if(!plain(row)||Object.keys(row).sort().join(',')!==keys)
  needsReview('invalid '+kind+' evidence');
}
function parseIntent(intent){
 if(!plain(intent)||Object.keys(intent).sort().join(',')!==INTENT_KEYS||
  ![intent.tenantId,intent.invoiceId,intent.productId,intent.returnId].every(id)||
  !Array.isArray(intent.unitBreakdown)||intent.unitBreakdown.length===0||
  intent.unitBreakdown.length>64)
  throw new TypeError('Invalid partial-return request identity or shape');
 const selected=new Map();
 for(const row of intent.unitBreakdown){
  if(!plain(row)||Object.keys(row).sort().join(',')!=='conversionId,qty'||
   !id(row.conversionId)||!positive(row.qty))
   throw new TypeError('Invalid or untrusted partial-return quantity');
  if(selected.has(row.conversionId))
   throw new TypeError('Invalid duplicate return unit');
  selected.set(row.conversionId,row.qty);
 }
 return selected;
}
function readOriginal(source){
 if(!plain(source))throw new TypeError('Invalid original Sales source snapshot');
 if(![source.tenantId,source.invoiceId,source.productId,source.stockUnit].every(id)||
  !HASH.test(source.sourceLineHash||'')||
  !positive(source.baseQty)||
  !nonnegative(source.activeReturnedBaseQty)||
  source.activeReturnedBaseQty>source.baseQty||
  !nonnegative(source.shortfallBaseQty)||
  typeof source.lineTotal!=='number'||!Number.isFinite(source.lineTotal)||
  source.lineTotal<0||!nonnegative(source.lineTotalPaisa)||
  !Number.isSafeInteger(Math.round((source.lineTotal+Number.EPSILON)*100))||
  Math.round((source.lineTotal+Number.EPSILON)*100)!==source.lineTotalPaisa)
  needsReview('invalid original money, identity or quantity');
 for(const name of ['unitBreakdownSnapshot','unitPricingSnapshot',
  'fifoDraws','consumptionRows']){
  if(!Array.isArray(source[name])||source[name].length===0||
   source[name].length>100)needsReview('missing '+name);
 }
 const units=new Map();
 let sum=0;
 for(const row of source.unitBreakdownSnapshot){
  trustedRow(row,UNIT_KEYS,'original units');
  if(!id(row.conversionId)||!id(row.unitName)||
   !positive(row.factor)||!positive(row.qty)||
   units.has(row.conversionId))needsReview('invalid original unit conversion');
  if(row.conversionId==='BASE'&&
   (row.factor!==1||row.unitName!==source.stockUnit))
   needsReview('invalid original BASE unit');
  const subtotal=row.factor*row.qty;
  if(!positive(subtotal))needsReview('original unit quantity overflow');
  sum=safeSum(sum,subtotal);
  units.set(row.conversionId,row);
 }
 if(sum!==source.baseQty||!units.has('BASE')||
  source.unitPricingSnapshot.length!==units.size)
  needsReview('original sale unit totals');
 for(let i=0;i<source.unitPricingSnapshot.length;i++){
  const row=source.unitPricingSnapshot[i];
  trustedRow(row,PRICE_KEYS,'original pricing');
  const old=source.unitBreakdownSnapshot[i];
  if(row.conversionId!==old.conversionId||row.factor!==old.factor||
   row.unitName!==old.unitName||row.qty!==old.qty||
   typeof row.unitPrice!=='number'||!Number.isFinite(row.unitPrice)||
   row.unitPrice<0)needsReview('original price snapshot mismatch');
 }
 const originalLots=new Map();
 let baseTotal=0;
 for(const row of source.fifoDraws){
  trustedRow(row,LOT_KEYS,'original FIFO allocation');
  if(!id(row.lotId)||!positive(row.baseQty)||originalLots.has(row.lotId))
   needsReview('duplicate/invalid original lot allocation');
  baseTotal=safeSum(baseTotal,row.baseQty);
  originalLots.set(row.lotId,row.baseQty);
 }
 if(baseTotal!==source.baseQty||
  source.consumptionRows.length!==originalLots.size)
  needsReview('missing original consumption-linked lot');
 let outstanding=0;
 const links=new Set(),rowIndices=new Set(),lotIds=new Set();
 for(const row of source.consumptionRows){
  trustedRow(row,CONSUMPTION_KEYS,'source consumption');
  if(row.invoiceId!==source.invoiceId||row.productId!==source.productId||
   !id(row.lotId)||!id(row.sourceLinkId)||!positive(row.rowIndex)||
   !nonnegative(row.remainingBaseQty)||
   !originalLots.has(row.lotId)||
   row.remainingBaseQty>originalLots.get(row.lotId)||
   links.has(row.sourceLinkId)||rowIndices.has(row.rowIndex)||
   lotIds.has(row.lotId))
   needsReview('missing, repeated or mismatched source consumption identity');
  outstanding=safeSum(outstanding,row.remainingBaseQty);
  links.add(row.sourceLinkId);
  rowIndices.add(row.rowIndex);
  lotIds.add(row.lotId);
 }
 if(outstanding!==source.baseQty-source.activeReturnedBaseQty)
  needsReview('outstanding source lot quantities do not reconcile with active returns');
 return {units,outstanding};
}
export function planHistoricalPartialUnitReturn(source,intent){
 // Validate intent first so forged client factors/lot IDs are never read.
 const selected=parseIntent(intent);
 const {units,outstanding}=readOriginal(source);
 if(source.tenantId!==intent.tenantId||source.invoiceId!==intent.invoiceId||
  source.productId!==intent.productId)
  throw new TypeError('Original source/return identity mismatch');
 if(source.shortageMode!=='Own'||source.shortfallBaseQty!==0)
  return decline('UNSUPPORTED_ORIGINAL_SHORTAGE_PROVENANCE');
 let quantity=0;
 const selectedUnits=[];
 for(const [conversionId,qty] of selected){
  const original=units.get(conversionId);
  if(!original)return decline('UNIT_NOT_IN_ORIGINAL_SALE');
  if(qty>original.qty)return decline('EXCEEDS_HISTORICAL_COMPONENT_QTY');
  const unitsBase=qty*original.factor;
  if(!positive(unitsBase))needsReview('unsafe return unit quantity');
  quantity=safeSum(quantity,unitsBase);
  selectedUnits.push(Object.freeze({
   conversionId,unitName:original.unitName,factor:original.factor,qty
  }));
 }
 if(quantity===source.baseQty)return decline('FULL_LINE_USE_B11');
 if(quantity>outstanding)return decline('EXCEEDS_OUTSTANDING_ORIGINAL_LOTS');
 let need=quantity;
 const draws=[];
 for(const row of [...source.consumptionRows].sort((a,b)=>b.rowIndex-a.rowIndex)){
  if(need<=0)break;
  const give=Math.min(need,row.remainingBaseQty);
  if(!give)continue;
  draws.push(Object.freeze({
   lotId:row.lotId,sourceLinkId:row.sourceLinkId,
   sourceRowIndex:row.rowIndex,baseQty:give
  }));
  need-=give;
 }
 if(need!==0)needsReview('unfilled original consumption plan');
 const data=Object.freeze({
  tenantId:source.tenantId,invoiceId:source.invoiceId,
  returnId:intent.returnId,productId:source.productId,
  stockUnit:source.stockUnit,requestedBaseQty:quantity,
  remainingSaleBaseQty:outstanding,
  activeReturnedBaseQty:source.activeReturnedBaseQty,
  historicalUnits:Object.freeze(selectedUnits),
  restoreOriginalLots:Object.freeze(draws),
  financialCalculationAuthorized:false,readOnly:true,commitAuthorized:false
 });
 return Object.freeze({status:'PLAN_ONLY',data});
}
