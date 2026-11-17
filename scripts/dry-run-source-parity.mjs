#!/usr/bin/env node
/**
 * M02-safe source-to-candidate exact-text parity rehearsal (issue #24).
 * No Workers, Sheets, D1, financial posting, auth, source ID rewriting or writes.
 *
 * This validates a supplied *source-shaped* projection, NOT a D1-import audit.
 * Source authority: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Original export and private snapshots stay solely with the caller.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BASELINE=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const SOURCE_COMMIT=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const MAX_ROWS_PER_GROUP=250000;

// Frozen single-record identities; repeated parent IDs in item/lot allocations
// are intentionally NOT treated as unique. All other groups still use their
// exact physical source sheet row for mandatory provenance.
const RECORD_KEYS=Object.freeze({
 PRODUCTS:'Product ID',SUPPLIERS:'Supplier ID',SUPPLIER_LEDGER:'Ledger ID',
 STOCK_LOTS:'Lot ID',STOCK_LOT_COST_CORRECTIONS:'Correction ID',
 PURCHASES:'Purchase ID',SALES:'Invoice ID',SALE_PAYMENTS:'Payment ID',
 SALE_POSTING_JOURNAL:'Operation ID',SALES_DRAFTS:'Draft ID',
 SALES_DRAFT_AUDIT:'Audit ID',CUSTOMERS:'Customer ID',
 CUSTOMER_LEDGER:'Ledger ID',EXPENSES:'Expense ID',
 EXPENSE_CATEGORIES:'Category ID',EXPENSE_PAYEES:'Payee ID',
 CASH_BOOK:'Entry ID',STOCK_MOVEMENT:'Movement ID',SETTINGS:'Key',
 SALES_RETURN:'Return ID',PURCHASE_RETURN:'Return ID',
 CASH_SESSIONS:'Session ID',INVOICE_EDIT_LOG:'Log ID',
 USERS:'User ID',ROLES:'Role ID',SESSIONS:'Token',
 DELETE_LOG:'Log ID',OPENING_BALANCE_EDIT_LOG:'Audit ID',
 BANK_ACCOUNTS:'Bank Account ID',BANK_BOOK:'Entry ID',
 BANK_TRANSFERS:'Transfer ID',FINANCE_TRANSACTIONS:'Finance ID',
 FINANCE_PERSONS:'Person ID',PRODUCT_CATEGORIES:'Category ID',
 PRODUCT_UNITS:'Unit ID',VENDORS:'Vendor ID',
 VENDOR_SOURCING:'Sourcing ID',VENDOR_LEDGER:'Ledger ID',
 VENDOR_RETURNS:'Return ID',VENDOR_ISSUES:'Issue ID',
 VENDOR_RETURNS_RECEIVED:'Return ID'
});
function isRecord(v){
 return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
}
function reject(code,sourceGroup=''){
 // Never include row contents, IDs, amounts, names, Settings or passwords.
 throw new Error('M02 offline parity rejected: '+code+(sourceGroup?' ['+sourceGroup+']':''));
}
function exactKeys(obj,keys){
 return isRecord(obj)&&Object.keys(obj).length===keys.length&&
  keys.every(k=>Object.hasOwn(obj,k));
}
function requireBaseline(schema,pinnedSourceCommit){
 if(!isRecord(schema)||schema.formatVersion!==1||
    !Array.isArray(schema.tables)||schema.tables.length!==49)
  reject('INVALID_FROZEN_SCHEMA');
 if(pinnedSourceCommit!==SOURCE_COMMIT)reject('SOURCE_COMMIT_MISMATCH');
 if(JSON.stringify(schema)!==JSON.stringify(BASELINE))
  reject('INVALID_FROZEN_SCHEMA');
 const names=new Set();
 for(const group of schema.tables){
  if(!isRecord(group)||typeof group.sheetKey!=='string'||names.has(group.sheetKey)||
     !Array.isArray(group.columns)||group.columns.length===0||
     group.columns.some(x=>typeof x!=='string'))
   reject('INVALID_FROZEN_SCHEMA');
  names.add(group.sheetKey);
  if(Object.hasOwn(RECORD_KEYS,group.sheetKey)&&
     !group.columns.includes(RECORD_KEYS[group.sheetKey]))
   reject('INVALID_FROZEN_ID_FIELD');
 }
}
function verifyExport(input,schema,pinned,which){
 if(!isRecord(input)||input.formatVersion!==1||
    input.sourceCommit!==pinned||!isRecord(input.groups)||
    !exactKeys(input,['formatVersion','sourceCommit','groups']))
  reject('INVALID_EXPORT_OR_SOURCE_COMMIT');
 const tables=schema.tables;
 const keys=tables.map(t=>t.sheetKey);
 if(Object.keys(input.groups).length!==keys.length||
    keys.some(k=>!Object.hasOwn(input.groups,k)))
  reject('GROUP_COVERAGE_MISMATCH');
 const result=new Map();
 for(const {sheetKey,columns} of tables){
  const group=input.groups[sheetKey];
  if(!exactKeys(group,['headers','rows'])||
     !Array.isArray(group.headers)||!Array.isArray(group.rows)||
     group.headers.length!==columns.length||
     columns.some((h,i)=>group.headers[i]!==h))
   reject('HEADER_MISMATCH',sheetKey);
  if(group.rows.length>MAX_ROWS_PER_GROUP)reject('ROW_COUNT_EXCEEDS_BOUND',sheetKey);
  const seenRows=new Set(),seenIDs=new Set();
  const keyIndex=Object.hasOwn(RECORD_KEYS,sheetKey)?
    columns.indexOf(RECORD_KEYS[sheetKey]):-1;
  const rows=[];
  for(const row of group.rows){
   if(!exactKeys(row,['sheetRow','cells']))
    reject('INVALID_ROW_FORMAT',sheetKey);
   if(!Number.isSafeInteger(row.sheetRow)||row.sheetRow<2)
    reject('INVALID_ROW_PROVENANCE',sheetKey);
   if(seenRows.has(row.sheetRow))
    reject('DUPLICATE_ROW_PROVENANCE',sheetKey);
   seenRows.add(row.sheetRow);
   if(!Array.isArray(row.cells)||row.cells.length!==columns.length||
      !Array.from({length:row.cells.length},(_,i)=>Object.hasOwn(row.cells,i)).every(Boolean))
    reject('INVALID_ROW_WIDTH',sheetKey);
   if(row.cells.some(cell=>typeof cell!=='string'))
    reject('UNSAFE_TEXT_VALUE',sheetKey);
   if(keyIndex!==-1){
    const key=row.cells[keyIndex];
    if(!key.trim())reject('MISSING_RECORD_ID',sheetKey);
    if(seenIDs.has(key))reject('DUPLICATE_RECORD_ID',sheetKey);
    seenIDs.add(key);
   }
   rows.push({sheetRow:row.sheetRow,cells:row.cells});
  }
  rows.sort((a,b)=>a.sheetRow-b.sheetRow);
  const digest=createHash('sha256').update(JSON.stringify([
   'SherERP_M02_offline_source_parity_v1',sheetKey,columns,
   rows.map(row=>[row.sheetRow,row.cells])
  ])).digest('hex');
  result.set(sheetKey,{rows,digest});
 }
 return result;
}
function addIssue(issues,sourceGroup,code,count){
 if(count>0)issues.push({sourceGroup,code,count});
}

/**
 * Compare two explicitly supplied offline source-shaped exports, including
 * physical sheet-row provenance. Zero user-controlled text is returned.
 * No output from this function certifies that D1 data was imported.
 */
