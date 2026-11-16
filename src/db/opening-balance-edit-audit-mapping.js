const columns=Object.freeze({
 'Audit ID':'audit_id','Changed At':'changed_at_text',
 'Entity Type':'entity_type','Entity ID':'entity_id','Entity Name':'entity_name',
 'Old Opening Balance':'old_opening_balance_text','New Opening Balance':'new_opening_balance_text',
 Delta:'delta_text','Current Due Before':'current_due_before_text',
 'Current Due After':'current_due_after_text',Reason:'reason','Changed By':'changed_by'
});
export const openingBalanceEditAuditMapping=Object.freeze({table:'legacy_opening_balance_edit_audit',columns});
const fields=Object.freeze([...Object.keys(columns),'_rowIndex']);
const amounts=new Set(['Old Opening Balance','New Opening Balance','Delta','Current Due Before','Current Due After']);
export function verifyOpeningBalanceEditAuditMapping(inventory){
 if(!inventory||!Array.isArray(inventory.tables))throw Error('Invalid source inventory');
 const matches=inventory.tables.filter(x=>x?.sheetKey==='OPENING_BALANCE_EDIT_LOG');
 if(matches.length!==1||JSON.stringify(matches[0].columns)!==JSON.stringify(Object.keys(columns)))
   throw Error('Frozen OPENING_BALANCE_EDIT_LOG source headers changed');
 return true;
}
export function mapOpeningBalanceEditAuditRecord(row){
 if(!row||Object.getPrototypeOf(row)!==Object.prototype)throw Error('Invalid source record');
 const found=Reflect.ownKeys(row);
 if(found.length!==fields.length||found.some(x=>typeof x!=='string'||!fields.includes(x)))
   throw Error('Invalid source fields');
 for(const field of fields){
   const d=Object.getOwnPropertyDescriptor(row,field);
   if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('Invalid source accessor/field');
 }
 if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)throw Error('Invalid source row');
 for(const field of ['Audit ID','Entity Type','Entity ID'])
   if(typeof row[field]!=='string'||!row[field].trim())throw Error('Invalid source identity');
 const projected={legacy_sheet_row:row._rowIndex};
 for(const [field,key] of Object.entries(columns)){
   let v=row[field];
   if(field==='Changed At'&&v instanceof Date){
     if(!Number.isFinite(v.getTime()))throw Error('Invalid source date');
     v=v.toISOString();
   }else if(amounts.has(field)&&typeof v==='number'){
     if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)throw Error('Invalid source amount');
     v=String(v);
   }
   if(typeof v!=='string')throw Error('Invalid source text');
   projected[key]=v;
 }
 return projected;
}
