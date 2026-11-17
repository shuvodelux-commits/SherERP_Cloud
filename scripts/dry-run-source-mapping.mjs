#!/usr/bin/env node
/**
 * M02 Run 2 — source-to-D1 migration mapping PROPOSAL only.
 * Canonical M03 owns all executable D1 schema, shared posting and RPC.
 * Never changes production, read-only frozen GAS, or any source export.
 */
import {readFile,readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMigrationCoverage} from './audit-migration-coverage.mjs';
import {inventorySchema} from './inventory-schema.mjs';

const FROZEN=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const UNIQUE_BY_POSITION_ONLY=new Set([
 'BUNDLE_COMPONENTS','SALE_BUNDLE_COMPONENTS','SALE_ITEM_LOTS',
 'PURCHASE_ITEMS','SALE_ITEMS','SALES_RETURN_ITEMS',
 'PURCHASE_RETURN_ITEMS','LOGS'
]);

// Frozen evidence *labels*, not deployment confirmation. If M03 adds
// actual reviewed schema coverage, refresh this in a dedicated shared
// contract PR. Never allow invented table names into M02 reports.
const EXPECTED_PARTIAL_D1_EVIDENCE=Object.freeze({
  "SETTINGS": [
    "catalog-schema-only",
    "settings"
  ],
  "PRODUCT_CATEGORIES": [
    "catalog-schema-only",
    "product_categories"
  ],
  "PRODUCT_UNITS": [
    "catalog-schema-only",
    "product_units"
  ],
  "EXPENSE_CATEGORIES": [
    "catalog-schema-only",
    "expense_categories"
  ],
  "LOGS": [
    "diagnostic-schema-only",
    "legacy_error_logs"
  ],
  "PRODUCTS": [
    "product-source-archive-only",
    "legacy_product_snapshots"
  ],
  "DELETE_LOG": [
    "audit-schema-only",
    "legacy_delete_log"
  ],
  "SALES_DRAFT_AUDIT": [
    "audit-schema-only",
    "legacy_sales_draft_audit"
  ],
  "INVOICE_EDIT_LOG": [
    "audit-schema-only",
    "legacy_invoice_edit_audit"
  ],
  "OPENING_BALANCE_EDIT_LOG": [
    "audit-schema-only",
    "legacy_opening_balance_edit_audit"
  ],
  "STOCK_LOT_COST_CORRECTIONS": [
    "audit-schema-only",
    "legacy_stock_lot_cost_corrections"
  ],
  "CUSTOMERS": [
    "party-identity-only",
    "party_legacy_links"
  ],
  "SUPPLIERS": [
    "party-identity-only",
    "party_legacy_links"
  ],
  "VENDORS": [
    "party-identity-only",
    "party_legacy_links"
  ],
  "FINANCE_PERSONS": [
    "party-identity-only",
    "party_legacy_links"
  ],
  "EXPENSE_PAYEES": [
    "party-identity-only",
    "party_legacy_links"
  ],
  "USERS": [
    "auth-local-only",
    "auth_users"
  ],
  "ROLES": [
    "auth-local-only",
    "auth_roles"
  ],
  "SESSIONS": [
    "auth-local-only",
    "auth_sessions"
  ]
});

const ALLOWED_EVIDENCE=new Set([
 'unmapped','catalog-schema-only','diagnostic-schema-only',
 'audit-schema-only','product-source-archive-only',
 'party-identity-only','auth-local-only'
]);

