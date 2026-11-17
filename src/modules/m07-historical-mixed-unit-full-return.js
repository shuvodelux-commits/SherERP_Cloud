/**
 * M07-B11 INTERNAL READ-ONLY: one *full* historical multi-unit Sales Return.
 *
 * Reads the frozen sale-time M06 line facts. Current conversion catalogs,
 * prices or FIFO stock must never be used to rewrite a prior sale. A future
 * M03/M04 authorized D1 writer must revalidate every source ID, Cash Session,
 * lot, financial ledger and return concurrency condition atomically.
 *
 * Original source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Approved units: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 * No D1, posting, RPC, stock or financial mutation.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[0-9a-f]{64}$/;
const INTENT_FIELDS='invoiceId,productId,returnId,tenantId,unitBreakdown';

function plainData(value){
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 if(proto!==Object.prototype&&proto!==null)return false;
 return Object.values(Object.getOwnPropertyDescriptors(value))
  .every(x=>Object.hasOwn(x,'value'));
}
const validId=x=>typeof x==='string'&&ID.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const mismatch=()=>{throw new Error('NEEDS_REVIEW: historical unit, price or source evidence mismatch.');};
const decline=reason=>Object.freeze({status:'DECLINED',reason});
function sumSafe(total,delta){
 const result=total+delta;
 if(!Number.isSafeInteger(result))mismatch();
 return result;
}
function safeRow(row,fields,name){
 if(!plainData(row)||Object.keys(row).sort().join(',')!==fields)
  throw new TypeError('NEEDS_REVIEW: invalid historical '+name+' snapshot.');
}
function validateIntent(intent){
 if(!plainData(intent)||
  Object.keys(intent).sort().join(',')!==INTENT_FIELDS||
  ![intent.tenantId,intent.invoiceId,intent.returnId,intent.productId].every(validId)||
  !Array.isArray(intent.unitBreakdown)||intent.unitBreakdown.length===0||
  intent.unitBreakdown.length>64)
  throw new TypeError('Invalid historical full-return request identity or shape.');
 const requested=new Map();
 for(const part of intent.unitBreakdown){
  if(!plainData(part)||Object.keys(part).sort().join(',')!=='conversionId,qty'||
   !validId(part.conversionId)||!positive(part.qty))
   throw new TypeError('Invalid or untrusted historical return unit quantity.');
  if(requested.has(part.conversionId))
   throw new TypeError('Invalid duplicate return unit conversion ID.');
  requested.set(part.conversionId,part.qty);
 }
 return requested;
}
function trustedSale(source){
 if(!plainData(source))throw new TypeError('Invalid trusted historical Sales source.');
 if(![source.tenantId,source.invoiceId,source.productId,source.stockUnit].every(validId)||
  typeof source.sourceLineHash!=='string'||!HASH.test(source.sourceLineHash)||
  !positive(source.baseQty)||!nonnegative(source.activeReturnedBaseQty)||
  source.activeReturnedBaseQty>source.baseQty||
  !nonnegative(source.shortfallBaseQty)||
  typeof source.lineTotal!=='number'||!Number.isFinite(source.lineTotal)||
  source.lineTotal<0||!nonnegative(source.lineTotalPaisa)||
  !Number.isSafeInteger(Math.round((source.lineTotal+Number.EPSILON)*100))||
  Math.round((source.lineTotal+Number.EPSILON)*100)!==source.lineTotalPaisa)
  mismatch();
 for(const name of ['unitBreakdownSnapshot','unitPricingSnapshot','fifoDraws']){
  if(!Array.isArray(source[name])||source[name].length===0||
   source[name].length>64)mismatch();
 }
 if(source.unitBreakdownSnapshot.length!==source.unitPricingSnapshot.length)mismatch();
 const components=new Map();
 let baseQty=0;
 for(const entry of source.unitBreakdownSnapshot){
  safeRow(entry,'conversionId,factor,qty,unitName','unit breakdown');
  if(!validId(entry.conversionId)||!validId(entry.unitName)||
   !positive(entry.factor)||!positive(entry.qty)||
   components.has(entry.conversionId))mismatch();
  if(entry.conversionId==='BASE'&&
   (entry.factor!==1||entry.unitName!==source.stockUnit))mismatch();
  const componentBase=entry.factor*entry.qty;
  if(!positive(componentBase))mismatch();
  baseQty=sumSafe(baseQty,componentBase);
  components.set(entry.conversionId,entry);
 }
 if(!components.has('BASE')||baseQty!==source.baseQty)mismatch();
 for(let i=0;i<source.unitPricingSnapshot.length;i++){
  const p=source.unitPricingSnapshot[i];
  safeRow(p,'conversionId,factor,qty,unitName,unitPrice','unit price');
  const q=source.unitBreakdownSnapshot[i];
  if(p.conversionId!==q.conversionId||p.factor!==q.factor||
   p.unitName!==q.unitName||p.qty!==q.qty||
   typeof p.unitPrice!=='number'||!Number.isFinite(p.unitPrice)||p.unitPrice<0)
   mismatch();
 }
 let totalDrawn=0;
 const lots=new Set();
 for(const draw of source.fifoDraws){
  safeRow(draw,'baseQty,lotId','FIFO lot');
  if(!validId(draw.lotId)||!positive(draw.baseQty)||lots.has(draw.lotId))
   mismatch();
  lots.add(draw.lotId);
  totalDrawn=sumSafe(totalDrawn,draw.baseQty);
 }
 if(totalDrawn!==source.baseQty)mismatch();
 return components;
}

/**
 * A preview of original full-line recovery only, NEVER posting permission.
 * Partial return requires original component-to-lot evidence not present in
 * the merged M06 display plan. This conservative slice declines that case.
 */
export function planHistoricalMixedUnitFullReturn(source,intent){
 const requested=validateIntent(intent);
 const components=trustedSale(source);
 if(source.tenantId!==intent.tenantId||
    source.invoiceId!==intent.invoiceId||
    source.productId!==intent.productId)
  throw new Error('Historical source identity mismatch: tenant/invoice/product.');
 if(source.shortageMode!=='Own'||source.shortfallBaseQty!==0)
  return decline('UNSUPPORTED_ORIGINAL_SHORTAGE_PROVENANCE');
 if(source.activeReturnedBaseQty>0)
  return decline('ACTIVE_RETURN_ALREADY_EXISTS');
 if(requested.size!==components.size||
  [...components].some(([id,row])=>requested.get(id)!==row.qty))
  return decline('PARTIAL_REQUIRES_ORIGINAL_COMPONENT_LOT_PROVENANCE');
 const units=Object.freeze(source.unitBreakdownSnapshot.map(row=>
  Object.freeze({...row})));
 const prices=Object.freeze(source.unitPricingSnapshot.map(row=>
  Object.freeze({...row})));
 const draws=Object.freeze(source.fifoDraws.map(row=>
  Object.freeze({...row})));
 const data=Object.freeze({
  tenantId:source.tenantId,invoiceId:source.invoiceId,
  returnId:intent.returnId,productId:source.productId,
  stockUnit:source.stockUnit,baseQty:source.baseQty,
  refundCeilingPaisa:source.lineTotalPaisa,
  historicalUnits:units,historicalUnitPrices:prices,
  restoreOriginalLots:draws,readOnly:true,commitAuthorized:false
 });
 return Object.freeze({status:'PLAN_ONLY',data});
}
