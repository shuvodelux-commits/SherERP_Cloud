import {
  CANONICAL_PRODUCT_HEADERS,
  SUPPLEMENTARY_PRODUCT_HEADERS,
  SUPPLEMENTARY_CONVERSION_HEADERS,
  snapshotProductTextRows,
  snapshotConversionTextRows
} from './product-source-contract.js';

// Source-frozen field mapping. Historical numbers are *text evidence* here.
// No computed inventory, COGS, price, accounting entry, or source-ID rewrite.
const PRODUCT_MAP=Object.freeze({
  'Product ID':'product_id','Product Name':'product_name',Brand:'brand_text',
  Category:'category_text',Unit:'unit_text',Barcode:'barcode_text',
  'Purchase Price':'purchase_price_text','Selling Price':'selling_price_text',
  'Current Stock':'current_stock_text','Minimum Stock':'minimum_stock_text',
  Status:'status_text','Created At':'created_at_text','Updated At':'updated_at_text',
  'Is Deleted':'is_deleted_text','Deleted By':'deleted_by','Deleted At':'deleted_at_text',
  'Delete Reason':'delete_reason','Product Type':'product_type_text',
  'Bundle Revision':'bundle_revision_text','Purchase Price Unit':'purchase_price_unit_text',
  'Selling Price Unit':'selling_price_unit_text',
  'Stock Unit Purchase Price Override':'stock_unit_purchase_price_override_text',
  'Stock Unit Selling Price Override':'stock_unit_selling_price_override_text',
  'Stock View Unit':'stock_view_unit_text','Stock Entry Unit':'stock_entry_unit_text',
  'Minimum Stock Unit':'minimum_stock_unit_text'
});
const CONVERSION_MAP=Object.freeze({
  'Conversion ID':'conversion_id','Product ID':'product_id','Unit Name':'unit_name',
  'Conversion Factor':'factor_text','Relation Qty':'relation_qty_text',
  'Relation Unit Name':'relation_unit_name','Purchase Price':'purchase_price_text',
  'Selling Price':'selling_price_text','Sort Order':'sort_order_text',
  Status:'status_text','Created At':'created_at_text','Updated At':'updated_at_text'
});
const PRODUCT_COLUMNS=Object.freeze(['source_profile','legacy_sheet_row',...Object.values(PRODUCT_MAP)]);
const CONVERSION_COLUMNS=Object.freeze(['source_profile','legacy_sheet_row',...Object.values(CONVERSION_MAP)]);
const MAX_ROWS=1000;
const productTable='legacy_product_snapshots';
const conversionTable='legacy_product_unit_conversion_snapshots';
function bindableSQL(table,columns){
  return 'INSERT INTO '+table+'('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')';
}
function readableSQL(table,columns){
  return 'SELECT '+columns.join(',')+' FROM '+table+
    ' WHERE source_profile = ? ORDER BY legacy_sheet_row LIMIT ?';
}
const productInsert=bindableSQL(productTable,PRODUCT_COLUMNS);
const conversionInsert=bindableSQL(conversionTable,CONVERSION_COLUMNS);
const productRead=readableSQL(productTable,PRODUCT_COLUMNS);
const conversionRead=readableSQL(conversionTable,CONVERSION_COLUMNS);
// SQL abort guard executed INSIDE D1 batch. No JS read-before-write race.
// A first import may commit once; all second/replayed/conflicting imports fail.
const EMPTY_TARGET_GUARD=
  "INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id) "+
  "SELECT 'canonical',1,'' WHERE EXISTS (SELECT 1 FROM legacy_product_snapshots)";