export function reviewOfflineSourceParity({
 schema,pinnedSourceCommit,sourceExport,candidateExport
}={}){
 requireBaseline(schema,pinnedSourceCommit);
 const source=verifyExport(sourceExport,schema,pinnedSourceCommit,'source');
 const candidate=verifyExport(candidateExport,schema,pinnedSourceCommit,'candidate');
 const groups=[],issues=[];
 let sourceRows=0,candidateRows=0;
 for(const {sheetKey} of schema.tables){
  const left=source.get(sheetKey),right=candidate.get(sheetKey);
  sourceRows+=left.rows.length;
  candidateRows+=right.rows.length;
  const a=new Map(left.rows.map(row=>[row.sheetRow,row.cells]));
  const b=new Map(right.rows.map(row=>[row.sheetRow,row.cells]));
  const presentLeft=new Set(a.keys()),presentRight=new Set(b.keys());
  const provenanceMissing=[...presentLeft].filter(row=>!presentRight.has(row)).length+
                          [...presentRight].filter(row=>!presentLeft.has(row)).length;
  const rowContentDiff=[...a].filter(([index,cells])=>
    b.has(index)&&cells.some((value,col)=>b.get(index)[col]!==value)).length;
  const groupIssues=[];
  addIssue(groupIssues,sheetKey,'ROW_COUNT_MISMATCH',Math.abs(left.rows.length-right.rows.length));
  addIssue(groupIssues,sheetKey,'ROW_PROVENANCE_MISMATCH',provenanceMissing);
  addIssue(groupIssues,sheetKey,'CELL_MISMATCH',rowContentDiff);
  issues.push(...groupIssues);
  groups.push({
   sourceGroup:sheetKey,sourceRows:left.rows.length,candidateRows:right.rows.length,
   sourceDigest:left.digest,candidateDigest:right.digest,
   exactTextParity:left.digest===right.digest&&groupIssues.length===0
  });
 }
 return {
  formatVersion:1,sourceGroups:schema.tables.length,sourceRows,candidateRows,
  exactTextParity:issues.length===0&&groups.every(g=>g.exactTextParity),
  d1Verified:false,productionReady:false,issues,groups
 };
}


