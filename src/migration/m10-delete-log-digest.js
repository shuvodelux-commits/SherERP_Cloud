/**
 * M10-06 — pure OFFLINE original-ID and complete-row digest for the frozen
 * DELETE_LOG audit history. It reuses M02's source validation but does not
 * read the source, call D1, mutate an immutable audit table or approve import.
 */
import {createHash} from 'node:crypto';
import {verifyDeleteLogMapping} from '../db/delete-log-mapping.js';
import {prepareSourceDeleteLog} from '../db/delete-log-import.js';

const INVALID='M10 DELETE_LOG evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const COLUMNS=Object.freeze([
  'log_id','date_text','time_text','module','record_id',
  'invoice_no','reason','deleted_by','deleted_by_mobile'
]);
const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

/**
 * Source Log ID is stable original identity, unlike the ID-less LOGS sheet.
 * Hashes are for trusted local in-memory comparison only; do not log/emit
 * private raw source values or digest bytes.
 *
 * @returns {{sheetKey:'DELETE_LOG',rowCount:number,rowDigest:string,idDigest:string}}
 */
export function summarizeM10DeleteLog({inventory,rows}={}){
  try{
    if(!inventory||inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('Unreviewed source inventory');
    const keys=inventory.tables.map(entry=>entry?.sheetKey);
    if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
       new Set(keys).size!==49)
      throw new Error('Invalid source groups');
    verifyDeleteLogMapping(inventory);
    const records=prepareSourceDeleteLog(rows);
    const full=records.map(row=>[
      row.legacy_sheet_row,...COLUMNS.map(key=>row[key])
    ]);
    const ids=records.map(row=>[row.legacy_sheet_row,row.log_id]);
    return {
      sheetKey:'DELETE_LOG',
      rowCount:records.length,
      rowDigest:hash(['M10-ROW-v1','DELETE_LOG',full]),
      idDigest:hash(['M10-ID-v1','DELETE_LOG',ids])
    };
  }catch{
    // Audit reason, staff identity, phone and related record references can
    // be private; never expose them or driver internals in error messages.
    throw new Error(INVALID);
  }
}
