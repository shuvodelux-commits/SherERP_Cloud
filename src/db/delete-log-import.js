import {mapDeleteLogRecord} from './delete-log-mapping.js';

// Bounded, one-shot internal offline import. No public RPC, worker route or
// general database/Sheets adapter. Every SQL identifier is literal.
const MAX_ROWS=1000;
const SQL_EMPTY="INSERT INTO legacy_delete_log(log_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM legacy_delete_log)";
const SQL_INSERT="INSERT INTO legacy_delete_log(legacy_sheet_row,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile) VALUES (?,?,?,?,?,?,?,?,?,?)";
const SQL_READ="SELECT legacy_sheet_row,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile FROM legacy_delete_log ORDER BY legacy_sheet_row ASC LIMIT ?";
const FIELDS=['legacy_sheet_row','log_id','date_text','time_text','module','record_id','invoice_no','reason','deleted_by','deleted_by_mobile'];

/** Only validated source snapshot objects can progress to any D1 call. */
export function prepareSourceDeleteLog(sourceRows){
  if(!Array.isArray(sourceRows)||sourceRows.length<1||
     sourceRows.length>MAX_ROWS)
    throw new Error('Invalid source DELETE_LOG row count');
  const ids=new Set();
  return sourceRows.map((row,index)=>{
    let record;
    try{record=mapDeleteLogRecord(row);}
    catch{throw new Error('Invalid source DELETE_LOG row or field');}
    if(record.legacy_sheet_row!==index+2)
      throw new Error('Invalid source DELETE_LOG physical row sequence');
    if(ids.has(record.log_id))
      throw new Error('Duplicate source DELETE_LOG ID');
    ids.add(record.log_id);
    return record;
  });
}

/**
 * Execute all INSERTs and the empty-table sentinel in one atomic D1 batch.
 * Readback errors after commit are NEEDS_REVIEW, never a rollback claim.
 */
export async function importSourceDeleteLogWithD1({DB,sourceRows}={}){
  const rows=prepareSourceDeleteLog(sourceRows);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 DELETE_LOG import binding unavailable');
  try{
    const result=await DB.batch([
      DB.prepare(SQL_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(...FIELDS.map(key=>row[key])))
    ]);
    if(!Array.isArray(result)||result.length!==rows.length+1||
       result.some(item=>item?.success!==true))
      throw new Error('Invalid local D1 batch response');
  }catch{
    throw new Error('D1 DELETE_LOG import failed; target must be fresh');
  }
  let actual;
  try{
    const result=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results))
      throw new Error('Missing D1 readback');
    actual=result.results;
  }catch{
    throw new Error('NEEDS_REVIEW: DELETE_LOG D1 readback unavailable after commit');
  }
  if(actual.length!==rows.length||actual.some((record,index)=>
    !record||Object.keys(record).length!==FIELDS.length||
    FIELDS.some(key=>record[key]!==rows[index][key])
  ))throw new Error('NEEDS_REVIEW: DELETE_LOG D1 readback differs after commit');

  return {sourceGroup:'DELETE_LOG',importedRows:rows.length,reconciled:true};
}
