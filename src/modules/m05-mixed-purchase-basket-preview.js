/**
 * M05 INTERNAL READ-ONLY mixed ordinary/multi-unit and Tiles purchase quote.
 *
 * Composition only: original source purchase/supplier semantics with approved
 * optional unit conversions, plus current revision exact D1 Tiles quotation.
 * This is NOT a source-ID issuer, stock reservation, supplier journal, Bank
 * payment, Cash Session check, M04 actor authorization or a public RPC.
 *
 * Frozen original: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Optional approved: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 * All source snapshots supplied here require M03/M02/M04 revalidation within
 * the future SQL-atomic stock/supplier payment boundary, not before it alone.
 */
import {prepareMultiUnitPurchasePaymentPreflight} from './m05-multi-unit-purchase-payment.js';
import {auditMultiUnitPurchaseSnapshot} from './m05-purchase-unit-snapshot-conservation.js';
import {previewTilePurchaseBasketD1} from './m05-tile-purchase-basket-preview.js';

const MAX_MINOR=BigInt(Number.MAX_SAFE_INTEGER);
const MINOR_PATTERN=/^(?:0|[1-9][0-9]*)$/u;
const ITEM_FIELDS=['productId','name','qty','unitPrice','sellingPrice','unitBreakdown'];
const COMPONENT_FIELDS=['conversionId','qty','factor','unitPrice','unitName','sellingPrice'];
const REQUEST_FIELDS=['mode','boxes','extraPieces','requestedSqft','fulfillment'];

function record(value,allowed,required,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid mixed purchase '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!allowed.includes(key)||!d.enumerable||
       !Object.hasOwn(d,'value'))
      throw new TypeError('Unsupported mixed purchase '+label+' field or accessor');
  }
  for(const key of required)
    if(!Object.hasOwn(value,key))
      throw new TypeError('Missing mixed purchase '+label+' field: '+key);
  return value;
}
function identity(value,label){
  if(typeof value!=='string'||value.trim()!==value||value.length===0||
     value.length>256||/[\u0000-\u001f\u007f]/u.test(value))
    throw new TypeError('Invalid original '+label+' identity');
  return value;
}
function array(value,label,min=0,max=1000){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
     value.length<min||value.length>max)
    throw new TypeError('Invalid '+label+' array length');
  const props=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(props)){
    if(key==='length')continue;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/u.test(key)||
       Number(key)>=value.length||!Object.hasOwn(props[key],'value'))
      throw new TypeError('Invalid '+label+' array or accessor');
  }
  for(let i=0;i<value.length;i++)
    if(!Object.hasOwn(props,String(i)))
      throw new TypeError('Sparse '+label+' array');
  return value;
}
function trustedRows(rows,label){
  for(const row of array(rows,label,0,10000)){
    if(row===null||typeof row!=='object'||Array.isArray(row)||
       ![Object.prototype,null].includes(Object.getPrototypeOf(row))||
       Reflect.ownKeys(row).some(key=>{
         const d=Object.getOwnPropertyDescriptor(row,key);
         return typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value');
       }))
      throw new TypeError('Invalid trusted '+label+' row or accessor');
  }
}
function minor(value,label){
  if(typeof value!=='string'||!MINOR_PATTERN.test(value))
    throw new TypeError('Invalid canonical integer paisa '+label+' minor amount');
  const n=BigInt(value);
  if(n>MAX_MINOR)
    throw new RangeError('Mixed purchase '+label+' minor amount exceeds safe integer paisa');
  return n;
}
function sourceMinor(value,label){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)
    throw new Error('NEEDS_REVIEW: invalid source '+label+' monetary value');
  const cents=Math.round((value+Number.EPSILON)*100);
  if(!Number.isSafeInteger(cents)||Math.abs(value-cents/100)>0.0000001)
    throw new Error('NEEDS_REVIEW: source '+label+' not representable as cent-safe integer paisa');
  return BigInt(cents);
}
function add(a,b,label){
  const sum=a+b;
  if(sum>MAX_MINOR)throw new RangeError('Mixed purchase '+label+' minor total exceeds safe integer paisa');
  return sum;
}

