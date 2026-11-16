/**
 * M10-07 — pure OFFLINE immutable SALES_DRAFT_AUDIT evidence.
 * Original Audit ID is the source identity; draft ID/number and actor
 * references remain historical opaque text. No D1, GAS, RPC or production
 * import operation is performed or authorized by this module.
 */
import {createHash} from 'node:crypto';
import {verifySalesDraftAuditMapping} from '../db/sales-draft-audit-mapping.js';
import {prepareSourceSalesDraftAudit} from '../db/sales-draft-audit-import.js';

const INVALID='M10 SALES_DRAFT_AUDIT evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const FIELDS=Object.freeze([
  'audit_id','timestamp_text','action','draft_id','draft_no','version_text',
  'actor_id','actor_name','source_owner_id','invoice_id','note'
]);
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

/** Returns the M10 source group row count and two domain-separated SHA-256
 * digests, suitable only for in-memory comparison against independently
 * captured rows. The original decimal Version string must not be parsed
 * from D1 or rewritten: source Version '02' is distinct from '2'.
 */
export function summarizeM10SalesDraftAudit({inventory,rows}={}){
  try{
    if(!inventory||inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('Unreviewed source inventory');
    const keys=inventory.tables.map(item=>item?.sheetKey);
    if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
       new Set(keys).size!==49)
      throw new Error('Invalid source group set');
    verifySalesDraftAuditMapping(inventory);
    const records=prepareSourceSalesDraftAudit(rows);
    const full=records.map(row=>[
      row.legacy_sheet_row,...FIELDS.map(field=>row[field])
    ]);
    const identities=records.map(row=>[row.legacy_sheet_row,row.audit_id]);
    return {
      sheetKey:'SALES_DRAFT_AUDIT',
      rowCount:records.length,
      rowDigest:sha(['M10-ROW-v1','SALES_DRAFT_AUDIT',full]),
      idDigest:sha(['M10-ID-v1','SALES_DRAFT_AUDIT',identities])
    };
  }catch{
    // Do not leak staff/actor identity, source IDs, note contents, hash
    // inputs, error payloads or SQL internals in public/CI diagnostics.
    throw new Error(INVALID);
  }
}
