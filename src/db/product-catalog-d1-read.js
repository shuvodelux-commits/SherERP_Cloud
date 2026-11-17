/**
 * Internal M03 candidate product-catalog projection (migration 0013).
 *
 * Safe by design: static parameterized SELECTs only; no public RPC, auth,
 * source-row import, stock/FIFO, payment or ledger authority. M04 must
 * separately authorize and scope any future user-facing caller.
 * Frozen canonical Mohim_ERP source identity remains distinct from older
 * supplementary multi-unit source history.
 */
const PRODUCT_SQL=(
 'SELECT product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,'+
 'product_name,brand_text,category_name,base_unit_name,base_unit_id,'+
 'barcode_text,purchase_price_text,selling_price_text,minimum_stock_text,'+
 'product_type_text,bundle_revision_text,status,is_deleted,'+
 'current_unit_revision,record_version '+
 'FROM products WHERE product_id=? LIMIT 1'
);
const PROFILE_SQL=(
 'SELECT product_id,revision,stock_unit_name,purchase_anchor_unit_name,'+
 'selling_anchor_unit_name,stock_view_unit_name,stock_purchase_override_text,'+
 'stock_selling_override_text,created_at_text '+
 'FROM product_unit_profiles WHERE product_id=? AND revision=? LIMIT 1'
);
const CONVERSIONS_SQL=(
 'SELECT product_id,revision,conversion_id,unit_name,reviewed_unit_master_id,'+
 'factor_text,relation_qty_text,relation_unit_name,purchase_price_override_text,'+
 'selling_price_override_text,sort_order,status,source_conversion_row_id '+
 'FROM product_unit_conversions WHERE product_id=? AND revision=? '+
 'ORDER BY sort_order,conversion_id'
);

function failClosed(message){
 return new Error('NEEDS_REVIEW: product candidate D1 '+message);
}
function isD1(db){
 return db!==null&&typeof db==='object'&&typeof db.prepare==='function';
}
function stringFields(row,keys){
 return row!==null&&typeof row==='object'&&
  keys.every(key=>typeof row[key]==='string');
}
function finiteNonnegativeInteger(value){
 return Number.isSafeInteger(value)&&value>=0;
}
function validProduct(row,productId){
 return stringFields(row,[
  'product_id','source_profile','product_name','brand_text','category_name',
  'base_unit_name','barcode_text','purchase_price_text','selling_price_text',
  'minimum_stock_text','product_type_text','bundle_revision_text','status'
 ])&&row.product_id===productId&&
 (row.source_profile==='canonical'||row.source_profile==='new')&&
 row.product_name.trim()!==''&&row.base_unit_name.trim()!==''&&
 finiteNonnegativeInteger(row.current_unit_revision)&&
 finiteNonnegativeInteger(row.record_version)&&
 (row.is_deleted===0||row.is_deleted===1)&&
 (row.status==='Active'||row.status==='Inactive')&&
 (row.base_unit_id===null||typeof row.base_unit_id==='string')&&
 ((row.source_profile==='new'&&row.source_snapshot_row_id===null&&row.legacy_sheet_row===null)||
 (row.source_profile==='canonical'&&
 Number.isSafeInteger(row.source_snapshot_row_id)&&row.source_snapshot_row_id>0&&
 Number.isSafeInteger(row.legacy_sheet_row)&&row.legacy_sheet_row>=2));
}
function validProfile(row,productId,revision,baseUnitName){
 return stringFields(row,[
  'product_id','stock_unit_name','purchase_anchor_unit_name',
  'selling_anchor_unit_name','stock_view_unit_name',
  'stock_purchase_override_text','stock_selling_override_text','created_at_text'
 ])&&row.product_id===productId&&row.revision===revision&&
 row.stock_unit_name===baseUnitName;
}
function validConversion(row,productId,revision){
 return stringFields(row,[
  'product_id','conversion_id','unit_name','factor_text','relation_qty_text',
  'relation_unit_name','purchase_price_override_text',
  'selling_price_override_text','status'
 ])&&row.product_id===productId&&row.revision===revision&&
 Number.isSafeInteger(row.sort_order)&&row.sort_order>=0&&
 row.conversion_id.trim()!==''&&row.unit_name.trim()!==''&&
 row.factor_text.trim()!==''&&
 (row.status==='Active'||row.status==='Inactive')&&
 (row.reviewed_unit_master_id===null||typeof row.reviewed_unit_master_id==='string')&&
 (row.source_conversion_row_id===null||Number.isSafeInteger(row.source_conversion_row_id));
}
function baseOnlyProfile(baseUnitName){
 return {
  revision:0,isCurrent:true,stockUnitName:baseUnitName,
  purchaseAnchorUnitName:'',sellingAnchorUnitName:'',stockViewUnitName:'',
  stockPurchaseOverrideText:'',stockSellingOverrideText:'',
  createdAtText:'',conversions:[]
 };
}
function toProduct(row){
 return {
  productId:row.product_id,sourceProfile:row.source_profile,
  sourceSnapshotRowId:row.source_snapshot_row_id,
  legacySheetRow:row.legacy_sheet_row,productName:row.product_name,
  brandText:row.brand_text,categoryName:row.category_name,
  baseUnitName:row.base_unit_name,baseUnitId:row.base_unit_id,
  barcodeText:row.barcode_text,
  purchasePriceText:row.purchase_price_text,
  sellingPriceText:row.selling_price_text,
  minimumStockText:row.minimum_stock_text,
  productTypeText:row.product_type_text,
  bundleRevisionText:row.bundle_revision_text,
  status:row.status,isDeleted:row.is_deleted===1,
  currentUnitRevision:row.current_unit_revision,
  recordVersion:row.record_version,
  stockAuthority:'not-loaded'
 };
}

