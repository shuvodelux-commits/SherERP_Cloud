import {mapSalesDraftAuditRecord} from './sales-draft-audit-mapping.js';

// Offline one-shot frozen source import; fixed SQL and no RPC/Worker route.
const MAX_ROWS=1000;
const FIELDS=['legacy_sheet_row','audit_id','timestamp_text','action','draft_id',
  'draft_no','version_text','actor_id','actor_name','source_owner_id','invoice_id','note'];
// A nonempty target makes this sentinel raise a NOT NULL constraint inside
// the same D1.batch transaction as all writes, not a racy JS SELECT.
const SQL_EMPTY="INSERT INTO legacy_sales_draft_audit(audit_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM legacy_sales_draft_audit)";
const SQL_INSERT="INSERT INTO legacy_sales_draft_audit(legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
const SQL_READ="SELECT legacy_sheet_row,audit_id,timestamp_text,action,draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,invoice_id,note FROM legacy_sales_draft_audit ORDER BY legacy_sheet_row ASC LIMIT ?";

/** Complete snapshot validation before any D1 operation or source mutation. */
export function prepareSourceSalesDraftAudit(sourceRows) {
  if(!Array.isArray(sourceRows)||sourceRows.length<1||
     sourceRows.length>MAX_ROWS)
    throw new Error('Invalid source SALES_DRAFT_AUDIT row count');
  const ids=new Set();
  return sourceRows.map((row,index)=>{
    let mapped;
    try{mapped=mapSalesDraftAuditRecord(row);}
    catch{throw new Error('Invalid source SALES_DRAFT_AUDIT row or field');}
    if(mapped.legacy_sheet_row!==index+2)
      throw new Error('Invalid source SALES_DRAFT_AUDIT physical row order');
    if(ids.has(mapped.audit_id))
      throw new Error('Duplicate source SALES_DRAFT_AUDIT Audit ID');
    ids.add(mapped.audit_id);
    return mapped;
  });
}

/** A successful import is a synthetic/local snapshot parity result ONLY. */
export async function importSourceSalesDraftAuditWithD1({DB,sourceRows}={}) {
  const rows=prepareSourceSalesDraftAudit(sourceRows);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 SALES_DRAFT_AUDIT import binding unavailable');
  try{
    const results=await DB.batch([
      DB.prepare(SQL_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(...FIELDS.map(field=>row[field])))
    ]);
    if(!Array.isArray(results)||results.length!==rows.length+1||
       results.some(item=>item?.success!==true))
      throw new Error('Invalid D1 import batch response');
  }catch{
    throw new Error('D1 SALES_DRAFT_AUDIT import failed; target must be fresh');
  }
  let actual;
  try{
    const result=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(result?.success!==true||!Array.isArray(result.results))
      throw new Error('Invalid D1 readback');
    actual=result.results;
  }catch{
    throw new Error('NEEDS_REVIEW: SALES_DRAFT_AUDIT readback unavailable after commit');
  }
  if(actual.length!==rows.length||actual.some((record,index)=>
    !record||Object.keys(record).length!==FIELDS.length||
    FIELDS.some(field=>record[field]!==rows[index][field])
  ))throw new Error('NEEDS_REVIEW: SALES_DRAFT_AUDIT readback differs after commit');

  return {sourceGroup:'SALES_DRAFT_AUDIT',importedRows:rows.length,reconciled:true};
}
