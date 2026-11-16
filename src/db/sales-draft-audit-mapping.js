/** Fixed, frozen SALES_DRAFT_AUDIT column mapping. Never a public Sheet API. */
const columns=Object.freeze({
  'Audit ID':'audit_id',
  Timestamp:'timestamp_text',
  Action:'action',
  'Draft ID':'draft_id',
  'Draft No':'draft_no',
  Version:'version_text',
  'Actor ID':'actor_id',
  'Actor Name':'actor_name',
  'Source Owner ID':'source_owner_id',
  'Invoice ID':'invoice_id',
  Note:'note'
});
export const salesDraftAuditMapping=Object.freeze({
  table:'legacy_sales_draft_audit',columns
});
const sourceFields=Object.freeze([...Object.keys(columns),'_rowIndex']);
const actions=new Set(['CREATED','UPDATED','DELETED','POSTED','POST_CLEANUP_RETRY']);

export function verifySalesDraftAuditMapping(inventory) {
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid SALES_DRAFT_AUDIT source inventory');
  const matches=inventory.tables.filter(row=>row?.sheetKey==='SALES_DRAFT_AUDIT');
  if(matches.length!==1 ||
     JSON.stringify(matches[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('Frozen SALES_DRAFT_AUDIT source headers changed');
  return true;
}

/** Source fidelity: Version is decimal text, Date can be a native Date. */
export function mapSalesDraftAuditRecord(row) {
  if(!row||Object.getPrototypeOf(row)!==Object.prototype)
    throw new Error('Invalid SALES_DRAFT_AUDIT source row');
  const keys=Reflect.ownKeys(row);
  if(keys.length!==sourceFields.length||
     keys.some(key=>typeof key!=='string'||!sourceFields.includes(key)))
    throw new Error('Invalid SALES_DRAFT_AUDIT source fields');
  for(const field of sourceFields){
    const descriptor=Object.getOwnPropertyDescriptor(row,field);
    if(!descriptor||descriptor.enumerable!==true||
       !Object.hasOwn(descriptor,'value'))
      throw new Error('Invalid SALES_DRAFT_AUDIT source field descriptor');
  }
  if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)
    throw new Error('Invalid SALES_DRAFT_AUDIT source row index');
  if(typeof row['Audit ID']!=='string'||!row['Audit ID'].trim()||
     typeof row['Draft ID']!=='string'||!row['Draft ID'].trim()||
     typeof row['Draft No']!=='string'||!row['Draft No'].trim()||
     !actions.has(row.Action))
    throw new Error('Invalid SALES_DRAFT_AUDIT source identity/action');
  const version=row.Version;
  const validNumber=typeof version==='number'&&Number.isSafeInteger(version)&&version>=1;
  const validText=typeof version==='string'&&/^\d+$/.test(version)&&
    Number.isSafeInteger(Number(version))&&Number(version)>=1;
  if(!validNumber&&!validText)
    throw new Error('Invalid SALES_DRAFT_AUDIT source Version');
  let timestamp=row.Timestamp;
  if(timestamp instanceof Date){
    if(!Number.isFinite(timestamp.getTime()))
      throw new Error('Invalid SALES_DRAFT_AUDIT source Timestamp');
    timestamp=timestamp.toISOString();
  }
  if(typeof timestamp!=='string')
    throw new Error('Invalid SALES_DRAFT_AUDIT source Timestamp');
  const out={legacy_sheet_row:row._rowIndex};
  for(const [source,target] of Object.entries(columns)){
    if(source==='Version')out[target]=String(version);
    else if(source==='Timestamp')out[target]=timestamp;
    else {
      if(typeof row[source]!=='string')
        throw new Error('Invalid SALES_DRAFT_AUDIT source text field');
      out[target]=row[source];
    }
  }
  return out;
}