/**
 * Awaited, read-only candidate projection. revision='current' selects the
 * product's current revision. An explicit positive revision reads history;
 * it never changes the active revision or validates any future transaction.
 */
export async function readProductCatalogCandidateD1({
 DB,productId,revision='current'
}={}){
 if(!isD1(DB))throw new Error('D1 product candidate binding unavailable');
 if(typeof productId!=='string'||!productId.trim()||productId.length>256)
  throw new Error('Invalid Product ID for private D1 read');
 if(revision!=='current'){
  if(!Number.isSafeInteger(revision)||revision<=0)
   throw new Error('Invalid product unit revision');
 }
 let row;
 try{row=await DB.prepare(PRODUCT_SQL).bind(productId).first();}
 catch{throw failClosed('product row unavailable');}
 if(row===null)return null;
 if(!validProduct(row,productId))throw failClosed('incomplete or inconsistent product row');
 const selectedRevision=revision==='current'?row.current_unit_revision:revision;
 const product=toProduct(row);
 if(selectedRevision===0){
  product.unitConfig=baseOnlyProfile(row.base_unit_name);
  return product;
 }
 let profile,conversionsResult;
 try{
  profile=await DB.prepare(PROFILE_SQL).bind(productId,selectedRevision).first();
  conversionsResult=await DB.prepare(CONVERSIONS_SQL).bind(productId,selectedRevision).all();
 }catch{throw failClosed('unit revision read unavailable');}
 if(!validProfile(profile,productId,selectedRevision,row.base_unit_name))
  throw failClosed('missing or mismatched unit revision');
 if(conversionsResult?.success!==true||!Array.isArray(conversionsResult.results)||
    conversionsResult.results.some(item=>!validConversion(item,productId,selectedRevision)))
  throw failClosed('unit conversion read incomplete');
 product.unitConfig={
  revision:selectedRevision,isCurrent:selectedRevision===row.current_unit_revision,
  stockUnitName:profile.stock_unit_name,
  purchaseAnchorUnitName:profile.purchase_anchor_unit_name,
  sellingAnchorUnitName:profile.selling_anchor_unit_name,
  stockViewUnitName:profile.stock_view_unit_name,
  stockPurchaseOverrideText:profile.stock_purchase_override_text,
  stockSellingOverrideText:profile.stock_selling_override_text,
  createdAtText:profile.created_at_text,
  conversions:conversionsResult.results.map(item=>({
   conversionId:item.conversion_id,unitName:item.unit_name,
   reviewedUnitMasterId:item.reviewed_unit_master_id,
   factorText:item.factor_text,relationQtyText:item.relation_qty_text,
   relationUnitName:item.relation_unit_name,
   purchasePriceOverrideText:item.purchase_price_override_text,
   sellingPriceOverrideText:item.selling_price_override_text,
   sortOrder:item.sort_order,status:item.status,
   sourceConversionRowId:item.source_conversion_row_id
  }))
 };
 return product;
}
