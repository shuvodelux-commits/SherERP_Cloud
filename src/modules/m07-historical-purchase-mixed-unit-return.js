/**
 * M07-B15: INTERNAL ONLY read-only historical mixed-unit Purchase Return.
 *
 * Historical unit/factor/price snapshots are supplied by the M05-approved
 * original Purchase preflight (not present-day product catalog). Physical
 * quantities may be returned ONLY out of purchase-owned lots; the original
 * M07 planner's legacy fallback is intentionally ineligible here.
 *
 * No SQL, RPC, ledger, Cash/Bank/Supplier credit, return posting, source
 * modification or refund derivation from rounded original unit costs.
 * M03 must revalidate source ownership, stock CAS, Cash Session, idempotent
 * atomic stock+finance and M04 authority before any real transaction.
 */
import {auditMultiUnitPurchaseSnapshot}
 from './m05-purchase-unit-snapshot-conservation.js';
import {planPurchaseReturnLots} from './purchase-return-lot-plan.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const INTENT_KEYS='productId,purchaseId,returnId,tenantId,unitBreakdown';
const validId=value=>typeof value==='string'&&ID.test(value);
const validPos=value=>Number.isSafeInteger(value)&&value>0;
const validNonNeg=value=>Number.isSafeInteger(value)&&value>=0;
const fail=msg=>{throw new Error('NEEDS_REVIEW: '+msg);};
function plain(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 return (proto===Object.prototype||proto===null) &&
  Object.values(Object.getOwnPropertyDescriptors(value))
   .every(d=>Object.hasOwn(d,'value'));
}
function add(a,b){
 const result=a+b;
 if(!Number.isSafeInteger(result))fail('unsafe source quantity');
 return result;
}
function readIntent(intent){
 if(!plain(intent)||
  Object.keys(intent).sort().join(',')!==INTENT_KEYS||
  ![intent.tenantId,intent.purchaseId,intent.productId,intent.returnId].every(validId)||
  !Array.isArray(intent.unitBreakdown)||intent.unitBreakdown.length===0||
  intent.unitBreakdown.length>64)
  throw new TypeError('Invalid historical Purchase Return request shape');
 const selected=[];
 const seen=new Set();
 for(const row of intent.unitBreakdown){
  if(!plain(row)||Object.keys(row).sort().join(',')!=='conversionId,qty'||
    !validId(row.conversionId)||!validPos(row.qty)||
    seen.has(row.conversionId))
   throw new TypeError('Invalid duplicate/untrusted Purchase Return unit quantity');
  seen.add(row.conversionId);
  selected.push(row);
 }
 return selected;
}
function sourceReview(source){
 if(!plain(source)||!plain(source.line)||
  ![source.tenantId,source.purchaseId,source.productId,source.supplierId].every(validId)||
  typeof source.sourceHash!=='string'||!HASH.test(source.sourceHash)||
  !validNonNeg(source.originalLineTotalPaisa)||
  !validNonNeg(source.alreadyReturnedBaseQty)||
  !validPos(source.line.qty)||
  source.line.productId!==source.productId||
  source.alreadyReturnedBaseQty>source.line.qty||
  !plain(source.line.unit))
  fail('invalid original Purchase line identity or historical unit evidence');
 const line=source.line,unit=line.unit;
 if(!validId(unit.stockUnit)||
  !Array.isArray(unit.unitSnapshot)||unit.unitSnapshot.length===0||
  !Array.isArray(unit.pricingSnapshot)||
  unit.pricingSnapshot.length!==unit.unitSnapshot.length)
  fail('missing historical Purchase unit/price snapshots');
 const review=auditMultiUnitPurchaseSnapshot({
  lines:[line],subtotal:unit.lineTotal
 });
 if(!review.ready)fail('original Purchase unit/price snapshot does not conserve');
 const exactPaisa=Math.round((unit.lineTotal+Number.EPSILON)*100);
 if(!validNonNeg(exactPaisa)||
  exactPaisa!==source.originalLineTotalPaisa)
  fail('original Purchase money mismatch');
 const unitMap=new Map();
 for(const row of unit.unitSnapshot){
  if(!plain(row)||!validId(row.conversionId)||!validId(row.unitName)||
    !validPos(row.factor)||!validPos(row.qty)||
    unitMap.has(row.conversionId))
   fail('invalid original Purchase conversion snapshot');
  if(row.conversionId==='BASE'&&
   (row.factor!==1||row.unitName!==unit.stockUnit))
   fail('invalid historical Purchase base unit');
  const portion=row.factor*row.qty;
  if(!validPos(portion))fail('unsafe historical Purchase base quantity');
  unitMap.set(row.conversionId,row);
 }
 if(!unitMap.has('BASE'))fail('missing historical Purchase BASE unit');
 if(!Array.isArray(source.lots)||source.lots.length>10000)
  fail('invalid original Purchase lot list');
 const ids=new Set(),indices=new Set();
 let originalOwnedQty=0,ownedLots=0;
 for(const lot of source.lots){
  if(!plain(lot)||!validId(lot['Lot ID'])||
   !validId(lot['Purchase ID'])||!validId(lot['Product ID'])||
   !validPos(lot._rowIndex)||
   !Number.isFinite(lot['Purchase Price'])||
   lot['Purchase Price']<0||
   !validNonNeg(lot['Original Quantity'])||
   !validNonNeg(lot['Remaining Quantity'])||
   lot['Remaining Quantity']>lot['Original Quantity']||
   ids.has(lot['Lot ID'])||indices.has(lot._rowIndex))
   fail('missing/duplicate/invalid original Purchase lot source');
  ids.add(lot['Lot ID']);indices.add(lot._rowIndex);
  if(lot['Purchase ID']!==source.purchaseId)continue;
  if(lot['Product ID']!==source.productId||
    !validPos(lot['Original Quantity'])||
    lot['Supplier ID']!==source.supplierId)
   fail('mismatched original Purchase product, Supplier or lot');
  originalOwnedQty=add(originalOwnedQty,lot['Original Quantity']);
  ownedLots++;
 }
 if(ownedLots && originalOwnedQty!==line.qty)
  fail('original Purchase lot quantities do not match historical Purchase');
 return {unitMap,ownedLots};
}
const decline=reason=>Object.freeze({status:'DECLINED',reason});

