import {mapOpeningBalanceEditAuditRecord} from './opening-balance-edit-audit-mapping.js';
const LIMIT=1000;
const keys=['legacy_sheet_row','audit_id','changed_at_text','entity_type','entity_id',
 'entity_name','old_opening_balance_text','new_opening_balance_text','delta_text',
 'current_due_before_text','current_due_after_text','reason','changed_by'];
const guard='INSERT INTO legacy_opening_balance_edit_audit(audit_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM legacy_opening_balance_edit_audit)';
const insert='INSERT INTO legacy_opening_balance_edit_audit(legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
const read='SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row ASC LIMIT ?';
export function prepareSourceOpeningBalanceEditAudit(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>LIMIT)throw Error('Invalid source row count');
 const ids=new Set();
 return rows.map((row,i)=>{
   let item;
   try{item=mapOpeningBalanceEditAuditRecord(row);}
   catch{throw Error('Invalid source opening balance edit record');}
   if(item.legacy_sheet_row!==i+2)throw Error('Invalid source row order');
   if(ids.has(item.audit_id))throw Error('Duplicate source Audit ID');
   ids.add(item.audit_id);
   return item;
 });
}
export async function importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows}={}){
 const rows=prepareSourceOpeningBalanceEditAudit(sourceRows);
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')throw Error('D1 unavailable');
 try{
   const results=await DB.batch([DB.prepare(guard),
     ...rows.map(row=>DB.prepare(insert).bind(...keys.map(k=>row[k])))]);
   if(!Array.isArray(results)||results.length!==rows.length+1||
      results.some(x=>x?.success!==true))throw Error('Invalid D1 batch response');
 }catch{throw Error('D1 opening balance edit import failed; target must be empty');}
 let actual;
 try{
   const result=await DB.prepare(read).bind(LIMIT+1).all();
   if(result?.success!==true||!Array.isArray(result.results))throw Error('Missing D1 readback');
   actual=result.results;
 }catch{throw Error('NEEDS_REVIEW: opening balance edit readback unavailable after commit');}
 if(actual.length!==rows.length||actual.some((r,i)=>!r||
    Object.keys(r).length!==keys.length||keys.some(k=>r[k]!==rows[i][k])))
   throw Error('NEEDS_REVIEW: opening balance edit readback differs after commit');
 return {sourceGroup:'OPENING_BALANCE_EDIT_LOG',importedRows:rows.length,reconciled:true};
}
