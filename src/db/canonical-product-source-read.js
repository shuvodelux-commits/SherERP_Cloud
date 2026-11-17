import {requireD1Binding} from './d1-binding.js';
import {CANONICAL_PRODUCT_HEADERS} from './product-source-contract.js';

/**
 * M03 Run 2: source-shaped, fully awaited read of the IMMUTABLE original
 * PRODUCTS archive (M02 migration 0012) only. Does not read active Products
 * from migration 0013, calculate current stock, issue product IDs, mutate
 * D1, implement FIFO, enable RPC or cross-merge the supplementary profile.
 *
 * This is historical evidence. All archive cells are intentionally TEXT;
 * it cannot reconstruct numeric/date types from the original Sheets grid.
 * The original source's 19 header spellings and positions remain authoritative.
 */
const MAX_SOURCE_ROWS=1000;
const SOURCE_FIELD_NAMES=Object.freeze([
  'product_id','product_name','brand_text','category_text','unit_text',
  'barcode_text','purchase_price_text','selling_price_text','current_stock_text',
  'minimum_stock_text','status_text','created_at_text','updated_at_text',
  'is_deleted_text','deleted_by','deleted_at_text','delete_reason',
  'product_type_text','bundle_revision_text'
]);
const DB_FIELDS=Object.freeze(['source_profile','legacy_sheet_row',...SOURCE_FIELD_NAMES]);
// The names below are compile-time reviewed, not caller-selected SQL columns.
const READ_CANONICAL_PRODUCTS=`SELECT
    source_profile,legacy_sheet_row,product_id,product_name,brand_text,
    category_text,unit_text,barcode_text,purchase_price_text,
    selling_price_text,current_stock_text,minimum_stock_text,status_text,
    created_at_text,updated_at_text,is_deleted_text,deleted_by,
    deleted_at_text,delete_reason,product_type_text,bundle_revision_text
  FROM legacy_product_snapshots
  WHERE source_profile = ?
  ORDER BY legacy_sheet_row ASC LIMIT ?`;
const fail=()=>new Error('Invalid D1 canonical PRODUCTS source archive');

function sourceOnly(sheetKey){
  if(sheetKey!=='PRODUCTS')throw new TypeError('Unsupported source sheet; PRODUCTS only');
}
function sourceColumn(columnName){
  if(typeof columnName!=='string'||!CANONICAL_PRODUCT_HEADERS.includes(columnName))
    throw new TypeError('Unsupported PRODUCTS source column');
}
function recordOwnFields(record){
  if(!record||typeof record!=='object'||Array.isArray(record)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(record)))throw fail();
  const props=Object.getOwnPropertyDescriptors(record);
  const keys=Reflect.ownKeys(props);
  if(keys.length!==DB_FIELDS.length ||
     keys.some(key=>typeof key!=='string'||!DB_FIELDS.includes(key)) ||
     DB_FIELDS.some(key=>!props[key]?.enumerable||
       !Object.hasOwn(props[key],'value')))
    throw fail();
  return props;
}
async function canonicalRows(DB){
  try{
    const result=await DB.prepare(READ_CANONICAL_PRODUCTS)
      .bind('canonical',MAX_SOURCE_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results)||
       result.results.length>MAX_SOURCE_ROWS)throw fail();
    const ids=new Set();
    return result.results.map((record,index)=>{
      const props=recordOwnFields(record);
      const position=props.legacy_sheet_row.value;
      const productId=props.product_id.value;
      if(props.source_profile.value!=='canonical'||
         !Number.isSafeInteger(position)||position!==index+2 ||
         typeof productId!=='string'||!productId.trim()||ids.has(productId) ||
         SOURCE_FIELD_NAMES.some(field=>typeof props[field].value!=='string'))
        throw fail();
      ids.add(productId);
      const row=Object.fromEntries(CANONICAL_PRODUCT_HEADERS.map((header,i)=>
        [header,props[SOURCE_FIELD_NAMES[i]].value]));
      row._rowIndex=position;
      return row;
    });
  }catch{
    // Never include original product IDs, archived costs or private D1 errors.
    throw fail();
  }
}

/**
 * Private awaitable subset of original Database.gs lookup method names.
 * No cross-request cache: each lookup observes the latest local D1 archive.
 * The archive's immutable snapshots and initial physical row positions are
 * evidence only, not a current stock, price, authentication or write grant.
 */
export function createCanonicalProductSourceReadAdapter(env){
  if(CANONICAL_PRODUCT_HEADERS.length!==19||
     SOURCE_FIELD_NAMES.length!==CANONICAL_PRODUCT_HEADERS.length)throw fail();
  const DB=requireD1Binding(env);
  const getAllRows_=async sheetKey=>{
    sourceOnly(sheetKey);
    return canonicalRows(DB);
  };
  const getSheetHeaders_=async sheetKey=>{
    sourceOnly(sheetKey);
    return [...CANONICAL_PRODUCT_HEADERS];
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    sourceOnly(sheetKey);
    sourceColumn(columnName);
    const rows=await canonicalRows(DB);
    return rows.filter(row=>String(row[columnName])===String(value));
  };
  const findFirstRow_=async(sheetKey,columnName,value)=>{
    const rows=await findRows_(sheetKey,columnName,value);
    return rows[0]??null;
  };
  const findRow_=async(sheetKey,columnName,value)=>{
    const row=await findFirstRow_(sheetKey,columnName,value);
    return row===null?null:{row,rowIndex:row._rowIndex};
  };
  const findRowIndex_=async(sheetKey,columnName,value)=>{
    const found=await findRow_(sheetKey,columnName,value);
    return found===null?-1:found.rowIndex;
  };
  return Object.freeze({
    getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_
  });
}