/**
 * Historical source-ID-only reference-review evidence (M02-safe).
 * These are review hints, not FK DDL, auto-identity joins or posting guards.
 * Historical orphan references may be legitimate; never synthesize parents.
 */
const SOURCE_REFERENCE_RULES=Object.freeze([
  [
    "BUNDLE_COMPONENTS",
    "Bundle Product ID",
    "PRODUCTS",
    true
  ],
  [
    "BUNDLE_COMPONENTS",
    "Component Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SALE_BUNDLE_COMPONENTS",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALE_BUNDLE_COMPONENTS",
    "Bundle Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SALE_BUNDLE_COMPONENTS",
    "Component Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SUPPLIER_LEDGER",
    "Supplier ID",
    "SUPPLIERS",
    true
  ],
  [
    "STOCK_LOTS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "STOCK_LOTS",
    "Purchase ID",
    "PURCHASES",
    false
  ],
  [
    "STOCK_LOTS",
    "Supplier ID",
    "SUPPLIERS",
    false
  ],
  [
    "SALE_ITEM_LOTS",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALE_ITEM_LOTS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SALE_ITEM_LOTS",
    "Lot ID",
    "STOCK_LOTS",
    false
  ],
  [
    "SALE_ITEM_LOTS",
    "Supplier ID",
    "SUPPLIERS",
    false
  ],
  [
    "STOCK_LOT_COST_CORRECTIONS",
    "Lot ID",
    "STOCK_LOTS",
    false
  ],
  [
    "STOCK_LOT_COST_CORRECTIONS",
    "Product ID",
    "PRODUCTS",
    false
  ],
  [
    "PURCHASES",
    "Supplier ID",
    "SUPPLIERS",
    false
  ],
  [
    "PURCHASE_ITEMS",
    "Purchase ID",
    "PURCHASES",
    true
  ],
  [
    "PURCHASE_ITEMS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SALES",
    "Customer ID",
    "CUSTOMERS",
    false
  ],
  [
    "SALE_PAYMENTS",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALE_PAYMENTS",
    "Bank Account ID",
    "BANK_ACCOUNTS",
    false
  ],
  [
    "SALE_PAYMENTS",
    "Operation ID",
    "SALE_POSTING_JOURNAL",
    false
  ],
  [
    "SALE_POSTING_JOURNAL",
    "Invoice ID",
    "SALES",
    false
  ],
  [
    "SALE_POSTING_JOURNAL",
    "Return ID",
    "SALES_RETURN",
    false
  ],
  [
    "SALES_DRAFTS",
    "Customer ID",
    "CUSTOMERS",
    false
  ],
  [
    "SALE_ITEMS",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALE_ITEMS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "CUSTOMER_LEDGER",
    "Customer ID",
    "CUSTOMERS",
    true
  ],
  [
    "CUSTOMER_LEDGER",
    "Allocated Invoice ID",
    "SALES",
    false
  ],
  [
    "EXPENSES",
    "Category ID",
    "EXPENSE_CATEGORIES",
    false
  ],
  [
    "EXPENSES",
    "Bank Account ID",
    "BANK_ACCOUNTS",
    false
  ],
  [
    "STOCK_MOVEMENT",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "STOCK_MOVEMENT",
    "Lot ID",
    "STOCK_LOTS",
    false
  ],
  [
    "SALES_RETURN",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALES_RETURN",
    "Customer ID",
    "CUSTOMERS",
    false
  ],
  [
    "SALES_RETURN_ITEMS",
    "Return ID",
    "SALES_RETURN",
    true
  ],
  [
    "SALES_RETURN_ITEMS",
    "Invoice ID",
    "SALES",
    true
  ],
  [
    "SALES_RETURN_ITEMS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "SALES_RETURN_ITEMS",
    "Supplier ID",
    "SUPPLIERS",
    false
  ],
  [
    "PURCHASE_RETURN",
    "Purchase ID",
    "PURCHASES",
    true
  ],
  [
    "PURCHASE_RETURN",
    "Supplier ID",
    "SUPPLIERS",
    false
  ],
  [
    "PURCHASE_RETURN_ITEMS",
    "Return ID",
    "PURCHASE_RETURN",
    true
  ],
  [
    "PURCHASE_RETURN_ITEMS",
    "Purchase ID",
    "PURCHASES",
    true
  ],
  [
    "PURCHASE_RETURN_ITEMS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "INVOICE_EDIT_LOG",
    "Invoice ID",
    "SALES",
    false
  ],
  [
    "BANK_BOOK",
    "Bank Account ID",
    "BANK_ACCOUNTS",
    true
  ],
  [
    "BANK_TRANSFERS",
    "From Account ID",
    "BANK_ACCOUNTS",
    true
  ],
  [
    "BANK_TRANSFERS",
    "To Account ID",
    "BANK_ACCOUNTS",
    true
  ],
  [
    "FINANCE_TRANSACTIONS",
    "Person ID",
    "FINANCE_PERSONS",
    false
  ],
  [
    "FINANCE_TRANSACTIONS",
    "Bank Account ID",
    "BANK_ACCOUNTS",
    false
  ],
  [
    "VENDOR_SOURCING",
    "Invoice ID",
    "SALES",
    false
  ],
  [
    "VENDOR_SOURCING",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "VENDOR_SOURCING",
    "Vendor ID",
    "VENDORS",
    true
  ],
  [
    "VENDOR_LEDGER",
    "Vendor ID",
    "VENDORS",
    true
  ],
  [
    "VENDOR_RETURNS",
    "Vendor ID",
    "VENDORS",
    true
  ],
  [
    "VENDOR_RETURNS",
    "Sourcing ID",
    "VENDOR_SOURCING",
    false
  ],
  [
    "VENDOR_RETURNS",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "VENDOR_ISSUES",
    "Vendor ID",
    "VENDORS",
    true
  ],
  [
    "VENDOR_ISSUES",
    "Product ID",
    "PRODUCTS",
    true
  ],
  [
    "VENDOR_RETURNS_RECEIVED",
    "Vendor ID",
    "VENDORS",
    true
  ],
  [
    "VENDOR_RETURNS_RECEIVED",
    "Issue ID",
    "VENDOR_ISSUES",
    false
  ],
  [
    "VENDOR_RETURNS_RECEIVED",
    "Product ID",
    "PRODUCTS",
    true
  ]
]);
const REVIEW_ROW_SAMPLE_LIMIT=20;