// Every group is intentionally assigned to ONE downstream review lane.
// These are semantic assignments, NOT grants to modify M03 shared files.
const LANES=Object.freeze([
 {domain:'stock-and-products',owner:'M05',reconcile:'original-lot-and-unit-source-text',groups:[
  'PRODUCTS','PRODUCT_CATEGORIES','PRODUCT_UNITS','BUNDLE_COMPONENTS',
  'SALE_BUNDLE_COMPONENTS','STOCK_LOTS','SALE_ITEM_LOTS','PURCHASES',
  'PURCHASE_ITEMS','STOCK_MOVEMENT','VENDOR_SOURCING'
 ]},
 {domain:'sales-and-payments',owner:'M06',reconcile:'sale-cash-split-tender-and-original-draft',groups:[
  'SALES','SALE_ITEMS','SALE_PAYMENTS','SALE_POSTING_JOURNAL',
  'SALES_DRAFTS','SALES_DRAFT_AUDIT'
 ]},
 {domain:'returns-and-corrections',owner:'M07',reconcile:'original-posting-exactly-once-reversal',groups:[
  'SALES_RETURN','SALES_RETURN_ITEMS','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS',
  'INVOICE_EDIT_LOG','DELETE_LOG','STOCK_LOT_COST_CORRECTIONS',
  'VENDOR_RETURNS','VENDOR_ISSUES','VENDOR_RETURNS_RECEIVED'
 ]},
 {domain:'party-identity',owner:'M08',reconcile:'party-original-id-with-distinct-gross-accounts',groups:[
  'CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'
 ]},
 {domain:'cash-bank-finance',owner:'M08',reconcile:'gross-role-account-and-historical-opening-separation',groups:[
  'CUSTOMER_LEDGER','SUPPLIER_LEDGER','VENDOR_LEDGER','CASH_BOOK','CASH_SESSIONS',
  'BANK_ACCOUNTS','BANK_BOOK','BANK_TRANSFERS','FINANCE_TRANSACTIONS',
  'EXPENSES','EXPENSE_CATEGORIES','OPENING_BALANCE_EDIT_LOG'
 ]},
 {domain:'private-auth',owner:'M04',reconcile:'staff-source-identity-and-revocation',groups:[
  'USERS','ROLES','SESSIONS'
 ]},
 {domain:'tenant-settings',owner:'M09',reconcile:'private-key-text-and-report-eligibility',groups:[
  'SETTINGS'
 ]},
 {domain:'diagnostics',owner:'M11',reconcile:'idless-source-row-provenance-only',groups:[
  'LOGS'
 ]}
]);

// Only source-exact field labels; these are prompts for downstream
// semantic review, not exhaustive operational SQL field mappings.
// All sourceColumns are still exact-text preservation obligations.
const REVIEW_CRITICAL_FIELDS=Object.freeze({
 PRODUCTS:['Product ID','Current Stock','Purchase Price','Selling Price','Bundle Revision'],
 STOCK_LOTS:['Lot ID','Purchase Date','Original Quantity','Remaining Quantity','Supplier ID'],
 SALE_ITEM_LOTS:['Invoice ID','Product ID','Lot ID','Quantity','Unit Cost'],
 PURCHASES:['Purchase ID','Paid Amount','Due Amount','Is Deleted'],
 PURCHASE_ITEMS:['Purchase ID','Product ID','Quantity','Line Total'],
 SALES:['Invoice ID','Grand Total','Paid Amount','Due Amount','Source Draft ID'],
 SALE_PAYMENTS:['Payment ID','Tendered Amount','Applied Amount','Change Amount','Operation ID','Reversal Operation ID'],
 SALE_POSTING_JOURNAL:['Operation ID','Payload Hash','State','Last Completed Stage'],
 SALES_RETURN:['Return ID','Return Operation ID','Edit Version','Total Return Amount'],
 SALES_RETURN_ITEMS:['Return ID','Return Quantity','Line Total','Supplier ID'],
 PURCHASE_RETURN:['Return ID','Purchase ID','Supplier ID','Is Deleted'],
 PURCHASE_RETURN_ITEMS:['Return ID','Purchase ID','Product ID','Return Quantity'],
 CASH_SESSIONS:['Session ID','Opening Cash','Expected Cash','Counted Cash','Variance'],
 BANK_BOOK:['Entry ID','Bank Account ID','Debit','Credit','Balance'],
 BANK_TRANSFERS:['Transfer ID','From Account ID','To Account ID','Amount'],
 CUSTOMERS:['Customer ID','Opening Balance','Current Due'],
 SUPPLIERS:['Supplier ID','Opening Balance','Current Due'],
 VENDORS:['Current Due','Current Receivable'],
 FINANCE_PERSONS:['Person ID','Person Type','Roles'],
 FINANCE_TRANSACTIONS:['Finance ID','Transaction Type','Person ID','Amount'],
 CUSTOMER_LEDGER:['Ledger ID','Customer ID','Debit','Credit','Balance'],
 SUPPLIER_LEDGER:['Ledger ID','Supplier ID','Debit','Credit','Balance'],
 VENDOR_LEDGER:['Ledger ID','Vendor ID','Debit','Credit','Balance Type','Balance'],
 OPENING_BALANCE_EDIT_LOG:['Old Opening Balance','New Opening Balance','Delta','Current Due Before','Current Due After'],
 USERS:['User ID','Password Hash','Password Salt','Status'],
 SESSIONS:['Token','User ID','Expires At','Last Activity'],
 SETTINGS:['Key','Value'],
 LOGS:['Timestamp','Context','Message']
});


