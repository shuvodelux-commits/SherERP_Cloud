import {requireD1Binding} from './d1-binding.js';

// M03 INTERNAL historical source read, never a public RPC or posting writer.
// The archived M02 INVOICE_EDIT_LOG amount fields are descriptive TEXT;
// source Sheet runtime numeric-vs-string cell types cannot be reconstructed.
const HEADERS=Object.freeze([
  'Log ID','Invoice ID','Edit Date','Reason',
  'Before Grand Total','After Grand Total','Return ID',
  'Before Return Amount','After Return Amount',
  'Before Return Items JSON','After Return Items JSON','Edited By'
]);
const FIELDS=Object.freeze([
  'log_id','invoice_id','edit_date_text','reason',
  'before_grand_total_text','after_grand_total_text','return_id',
  'before_return_amount_text','after_return_amount_text',
  'before_return_items_json','after_return_items_json','edited_by'
]);
const MAX_ROWS=1000;
const SQL_READ=`SELECT legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,
  before_grand_total_text,after_grand_total_text,return_id,
  before_return_amount_text,after_return_amount_text,
  before_return_items_json,after_return_items_json,edited_by
  FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?`;
const FIELDS_ALL=Object.freeze(['legacy_sheet_row',...FIELDS]);

function sourceGroup(sheetKey){
  if(sheetKey!=='INVOICE_EDIT_LOG')
    throw new TypeError('Unsupported INVOICE_EDIT_LOG source sheet');
}
function sourceColumn(column){
  if(typeof column!=='string'||!HEADERS.includes(column))
    throw new TypeError('Unsupported INVOICE_EDIT_LOG source column');
}
function invalidArchive(){
  // Never surface SQL exceptions, archived actor names, JSON or invoice text.
  return new Error('Invalid D1 INVOICE_EDIT_LOG archive result');
}

/** Await a bounded, fixed-column, provenance-checked, immutable M02 archive. */
async function rowsFor(DB){
  try{
    const result=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results)||
       result.results.length>MAX_ROWS)
      throw invalidArchive();

    const logIds=new Set();
    return result.results.map((record,index)=>{
      if(record===null||typeof record!=='object'||Array.isArray(record))
        throw invalidArchive();

      const descriptors=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(descriptors);
      if(keys.length!==FIELDS_ALL.length ||
         keys.some(key=>typeof key!=='string'||!FIELDS_ALL.includes(key))||
         !FIELDS_ALL.every(key=>descriptors[key]?.enumerable===true &&
           Object.hasOwn(descriptors[key],'value')))
        throw invalidArchive();

      const rowIndex=descriptors.legacy_sheet_row.value;
      const logId=descriptors.log_id.value;
      if(!Number.isSafeInteger(rowIndex)||rowIndex!==index+2 ||
         typeof logId!=='string'||!logId.trim()||logIds.has(logId) ||
         FIELDS.some(field=>typeof descriptors[field].value!=='string'))
        throw invalidArchive();
      logIds.add(logId);

      const row=Object.fromEntries(HEADERS.map((header,i)=>
        [header,descriptors[FIELDS[i]].value]));
      row._rowIndex=rowIndex;
      return row;
    });
  }catch{
    throw invalidArchive();
  }
}

/**
 * Exact frozen Database.gs find/get helpers, only for INVOICE_EDIT_LOG.
 * Not a general Sheets adapter, not authenticated HTTP, no caches/writes.
 * A later RPC must require current M04 authorization before disclosing audits.
 */
export function createInvoiceEditAuditReadAdapter(env){
  const DB=requireD1Binding(env);
  const getAllRows_=async(sheetKey)=>{
    sourceGroup(sheetKey);
    return rowsFor(DB);
  };
  const getSheetHeaders_=async(sheetKey)=>{
    sourceGroup(sheetKey);
    return [...HEADERS];
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    sourceGroup(sheetKey);
    sourceColumn(columnName);
    const rows=await rowsFor(DB);
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
    getAllRows_,getSheetHeaders_,findRows_,findFirstRow_,findRow_,findRowIndex_
  });
}
