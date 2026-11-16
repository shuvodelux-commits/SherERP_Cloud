// M02 fixed, original Config.gs LOGS: three headers and physical row provenance.
// No source Log ID exists; the SQLite internal row_id must never substitute one.
const columns=Object.freeze({
  Timestamp:'timestamp_text',
  Context:'context',
  Message:'message'
});
export const legacyErrorLogMapping=Object.freeze({
  table:'legacy_error_logs',columns
});

export function verifyLegacyErrorLogMapping(inventory){
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid frozen LOGS source inventory');
  const matching=inventory.tables.filter(x=>x?.sheetKey==='LOGS');
  if(matching.length!==1||
     JSON.stringify(matching[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('Frozen LOGS source headers changed or missing');
  return true;
}

/** Pure source projection only; unknown fields and accessors fail closed. */
export function mapLegacyErrorLogRecord(row){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype)
    throw new Error('Invalid LOGS source row');
  const fields=['Timestamp','Context','Message','_rowIndex'];
  const keys=Reflect.ownKeys(row);
  if(keys.length!==fields.length||
     keys.some(key=>typeof key!=='string'||!fields.includes(key)))
    throw new Error('Unexpected LOGS source field');
  for(const field of fields){
    const d=Object.getOwnPropertyDescriptor(row,field);
    if(!d||d.enumerable!==true||!Object.hasOwn(d,'value'))
      throw new Error('Invalid LOGS source field descriptor');
  }
  if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)
    throw new Error('Invalid LOGS physical row index');
  let timestamp=row.Timestamp;
  if(timestamp instanceof Date){
    if(!Number.isFinite(timestamp.getTime()))throw new Error('Invalid LOGS Timestamp');
    timestamp=timestamp.toISOString();
  }
  if(typeof timestamp!=='string'||
     typeof row.Context!=='string'||
     typeof row.Message!=='string')
    throw new Error('Invalid LOGS source value type');
  return {
    legacy_sheet_row:row._rowIndex,
    timestamp_text:timestamp,
    context:row.Context,
    message:row.Message
  };
}
