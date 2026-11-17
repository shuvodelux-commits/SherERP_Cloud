import {requireD1Binding} from './d1-binding.js';

// M03 PRIVATE frozen source archive. Historical signed prices/COGS are TEXT,
// NOT live stock valuations, invoice corrections or accounting transactions.
const SOURCE='STOCK_LOT_COST_CORRECTIONS';
const HEADERS=Object.freeze([
  'Correction ID','Date','Lot ID','Product ID','Product Name','Source',
  'Old Purchase Price','New Purchase Price','Original Quantity',
  'Remaining Quantity','Matched Historical Quantity','Affected Invoice Count',
  'Historical COGS Delta','Reason','Corrected By','Created At'
]);
const FIELDS=Object.freeze([
  'correction_id','date_text','lot_id','product_id','product_name','source',
  'old_purchase_price_text','new_purchase_price_text','original_quantity_text',
  'remaining_quantity_text','matched_historical_quantity_text',
  'affected_invoice_count_text','historical_cogs_delta_text','reason',
  'corrected_by','created_at_text'
]);
const DB_FIELDS=Object.freeze(['legacy_sheet_row',...FIELDS]);
const MAX_ROWS=1000;
const SQL_READ='SELECT legacy_sheet_row,correction_id,date_text,lot_id,product_id,'+
  'product_name,source,old_purchase_price_text,new_purchase_price_text,'+
  'original_quantity_text,remaining_quantity_text,matched_historical_quantity_text,'+
  'affected_invoice_count_text,historical_cogs_delta_text,reason,corrected_by,'+
  'created_at_text FROM legacy_stock_lot_cost_corrections '+
  'ORDER BY legacy_sheet_row ASC LIMIT ?';

function validateSheet(sheet){
  if(sheet!==SOURCE)throw new TypeError('Unsupported stock lot correction source sheet');
}
function validateColumn(column){
  if(typeof column!=='string'||!HEADERS.includes(column))
    throw new TypeError('Unsupported stock lot correction source column');
}
const invalid=()=>new Error('Invalid D1 stock lot correction archive result');

async function sourceRows(DB){
  try{
    const result=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results)||
       result.results.length>MAX_ROWS)
      throw invalid();
    const ids=new Set();
    return result.results.map((record,index)=>{
      if(!record||typeof record!=='object'||Array.isArray(record)||
         ![Object.prototype,null].includes(Object.getPrototypeOf(record)))
        throw invalid();
      const d=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(d);
      if(keys.length!==DB_FIELDS.length||
         keys.some(key=>typeof key!=='string'||!DB_FIELDS.includes(key))||
         !DB_FIELDS.every(key=>d[key]?.enumerable===true &&
           Object.hasOwn(d[key],'value')))
        throw invalid();

      const sourceIndex=d.legacy_sheet_row.value;
      const correctionId=d.correction_id.value;
      if(!Number.isSafeInteger(sourceIndex)||sourceIndex!==index+2||
         typeof correctionId!=='string'||!correctionId.trim()||ids.has(correctionId)||
         typeof d.lot_id.value!=='string'||!d.lot_id.value.trim()||
         typeof d.product_id.value!=='string'||!d.product_id.value.trim()||
         FIELDS.some(field=>typeof d[field].value!=='string'))
        throw invalid();
      ids.add(correctionId);
      const row=Object.fromEntries(HEADERS.map((header,i)=>
        [header,d[FIELDS[i]].value]));
      row._rowIndex=sourceIndex;
      return row;
    });
  }catch{
    // Neither archived cost/COGS, actor details nor SQL exceptions escape.
    throw invalid();
  }
}

/** Original Database.gs source-shaped helper methods for this archive only. */
export function createStockLotCostAuditReadAdapter(env){
  const DB=requireD1Binding(env);
  const getSheetHeaders_=async sheet=>{
    validateSheet(sheet);
    return [...HEADERS];
  };
  const getAllRows_=async sheet=>{
    validateSheet(sheet);
    return sourceRows(DB);
  };
  const findRows_=async(sheet,column,value)=>{
    validateSheet(sheet);
    validateColumn(column);
    const rows=await sourceRows(DB);
    return rows.filter(row=>String(row[column])===String(value));
  };
  const findFirstRow_=async(sheet,column,value)=>{
    const rows=await findRows_(sheet,column,value);
    return rows[0]??null;
  };
  const findRow_=async(sheet,column,value)=>{
    const row=await findFirstRow_(sheet,column,value);
    return row===null?null:{row,rowIndex:row._rowIndex};
  };
  const findRowIndex_=async(sheet,column,value)=>{
    const found=await findRow_(sheet,column,value);
    return found===null?-1:found.rowIndex;
  };
  return Object.freeze({
    getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_
  });
}
