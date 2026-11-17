/**
 * M07-B18 — INTERNAL, READ-ONLY original Purchase Return correction evidence.
 *
 * Frozen Mohim_ERP PurchaseReturn.gs implements create/view only; it has NO
 * native Purchase Return edit/delete. This is NOT a migrated correction
 * endpoint, financial reversal, Cash Session authorization or idempotency
 * journal. M03/M04/M08 must independently verify and atomically reverse
 * original source effects if a future separately approved feature is built.
 */

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const CORRECTION=/^[A-Za-z0-9][A-Za-z0-9_.:-]{11,99}$/;
const SOURCE_KEYS='cashBook,purchaseId,purchaseLots,returnHeader,returnId,returnItems,sourceHash,stockMovements,supplierLedger,tenantId';
const INTENT_KEYS='correctionId,expectedSourceHash,mode,purchaseId,reason,returnId,tenantId';
const id=value=>typeof value==='string'&&ID.test(value);
const pos=value=>Number.isSafeInteger(value)&&value>0;
const nonneg=value=>Number.isSafeInteger(value)&&value>=0;
const review=message=>{throw new Error('NEEDS_REVIEW: '+message);};
const plain=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);
 return (proto===Object.prototype||proto===null)&&
  Object.values(Object.getOwnPropertyDescriptors(value))
   .every(d=>Object.hasOwn(d,'value'));
};
const deleted=row=>row?.['Is Deleted']===true||
 String(row?.['Is Deleted']??'').trim().toLowerCase()==='true';
function copied(value,depth=0){
 if(depth>16)review('excessively nested source');
 if(value===null||typeof value==='string'||typeof value==='boolean')
  return value;
 if(typeof value==='number'){
  if(!Number.isFinite(value))review('nonfinite original source');
  return value;
 }
 if(Array.isArray(value)){
  if(value.length>10000)review('oversized original source array');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors))
   if(typeof key!=='string'||(key!=='length'&&!/^(0|[1-9]\d*)$/.test(key)))
    review('unexpected original source array property');
  const out=[];
  for(let i=0;i<value.length;i++){
   const descriptor=descriptors[String(i)];
   if(!descriptor||!Object.hasOwn(descriptor,'value'))
    review('sparse or accessor-bearing source array');
   out.push(copied(descriptor.value,depth+1));
  }
  return out;
 }
 if(!plain(value))review('invalid or accessor-bearing source');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))
   review('unsafe source property');
  out[key]=copied(Object.getOwnPropertyDescriptor(value,key).value,depth+1);
 }
 return out;
}
function safeAdd(a,b){
 const n=a+b;
 if(!Number.isSafeInteger(n)||n<0)
  review('historical return quantity exceeds safe integer range');
 return n;
}
function paisa(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||
    !Number.isSafeInteger(Math.round(value*100))||
    Math.abs(value*100-Math.round(value*100))>0.00001)
  review('invalid original Return money evidence');
 return Math.round(value*100);
}
function sourceRows(rows,label,max=1000){
 if(!Array.isArray(rows)||rows.length>max||rows.some(row=>!plain(row)))
  review('invalid original '+label+' source');
}
function uniqueRow(index,seen,label){
 if(!pos(index)||seen.has(index))review('invalid/duplicate '+label+' row index');
 seen.add(index);
}
function moneyEvidence(source,headerPaisa,supplierId){
 const relatedCash=source.cashBook.filter(row=>row.Reference===source.returnId);
 const relatedLedger=source.supplierLedger.filter(row=>row.Reference===source.returnId);
 const method=source.returnHeader['Refund Method'];
 if(method==='Cash'){
  if(relatedCash.length!==1||relatedLedger.length)
   review('missing/duplicate/conflicting Cash refund source');
  const row=relatedCash[0];
  if(deleted(row)||row.Type!=='Purchase Return'||
     paisa(Number(row.Credit))!==headerPaisa||
     !(row.Debit===''||row.Debit===null||row.Debit===0)||
     !pos(row._rowIndex))
   review('incorrect original Cash refund evidence');
  return Object.freeze({kind:'Cash',sourceRowIndex:row._rowIndex});
 }
 if(method==='Supplier Credit'){
  if(relatedLedger.length!==1||relatedCash.length)
   review('missing/duplicate/conflicting Supplier Credit source');
  const row=relatedLedger[0];
  if(deleted(row)||row.Type!=='Purchase Return Credit'||
     row['Supplier ID']!==supplierId||
     paisa(Number(row.Credit))!==headerPaisa||
     !(row.Debit===''||row.Debit===null||row.Debit===0)||
     !pos(row._rowIndex))
   review('incorrect original Supplier Credit ledger evidence');
  return Object.freeze({kind:'Supplier Credit',sourceRowIndex:row._rowIndex});
 }
 review('unsupported original Purchase Return refund method');
}

