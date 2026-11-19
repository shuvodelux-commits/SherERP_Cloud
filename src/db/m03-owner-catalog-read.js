const MAX_PRODUCTS=1000;

// Read the canonical display fields only. Stock, cost and audit data stay private.
export async function readOwnerCatalog(DB){
  try{
    const result=await DB.prepare(`SELECT product_id AS productId, product_name AS name,
      brand_text AS brand, category_text AS category, unit_text AS unit,
      selling_price_text AS listedPrice
      FROM legacy_product_snapshots
      WHERE source_profile='canonical' AND upper(trim(is_deleted_text))<>'TRUE'
      ORDER BY legacy_sheet_row LIMIT ${MAX_PRODUCTS+1}`).all();
    if(result?.success!==true||!Array.isArray(result.results)||result.results.length>MAX_PRODUCTS){
      throw new Error('Incomplete catalog result');
    }
    return result.results.map(row=>({...row}));
  }catch{
    throw new Error('Owner catalog unavailable');
  }
}