/**
 * Proposes only a source-Purchase-bound physical lot decrease. Never infer
 * Supplier Credit/Cash refund from purchase unit prices: original invoice
 * discount, paid amount and later source transactions must be reconciled.
 */
export function planHistoricalMixedUnitPurchaseReturn(source,intent){
 const selected=readIntent(intent);
 const {unitMap,ownedLots}=sourceReview(source);
 if(source.tenantId!==intent.tenantId||
    source.purchaseId!==intent.purchaseId||
    source.productId!==intent.productId)
  throw new TypeError('Original Purchase Return identity mismatch');
 if(!ownedLots)return decline('UNVERIFIED_LEGACY_PURCHASE_LOT_ORIGIN');
 let qty=0;
 const units=[];
 for(const part of selected){
  const original=unitMap.get(part.conversionId);
  if(!original)return decline('UNIT_NOT_IN_HISTORICAL_PURCHASE');
  if(part.qty>original.qty)return decline('EXCEEDS_HISTORICAL_UNIT_QTY');
  const quantity=part.qty*original.factor;
  if(!validPos(quantity))fail('historical purchase return quantity overflow');
  qty=add(qty,quantity);
  units.push(Object.freeze({
   conversionId:original.conversionId,unitName:original.unitName,
   factor:original.factor,qty:part.qty
  }));
 }
 if(qty>source.line.qty-source.alreadyReturnedBaseQty)
  return decline('EXCEEDS_ORIGINAL_PURCHASE_REMAINING_QTY');
 // Never use the original legacy fallback when purchase-owned rows are
 // absent or exhausted: doing so would consume somebody else's purchase.
 const ownAvailable=source.lots.filter(l=>
   l['Purchase ID']===source.purchaseId&&l['Product ID']===source.productId)
   .reduce((a,l)=>add(a,l['Remaining Quantity']),0);
 if(qty>ownAvailable)
  return decline('INSUFFICIENT_ORIGINAL_PURCHASE_LOT_STOCK');
 const planned=planPurchaseReturnLots({
  purchaseId:source.purchaseId,productId:source.productId,
  qty,lots:source.lots
 });
 if(planned.legacyFallback||!Array.isArray(planned.draws)||
  planned.draws.reduce((a,l)=>add(a,l.take),0)!==qty)
  fail('unverified original purchase lot FIFO preflight');
 // Only expose immutable original lot IDs, row references and quantities.
 // Keep unitCost, supplier/master or lot selling price out of the response.
 const draws=Object.freeze(planned.draws.map(l=>Object.freeze({
  lotId:l.lotId,sourceRowIndex:l.rowIndex,
  baseQty:l.take,remainingAfter:l.remainingAfter
 })));
 const data=Object.freeze({
  tenantId:source.tenantId,purchaseId:source.purchaseId,
  productId:source.productId,returnId:intent.returnId,
  requestedBaseQty:qty,historicalUnits:Object.freeze(units),
  sourcePurchaseLots:draws,
  readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false
 });
 return Object.freeze({status:'PLAN_ONLY',data});
}
