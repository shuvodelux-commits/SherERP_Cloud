import {requireD1Binding} from './d1-binding.js';

// M03 internal-only source-format view of immutable M02 DELETE_LOG history.
// Never attach this adapter to public RPC or a preview Worker: records can
// contain confidential reasons, actor names and telephone numbers.
const HEADERS=Object.freeze([
  'Log ID','Date','Time','Module','Record ID','Invoice No',
  'Reason','Deleted By','Deleted By Mobile'
]);
const FIELDS=Object.freeze([
  'log_id','date_text','time_text','module','record_id','invoice_no',
  'reason','deleted_by','deleted_by_mobile'
]);
const D1_FIELDS=Object.freeze(['legacy_sheet_row',...FIELDS]);
const SQL_READ=`SELECT legacy_sheet_row,log_id,date_text,time_text,module,record_id,
  invoice_no,reason,deleted_by,deleted_by_mobile
  FROM legacy_delete_log ORDER BY legacy_sheet_row ASC LIMIT ?`;
const MAX_ROWS=1000;

function checkSheet(sheetKey){
  if(sheetKey!=='DELETE_LOG')throw new TypeError('Unsupported DELETE_LOG source sheet');
}
function checkColumn(name){
  if(typeof name!=='string'||!HEADERS.includes(name))
    throw new TypeError('Unsupported DELETE_LOG source column');
}
function invalidArchive(){
  // Never include original deletion reasons, mobile numbers or D1 exceptions.
  return new Error('Invalid D1 DELETE_LOG archive result');
}

async function sourceRows(DB){
  try{
    const response=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(response?.success!==true||!Array.isArray(response.results)||
       response.results.length>MAX_ROWS)
      throw invalidArchive();
    const ids=new Set();
    return response.results.map((record,index)=>{
      if(!record||typeof record!=='object'||Array.isArray(record))
        throw invalidArchive();
      const props=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(props);
      if(keys.length!==D1_FIELDS.length ||
         keys.some(key=>typeof key!=='string'||!D1_FIELDS.includes(key)) ||
         !D1_FIELDS.every(key=>props[key]?.enumerable===true &&
           Object.hasOwn(props[key],'value')))
        throw invalidArchive();
      const position=props.legacy_sheet_row.value;
      const id=props.log_id.value;
      if(!Number.isSafeInteger(position)||position!==index+2 ||
         typeof id!=='string'||!id.trim()||ids.has(id) ||
         FIELDS.some(key=>typeof props[key].value!=='string'))
        throw invalidArchive();
      ids.add(id);
      const row=Object.fromEntries(HEADERS.map((header,i)=>[header,props[FIELDS[i]].value]));
      row._rowIndex=position;
      return row;
    });
  }catch{
    throw invalidArchive();
  }
}

/**
 * Only the original DELETE_LOG is supported, never a general SQL/Sheet
 * lookup. Each operation awaits fixed, bounded D1 without mutable caching.
 */
export function createDeleteLogAuditReadAdapter(env){
  const DB=requireD1Binding(env);
  const getSheetHeaders_=async(sheetKey)=>{
    checkSheet(sheetKey);
    return [...HEADERS];
  };
  const getAllRows_=async(sheetKey)=>{
    checkSheet(sheetKey);
    return sourceRows(DB);
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    checkSheet(sheetKey);
    checkColumn(columnName);
    const rows=await sourceRows(DB);
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
  return Object.freeze({getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_});
}
