/**
 * M05 PRIVATE read-only Tiles purchase basket quote.
 *
 * Reuses the reviewed current-D1 Tile purchase-line preview for each original
 * Product ID. Exact per-line minor amounts are summed, never recomputed from
 * rounded Sqft/Box display quantities. This is NOT a purchase, stock check,
 * cashier authorization, Supplier/Party account lookup, or posting interface.
 *
 * Sources: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * and approved sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 * M03/M04 must re-read and authorize price, revision, stock, supplier, actor,
 * Cash Session and operation receipt inside the actual D1 write boundary.
 */
import {previewTilePurchaseLineCandidateD1} from './m05-tile-purchase-line-preview.js';

const MAX_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_MINOR=/^(?:0|[1-9][0-9]*)$/u;
const REQUEST_KEYS=['mode','boxes','extraPieces','requestedSqft','fulfillment'];

function record(value,allowed,required,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid tile basket '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!allowed.includes(key)||!descriptor.enumerable||
        !Object.hasOwn(descriptor,'value'))
      throw new TypeError('Unsupported tile basket '+label+' input or accessor');
  }
  for(const key of required)
    if(!Object.hasOwn(value,key))
      throw new TypeError('Missing tile basket '+label+' field: '+key);
}

function linesArray(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
      value.length<1||value.length>100)
    throw new TypeError('Explicit nonempty tile basket lines array required');
  const props=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(props)){
    if(key==='length')continue;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/u.test(key)||
        Number(key)>=value.length||!Object.hasOwn(props[key],'value'))
      throw new TypeError('Invalid tile basket lines array or accessor');
  }
  for(let i=0;i<value.length;i++)
    if(!Object.hasOwn(props,String(i)))
      throw new TypeError('Sparse tile basket lines array is invalid');
  return value;
}

function identity(value){
  if(typeof value!=='string'||!value||value!==value.trim()||
      value.length>256||/[\u0000-\u001f\u007f]/u.test(value))
    throw new TypeError('Invalid tile basket original Product ID');
  return value;
}

function minor(value,label){
  if(typeof value!=='string'||!CANONICAL_MINOR.test(value))
    throw new TypeError('Invalid canonical integer paisa '+label+' minor amount');
  const parsed=BigInt(value);
  if(parsed>MAX_MINOR)
    throw new RangeError('Tile basket '+label+' minor amount exceeds safe integer paisa range');
  return parsed;
}

const review=()=>new Error('NEEDS_REVIEW: tile basket current catalog or purchase quote unavailable');

/**
 * Input is request-only; price, dimensions and revision are resolved by the
 * existing M03 D1 reader. No Supplier or Cash Session authority is loaded.
 */
export async function previewTilePurchaseBasketD1(options){
  record(options,['DB','lines','discountMinorText','paidMinorText'],
    ['DB','lines'],'options');
  const {DB}=options;
  if(DB===null||typeof DB!=='object'||typeof DB.prepare!=='function')
    throw new TypeError('Tile basket D1 read binding unavailable');
  const discount=minor(Object.hasOwn(options,'discountMinorText')?
    options.discountMinorText:'0','discount');
  const paidRequested=minor(Object.hasOwn(options,'paidMinorText')?
    options.paidMinorText:'0','paid');

  // Validate the entire untrusted request before performing any catalog read.
  const incoming=linesArray(options.lines);
  const seen=new Set(),requested=[];
  for(const raw of incoming){
    record(raw,['productId','request'],['productId','request'],'line');
    const productId=identity(raw.productId);
    if(seen.has(productId))
      throw new TypeError('Duplicate tile basket Product ID: '+productId);
    seen.add(productId);
    record(raw.request,REQUEST_KEYS,['mode'],'request');
    requested.push({productId,request:Object.freeze({...raw.request})});
  }

  let subtotal=0n;
  const quoted=[];
  for(const line of requested){
    // Always force current revision; a caller cannot select a historical price.
    const candidate=await previewTilePurchaseLineCandidateD1({
      DB,productId:line.productId,request:line.request
    });
    if(candidate===null)throw review();
    const catalog=candidate.catalog,qty=candidate.quantity,quote=candidate.purchasePreview;
    if(candidate.isCurrent!==true||catalog?.productId!==line.productId||
        catalog.stockAuthority!=='not-loaded'||
        catalog.unitConfig?.revision!==catalog.currentUnitRevision||
        !Number.isSafeInteger(catalog.recordVersion)||catalog.recordVersion<0||
        quote?.postingAllowed!==false||quote.receivedPcs!==qty?.pieces||
        qty?.measurementSnapshot?.productId!==line.productId||
        qty.measurementSnapshot.revision!==String(catalog.currentUnitRevision))
      throw review();

    const amount=minor(quote.lineAmountMinor,'line');
    subtotal+=amount;
    if(subtotal>MAX_MINOR)
      throw new RangeError('Tile basket subtotal exceeds safe integer paisa range');

    quoted.push({
      productId:line.productId,
      revision:qty.measurementSnapshot.revision,
      productRecordVersion:catalog.recordVersion,
      sourceEvidenceRef:candidate.evidence.sourceEvidenceRef,
      receivedPcs:qty.pieces,
      boxes:qty.boxes,extraPieces:qty.extraPieces,
      nominalSqft:qty.nominalSqft,actualSqft:qty.actualSqft,
      displaySqft:qty.displaySqft,
      requestSnapshot:qty.requestSnapshot,
      measurementSnapshot:qty.measurementSnapshot,
      unitSnapshot:qty.unitSnapshot,
      pricingUnit:quote.pricingUnit,unitPriceText:quote.unitPriceText,
      billingQuantity:quote.billingQuantity,
      exactAmount:quote.exactAmount,
      lineAmountMinor:quote.lineAmountMinor,
      priceSnapshot:quote.priceSnapshot,
      postingAllowed:false
    });
  }

  // Preserve Purchase.gs clamp semantics without turning preview into money.
  const applied=discount>subtotal?subtotal:discount;
  const grand=subtotal-applied;
  const paid=paidRequested>grand?grand:paidRequested;
  const due=grand-paid;
  return {
    mode:'read-only-tile-basket-preview',currency:'BDT',
    lines:quoted,
    totals:{
      subtotalMinor:String(subtotal),
      requestedDiscountMinor:String(discount),
      appliedDiscountMinor:String(applied),
      grandTotalMinor:String(grand),
      paidMinor:String(paid),dueMinor:String(due),
      paymentStatus:due===0n?'Paid':paid>0n?'Partial':'Due'
    },
    supplierReviewRequired:true,
    stockAuthority:'not-loaded',
    postingAllowed:false
  };
}