function mapRow(source,profile,map,columns){
  const out={source_profile:profile,legacy_sheet_row:source.sourceSheetRow};
  for(const col of columns.slice(2))out[col]='';
  for(const [header,value] of Object.entries(source.fields)){
    const target=map[header];
    if(!target||typeof value!=='string')throw new Error('Invalid source product field');
    out[target]=value;
  }
  if(Object.keys(out).length!==columns.length)
    throw new Error('Invalid normalized product source row');
  return out;
}
function expectFrozenColumns(profile){
  const headers=profile==='canonical'?CANONICAL_PRODUCT_HEADERS:SUPPLEMENTARY_PRODUCT_HEADERS;
  if(!headers.every(key=>Object.hasOwn(PRODUCT_MAP,key))||
    !SUPPLEMENTARY_CONVERSION_HEADERS.every(key=>Object.hasOwn(CONVERSION_MAP,key)))
    throw new Error('Frozen source-to-SQL field mapping incomplete');
}

/**
 * Pure preflight, one source profile at a time. 'explicitSupplementaryReview'
 * is provenance evidence for offline planning, NOT authorization or a public API.
 */
export function prepareProductD1Snapshot({
  profile='canonical',productExport,conversionExport,
  explicitSupplementaryReview=false
}={}){
  if(profile!=='canonical'&&profile!=='supplementary')
    throw new Error('Unknown source product profile');
  expectFrozenColumns(profile);
  if(profile==='canonical'&&conversionExport!==undefined)
    throw new Error('Canonical PRODUCTS must not import supplementary conversions');
  const sourceProducts=snapshotProductTextRows({
    ...productExport,profile,explicitSupplementaryReview
  });
  if(!sourceProducts.length)
    throw new Error('Source PRODUCTS must contain at least one reviewed row');
  const products=sourceProducts.map(row=>mapRow(row,profile,PRODUCT_MAP,PRODUCT_COLUMNS));
  const sourceConversions=profile==='supplementary'&&conversionExport!==undefined?
    snapshotConversionTextRows({...conversionExport,
      approvedProductIds:new Set(sourceProducts.map(x=>x.sourceId))}):[];
  const conversions=sourceConversions.map(row=>mapRow(row,'supplementary',CONVERSION_MAP,CONVERSION_COLUMNS));
  if(conversions.length>MAX_ROWS)throw new Error('Source conversions exceed 1000-row bound');
  return {profile,products,conversions};
}

async function exactReadback(DB,sql,profile,expected,columns){
  let rows;
  try{
    const result=await DB.prepare(sql).bind(profile,MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results))
      throw new Error('Missing D1 results');
    rows=result.results;
  }catch{
    throw new Error('NEEDS_REVIEW: product D1 snapshot readback unavailable');
  }
  if(rows.length!==expected.length||rows.some((item,index)=>
      !item||Object.keys(item).length!==columns.length||
      columns.some(column=>item[column]!==expected[index][column])))
    throw new Error('NEEDS_REVIEW: product D1 snapshot readback mismatch after commit');
}

/** Isolated synthetic offline D1 import, never callable from public RPC. */
export async function importProductD1Snapshot({DB,...source}={}){
  const plan=prepareProductD1Snapshot(source);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 source archive binding unavailable');
  try{
    const statements=[
      DB.prepare(EMPTY_TARGET_GUARD),
      ...plan.products.map(row=>DB.prepare(productInsert).bind(...PRODUCT_COLUMNS.map(key=>row[key]))),
      ...plan.conversions.map(row=>DB.prepare(conversionInsert).bind(...CONVERSION_COLUMNS.map(key=>row[key])))
    ];
    const result=await DB.batch(statements);
    if(!Array.isArray(result)||result.length!==statements.length||
       result.some(x=>x?.success!==true))
      throw new Error('Missing success result');
  }catch{
    throw new Error('D1 product source import failed; target must be empty and constraints must hold');
  }
  await exactReadback(DB,productRead,plan.profile,plan.products,PRODUCT_COLUMNS);
  await exactReadback(DB,conversionRead,plan.profile,plan.conversions,CONVERSION_COLUMNS);
  return {sourceGroup:'PRODUCTS',sourceProfile:plan.profile,
    importedProducts:plan.products.length,importedConversions:plan.conversions.length,
    reconciled:true,scope:'isolated-fixture-snapshot-only'};
}