/**
 * Inspect stable original source references only. PLAN_ONLY is not a posting
 * plan or safety proof against later source transactions and concurrent
 * retries; all of those belong inside the M03 SQL-atomic reversal boundary.
 */
export function reviewHistoricalPurchaseReturnCorrection(rawSource,rawIntent){
 const source=copied(rawSource),intent=copied(rawIntent);
 if(!plain(source)||Object.keys(source).sort().join(',')!==SOURCE_KEYS||
    !id(source.tenantId)||!id(source.purchaseId)||!id(source.returnId)||
    !HASH.test(source.sourceHash)||
    !plain(source.returnHeader))
  review('invalid original Purchase Return source shape');
 if(!plain(intent)||Object.keys(intent).sort().join(',')!==INTENT_KEYS||
    !id(intent.tenantId)||!id(intent.purchaseId)||!id(intent.returnId)||
    !CORRECTION.test(intent.correctionId)||
    !HASH.test(intent.expectedSourceHash)||
    !['Delete','Edit'].includes(intent.mode)||
    typeof intent.reason!=='string'||!intent.reason.trim()||
    intent.reason.trim().length>200)
  throw new TypeError('Invalid Purchase Return correction request shape');
 if(source.tenantId!==intent.tenantId||
    source.purchaseId!==intent.purchaseId||
    source.returnId!==intent.returnId)
  throw new TypeError('Invalid original Purchase Return tenant/source identity');
 if(source.sourceHash!==intent.expectedSourceHash)
  review('historical Return source hash mismatch');

 // Source has no native edit behavior; do not invent replacement semantics.
 if(intent.mode==='Edit')
  return Object.freeze({
   status:'DECLINED',reason:'NATIVE_PURCHASE_RETURN_EDIT_UNSUPPORTED'
  });

 const header=source.returnHeader;
 const supplierId=header['Supplier ID'];
 if(header['Return ID']!==source.returnId||
    header['Purchase ID']!==source.purchaseId||
    !id(supplierId)||!pos(header._rowIndex))
  review('original Return header Purchase/Supplier identity mismatch');
 if(deleted(header)||header['Reversal Operation ID']||
    header['Correction State'])
  review('original Purchase Return already deleted/corrected or needs reconciliation');
 const headerPaisa=paisa(header['Total Return Amount']);
 for(const [name,limit] of [
  ['returnItems',100],['stockMovements',500],
  ['purchaseLots',10000],['cashBook',10000],['supplierLedger',10000]
 ])sourceRows(source[name],name,limit);
 if(!source.returnItems.length||!source.stockMovements.length)
  review('missing original Return item/stock movement source');

 const itemIds=new Set(),itemRowIds=new Set();
 const quantities=new Map(),originalItemRefs=[];
 let totalPaisa=0,originalBaseQty=0;
 for(const row of source.returnItems){
  const productId=row['Product ID'],qty=row['Return Quantity'];
  if(deleted(row)||row['Return ID']!==source.returnId||
     row['Purchase ID']!==source.purchaseId||
     !id(productId)||!pos(qty)||itemIds.has(productId))
   review('invalid/duplicate original Purchase Return item source');
  uniqueRow(row._rowIndex,itemRowIds,'Purchase Return item');
  itemIds.add(productId);
  quantities.set(productId,qty);
  originalBaseQty=safeAdd(originalBaseQty,qty);
  totalPaisa=safeAdd(totalPaisa,paisa(row['Line Total']));
  originalItemRefs.push(row._rowIndex);
 }
 if(totalPaisa!==headerPaisa)
  review('historical Purchase Return header/line money mismatch');

 const lots=new Map(),lotIds=new Set(),lotRows=new Set();
 for(const lot of source.purchaseLots){
  if(!id(lot['Lot ID'])||!id(lot['Purchase ID'])||
     !id(lot['Product ID'])||lotIds.has(lot['Lot ID'])||
     !nonneg(lot['Original Quantity'])||
     !nonneg(lot['Remaining Quantity'])||
     lot['Remaining Quantity']>lot['Original Quantity'])
   review('invalid/duplicate original Purchase lot source');
  uniqueRow(lot._rowIndex,lotRows,'Purchase lot');
  lotIds.add(lot['Lot ID']);
  lots.set(lot['Lot ID'],lot);
 }

 const movementIds=new Set(),movementRows=new Set(),usedLots=new Set();
 const movementsByProduct=new Map(),stockMovementRefs=[],restorations=[];
 for(const row of source.stockMovements){
  const productId=row['Product ID'],lotId=row['Lot ID'];
  const qty=row['Quantity Out'];
  if(!id(row['Movement ID'])||movementIds.has(row['Movement ID'])||
     row.Type!=='Purchase Return'||row.Reference!==source.returnId||
     !id(productId)||!itemIds.has(productId)||
     !id(lotId)||usedLots.has(lotId)||!pos(qty)||
     !(row['Quantity In']===''||row['Quantity In']===null||row['Quantity In']===0))
   review('invalid/duplicate original Purchase Return stock movement');
  uniqueRow(row._rowIndex,movementRows,'Return Stock Movement');
  movementIds.add(row['Movement ID']);usedLots.add(lotId);
  const lot=lots.get(lotId);
  if(!lot||deleted(lot)||lot['Purchase ID']!==source.purchaseId||
     lot['Product ID']!==productId||lot['Supplier ID']!==supplierId)
   review('unverified original source-Purchase lot ownership');
  const restored=safeAdd(lot['Remaining Quantity'],qty);
  if(restored>lot['Original Quantity'])
   review('original Purchase lot cannot safely restore returned quantity');
  movementsByProduct.set(productId,safeAdd(movementsByProduct.get(productId)||0,qty));
  stockMovementRefs.push(row._rowIndex);
  restorations.push(Object.freeze({
   productId,lotId,sourceRowIndex:lot._rowIndex,
   baseQty:qty,remainingAfterRestore:restored
  }));
 }
 if(movementsByProduct.size!==quantities.size)
  review('original Return movement/product count mismatch');
 for(const [productId,qty] of quantities)
  if(movementsByProduct.get(productId)!==qty)
   review('original Return movement/base-quantity mismatch');
 const evidence=moneyEvidence(source,headerPaisa,supplierId);
 return Object.freeze({status:'PLAN_ONLY',data:Object.freeze({
  tenantId:source.tenantId,purchaseId:source.purchaseId,
  returnId:source.returnId,correctionId:intent.correctionId,
  sourceHash:source.sourceHash,originalReturnRowIndex:header._rowIndex,
  originalBaseQty,
  restoreOriginalLots:Object.freeze(restorations),
  stockMovementRowIndices:Object.freeze(stockMovementRefs),
  returnItemRowIndices:Object.freeze(originalItemRefs),
  financialEvidence:evidence,
  nativeMutationAvailable:false,readOnly:true,commitAuthorized:false,
  financialCalculationAuthorized:false,replayResolved:false,
  accountingReconciled:false
 })});
}