function validatedInputs(options){
  record(options,['DB','standard','tileLines','discountMinorText','paidMinorText'],
    ['DB','standard','tileLines'],'options');
  const standard=record(options.standard,['payload','products','suppliers','conversionRows'],
    ['payload','products','suppliers','conversionRows'],'standard');
  const payload=record(standard.payload,['supplierId','items'],
    ['supplierId','items'],'payload');
  identity(payload.supplierId,'Supplier ID');
  const incoming=array(payload.items,'original purchase items',1,100);
  const ids=new Set();
  for(const item of incoming){
    record(item,ITEM_FIELDS,['productId'],'source item');
    const productId=identity(item.productId,'Product ID');
    if(ids.has(productId))throw new TypeError('Duplicate mixed purchase Product ID: '+productId);
    ids.add(productId);
    if(Object.hasOwn(item,'unitBreakdown')&&item.unitBreakdown!==null&&
       item.unitBreakdown!==undefined){
      for(const part of array(item.unitBreakdown,'unit breakdown',0,100))
        record(part,COMPONENT_FIELDS,['conversionId','qty'],'unit component');
    }
  }
  const tileLines=array(options.tileLines,'tile lines',1,100);
  for(const tile of tileLines){
    record(tile,['productId','request'],['productId','request'],'Tile line');
    const productId=identity(tile.productId,'Product ID');
    if(ids.has(productId))throw new TypeError('Duplicate mixed purchase Product ID: '+productId);
    ids.add(productId);
    record(tile.request,REQUEST_FIELDS,['mode'],'Tile request');
  }
  trustedRows(standard.products,'products');
  trustedRows(standard.suppliers,'suppliers');
  trustedRows(standard.conversionRows,'conversion');
  const discount=minor(Object.hasOwn(options,'discountMinorText')?
    options.discountMinorText:'0','discount');
  const paid=minor(Object.hasOwn(options,'paidMinorText')?
    options.paidMinorText:'0','paid');
  return {standard,payload,discount,paid,tileLines};
}

/**
 * G1 candidate only. Never pass this result unverified to a posting kernel.
 * M03 must re-read source/Party links, all product revisions and real actor
 * authority, then post in one transaction with Cash Session and replay gates.
 */
export async function previewMixedPurchaseBasketD1(options){
  const {standard,payload,discount,paid,tileLines}=validatedInputs(options);

  // Preserve source validation and source's editable legacy single-unit
  // purchase price; exclude all payment/discount effects from this subtotal.
  const src=prepareMultiUnitPurchasePaymentPreflight(
    {...payload,discount:0,paidAmount:0},
    {products:standard.products,suppliers:standard.suppliers,
     conversionRows:standard.conversionRows,bankAccounts:[]}
  );
  const conservation=auditMultiUnitPurchaseSnapshot(src);
  if(!conservation.ready)
    throw new Error('NEEDS_REVIEW: mixed purchase source quantity/pricing snapshots do not conserve');
  if(src.supplierId!==payload.supplierId||src.paidAmount!==0||
     src.discount!==0||src.dueAmount!==src.grandTotal)
    throw new Error('NEEDS_REVIEW: source purchase financial preview was not isolated');

  const lookup=new Map(standard.products.map(p=>[p['Product ID'],p]));
  let standardTotal=0n;
  const standardLines=[];
  for(const line of src.lines){
    const withUnits=Object.hasOwn(line,'unit');
    const amount=sourceMinor(withUnits?line.unit.lineTotal:line.qty*line.price,
      'purchase line');
    standardTotal=add(standardTotal,amount,'ordinary source');
    const sourceProduct=lookup.get(line.productId);
    if(!sourceProduct)throw new Error('NEEDS_REVIEW: missing original product snapshot');
    standardLines.push({
      productId:line.productId,name:line.name,baseQty:line.qty,
      baseUnit:withUnits?line.unit.stockUnit:sourceProduct.Unit,
      lineAmountMinor:String(amount),
      editableLegacyPrice:!withUnits,
      ...(withUnits?{
        unitSnapshot:line.unit.unitSnapshot,
        pricingSnapshot:line.unit.pricingSnapshot
      }:{}),
      postingAllowed:false
    });
  }
  if(standardTotal!==sourceMinor(src.subtotal,'purchase subtotal'))
    throw new Error('NEEDS_REVIEW: original source invoice subtotal mismatches integer-paisa lines');

  // This is only an existing M03 read-only catalog candidate: no stock,
  // Supplier/Party, actor, Cash Session, Bank or operation authority here.
  const tiles=await previewTilePurchaseBasketD1({DB:options.DB,lines:tileLines});
  if(tiles?.postingAllowed!==false||tiles?.supplierReviewRequired!==true||
     tiles?.stockAuthority!=='not-loaded')
    throw new Error('NEEDS_REVIEW: Tiles candidate does not remain read-only');

  const tileTotal=minor(tiles.totals.subtotalMinor,'tile subtotal');
  const subtotal=add(standardTotal,tileTotal,'combined');
  const applied=discount>subtotal?subtotal:discount;
  const grand=subtotal-applied;
  const settled=paid>grand?grand:paid;
  const due=grand-settled;
  return {
    mode:'read-only-mixed-purchase-basket-preview',
    currency:'BDT',
    sourceSupplierId:src.supplierId,
    sourceSupplierName:src.supplierName,
    standardLines,tileLines:tiles.lines,
    totals:{
      subtotalMinor:String(subtotal),
      requestedDiscountMinor:String(discount),
      appliedDiscountMinor:String(applied),
      grandTotalMinor:String(grand),
      paidMinor:String(settled),
      dueMinor:String(due),
      paymentStatus:due===0n?'Paid':settled>0n?'Partial':'Due'
    },
    sourceCatalogAuthority:'snapshot-only',
    tileStockAuthority:'not-loaded',
    supplierReviewRequired:true,
    paymentReviewRequired:true,
    postingAllowed:false
  };
}