// One DISTINCT proposed logical data model per original source group.
// These are review labels, explicitly NOT existing D1 tables or migrations.
const LOGICAL_D1_PROPOSALS=Object.freeze({
  "PRODUCTS": "product-master-revision-and-raw-history",
  "BUNDLE_COMPONENTS": "bundle-component-recipe-version-history",
  "SALE_BUNDLE_COMPONENTS": "sold-bundle-component-revision-history",
  "SUPPLIERS": "party-supplier-legacy-link-and-gross-accounts",
  "SUPPLIER_LEDGER": "supplier-payable-advance-ledger-history",
  "STOCK_LOTS": "purchase-lot-stock-and-fifo-provenance",
  "SALE_ITEM_LOTS": "invoice-line-original-lot-consumption",
  "STOCK_LOT_COST_CORRECTIONS": "original-lot-cost-correction-audit",
  "PURCHASES": "purchase-header-payment-and-original-ids",
  "PURCHASE_ITEMS": "purchase-line-source-units-and-cost-history",
  "SALES": "invoice-header-customer-and-original-payment",
  "SALE_PAYMENTS": "split-tender-and-application-history",
  "SALE_POSTING_JOURNAL": "original-operation-idempotency-journal",
  "SALES_DRAFTS": "sales-draft-original-json-and-version-history",
  "SALES_DRAFT_AUDIT": "draft-actor-version-historical-audit",
  "SALE_ITEMS": "invoice-line-source-unit-and-price-history",
  "CUSTOMERS": "party-customer-legacy-link-and-advance",
  "CUSTOMER_LEDGER": "customer-receivable-advance-ledger-history",
  "EXPENSES": "expense-source-payment-and-liability-history",
  "EXPENSE_CATEGORIES": "expense-category-source-identity-history",
  "EXPENSE_PAYEES": "party-payee-identity-without-auto-liability",
  "CASH_BOOK": "cash-debit-credit-original-entry-history",
  "STOCK_MOVEMENT": "original-product-stock-movement-audit",
  "SETTINGS": "tenant-settings-exact-key-value-history",
  "SALES_RETURN": "original-sale-return-operation-and-version",
  "SALES_RETURN_ITEMS": "original-invoice-line-lot-return-allocations",
  "PURCHASE_RETURN": "original-purchase-return-document-history",
  "PURCHASE_RETURN_ITEMS": "original-purchase-lot-return-allocations",
  "CASH_SESSIONS": "cash-session-open-close-explanation-history",
  "INVOICE_EDIT_LOG": "original-invoice-edit-before-after-audit",
  "USERS": "staff-original-identity-and-credential-provenance",
  "ROLES": "staff-original-role-permission-policy-history",
  "SESSIONS": "staff-original-session-revocation-history",
  "LOGS": "idless-error-log-raw-event-history",
  "DELETE_LOG": "original-deletion-actor-and-reason-audit",
  "OPENING_BALANCE_EDIT_LOG": "historical-opening-balance-edits-without-cash",
  "BANK_ACCOUNTS": "bank-account-original-opening-and-current-history",
  "BANK_BOOK": "bank-debit-credit-account-entry-history",
  "BANK_TRANSFERS": "bank-source-destination-transfer-history",
  "FINANCE_TRANSACTIONS": "owner-lender-borrower-obligation-history",
  "FINANCE_PERSONS": "party-finance-owner-lender-borrower-roles",
  "PRODUCT_CATEGORIES": "product-category-source-identity-history",
  "PRODUCT_UNITS": "product-unit-source-identity-history",
  "VENDORS": "party-vendor-gross-payable-and-receivable",
  "VENDOR_SOURCING": "supplier-independent-vendor-stock-sourcing",
  "VENDOR_LEDGER": "vendor-gross-dues-and-receivables-ledger",
  "VENDOR_RETURNS": "vendor-sourced-item-return-history",
  "VENDOR_ISSUES": "vendor-consignment-issue-source-history",
  "VENDOR_RETURNS_RECEIVED": "vendor-return-receipt-source-history"
});

