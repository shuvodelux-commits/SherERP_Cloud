import {requireD1Binding} from './d1-binding.js';

// M03 source-shaped read subset of legacy Database.gs. NOT a general Sheet emulator.
// Only the two approved, non-sensitive masters from original CONFIG.HEADERS.
const MAX_ROWS = 1000;
const CATALOG = Object.freeze({
  PRODUCT_CATEGORIES: Object.freeze({
    headers: Object.freeze(['Category ID','Category Name','Status','Created At']),
    fields: Object.freeze(['category_id','category_name','status','created_at']),
    sql: 'SELECT legacy_sheet_row, category_id, category_name, status, created_at FROM product_categories ORDER BY legacy_sheet_row ASC LIMIT ?',
  }),
  PRODUCT_UNITS: Object.freeze({
    headers: Object.freeze(['Unit ID','Unit Name','Status','Created At']),
    fields: Object.freeze(['unit_id','unit_name','status','created_at']),
    sql: 'SELECT legacy_sheet_row, unit_id, unit_name, status, created_at FROM product_units ORDER BY legacy_sheet_row ASC LIMIT ?',
  }),
});

function catalogFor(sheetKey) {
  if (typeof sheetKey !== 'string' || !Object.hasOwn(CATALOG,sheetKey)) {
    throw new TypeError('Unsupported legacy catalog sheet');
  }
  return CATALOG[sheetKey];
}

async function rowsFor(db, sheetKey) {
  const catalog=catalogFor(sheetKey);
  const result=await db.prepare(catalog.sql).bind(MAX_ROWS+1).all();
  if (result?.success!==true || !Array.isArray(result.results)) {
    throw new Error('Invalid D1 legacy catalog result');
  }
  if (result.results.length>MAX_ROWS) {
    throw new RangeError('Legacy catalog exceeds 1000-row bounded read limit');
  }
  return result.results.map((record,index)=>{
    if(!record || !Number.isInteger(record.legacy_sheet_row) || record.legacy_sheet_row!==index+2){
      throw new Error('Invalid legacy physical row index; refusing unsafe row mapping');
    }
    const row={};
    catalog.headers.forEach((header,i)=>{
      const value=record[catalog.fields[i]];
      if (value!==null && typeof value!=='string') throw new Error('Invalid D1 legacy catalog row value');
      if (value===null && catalog.fields[i]!=='created_at') throw new Error('Invalid D1 legacy catalog row value');
      row[header]=value??'';
    });
    row._rowIndex=record.legacy_sheet_row;
    return row;
  });
}

function validColumn(sheetKey,columnName){
  const headers=catalogFor(sheetKey).headers;
  if (!headers.includes(columnName)) throw new Error('Column not found: '+columnName);
}

/**
 * Internal async, read-only migration adapter for two reviewed master groups.
 * Never attach to public RPC until M04 auth. Does not cache, write, or expose SETTINGS.
 * Original Database.gs find helpers use String() exact-match semantics.
 */
export function createLegacyCatalogReadAdapter(env) {
  const db=requireD1Binding(env);
  const getAllRows_=async(sheetKey)=>rowsFor(db,sheetKey);
  const getSheetHeaders_=async(sheetKey)=>[...catalogFor(sheetKey).headers];
  const findRows_=async(sheetKey,columnName,value)=>{
    validColumn(sheetKey,columnName);
    const rows=await getAllRows_(sheetKey);
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
  return Object.freeze({getAllRows_,getSheetHeaders_,findRowIndex_,findRow_,findRows_,findFirstRow_});
}
