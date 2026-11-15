/**
 * M02-P offline-only Finance Transactions export coverage.
 * Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * No D1, RPC, migrations, finance posting or production import.
 * Declared source counts must be captured by trusted exporter tooling.
 */
const columns=Object.freeze([
  'Finance ID','Date','Transaction Type','Person','Payment Method',
  'Bank Account ID','Bank Account Name','Amount','Reference No','Notes',
  'Created By','Created At','Is Backdated','Backdated Days',
  'Backdated Reason','Is Deleted','Deleted By','Deleted At',
  'Delete Reason','Person ID'
]);
const allowed=new Set(columns);
const plain=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x)===Object.prototype ||
    Object.getPrototypeOf(x)===null);
const cell=x=>x===null || typeof x==='string' || typeof x==='boolean' ||
  (typeof x==='number' && Number.isFinite(x));
const softDeleted=row=>row['Is Deleted']===true ||
  String(row['Is Deleted']||'').trim().toUpperCase()==='TRUE';
function positiveAmount(value){
  if(typeof value!=='number' && typeof value!=='string')return false;
  if(typeof value==='number'&&!Number.isFinite(value))return false;
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return false;
  const [whole,fraction='']=raw.split('.');
  const minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(minor)&&minor>0;
}
function issue(issues,code,count){
  if(count>0)issues.push({code,count});
}

/** Returns only fixed issue codes and counts, never source values. */
export function validateFinanceTransactionExport(input={}){
  if(!plain(input) || !Array.isArray(input.sourceRows) ||
    !Array.isArray(input.sourceHeaders) ||
    !Number.isSafeInteger(input.declaredRowCount) ||
    input.declaredRowCount<0)
    throw new Error('Invalid Finance export');
  const {sourceRows,sourceHeaders,declaredRowCount}=input;
  const counts={
    declaredRows:declaredRowCount,observedRows:sourceRows.length,
    headerIssues:0,missingFields:0,unexpectedFields:0,
    unsafeValues:0,missingIds:0,duplicateIds:0,
    missingPersonIds:0,duplicateSourceRows:0,invalidActiveAmounts:0
  };
  const issues=[];
  if(sourceHeaders.length!==columns.length ||
    sourceHeaders.some((field,i)=>field!==columns[i]))
    counts.headerIssues=1;
  issue(issues,'HEADER_MISMATCH',counts.headerIssues);
  issue(issues,'SOURCE_COUNT_MISMATCH',
    sourceRows.length===declaredRowCount?0:1);
  const ids=new Set(),positions=new Set();
  let invalidSourceRows=0,unsafeIdentifiers=0;
  for(const row of sourceRows){
    if(!plain(row))throw new Error('Invalid Finance export');
    for(const field of columns){
      if(!Object.hasOwn(row,field))counts.missingFields++;
    }
    for(const [field,value] of Object.entries(row)){
      if(field==='_rowIndex'){
        if(!Number.isInteger(value) || value<2)invalidSourceRows++;
        else if(positions.has(value))counts.duplicateSourceRows++;
        else positions.add(value);
      }else if(!allowed.has(field))counts.unexpectedFields++;
      else if(!cell(value))counts.unsafeValues++;
    }
    const id=row['Finance ID'],personId=row['Person ID'];
    if(typeof id==='number')unsafeIdentifiers++;
    if(typeof personId==='number' || typeof personId==='boolean')unsafeIdentifiers++;
    if(typeof id!=='string'){
      if(typeof id!=='number')counts.missingIds++;
    }else if(!id.trim())counts.missingIds++;
    else if(ids.has(id))counts.duplicateIds++;
    else ids.add(id);
    if(!softDeleted(row)){
      if(personId===null || personId===undefined ||
         (typeof personId==='string' && !personId.trim()))
        counts.missingPersonIds++;
      if(!positiveAmount(row.Amount))counts.invalidActiveAmounts++;
    }
  }
  issue(issues,'MISSING_FIELD',counts.missingFields);
  issue(issues,'UNEXPECTED_FIELD',counts.unexpectedFields);
  issue(issues,'UNSAFE_VALUE',counts.unsafeValues);
  issue(issues,'MISSING_FINANCE_ID',counts.missingIds);
  issue(issues,'DUPLICATE_FINANCE_ID',counts.duplicateIds);
  issue(issues,'UNSAFE_IDENTIFIER',unsafeIdentifiers);
  issue(issues,'MISSING_PERSON_ID',counts.missingPersonIds);
  issue(issues,'INVALID_SOURCE_ROW',invalidSourceRows);
  issue(issues,'DUPLICATE_SOURCE_ROW',counts.duplicateSourceRows);
  issue(issues,'INVALID_ACTIVE_AMOUNT',counts.invalidActiveAmounts);
  issues.sort((a,b)=>a.code.localeCompare(b.code));
  return {
    formatVersion:1,sourceGroup:'FINANCE_TRANSACTIONS',
    offlineExportComplete:issues.length===0,counts,issues
  };
}