export function reviewOfflineSourceReferences({schema,pinnedSourceCommit,sourceExport}={}){
 requireBaseline(schema,pinnedSourceCommit);
 const snapshot=verifyExport(sourceExport,schema,pinnedSourceCommit,'source');
 const groupHeaders=new Map(schema.tables.map(t=>[t.sheetKey,t.columns]));
 const findings=[];
 let checkedReferences=0,resolvedReferences=0,unresolvedReferences=0,missingRequiredReferences=0;
 for(const [sourceGroup,referenceField,targetGroup,required] of SOURCE_REFERENCE_RULES){
  const from=groupHeaders.get(sourceGroup),to=groupHeaders.get(targetGroup);
  const targetKey=RECORD_KEYS[targetGroup];
  if(!from?.includes(referenceField)||!to?.includes(targetKey))
   reject('INVALID_FROZEN_REFERENCE_RULE');
  const sourceColumn=from.indexOf(referenceField),targetColumn=to.indexOf(targetKey);
  const targetIds=new Set(snapshot.get(targetGroup).rows.map(r=>r.cells[targetColumn]));
  const unresolved=[],missing=[];
  for(const row of snapshot.get(sourceGroup).rows){
   const identifier=row.cells[sourceColumn];
   if(identifier===''){
    if(required){missingRequiredReferences++;missing.push(row.sheetRow);}
   }else{
    checkedReferences++;
    if(targetIds.has(identifier))resolvedReferences++;
    else{unresolvedReferences++;unresolved.push(row.sheetRow);}
   }
  }
  for(const [code,rows] of [['MISSING_REQUIRED_SOURCE_ID',missing],['UNRESOLVED_SOURCE_ID',unresolved]]){
   if(!rows.length)continue;
   findings.push({sourceGroup,targetGroup,referenceField,code,count:rows.length,
    sampleSheetRows:rows.slice().sort((a,b)=>a-b).slice(0,REVIEW_ROW_SAMPLE_LIMIT)});
  }
 }
 return {
  formatVersion:1,sourceGroups:schema.tables.length,
  rulesChecked:SOURCE_REFERENCE_RULES.length,
  checkedReferences,resolvedReferences,unresolvedReferences,missingRequiredReferences,
  humanReviewRequired:findings.length>0,automaticLinksCreated:0,
  resolvedByNameOrPhone:false,d1Verified:false,productionReady:false,findings
 };
}

