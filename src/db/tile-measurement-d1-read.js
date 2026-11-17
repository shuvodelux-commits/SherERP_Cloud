/**
 * Private M03 read-only tile measurement candidate.
 * Migration 0014 persists exact immutable evidence; this adapter is neither
 * an authenticated RPC nor a stock, pricing, or financial posting authority.
 */
import {readProductCatalogCandidateD1} from './product-catalog-d1-read.js';

const MEASUREMENT_SQL=(
 'SELECT product_id,revision,box_conversion_id,length_text,width_text,'+
 'dimension_unit,pieces_per_box,coverage_policy,manufacturer_sqft_per_box_text,'+
 'manufacturer_evidence_ref,purchase_pricing_unit,selling_pricing_unit,'+
 'purchase_sqft_price_override_text,selling_sqft_price_override_text,'+
 'source_evidence_ref,created_at_text '+
 'FROM product_tile_measurement_revisions WHERE product_id=? AND revision=? LIMIT 1'
);
const DECIMAL=/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u;
const UNITS=new Set(['Box','Pcs','Sqft']);
const DIMENSIONS=new Set(['in','cm','mm']);
const fail=()=>new Error('NEEDS_REVIEW: tile measurement D1 invalid or inconsistent row');
const exactPositive=text=>typeof text==='string'&&DECIMAL.test(text)&&/[1-9]/u.test(text);
const exactNonnegative=text=>typeof text==='string'&&DECIMAL.test(text);
const reference=text=>typeof text==='string'&&text.length>0&&text.length<=256&&
 text===text.trim()&&!/[\u0000-\u001f\u007f]/u.test(text);
const nullablePrice=text=>text===null||exactNonnegative(text);

function validated(row,catalog,productId,revision) {
 if(row===null||typeof row!=='object'||Array.isArray(row)||
    row.product_id!==productId||row.revision!==revision||
    !reference(row.box_conversion_id)||row.box_conversion_id==='BASE'||
    !exactPositive(row.length_text)||!exactPositive(row.width_text)||
    !DIMENSIONS.has(row.dimension_unit)||
    !Number.isSafeInteger(row.pieces_per_box)||row.pieces_per_box<=0||
    !['nominal','manufacturer'].includes(row.coverage_policy)||
    !UNITS.has(row.purchase_pricing_unit)||!UNITS.has(row.selling_pricing_unit)||
    !nullablePrice(row.purchase_sqft_price_override_text)||
    !nullablePrice(row.selling_sqft_price_override_text)||
    !reference(row.source_evidence_ref)||
    typeof row.created_at_text!=='string'||!row.created_at_text.trim())
  throw fail();

 const coverage=row.manufacturer_sqft_per_box_text;
 const manufacturerRef=row.manufacturer_evidence_ref;
 if((coverage===null)!==(manufacturerRef===null)||
    (coverage!==null&&(!exactPositive(coverage)||!reference(manufacturerRef)))||
    (row.coverage_policy==='manufacturer'&&coverage===null))
  throw fail();

 const profile=catalog?.unitConfig;
 if(catalog?.productId!==productId||catalog.baseUnitName!=='Pcs'||
    catalog.productTypeText==='Bundle'||profile?.stockUnitName!=='Pcs'||
    profile.revision!==revision||!Array.isArray(profile.conversions))
  throw fail();
 const matches=profile.conversions.filter(x=>x?.conversionId===row.box_conversion_id);
 if(matches.length!==1)throw fail();
 const pack=matches[0];
 const count=String(row.pieces_per_box);
 // Compare the decimal string exactly. A REAL cast can accept near-integers.
 if(!reference(pack.unitName)||pack.unitName.trim().toLowerCase()==='pcs'||
    !(pack.factorText===count||new RegExp('^'+count+'\\.0{1,12}$','u').test(pack.factorText)))
  throw fail();

 const measurement={
  productId,revision:String(revision),baseUnit:'Pcs',
  boxConversionId:row.box_conversion_id,boxUnitName:pack.unitName,
  length:row.length_text,width:row.width_text,
  dimensionUnit:row.dimension_unit,piecesPerBox:count,
  coveragePolicy:row.coverage_policy
 };
 if(coverage!==null) {
  measurement.manufacturerSqftPerBox=coverage;
  measurement.manufacturerEvidence=manufacturerRef;
 }
 return {
  catalog,measurement,
  pricing:{
   purchasePricingUnit:row.purchase_pricing_unit,
   sellingPricingUnit:row.selling_pricing_unit,
   purchaseSqftPriceOverrideText:row.purchase_sqft_price_override_text,
   sellingSqftPriceOverrideText:row.selling_sqft_price_override_text
  },
  evidence:{sourceEvidenceRef:row.source_evidence_ref,createdAtText:row.created_at_text},
  isCurrent:profile.isCurrent
 };
}

/**
 * Explicit revision is historical and read-only; current resolves the
 * existing product pointer. A non-tile product has no inferred area row.
 */
export async function readTileMeasurementCandidateD1({
 DB,productId,revision='current'
}={}){
 if(DB===null||typeof DB!=='object'||typeof DB.prepare!=='function')
  throw new Error('D1 tile measurement binding unavailable');
 if(!reference(productId))throw new TypeError('Invalid tile Product ID');
 if(revision!=='current'&&(!Number.isSafeInteger(revision)||revision<=0))
  throw new TypeError('Invalid tile unit revision');
 let catalog;
 try{catalog=await readProductCatalogCandidateD1({DB,productId,revision});}
 catch{throw new Error('NEEDS_REVIEW: tile measurement D1 catalog unavailable');}
 if(catalog===null||catalog.unitConfig.revision===0)return null;
 const selected=catalog.unitConfig.revision;
 let measurementRow;
 try{measurementRow=await DB.prepare(MEASUREMENT_SQL).bind(productId,selected).first();}
 catch{throw new Error('NEEDS_REVIEW: tile measurement D1 read unavailable');}
 if(measurementRow===null)return null;
 return validated(measurementRow,catalog,productId,selected);
}
