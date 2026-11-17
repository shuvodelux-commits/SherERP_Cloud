/**
 * M06 private READ-ONLY Tiles POS sale-line quote.
 *
 * Reuses the existing M03 D1 revision candidate and M02 exact rational
 * Box/Pcs/Sqft quantity/price helper. This is not the trusted stock,
 * Cash Session, actor, invoice, Party or payment posting boundary.
 * M03 owns all future SQL-atomic writers and public auth integration.
 */
import {proposeTileQuantityCandidateD1} from '../db/tile-quantity-d1-proposal.js';
import {priceTileQuantity} from './tile-quantity-contract.js';

const DECIMAL=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const INPUT_KEYS=['DB','productId','revision','request'];
const review=()=>new Error('NEEDS_REVIEW: tile sale price or revision is not authoritative');

function inputs(options){
  if(options===null||typeof options!=='object'||Array.isArray(options)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(options)))
    throw new TypeError('Invalid tile sale preview options');
  for(const key of Reflect.ownKeys(options)){
    const desc=Object.getOwnPropertyDescriptor(options,key);
    if(!INPUT_KEYS.includes(key)||!desc.enumerable||!Object.hasOwn(desc,'value'))
      throw new TypeError('Unsupported tile sale preview input');
  }
}
function decimal(text){
  if(typeof text!=='string'||!DECIMAL.test(text))throw review();
  return text;
}
function scaled(text){
  const [whole,part='']=decimal(text).split('.');
  return BigInt(whole+part)*10n**BigInt(12-part.length);
}
function sameAmount(a,b){return scaled(a)===scaled(b);}
function sameUnit(a,b){
  return typeof a==='string'&&typeof b==='string'&&
    a.trim()!==''&&b.trim()!==''&&a.toLowerCase()===b.toLowerCase();
}
function trustedSellingPrice(candidate){
  const {catalog,measurement,pricing}=candidate;
  const profile=catalog.unitConfig;
  const packRows=profile.conversions.filter(
    row=>row.conversionId===measurement.boxConversionId);
  if(packRows.length!==1||packRows[0].status!=='Active')throw review();
  const pack=packRows[0];
  const anchor=profile.sellingAnchorUnitName;
  const unit=pricing.sellingPricingUnit;
  if(unit==='Sqft')return decimal(pricing.sellingSqftPriceOverrideText);

  if(unit==='Box'){
    if(sameUnit(anchor,pack.unitName)){
      const original=decimal(catalog.sellingPriceText);
      if(pack.sellingPriceOverrideText!==''&&
        !sameAmount(pack.sellingPriceOverrideText,original))throw review();
      return original;
    }
    return decimal(pack.sellingPriceOverrideText);
  }
  if(unit==='Pcs'){
    if(anchor===''||sameUnit(anchor,catalog.baseUnitName)){
      const original=decimal(catalog.sellingPriceText);
      if(profile.stockSellingOverrideText!==''&&
        !sameAmount(profile.stockSellingOverrideText,original))throw review();
      return original;
    }
    return decimal(profile.stockSellingOverrideText);
  }
  throw review();
}

/**
 * Existing private M03 reader supplies the current D1 measurement revision.
 * Only physical Pcs and exact source-priced rational totals are proposed.
 * No original purchase costs, Cash/Bank, Customer or private DB snapshot
 * are returned to the POS display contract.
 */
export async function previewTileSaleLineCandidateD1(options={}){
  inputs(options);
  const {DB,productId,revision='current',request}=options;
  const candidate=await proposeTileQuantityCandidateD1({
    DB,productId,revision,request
  });
  if(candidate===null)return null;
  if(candidate.isCurrent!==true||candidate.catalog.isDeleted||
    candidate.catalog.status!=='Active'||
    candidate.catalog.productTypeText==='Bundle')throw review();

  const pricingUnit=candidate.pricing.sellingPricingUnit;
  const priceText=trustedSellingPrice(candidate);
  let exact;
  try{
    exact=priceTileQuantity(candidate.measurement,request,pricingUnit,priceText);
  }catch{throw review();}
  if(exact.quantity.pieces!==candidate.quantity.pieces||
    exact.quantity.actualSqft.numerator!==candidate.quantity.actualSqft.numerator||
    exact.quantity.actualSqft.denominator!==candidate.quantity.actualSqft.denominator)
    throw review();

  // Do not spread the catalog: it contains purchase cost and private source
  // provenance that an ordinary POS cashier must never see.
  return {
    productId:candidate.catalog.productId,
    productName:candidate.catalog.productName,
    revision:candidate.measurement.revision,
    stockUnit:'Pcs',stockAuthority:'not-loaded',
    quantity:candidate.quantity,
    salePreview:{
      mode:'read-only-sale-quote',
      pricingUnit,unitPriceText:priceText,
      billingQuantity:exact.billingQuantity,
      billingQuantityDisplay:exact.billingQuantityDisplay,
      exactAmount:exact.exactAmount,
      lineAmountMinor:exact.lineAmountMinor,
      roundingDeltaMinor:exact.displayQuantityAmountDeltaMinor,
      priceSnapshot:exact.priceSnapshot,
      postingAllowed:false
    }
  };
}
