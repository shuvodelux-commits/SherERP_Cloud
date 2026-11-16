import {mapInvoiceEditAuditRecord} from './invoice-edit-audit-mapping.js';

// Fixed SQL for nonpublic, one-shot synthetic/offline source migration only.
// Not a live financial posting path; never infer invoice/return foreign keys.
const MAX_ROWS=1000;
const FIELDS=['legacy_sheet_row','log_id','invoice_id','edit_date_text','reason',
  'before_grand_total_text','after_grand_total_text','return_id',
  'before_return_amount_text','after_return_amount_text',
  'before_return_items_json','after_return_items_json','edited_by'];
const SQL_EMPTY='INSERT INTO legacy_invoice_edit_audit(log_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM legacy_invoice_edit_audit)';
const SQL_INSERT='INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
const SQL_READ='SELECT legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by FROM legacy_invoice_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?';

/** Validate complete original source snapshot before any database operation. */
export function prepareSourceInvoiceEditAudit(sourceRows){
  if(!Array.isArray(sourceRows)||sourceRows.length<1||
     sourceRows.length>MAX_ROWS)
    throw new Error('Invalid source INVOICE_EDIT_LOG row count');
  const ids=new Set();
  return sourceRows.map((row,index)=>{
    let mapped;
    try{mapped=mapInvoiceEditAuditRecord(row);}
    catch{throw new Error('Invalid source INVOICE_EDIT_LOG row or value');}
    if(mapped.legacy_sheet_row!==index+2)
      throw new Error('Invalid source INVOICE_EDIT_LOG row order');
    if(ids.has(mapped.log_id))
      throw new Error('Duplicate source INVOICE_EDIT_LOG Log ID');
    ids.add(mapped.log_id);
    return mapped;
  });
}

/** Only a synthetic/local whole-snapshot success, not production parity. */
export async function importSourceInvoiceEditAuditWithD1({DB,sourceRows}={}){
  const rows=prepareSourceInvoiceEditAudit(sourceRows);
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('D1 INVOICE_EDIT_LOG import unavailable');
  try{
    const result=await DB.batch([
      DB.prepare(SQL_EMPTY),
      ...rows.map(row=>DB.prepare(SQL_INSERT).bind(...FIELDS.map(x=>row[x])))
    ]);
    if(!Array.isArray(result)||result.length!==rows.length+1||
       result.some(x=>x?.success!==true))
      throw new Error('Unexpected D1 batch response');
  }catch{
    throw new Error('D1 INVOICE_EDIT_LOG import failed; target must be fresh');
  }
  let actual;
  try{
    const res=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(res?.success!==true||!Array.isArray(res.results))
      throw new Error('Missing postcommit D1 readback');
    actual=res.results;
  }catch{
    throw new Error('NEEDS_REVIEW: INVOICE_EDIT_LOG D1 readback unavailable after commit');
  }
  if(actual.length!==rows.length||actual.some((record,index)=>
    !record||Object.keys(record).length!==FIELDS.length||
    FIELDS.some(key=>record[key]!==rows[index][key])
  ))throw new Error('NEEDS_REVIEW: INVOICE_EDIT_LOG D1 readback differs after commit');
  return {sourceGroup:'INVOICE_EDIT_LOG',importedRows:rows.length,reconciled:true};
}