async function main(){
 // Explicit paths only: never fetch source over network or query production.
 if(process.argv.length===4&&process.argv[2]==='--references'){
  const sourceText=await readFile(resolve(process.argv[3]),'utf8');
  const review=reviewOfflineSourceReferences({
   schema:BASELINE,pinnedSourceCommit:SOURCE_COMMIT,
   sourceExport:JSON.parse(sourceText)
  });
  process.stdout.write(JSON.stringify(review,null,2)+'\n');
  if(review.humanReviewRequired)process.exitCode=1;
  return;
 }
 if(process.argv.length!==4)reject('REQUIRE_TWO_EXPLICIT_LOCAL_EXPORT_PATHS');
 const [sourcePath,candidatePath]=process.argv.slice(2);
 const [sourceText,candidateText]=await Promise.all([
  readFile(resolve(sourcePath),'utf8'),readFile(resolve(candidatePath),'utf8')
 ]);
 const report=reviewOfflineSourceParity({
  schema:BASELINE,pinnedSourceCommit:SOURCE_COMMIT,
  sourceExport:JSON.parse(sourceText),candidateExport:JSON.parse(candidateText)
 });
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(!report.exactTextParity)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{
  // Never forward private filenames, cell values, raw IDs or parser errors.
  process.stderr.write('M02 offline parity rejected: invalid or inaccessible snapshot (values withheld)\n');
  process.exitCode=1;
 });
}
