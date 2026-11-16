/** M02 source-pinned INVOICE_EDIT_LOG projection; no public Writer or RPC. */
const columns=Object.freeze({
  'Log ID':'log_id',
  'Invoice ID':'invoice_id',
  'Edit Date':'edit_date_text',
  Reason:'reason',
  'Before Grand Total':'before_grand_total_text',
  'After Grand Total':'after_grand_total_text',
  'Return ID':'return_id',
  'Before Return Amount':'before_return_amount_text',
  'After Return Amount':'after_return_amount_text',
  'Before Return Items JSON':'before_return_items_json',
  'After Return Items JSON':'after_return_items_json',
  'Edited By':'edited_by'
});
export const invoiceEditAuditMapping=Object.freeze({
  table:'legacy_invoice_edit_audit',columns
});
const keys=Object.freeze([...Object.keys(columns),'_rowIndex']);
const numberFields=new Set([
  'Before Grand Total','After Grand Total','Before Return Amount','After Return Amount'
]);

export function verifyInvoiceEditAuditMapping(inventory){
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid INVOICE_EDIT_LOG frozen source inventory');
  const matching=inventory.tables.filter(x=>x?.sheetKey==='INVOICE_EDIT_LOG');
  if(matching.length!==1||
     JSON.stringify(matching[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('Frozen INVOICE_EDIT_LOG source headers changed');
  return true;
}

/** Pure, byte-faithful source mapping: amounts and JSON are not recomputed. */
export function mapInvoiceEditAuditRecord(row){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype)
    throw new Error('Invalid INVOICE_EDIT_LOG source row');
  const actual=Reflect.ownKeys(row);
  if(actual.length!==keys.length||
     actual.some(x=>typeof x!=='string'||!keys.includes(x)))
    throw new Error('Invalid INVOICE_EDIT_LOG source fields');
  for(const key of keys){
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    if(!descriptor||descriptor.enumerable!==true||
       !Object.hasOwn(descriptor,'value'))
      throw new Error('Invalid INVOICE_EDIT_LOG source field descriptor');
  }
  if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)
    throw new Error('Invalid INVOICE_EDIT_LOG source physical row');
  if(typeof row['Log ID']!=='string'||!row['Log ID'].trim())
    throw new Error('Invalid INVOICE_EDIT_LOG source Log ID');
  const result={legacy_sheet_row:row._rowIndex};
  for(const [source,target] of Object.entries(columns)){
    let value=row[source];
    if(source==='Edit Date'&&value instanceof Date){
      if(!Number.isFinite(value.getTime()))
        throw new Error('Invalid INVOICE_EDIT_LOG Edit Date');
      value=value.toISOString();
    }else if(numberFields.has(source)&&typeof value==='number'){
      if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid INVOICE_EDIT_LOG source amount');
      value=String(value);
    }
    if(typeof value!=='string')
      throw new Error('Invalid INVOICE_EDIT_LOG source field value');
    result[target]=value;
  }
  return result;
}
