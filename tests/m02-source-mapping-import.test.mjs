import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildMigrationCoverage} from '../scripts/audit-migration-coverage.mjs';
import {buildM02SourceMappingReview} from '../scripts/dry-run-source-mapping.mjs';

const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const schema=read('docs/baseline/schema-inventory.json');
const pin=read('docs/baseline/source-manifest.json').source.commit;
const closure=read('docs/baseline/m03-async-caller-closure.json');
const sql=Object.fromEntries(readdirSync(new URL('../migrations/',import.meta.url))
 .filter(name=>/^\d{4}_.+\.sql$/.test(name))
 .map(name=>[name,readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')]));
const coverage=buildMigrationCoverage({schema,migrations:sql,sourceCommit:pin,asyncImpactedFunctions:closure.counts.impactedFunctions});
const review=(overrides={})=>buildM02SourceMappingReview({schema,coverage,pinnedSourceCommit:pin,...overrides});
const get=(r,key)=>r.groups.find(g=>g.sourceGroup===key);
const privacy=/01700000000|Synthetic Rahim|01900000000|synthetic-password-secret|private Finance Name/;

test('exact frozen source inventory yields 49 mapping obligations, no deployment claims',()=>{
 const r=review();
 assert.equal(r.formatVersion,1);
 assert.equal(r.sourceCommit,pin);
 assert.equal(r.sourceGroups,49);
 assert.equal(r.mappingProposals,49);
 assert.equal(r.fullyImportedAndReconciled,0);
 assert.equal(r.m03SharedSchemaReviewRequired,true);
 assert.equal(r.productionReady,false);
 assert.equal(r.d1WritesAuthorized,false);
 assert.equal(r.groups.length,49);
 assert.deepEqual(r.groups.map(x=>x.sourceGroup),schema.tables.map(x=>x.sheetKey));
 assert.deepEqual(r.groups.map(x=>x.sourceColumnCount),schema.tables.map(x=>x.columns.length));
 assert.equal(new Set(r.groups.map(x=>x.sourceGroup)).size,49);
 assert.doesNotMatch(JSON.stringify(r),privacy);
});
test('reconcile actual DDL coverage audit without claiming 30 missing D1 tables exist',()=>{
 const r=review();
 assert.equal(r.currentUnmappedGroups,30);
 assert.equal(r.currentPartiallyCoveredGroups,19);
 assert.equal(r.groups.filter(g=>g.existingTargetTable===null).length,30);
 assert.equal(r.groups.filter(g=>g.currentD1Evidence==='unmapped').length,30);
 for(const group of r.groups){
  const fromCoverage=coverage.rows.find(x=>x.sheetKey===group.sourceGroup);
  assert.equal(group.currentD1Evidence,fromCoverage.status);
  assert.equal(group.existingTargetTable,fromCoverage.targetTable);
  assert.equal(group.realSourceReconciled,false);
  assert.equal(group.operationalFieldMappingApproved,false);
  assert.equal(group.preserveEveryOriginalColumn,true);
  assert.equal(group.sourceColumns.join('|'),schema.tables.find(x=>x.sheetKey===group.sourceGroup).columns.join('|'));
  assert.notEqual(group.reviewOwner,'');
 }
});
test('30 current unmapped groups have downstream owner and proposal, never fictitious SQL activation',()=>{
 const r=review();
 for(const group of r.groups.filter(g=>g.currentD1Evidence==='unmapped')){
  assert.ok(group.proposedPreservationApproach.includes('source-row'));
  assert.ok(group.businessDomain);
  assert.ok(group.downstreamOwner);
  assert.equal(group.existingTargetTable,null);
  assert.equal(group.sharedD1ImplementationOwner,'M03');
  assert.equal(group.operationalFieldMappingApproved,false);
 }
});
test('repeated parent identifiers in line items, bundle parts and diagnostics use sheet-row provenance, not invented unique IDs',()=>{
 const r=review();
 for(const key of ['BUNDLE_COMPONENTS','SALE_BUNDLE_COMPONENTS','SALE_ITEM_LOTS','PURCHASE_ITEMS',
                   'SALE_ITEMS','SALES_RETURN_ITEMS','PURCHASE_RETURN_ITEMS','LOGS']){
  const g=get(r,key);
  assert.equal(g.identityUniqueness,'physical-row-only');
  assert.equal(g.sourceRowProvenanceRequired,true);
  assert.equal(g.uniqueSourceIdField,null);
 }
 for(const key of ['PRODUCTS','CUSTOMERS','SUPPLIERS','VENDORS','BANK_BOOK','SALES','STOCK_LOTS']){
  assert.equal(get(r,key).identityUniqueness,'record-id-plus-physical-row');
 }
});
test('source independent Party roles and the seven gross account buckets cannot auto-net',()=>{
 const r=review();
 assert.deepEqual(r.grossAccountScopes,[
  'CUSTOMER_RECEIVABLE_AND_ADVANCE','SUPPLIER_PAYABLE_AND_ADVANCE',
  'VENDOR_PAYABLE','VENDOR_RECEIVABLE','OWNER_EQUITY_AND_DRAWINGS',
  'LENDER_LOAN_PAYABLE','BORROWER_LOAN_RECEIVABLE'
 ]);
 assert.equal(r.crossRoleAutoNettingAllowed,false);
 assert.equal(r.identityMatchingByNameOrPhoneAllowed,false);
 assert.equal(get(r,'EXPENSE_PAYEES').financialLiabilityInferred,false);
 assert.deepEqual(get(r,'VENDORS').criticalFields,['Current Due','Current Receivable']);
 assert.deepEqual(get(r,'FINANCE_PERSONS').criticalFields,['Person ID','Person Type','Roles']);
});
test('stock, units, Tiles, bundle and FIFO source semantics retain original provenance',()=>{
 const r=review();
 for(const key of ['PRODUCTS','STOCK_LOTS','SALE_ITEM_LOTS','STOCK_MOVEMENT','PURCHASE_ITEMS',
  'BUNDLE_COMPONENTS','SALE_BUNDLE_COMPONENTS']){
  const g=get(r,key);
  assert.equal(g.businessDomain,'stock-and-products');
  assert.equal(g.downstreamOwner,'M05');
  assert.ok(g.reconciliationReview.includes('original-lot-and-unit'));
 }
 assert.equal(r.stockPostingAuthorized,false);
});
test('sales, split payment, return and posting journal remain native separate source obligations',()=>{
 const r=review();
 for(const key of ['SALES','SALE_ITEMS','SALE_PAYMENTS','SALE_POSTING_JOURNAL']){
  assert.equal(get(r,key).downstreamOwner,'M06');
 }
 for(const key of ['SALES_RETURN','SALES_RETURN_ITEMS','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS']){
  assert.equal(get(r,key).downstreamOwner,'M07');
 }
 assert.ok(get(r,'SALE_PAYMENTS').criticalFields.includes('Applied Amount'));
 assert.ok(get(r,'SALE_PAYMENTS').criticalFields.includes('Change Amount'));
 assert.ok(get(r,'SALES_RETURN').criticalFields.includes('Return Operation ID'));
});
test('historical opening values are source text, not cash/bank session posting',()=>{
 const r=review();
 assert.equal(r.historicalOpeningsAreCurrentCashMovement,false);
 assert.equal(get(r,'OPENING_BALANCE_EDIT_LOG').historicalOnly,true);
 assert.equal(get(r,'CASH_SESSIONS').businessDomain,'cash-bank-finance');
 assert.equal(get(r,'FINANCE_TRANSACTIONS').downstreamOwner,'M08');
 assert.ok(get(r,'OPENING_BALANCE_EDIT_LOG').criticalFields.includes('Old Opening Balance'));
 assert.ok(get(r,'OPENING_BALANCE_EDIT_LOG').criticalFields.includes('New Opening Balance'));
});
test('auth sessions remain M04-private and do not become public RPC on metadata mapping',()=>{
 const r=review();
 for(const name of ['USERS','ROLES','SESSIONS'])assert.equal(get(r,name).downstreamOwner,'M04');
 assert.equal(r.publicRpcEnabled,false);
 assert.equal(r.staffCredentialsImported,false);
});
test('every source field is an exact text-preservation obligation, not a numeric coercion contract',()=>{
 const r=review();
 for(const g of r.groups){
  assert.ok(g.sourceColumns.length);
  assert.equal(new Set(g.sourceColumns).size,g.sourceColumns.length);
  assert.equal(g.sourceTextPrecisionRequired,true);
  assert.equal(g.sourceRowProvenanceRequired,true);
  assert.equal(g.currentSnapshotImported,false);
 }
});
test('schema drift, missing group, duplicate group and stale coverage are rejected',()=>{
 const base=structuredClone(schema);
 const variant=structuredClone(schema);variant.tables[0].columns[0]='Forged ID';
 assert.throws(()=>review({schema:variant}),/frozen|invalid|drift/i);
 const missing=structuredClone(base);missing.tables.pop();
 assert.throws(()=>review({schema:missing}),/frozen|invalid|drift/i);
 const duplicated=structuredClone(base);duplicated.tables[1].sheetKey='PRODUCTS';
 assert.throws(()=>review({schema:duplicated}),/frozen|invalid|drift/i);
 const bad=structuredClone(coverage);bad.rows.pop();
 assert.throws(()=>review({coverage:bad}),/coverage|incomplete|invalid/i);
});
test('D1 audit status cannot be silently promoted to fully migrated in M02 mapping',()=>{
 const fake=structuredClone(coverage);
 fake.rows[0].sourceImportReconciled=true;
 assert.throws(()=>review({coverage:fake}),/unreviewed|reconciled|invalid/i);
 const fake2=structuredClone(coverage);
 fake2.rows[0].status='fully-live-and-reconciled';
 assert.throws(()=>review({coverage:fake2}),/coverage|invalid|status/i);
});
test('source pin and migration audit pin must match frozen source',()=>{
 assert.throws(()=>review({pinnedSourceCommit:'0'.repeat(40)}),/pin|commit/i);
 const fake=structuredClone(coverage);fake.sourceCommit='0'.repeat(40);
 assert.throws(()=>review({coverage:fake}),/pin|commit/i);
});
test('CLI prints deterministic metadata-only report and does not modify source inventory',()=>{
 const cli=new URL('../scripts/dry-run-source-mapping.mjs',import.meta.url).pathname;
 const original=readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8');
 const report=spawnSync(process.execPath,[cli,'--json'],{encoding:'utf8'});
 assert.equal(report.status,0,report.stderr);
 assert.equal(JSON.parse(report.stdout).sourceGroups,49);
 assert.equal(JSON.parse(report.stdout).currentUnmappedGroups,30);
 assert.doesNotMatch(report.stdout,privacy);
 const check=spawnSync(process.execPath,[cli,'--check'],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
 assert.match(check.stdout,/49/);
 assert.doesNotMatch(check.stdout,privacy);
 const unsupported=spawnSync(process.execPath,[cli,'--remote'],{encoding:'utf8'});
 assert.notEqual(unsupported.status,0);
 assert.equal(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'),original);
});
