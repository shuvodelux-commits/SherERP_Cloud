/**
 * M05 private read-only tile purchase-line PREVIEW, not a posting engine.
 *
 * Reuses the trusted D1 product/revision proposal and the exact rational
 * M02 tile price helper. This does not validate supplier/cash/lot authority,
 * enter a cash session, or persist a Purchase/Purchase Item/stock movement.
 */
import {proposeTileQuantityCandidateD1} from '../db/tile-quantity-d1-proposal.js';
import {priceTileQuantity} from './tile-quantity-contract.js';

const DECIMAL=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const INPUT_KEYS=['DB','productId','revision','request'];
const review=()=>new Error('NEEDS_REVIEW: tile purchase price or revision is not authoritative');

function inputs(options){
 if(options===null||typeof options!=='object'||Array.isArray(options)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(options)))
  throw new TypeError('Invalid tile purchase preview options');
 for(const key of Reflect.ownKeys(options)){
  const desc=Object.getOwnPropertyDescriptor(options,key);
  if(!INPUT_KEYS.includes(key)||!desc.enumerable||!Object.hasOwn(desc,'value'))
   throw new TypeError('Unsupported tile purchase preview input');
 }
}

function decimal(text){
 if(typeof text!=='string'||!DECIMAL.test(text))throw review();
 return text;
}
function scaled(text){
 const [major,minor='']=decimal(text).split('.');
 return BigInt(major+minor)*10n**BigInt(12-minor.length);
}
function equalAmounts(a,b){return scaled(a)===scaled(b);}
function sameUnit(a,b){
 return typeof a==='string'&&typeof b==='string'&&
  a.trim()!==''&&b.trim()!==''&&a.toLowerCase()===b.toLowerCase();
}

function trustedPurchasePrice(candidate){
 const {catalog,measurement,pricing}=candidate;
 const profile=catalog.unitConfig;
 const conversions=profile.conversions.filter(
  x=>x.conversionId===measurement.boxConversionId);
 if(conversions.length!==1||conversions[0].status!=='Active')throw review();
 const box=conversions[0],anchor=profile.purchaseAnchorUnitName;
 const unit=pricing.purchasePricingUnit;

 if(unit==='Sqft')return decimal(pricing.purchaseSqftPriceOverrideText);

 if(unit==='Box'){
  if(sameUnit(anchor,box.unitName)){
   const sourcePrice=decimal(catalog.purchasePriceText);
   if(box.purchasePriceOverrideText!=='' &&
      !equalAmounts(box.purchasePriceOverrideText,sourcePrice))throw review();
   return sourcePrice;
  }
  return decimal(box.purchasePriceOverrideText);
 }
 if(unit==='Pcs'){
  if(anchor===''||sameUnit(anchor,catalog.baseUnitName)){
   const sourcePrice=decimal(catalog.purchasePriceText);
   if(profile.stockPurchaseOverrideText!=='' &&
      !equalAmounts(profile.stockPurchaseOverrideText,sourcePrice))throw review();
   return sourcePrice;
  }
  return decimal(profile.stockPurchaseOverrideText);
 }
 throw review();
}

/**
 * New purchase previews require a currently active product and unit revision.
 * Explicit old revisions can be read separately for returns/review, but may
 * never silently become the current price or physical stock conversion.
 */
export async function previewTilePurchaseLineCandidateD1(options={}){
 inputs(options);
 const {DB,productId,revision='current',request}=options;
 const candidate=await proposeTileQuantityCandidateD1({DB,productId,revision,request});
 if(candidate===null)return null;
 if(candidate.isCurrent!==true||candidate.catalog.isDeleted||
    candidate.catalog.status!=='Active'||candidate.catalog.productTypeText==='Bundle')
  throw review();

 const selectedUnit=candidate.pricing.purchasePricingUnit;
 const selectedPrice=trustedPurchasePrice(candidate);
 let calculated;
 try{
  calculated=priceTileQuantity(candidate.measurement,request,selectedUnit,selectedPrice);
 }catch{throw review();}
 if(calculated.quantity.pieces!==candidate.quantity.pieces||
    calculated.quantity.actualSqft.numerator!==candidate.quantity.actualSqft.numerator||
    calculated.quantity.actualSqft.denominator!==candidate.quantity.actualSqft.denominator)
  throw review();

 return {
  ...candidate,
  purchasePreview:{
   mode:'read-only-preview',receivedPcs:candidate.quantity.pieces,
   pricingUnit:selectedUnit,unitPriceText:selectedPrice,
   billingQuantity:calculated.billingQuantity,
   billingQuantityDisplay:calculated.billingQuantityDisplay,
   exactAmount:calculated.exactAmount,
   lineAmountMinor:calculated.lineAmountMinor,
   roundingDeltaMinor:calculated.displayQuantityAmountDeltaMinor,
   priceSnapshot:calculated.priceSnapshot,
   postingAllowed:false
  }
 };
}
