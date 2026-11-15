/**
 * M02-P offline only: frozen legacy Party master export column coverage.
 * Source pin: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * (Config.gs; audited docs/baseline/schema-inventory.json).
 *
 * Does NOT authorize identity linking, import, accounting or D1 writes.
 * Captured sheet headers must be supplied by trusted export tooling.
 */
const columns=Object.freeze({
  CUSTOMERS:Object.freeze([
    'Customer ID','Customer Name','Father Name','Phone','Address',
    'Opening Balance','Current Due','Status','Notes','Created At',
    'Is Deleted','Deleted By','Deleted At','Delete Reason','Relation Type'
  ]),
  SUPPLIERS:Object.freeze([
    'Supplier ID','Supplier Name','Phone','Address','Opening Balance',
    'Current Due','Notes','Status','Created At','Is Deleted',
    'Deleted By','Deleted At','Delete Reason'
  ]),
  VENDORS:Object.freeze([
    'Vendor ID','Vendor Name','Phone','Address','Current Due','Status',
    'Created At','Current Receivable','Is Deleted','Deleted By',
    'Deleted At','Delete Reason'
  ]),
  FINANCE_PERSONS:Object.freeze([
    'Person ID','Person Name','Person Type','Roles','Phone','Description',
    'Notes','Status','Created At'
  ]),
  EXPENSE_PAYEES:Object.freeze([
    'Payee ID','Payee Name','Phone','Notes','Status','Created At',
    'Is Deleted','Deleted By','Deleted At','Delete Reason'
  ])
});
const groups=Object.keys(columns);
const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value)===Object.prototype ||
    Object.getPrototypeOf(value)===null);
const validCell=value=>value===null || typeof value==='string' ||
  typeof value==='boolean' ||
  (typeof value==='number' && Number.isFinite(value));
const add=(issues,sourceGroup,code,count)=>{
  if(count>0)issues.push({sourceGroup,code,count});
};
function shape(input,description){
  if(!plain(input) || Object.keys(input).length!==groups.length ||
     Object.keys(input).some(key=>!groups.includes(key)) ||
     groups.some(key=>!Array.isArray(input[key])))
    throw new Error('Invalid Party export '+description);
}
/**
 * Compare supplied master rows AND their captured sheet headers against
 * exact frozen GAS column coverage. Fixed-code counters only; no values.
 */
export function validatePartyExportCompleteness({sourceRows,sourceHeaders}={}){
  shape(sourceRows,'snapshot');
  shape(sourceHeaders,'metadata');
  const issues=[];
  const counts={
    sourceRows:0,missingFields:0,unexpectedFields:0,
    unsafeValues:0,headerIssues:0
  };
  for(const group of groups){
    const expected=columns[group],supplied=sourceHeaders[group];
    const headerMismatch=supplied.length!==expected.length ||
      supplied.some((name,index)=>name!==expected[index]);
    if(headerMismatch){
      add(issues,group,'HEADER_MISMATCH',1);
      counts.headerIssues++;
    }
    const expectedSet=new Set(expected);
    let missing=0,unexpected=0,unsafe=0,unsafeIdentity=0;
    for(const row of sourceRows[group]){
      counts.sourceRows++;
      if(!plain(row))throw new Error('Invalid Party export snapshot');
      for(const name of expected){
        if(!Object.hasOwn(row,name))missing++;
      }
      for(const [name,value] of Object.entries(row)){
        if(name!=='_rowIndex' && !expectedSet.has(name)){
          unexpected++;
          continue;
        }
        if(name==='_rowIndex'){
          if(!Number.isInteger(value)||value<2)unsafe++;
          continue;
        }
        if(!validCell(value)){
          unsafe++;
        }else if(
          (name===expected[0] && typeof value!=='string') ||
          (name==='Phone' && value!==null && typeof value!=='string')
        ){
          unsafeIdentity++;
        }
      }
    }
    add(issues,group,'MISSING_FIELD',missing);
    add(issues,group,'UNEXPECTED_FIELD',unexpected);
    add(issues,group,'UNSAFE_VALUE',unsafe);
    add(issues,group,'UNSAFE_ID_OR_PHONE',unsafeIdentity);
    counts.missingFields+=missing;
    counts.unexpectedFields+=unexpected;
    counts.unsafeValues+=unsafe+unsafeIdentity;
  }
  issues.sort((a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)||
    a.code.localeCompare(b.code));
  const schemaMatches=counts.headerIssues===0;
  const rowCoverageComplete=counts.missingFields===0 &&
    counts.unexpectedFields===0 && counts.unsafeValues===0;
  return {
    formatVersion:1,schemaMatches,rowCoverageComplete,
    offlineExportComplete:schemaMatches&&rowCoverageComplete,
    counts,issues
  };
}
