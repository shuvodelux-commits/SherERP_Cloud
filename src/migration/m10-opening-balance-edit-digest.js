/**
 * M10-10 — OFFLINE immutable OPENING_BALANCE_EDIT_LOG audit evidence only.
 * Authentic original Audit ID is distinct from an entity/Party role ID.
 * Historical signed numbers, negative-zero strings and due changes are
 * descriptive TEXT, not Cash, Bank, account or posting instructions.
 */
import {createHash} from 'node:crypto';
import {verifyOpeningBalanceEditAuditMapping} from '../db/opening-balance-edit-audit-mapping.js';
import {prepareSourceOpeningBalanceEditAudit} from '../db/opening-balance-edit-audit-import.js';

const INVALID='M10 OPENING_BALANCE_EDIT_LOG evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const FIELDS=Object.freeze([
  'audit_id','changed_at_text','entity_type','entity_id','entity_name',
  'old_opening_balance_text','new_opening_balance_text','delta_text',
  'current_due_before_text','current_due_after_text','reason','changed_by'
]);
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

/**
 * Source/D1 checksum must only be compared in trusted memory.
 * This function neither exports Sheets nor connects to D1 or posts money.
 * The returned hash bytes do not prove independent source provenance.
 * @returns {{sheetKey:'OPENING_BALANCE_EDIT_LOG',rowCount:number,rowDigest:string,idDigest:string}}
 */
export function summarizeM10OpeningBalanceEditAudit({inventory,rows}={}){
  try{
    if(!inventory||inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('Unreviewed source inventory');
    const keys=inventory.tables.map(entry=>entry?.sheetKey);
    if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
       new Set(keys).size!==49)
      throw new Error('Invalid frozen inventory groups');
    verifyOpeningBalanceEditAuditMapping(inventory);
    const records=prepareSourceOpeningBalanceEditAudit(rows);
    const full=records.map(row=>[
      row.legacy_sheet_row,...FIELDS.map(field=>row[field])
    ]);
    const ids=records.map(row=>[row.legacy_sheet_row,row.audit_id]);
    return {
      sheetKey:'OPENING_BALANCE_EDIT_LOG',
      rowCount:records.length,
      rowDigest:sha(['M10-ROW-v1','OPENING_BALANCE_EDIT_LOG',full]),
      idDigest:sha(['M10-ID-v1','OPENING_BALANCE_EDIT_LOG',ids])
    };
  }catch{
    // Fail closed and never expose identities, signed balance text,
    // evidence hashes, malicious getter contents, or D1 driver details.
    throw new Error(INVALID);
  }
}
