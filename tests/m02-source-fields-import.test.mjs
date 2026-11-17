import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildM02FieldPreservationReview} from '../scripts/dry-run-source-fields.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const schema=read('docs/baseline/schema-inventory.json');
const pin=read('docs/baseline/source-manifest.json').source.commit;
const review=(overrides={})=>buildM02FieldPreservationReview({
 schema,pinnedSourceCommit:pin,...overrides
});
const group=(r,key)=>r.groups.find(g=>g.sourceGroup===key);
const field=(r,key,name)=>group(r,key)?.columns.find(f=>f.sourceColumn===name);

test('every pinned source column of all 49 groups is represented exactly once',()=>{
 const r=review();
 assert.equal(r.formatVersion,1);
 assert.equal(r.sourceCommit,pin);
 assert.equal(r.sourceGroups,49);
 assert.equal(r.groups.length,49);
 const expected=schema.tables.reduce((n,g)=>n+g.columns.length,0);
 assert.equal(r.originalColumnObligations,expected);
 assert.ok(expected>400);
 assert.deepEqual(r.groups.map(g=>g.sourceGroup),schema.tables.map(g=>g.sheetKey));
 for(const original of schema.tables){
  const g=group(r,original.sheetKey);
  assert.equal(g.sourceColumnCount,original.columns.length);
  assert.deepEqual(g.columns.map(x=>x.sourceColumn),original.columns);
  assert.equal(new Set(g.columns.map(x=>x.sourceColumn)).size,original.columns.length);
 }
});
test('all field obligations are exact text, nondeployable, without inferred target columns',()=>{
 const r=review();
 for(const g of r.groups){
  assert.equal(g.sourceRowProvenanceRequired,true);
  assert.equal(g.sourceGroupReviewApproved,false);
  assert.equal(g.originalSourcePreserved,false);
  for(const column of g.columns){
   assert.equal(column.sourceStorage,'exact-original-text');
   assert.equal(column.operationalTargetColumn,null);
   assert.equal(column.operationalMappingApproved,false);
   assert.equal(column.autoConvertToNumberOrDate,false);
   assert.equal(column.reconciliationReviewRequired,true);
   assert.equal(typeof column.semanticHazard,'string');
  }
 }
 assert.equal(r.reviewedOperationalMappings,0);
 assert.equal(r.sourceRowsRead,false);
 assert.equal(r.sourceReconciled,false);
 assert.equal(r.productionReady,false);
 assert.equal(r.d1WriterAuthorized,false);
});
test('SETTINGS Value never assumed public or monetary, USERS and SESSIONS credentials classified secret',()=>{
 const r=review();
 assert.equal(field(r,'SETTINGS','Value').semanticHazard,'configuration-secret');
 assert.equal(field(r,'SETTINGS','Key').semanticHazard,'legacy-id');
 assert.equal(field(r,'USERS','Password Hash').semanticHazard,'credential-secret');
 assert.equal(field(r,'USERS','Password Salt').semanticHazard,'credential-secret');
 assert.equal(field(r,'SESSIONS','Token').semanticHazard,'credential-secret');
 assert.equal(field(r,'BANK_ACCOUNTS','Account Number').semanticHazard,'sensitive-identifier');
 for(const [g,c] of [['USERS','Password Hash'],['SESSIONS','Token'],['SETTINGS','Value']]){
  assert.equal(field(r,g,c).sourceValueMayBePrivate,true);
 }
});
test('separate Vendor payable and receivable, Customer/Supplier advances remain financial source strings',()=>{
 const r=review();
 for(const [g,c] of [
  ['VENDORS','Current Due'],['VENDORS','Current Receivable'],
  ['CUSTOMERS','Opening Balance'],['CUSTOMERS','Current Due'],
  ['SUPPLIERS','Opening Balance'],['SUPPLIERS','Current Due'],
  ['BANK_ACCOUNTS','Opening Balance'],['BANK_ACCOUNTS','Current Balance'],
  ['VENDOR_LEDGER','Debit'],['VENDOR_LEDGER','Credit'],
  ['FINANCE_TRANSACTIONS','Amount'],
  ['OPENING_BALANCE_EDIT_LOG','Old Opening Balance'],
  ['OPENING_BALANCE_EDIT_LOG','New Opening Balance']
 ])assert.equal(field(r,g,c).semanticHazard,'financial-amount',g+' '+c);
 assert.equal(r.crossRoleAutoNettingAllowed,false);
 assert.equal(r.payeeCreatesLiability,false);
 assert.equal(r.historicalOpeningPostsCashOrBank,false);
 assert.equal(r.grossFinancialAccountKinds.length,7);
});
test('purchase, sale, returns, payments and historical corrections retain amounts without rounding or folding',()=>{
 const r=review();
 for(const [g,c] of [
  ['PRODUCTS','Purchase Price'],['PRODUCTS','Selling Price'],
  ['PURCHASE_ITEMS','Line Total'],['PURCHASES','Paid Amount'],
  ['SALE_ITEMS','Unit Price'],['SALES','Grand Total'],
  ['SALE_PAYMENTS','Tendered Amount'],['SALE_PAYMENTS','Applied Amount'],
  ['SALE_PAYMENTS','Change Amount'],['SALES_RETURN','Total Return Amount'],
  ['PURCHASE_RETURN_ITEMS','Return Price'],
  ['STOCK_LOT_COST_CORRECTIONS','Historical COGS Delta']
 ])assert.equal(field(r,g,c).semanticHazard,'financial-amount',g+' '+c);
 assert.equal(r.roundSourceMoneyOnImport,false);
});
test('stock, lot, multi-unit, bundle and return quantities cannot be silently converted',()=>{
 const r=review();
 for(const [g,c] of [
  ['PRODUCTS','Current Stock'],['PRODUCTS','Minimum Stock'],
  ['STOCK_LOTS','Original Quantity'],['STOCK_LOTS','Remaining Quantity'],
  ['PURCHASE_ITEMS','Quantity'],
  ['BUNDLE_COMPONENTS','Quantity Per Set'],
  ['SALE_BUNDLE_COMPONENTS','Sets Sold'],
  ['SALE_ITEM_LOTS','Quantity'],
  ['STOCK_MOVEMENT','Quantity In'],['STOCK_MOVEMENT','Quantity Out'],
  ['PURCHASE_RETURN_ITEMS','Return Quantity'],
  ['SALES_RETURN_ITEMS','Return Quantity']
 ])assert.equal(field(r,g,c).semanticHazard,'stock-quantity',g+' '+c);
});
test('legacy IDs, names and phones retain namespaces and textual precision',()=>{
 const r=review();
 for(const [g,c] of [
  ['CUSTOMERS','Customer ID'],['SUPPLIERS','Supplier ID'],
  ['VENDORS','Vendor ID'],['PRODUCTS','Product ID'],
  ['BANK_BOOK','Bank Account ID'],['SALE_PAYMENTS','Operation ID'],
  ['FINANCE_PERSONS','Person ID']
 ])assert.equal(field(r,g,c).semanticHazard,'legacy-id',g+' '+c);
 for(const [g,c] of [
  ['CUSTOMERS','Phone'],['SUPPLIERS','Phone'],
  ['VENDORS','Phone'],['FINANCE_PERSONS','Phone'],
  ['USERS','Mobile Number'],['SALES','Customer Phone']
 ]){
  assert.equal(field(r,g,c).semanticHazard,'sensitive-identifier',g+' '+c);
  assert.equal(field(r,g,c).sourceValueMayBePrivate,true);
 }
 assert.equal(field(r,'CUSTOMERS','Customer Name').semanticHazard,'private-display-text');
 assert.equal(r.autoMergePartyByNameOrPhoneAllowed,false);
});
test('date, timestamp, state and backdated metadata remain source exact strings',()=>{
 const r=review();
 for(const [g,c] of [
  ['PURCHASES','Date'],['SALES','Time'],['SALES','Created At'],
  ['LOGS','Timestamp'],['SESSIONS','Expires At'],
  ['CASH_SESSIONS','Opened At'],['CASH_SESSIONS','Closed At']
 ])assert.equal(field(r,g,c).semanticHazard,'chronology-text',g+' '+c);
 for(const [g,c] of [
  ['SALES','Is Backdated'],['SALES','Is Deleted'],
  ['VENDORS','Is Deleted'],['SESSIONS','Last Activity']
 ]){
  assert.ok(field(r,g,c).semanticHazard==='state-flag'||
   field(r,g,c).semanticHazard==='chronology-text');
 }
 assert.equal(field(r,'SALES','Deleted At').semanticHazard,'deletion-provenance');
});
test('drafts and audit JSON, serialized permissions and source multi-unit revisions require explicit review',()=>{
 const r=review();
 for(const [g,c] of [
  ['SALES_DRAFTS','Items JSON'],['SALES_DRAFTS','Payment JSON'],
  ['INVOICE_EDIT_LOG','Before Return Items JSON'],
  ['INVOICE_EDIT_LOG','After Return Items JSON'],
  ['ROLES','Permissions'],['ROLES','Allowed Modules']
 ])assert.equal(field(r,g,c).semanticHazard,'structured-source-text');
 assert.equal(field(r,'PRODUCTS','Bundle Revision').semanticHazard,'version-revision');
 assert.equal(field(r,'SALE_PAYMENTS','Revision').semanticHazard,'version-revision');
});
test('source diagnostic LOGS has no invented unique Log ID; explicit row provenance applies',()=>{
 const r=review();
 assert.equal(group(r,'LOGS').sourceRecordIdColumn,null);
 assert.equal(group(r,'LOGS').identityBasis,'physical-sheet-row');
 assert.equal(group(r,'LOGS').sourceRowProvenanceRequired,true);
 assert.equal(field(r,'LOGS','Message').semanticHazard,'review-text');
});
test('repeated parent keys for line item and allocation groups do not become unique identity',()=>{
 const r=review();
 for(const key of [
  'BUNDLE_COMPONENTS','SALE_BUNDLE_COMPONENTS','SALE_ITEM_LOTS',
  'PURCHASE_ITEMS','SALE_ITEMS','SALES_RETURN_ITEMS','PURCHASE_RETURN_ITEMS'
 ]){
  assert.equal(group(r,key).sourceRecordIdColumn,null);
  assert.equal(group(r,key).identityBasis,'physical-sheet-row');
 }
 assert.equal(group(r,'PRODUCTS').sourceRecordIdColumn,'Product ID');
});
test('unclassified fields stay subject to review, not automatically omitted or authorized',()=>{
 const r=review();
 for(const [g,c] of [
  ['CUSTOMERS','Notes'],['PRODUCTS','Brand'],
  ['VENDOR_RETURNS','Reason'],['CASH_BOOK','Description']
 ]){
  assert.equal(field(r,g,c).semanticHazard,'review-text');
  assert.equal(field(r,g,c).reconciliationReviewRequired,true);
 }
});
test('exact pinned Config group schemas and commit are mandatory',()=>{
 const copied=structuredClone(schema);
 copied.tables[0].columns[0]='Altered product id';
 assert.throws(()=>review({schema:copied}),/frozen|schema|drift/i);
 const removed=structuredClone(schema);removed.tables.pop();
 assert.throws(()=>review({schema:removed}),/frozen|schema|drift/i);
 const shuffled=structuredClone(schema);shuffled.tables.reverse();
 assert.throws(()=>review({schema:shuffled}),/frozen|schema|drift/i);
 assert.throws(()=>review({pinnedSourceCommit:'0'.repeat(40)}),/pin|commit/i);
});
test('no access to real source rows or private data through metadata-only output',()=>{
 const r=review();
 const body=JSON.stringify(r);
 assert.doesNotMatch(body,/01700000000|Rahim Private|passwordHashValue|realCustomerAddress/);
 assert.equal(r.privateExportRequested,false);
 assert.equal(r.actualD1ReadbackVerified,false);
 assert.equal(r.sourceReconciled,false);
});
test('CLI check and JSON are deterministic and reject other modes or path inputs',()=>{
 const script=new URL('../scripts/dry-run-source-fields.mjs',import.meta.url).pathname;
 const a=spawnSync(process.execPath,[script,'--check'],{encoding:'utf8'});
 assert.equal(a.status,0,a.stderr);assert.match(a.stdout,/49/);
 const b=spawnSync(process.execPath,[script,'--json'],{encoding:'utf8'});
 assert.equal(b.status,0,b.stderr);
 assert.equal(JSON.parse(b.stdout).originalColumnObligations,
  schema.tables.reduce((n,g)=>n+g.columns.length,0));
 const again=spawnSync(process.execPath,[script,'--json'],{encoding:'utf8'});
 assert.equal(again.stdout,b.stdout);
 const c=spawnSync(process.execPath,[script,'--remote'],{encoding:'utf8'});
 assert.equal(c.status,1);
 assert.equal(c.stdout,'');
 assert.doesNotMatch(c.stderr,/Password Salt|Customer Name/);
});
