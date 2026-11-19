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
