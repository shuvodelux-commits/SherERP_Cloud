import {mapLegacyErrorLogRecord} from './legacy-error-log-mapping.js';

// Full source snapshot, not a public logging service or generic Sheets adapter.
// All SQL identifiers are fixed; DB is an isolated internal D1 binding.
const MAX_ROWS=1000;
const SQL_INSERT='INSERT INTO legacy_error_logs (legacy_sheet_row,timestamp_text,context,message) VALUES (?,?,?,?)';
// The source-group table is append-only for this one-shot importer. The 1
// violates the legacy_sheet_row CHECK on a nonempty target; within the SAME
// D1 batch as all INSERTs this prevents racing importers or silent append.
const SQL_REQUIRE_EMPTY='INSERT INTO legacy_error_logs (legacy_sheet_row) SELECT 1 WHERE EXISTS (SELECT 1 FROM legacy_error_logs)';
const SQL_READ='SELECT legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row ASC LIMIT ?';

/** Read-only full-snapshot validation, no D1 work, no source mutations. */
export function prepareSourceLegacyErrorLogs(sourceRows) {
  if(!Array.isArray(sourceRows)||sourceRows.length<1||
     sourceRows.length>MAX_ROWS)
    throw new Error('Invalid source LOGS row count');
  return sourceRows.map((row,index)=>{
    let mapped;
    try {mapped=mapLegacyErrorLogRecord(row);}
    catch {throw new Error('Invalid source LOGS row fields or values');}
    if(mapped.legacy_sheet_row!==index+2)
      throw new Error('Invalid source LOGS physical row order');
    return mapped;
  });
}

/**
 * One-shot internal synthetic/offline LOGS import; no HTTP/RPC exposure.
 * D1 batch failures roll back; postcommit readback failures require review.
 */
export async function importSourceLegacyErrorLogsWithD1({DB,sourceRows}={}) {
  const rows=prepareSourceLegacyErrorLogs(sourceRows);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 LOGS binding unavailable');

  try {
    const result=await DB.batch([
      DB.prepare(SQL_REQUIRE_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(
        row.legacy_sheet_row,row.timestamp_text,row.context,row.message
      ))
    ]);
    if(!Array.isArray(result)||result.length!==rows.length+1||
       result.some(entry=>entry?.success!==true))
      throw new Error('Invalid D1 batch result');
  }catch {
    throw new Error('D1 LOGS import failed; target must be fresh');
  }

  let actual;
  try {
    const result=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results))
      throw new Error('Invalid D1 readback result');
    actual=result.results;
  }catch {
    throw new Error('NEEDS_REVIEW: LOGS D1 readback unavailable after commit');
  }
  const columns=['legacy_sheet_row','timestamp_text','context','message'];
  if(actual.length!==rows.length||actual.some((record,index)=>
    !record||Object.keys(record).length!==columns.length||
    columns.some(key=>record[key]!==rows[index][key])
  ))throw new Error('NEEDS_REVIEW: LOGS D1 readback differs after commit');

  return {sourceGroup:'LOGS',importedRows:rows.length,reconciled:true};
}
