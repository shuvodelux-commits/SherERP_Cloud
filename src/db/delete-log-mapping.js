// Frozen Config.gs DELETE_LOG; source historical references are opaque
// strings, never auto-linked to a Party, invoice, user or money account.
const columns=Object.freeze({
  'Log ID':'log_id',
  Date:'date_text',
  Time:'time_text',
  Module:'module',
  'Record ID':'record_id',
  'Invoice No':'invoice_no',
  Reason:'reason',
  'Deleted By':'deleted_by',
  'Deleted By Mobile':'deleted_by_mobile'
});
export const deleteLogMapping=Object.freeze({table:'legacy_delete_log',columns});
const sourceFields=Object.freeze([...Object.keys(columns),'_rowIndex']);

export function verifyDeleteLogMapping(inventory){
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid DELETE_LOG source inventory');
  const matching=inventory.tables.filter(x=>x?.sheetKey==='DELETE_LOG');
  if(matching.length!==1 ||
     JSON.stringify(matching[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('Frozen DELETE_LOG source headers changed');
  return true;
}

/** No SQL and no coercion of mobile numbers or original deletion records. */
export function mapDeleteLogRecord(row){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype)
    throw new Error('Invalid DELETE_LOG source row');
  const keys=Reflect.ownKeys(row);
  if(keys.length!==sourceFields.length ||
     keys.some(key=>typeof key!=='string'||!sourceFields.includes(key)))
    throw new Error('Invalid DELETE_LOG source fields');
  for(const key of sourceFields){
    const descriptor=Object.getOwnPropertyDescriptor(row,key);
    if(!descriptor||descriptor.enumerable!==true||!Object.hasOwn(descriptor,'value'))
      throw new Error('Invalid DELETE_LOG source field descriptor');
  }
  if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)
    throw new Error('Invalid DELETE_LOG physical source row');
  if(typeof row['Log ID']!=='string'||!row['Log ID'].trim())
    throw new Error('Invalid DELETE_LOG source ID');
  const result={legacy_sheet_row:row._rowIndex};
  for(const [source,target] of Object.entries(columns)){
    if(typeof row[source]!=='string')
      throw new Error('Invalid DELETE_LOG source text field');
    result[target]=row[source];
  }
  return result;
}
