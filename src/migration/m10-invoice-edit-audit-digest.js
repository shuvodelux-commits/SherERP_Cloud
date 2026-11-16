/**
 * M10-08 — pure OFFLINE immutable INVOICE_EDIT_LOG evidence.
 * Original Log ID is source identity; invoice/return/user IDs are opaque
 * historical references, and amounts/JSON remain evidence text, not money.
 * No GAS, D1, public RPC, remote export, or production cutover access.
 */
import {createHash} from 'node:crypto';
import {verifyInvoiceEditAuditMapping} from '../db/invoice-edit-audit-mapping.js';
import {prepareSourceInvoiceEditAudit} from '../db/invoice-edit-audit-import.js';

const INVALID='M10 INVOICE_EDIT_LOG evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const FIELDS=Object.freeze([
  'log_id','invoice_id','edit_date_text','reason','before_grand_total_text',
  'after_grand_total_text','return_id','before_return_amount_text',
  'after_return_amount_text','before_return_items_json','after_return_items_json',
  'edited_by'
]);
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

/**
 * Only for trusted in-memory comparison of independently captured source and
 * D1 rows. Hashes are never printed or used to authorize live migration.
 * Historical amount "12.50" differs from "12.5"; JSON is not parsed.
 *
 * @returns {{sheetKey:'INVOICE_EDIT_LOG',rowCount:number,rowDigest:string,idDigest:string}}
 */
export function summarizeM10InvoiceEditAudit({inventory,rows}={}){
  try{
    if(!inventory||inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('Unreviewed source inventory');
    const keys=inventory.tables.map(x=>x?.sheetKey);
    if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
       new Set(keys).size!==49)
      throw new Error('Invalid source group set');
    verifyInvoiceEditAuditMapping(inventory);
    const records=prepareSourceInvoiceEditAudit(rows);
    const full=records.map(row=>[
      row.legacy_sheet_row,...FIELDS.map(field=>row[field])
    ]);
    const identities=records.map(row=>[row.legacy_sheet_row,row.log_id]);
    return {
      sheetKey:'INVOICE_EDIT_LOG',
      rowCount:records.length,
      rowDigest:sha(['M10-ROW-v1','INVOICE_EDIT_LOG',full]),
      idDigest:sha(['M10-ID-v1','INVOICE_EDIT_LOG',identities])
    };
  }catch{
    // Redact staff, invoice, Return ID, amounts, JSON, source IDs, secrets
    // and hash inputs from malformed source and malicious getter errors.
    throw new Error(INVALID);
  }
}