export const M02_GROSS_ACCOUNT_SCOPES=Object.freeze([
 'CUSTOMER_RECEIVABLE_AND_ADVANCE','SUPPLIER_PAYABLE_AND_ADVANCE',
 'VENDOR_PAYABLE','VENDOR_RECEIVABLE','OWNER_EQUITY_AND_DRAWINGS',
 'LENDER_LOAN_PAYABLE','BORROWER_LOAN_RECEIVABLE'
]);

function reject(code){throw new Error('M02 frozen source mapping rejected: '+code);}
function record(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function requireTrustedInventory(schema,coverage,pinnedSourceCommit){
 if(!record(schema)||JSON.stringify(schema)!==JSON.stringify(FROZEN))
  reject('frozen schema drift');
 if(pinnedSourceCommit!==PIN||coverage?.sourceCommit!==PIN)
  reject('source commit pin mismatch');
 if(!record(coverage)||!Array.isArray(coverage.rows)||coverage.rows.length!==49||
    !record(coverage.summary)||coverage.summary.sourceGroups!==49)
  reject('incomplete coverage');
 const seen=new Set();
 let unmapped=0,partial=0;
 for(const [i,source] of schema.tables.entries()){
  const row=coverage.rows[i];
  const expected=Object.hasOwn(EXPECTED_PARTIAL_D1_EVIDENCE,source.sheetKey)
   ?EXPECTED_PARTIAL_D1_EVIDENCE[source.sheetKey]:['unmapped',null];
  if(row?.status!==expected[0]||row?.targetTable!==expected[1])
   reject('unreviewed D1 target evidence');
  if(!record(row)||seen.has(row.sheetKey)||row.sheetKey!==source.sheetKey||
     row.sourceColumnCount!==source.columns.length||
     row.sourceImportReconciled!==false||
     !ALLOWED_EVIDENCE.has(row.status)||
     (row.status==='unmapped' ? row.targetTable!==null : typeof row.targetTable!=='string'||!row.targetTable))
   reject('invalid coverage evidence or unreviewed reconciled status');
  if(row.status==='unmapped')unmapped++;else partial++;
  seen.add(row.sheetKey);
 }
 if(coverage.summary.unmapped!==unmapped||
    coverage.summary.fullyReconciled!==0||
    unmapped+partial!==schema.tables.length)
  reject('invalid coverage summary');
 return {unmapped,partial};
}
function buildOwnership(){
 const map=new Map();
 for(const lane of LANES){
  for(const key of lane.groups){
   if(map.has(key))reject('duplicate source mapping owner');
   map.set(key,lane);
  }
 }
 if(map.size!==49||map.size!==FROZEN.tables.length||
    FROZEN.tables.some(g=>!map.has(g.sheetKey)))
  reject('incomplete semantic source mapping');
 return map;
}

/**
 * Pure source-group *proposal* report. It does not infer existing D1 tables,
 * approve an operational column mapping or inspect real business values.
 */
export function buildM02SourceMappingReview({
 schema,coverage,pinnedSourceCommit
}={}){
 const current=requireTrustedInventory(schema,coverage,pinnedSourceCommit);
 const lanes=buildOwnership();
 if(Object.keys(LOGICAL_D1_PROPOSALS).length!==49||schema.tables.some(g=>!Object.hasOwn(LOGICAL_D1_PROPOSALS,g.sheetKey)))
  reject('incomplete logical source mapping');
 const groups=schema.tables.map((source,i)=>{
  const lane=lanes.get(source.sheetKey),state=coverage.rows[i];
  const critical=REVIEW_CRITICAL_FIELDS[source.sheetKey]||[];
  if(critical.some(h=>!source.columns.includes(h)))reject('critical source field drift');
  const nonunique=UNIQUE_BY_POSITION_ONLY.has(source.sheetKey);
  const group={
   sourceGroup:source.sheetKey,
   sourceSheet:source.sheetName,
   sourceColumnCount:source.columns.length,
   sourceColumns:[...source.columns],
   uniqueSourceIdField:nonunique?null:source.columns[0],
   identityUniqueness:nonunique?'physical-row-only':'record-id-plus-physical-row',
   sourceRowProvenanceRequired:true,
   sourceTextPrecisionRequired:true,
   preserveEveryOriginalColumn:true,
   criticalFields:[...critical],
   businessDomain:lane.domain,
   downstreamOwner:lane.owner,
   sharedD1ImplementationOwner:'M03',
   reconciliationReview:lane.reconcile,
   proposedLogicalD1Model:LOGICAL_D1_PROPOSALS[source.sheetKey],
   proposedModelIsDeployed:false,
   existingTargetTable:state.targetTable,
   currentD1Evidence:state.status,
   proposedPreservationApproach:'full-fidelity source-row archive + M03-reviewed operational projection (proposal only)',
   operationalFieldMappingApproved:false,
   currentSnapshotImported:false,
   realSourceReconciled:false,
   historicalOnly:source.sheetKey==='OPENING_BALANCE_EDIT_LOG',
   financialLiabilityInferred:false
  };
  return group;
 });
 return {
  formatVersion:1,sourceCommit:pinnedSourceCommit,
  sourceGroups:49,mappingProposals:49,
  currentUnmappedGroups:current.unmapped,
  currentPartiallyCoveredGroups:current.partial,
  fullyImportedAndReconciled:0,
  grossAccountScopes:[...M02_GROSS_ACCOUNT_SCOPES],
  identityMatchingByNameOrPhoneAllowed:false,
  crossRoleAutoNettingAllowed:false,
  historicalOpeningsAreCurrentCashMovement:false,
  stockPostingAuthorized:false,
  staffCredentialsImported:false,
  publicRpcEnabled:false,
  m03SharedSchemaReviewRequired:true,
  d1WritesAuthorized:false,
  productionReady:false,
  limitations:'All rows are source-preservation and operational mapping PROPOSALS; a D1 table name reflects DDL-only partial evidence, not imported business data, finance posting authority or production approval.',
  groups
 };
}

async function main(){
 if(process.argv.length!==3||!['--json','--check'].includes(process.argv[2]))
  reject('requires --json or --check (offline only)');
 const root=new URL('../',import.meta.url);
 const loadJson=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
 const [schema,manifest,closure,originalConfig]=await Promise.all([
  loadJson('docs/baseline/schema-inventory.json'),
  loadJson('docs/baseline/source-manifest.json'),
  loadJson('docs/baseline/m03-async-caller-closure.json'),
  readFile(new URL('legacy/source/Config.gs',root),'utf8')
 ]);
 if(JSON.stringify(inventorySchema(originalConfig))!==JSON.stringify(schema))
  reject('frozen GAS Config headers drift');
 if(closure.sourceCommit!==manifest.source.commit)
  reject('source commit pin mismatch');
 const names=(await readdir(new URL('migrations/',root)))
  .filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
 const migrations=Object.fromEntries(await Promise.all(names.map(async name=>[
  name,await readFile(new URL('migrations/'+name,root),'utf8')
 ])));
 const coverage=buildMigrationCoverage({
  schema,migrations,sourceCommit:manifest.source.commit,
  asyncImpactedFunctions:closure.counts.impactedFunctions
 });
 const result=buildM02SourceMappingReview({
  schema,coverage,pinnedSourceCommit:manifest.source.commit
 });
 if(process.argv[2]==='--json')process.stdout.write(JSON.stringify(result,null,2)+'\n');
 else process.stdout.write('M02 mapping proposals: '+result.mappingProposals+
   '/49 source groups, '+result.currentUnmappedGroups+
   ' lack source-specific D1 DDL, 0 fully reconciled; NO D1 writes authorized\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{console.error('M02 mapping review rejected: frozen inventory or coverage invalid (details withheld)');process.exitCode=1;});
