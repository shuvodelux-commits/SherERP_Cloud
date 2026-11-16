import {requireD1Binding} from './d1-binding.js';

// Private M03 source-shaped read of existing M02 archived LOGS.
// The original source has no Log ID. SQLite row_id is internal, never
// presented as an original record identifier. This is NOT public RPC.
const HEADERS=Object.freeze(['Timestamp','Context','Message']);
const FIELDS=Object.freeze(['timestamp_text','context','message']);
const D1_COLUMNS=Object.freeze(['legacy_sheet_row',...FIELDS]);
const SQL_READ=`SELECT legacy_sheet_row,timestamp_text,context,message
  FROM legacy_error_logs ORDER BY legacy_sheet_row ASC LIMIT ?`;
const MAX_ROWS=1000;

function requireSource(sheet){
  if(sheet!=='LOGS')throw new TypeError('Unsupported LOGS source sheet');
}
function requireHeader(header){
  if(typeof header!=='string'||!HEADERS.includes(header))
    throw new TypeError('Unsupported LOGS source column');
}
function invalid(){
  // Internal messages and D1 SQL exceptions must never escape this boundary.
  return new Error('Invalid D1 LOGS source archive result');
}

/** One bounded awaited read; enforce the source's exact physical row order. */
async function readSourceRows(DB){
  try{
    const answer=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(answer?.success!==true||!Array.isArray(answer.results)||
       answer.results.length>MAX_ROWS)throw invalid();
    return answer.results.map((record,index)=>{
      if(!record||typeof record!=='object'||Array.isArray(record))
        throw invalid();
      const props=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(props);
      if(keys.length!==D1_COLUMNS.length||
         keys.some(key=>typeof key!=='string'||!D1_COLUMNS.includes(key))||
         !D1_COLUMNS.every(key=>props[key]?.enumerable===true &&
           Object.hasOwn(props[key],'value')))
        throw invalid();
      const position=props.legacy_sheet_row.value;
      if(!Number.isSafeInteger(position)||position!==index+2||
         FIELDS.some(key=>typeof props[key].value!=='string'))
        throw invalid();
      return {
        Timestamp:props.timestamp_text.value,
        Context:props.context.value,
        Message:props.message.value,
        _rowIndex:position
      };
    });
  }catch{
    throw invalid();
  }
}

/**
 * Database.gs source-shaped async helpers for LOGS ONLY.
 * Awaited, read-only and uncached. No data leaves an HTTP handler here.
 */
export function createLegacyErrorLogReadAdapter(env){
  const DB=requireD1Binding(env);
  const getSheetHeaders_=async(sheetKey)=>{
    requireSource(sheetKey);
    return [...HEADERS];
  };
  const getAllRows_=async(sheetKey)=>{
    requireSource(sheetKey);
    return readSourceRows(DB);
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    requireSource(sheetKey);
    requireHeader(columnName);
    const rows=await readSourceRows(DB);
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
    const result=await findRow_(sheetKey,columnName,value);
    return result===null?-1:result.rowIndex;
  };
  return Object.freeze({getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_});
}
