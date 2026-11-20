import {CLEAN_PRODUCT_SOURCE} from './m03-owner-product-create.js';

const MAX_PRODUCTS=1000;

function savedDecimal(value,{signed=false}={}){
  if(typeof value!=='string')return null;
  const text=value.trim();
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) &&
    Number.isFinite(Number(text)) && (signed||Number(text)>=0)?text:null;
}

// Saved master fields describe the backup. They are not lot valuation or live inventory.
export async function readOwnerCatalog(DB){
  try{
    const result=await DB.prepare(`SELECT product_id AS productId, product_name AS name,
      brand_text AS brand, category_text AS category, unit_text AS unit,
      selling_price_text AS listedPrice, purchase_price_text AS savedPurchasePrice,
      current_stock_text AS stockAtBackup, product_type_text AS productType
      FROM legacy_product_snapshots
      WHERE source_profile='canonical' AND upper(trim(is_deleted_text))<>'TRUE'
      ORDER BY legacy_sheet_row LIMIT ${MAX_PRODUCTS+1}`).all();
    if(result?.success!==true||!Array.isArray(result.results)||result.results.length>MAX_PRODUCTS){
      throw new Error('Incomplete catalog result');
    }
    return result.results.map(({productType,savedPurchasePrice,stockAtBackup,...row})=>({
      ...row,
      savedPurchasePrice:savedDecimal(savedPurchasePrice),
      stockAtBackup:productType?.trim().toLowerCase()==='bundle'?null:savedDecimal(stockAtBackup,{signed:true}),
    }));
  }catch{
    throw new Error('Owner catalog unavailable');
  }
}

// The clean-shop UI lists the complete operational catalog. A D1 fetch
// failure returns unavailable rather than a silently truncated list.
export async function readCleanOwnerCatalog(DB,{withMvpStock=false}={}){
  // Keep the original nine-migration Shop catalog readable until an
  // explicitly enabled Purchase pilot has the operational stock tables.
  const stockField=withMvpStock?'COALESCE(st.quantity_micro,0) AS stockMicro':'opening_stock_text AS stock';
  const stockJoin=withMvpStock?'LEFT JOIN owner_mvp_product_stock st ON st.product_id=products.product_id':'';
  const [scope,products,units,categories]=await DB.batch([
    DB.prepare(`SELECT (${CLEAN_PRODUCT_SOURCE}) AS clean, EXISTS(SELECT 1 FROM owner_product_create_receipts) AS hasReceipts`),
    DB.prepare(`SELECT product_id AS productId,product_name AS name,brand_text AS brand,
      category_name AS category,base_unit_name AS unit,selling_price_text AS listedPrice,
      purchase_price_text AS savedPurchasePrice,NULL AS stockAtBackup,${stockField}
      FROM products ${stockJoin} WHERE is_deleted=0 ORDER BY product_name COLLATE NOCASE,product_id`),
    DB.prepare("SELECT DISTINCT unit_name AS name FROM product_units WHERE status='Active' ORDER BY name"),
    DB.prepare("SELECT DISTINCT category_name AS name FROM product_categories WHERE status='Active' ORDER BY name"),
  ]);
  if(![scope,products,units,categories].every(result=>result.success)||scope.results[0]?.clean!==1)
    throw new Error('Operational catalog unavailable');
  return {mode:'operational',data:withMvpStock?products.results.map(({stockMicro,...row})=>({
      ...row,stock:stockMicro/1_000_000
    })):products.results,units:units.results.length?units.results:[{name:'pcs'}],
    categories:categories.results};
}
