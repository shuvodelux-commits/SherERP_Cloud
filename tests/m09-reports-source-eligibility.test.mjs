import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath='../src/modules/m09-reports-source-eligibility.js';
const impl=await import(modulePath).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function inspect(manifest){
  assert.equal(typeof impl?.evaluateM09ReportsSourceEligibility,'function',
    'M09 source eligibility read gate not implemented');
  return impl.evaluateM09ReportsSourceEligibility(manifest);
}

const groups=[
  'SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMER_LEDGER',
  'PURCHASES','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS','SUPPLIER_LEDGER',
  'PRODUCTS','STOCK_LOTS','CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS',
  'SALE_ITEMS','SALE_ITEM_LOTS','VENDOR_SOURCING','EXPENSES','SALE_BUNDLE_COMPONENTS',
  'FINANCE_TRANSACTIONS'
];
const reviewKeys=[
  'authBoundaryReviewed','tenantBoundaryReviewed','sourceSnapshotReviewed',
  'sourceIdentityReviewed','returnLineageReconciled','customerSettlementReconciled',
  'supplierSettlementReconciled','stockLotsReconciled','cashBankReconciled',
  'costLayersReconciled','settlementDiscountReconciled','grossPartyAccountsReconciled',
  'financeSummaryReconciled'
];
const receipt=(count=0)=>({
  sourceRows:count,importedRows:count,
  provenanceReviewed:true,deletionStateReviewed:true
});
const verified=()=>({
  sourceGroups:Object.fromEntries(groups.map(k=>[k,receipt()])),
  reviews:Object.fromEntries(reviewKeys.map(k=>[k,true]))
});
const report=(result,key)=>result.reports.find(item=>item.key===key);

test('M09 gates six source-shaped reports, never emits plausible partial totals',()=>{
  const result=inspect({sourceGroups:{},reviews:{}});
  assert.equal(result.ready,false);
  assert.deepEqual(result.reports.map(x=>x.key),
    ['sales','purchase','stock','cashbank','profit','balancesheet']);
  for(const item of result.reports){
    assert.equal(item.ready,false);
    assert.equal(item.evidenceComplete,false);
    assert.equal(item.status,'BLOCKED');
    assert.ok(item.missingGroups.length>0);
    assert.ok(item.missingReviews.length>0);
    assert.equal(Object.hasOwn(item,'totals'),false);
  }
  assert.deepEqual(report(result,'sales').missingGroups,
    ['SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMER_LEDGER']);
  assert.deepEqual(report(result,'purchase').missingGroups,
    ['PURCHASES','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS','SUPPLIER_LEDGER']);
  assert.deepEqual(report(result,'stock').missingGroups,['PRODUCTS','STOCK_LOTS']);
  assert.deepEqual(report(result,'cashbank').missingGroups,
    ['CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS']);
  assert.deepEqual(report(result,'balancesheet').missingGroups,
    ['CASH_BOOK','BANK_ACCOUNTS','STOCK_LOTS','FINANCE_TRANSACTIONS']);
  assert.deepEqual(report(result,'profit').missingGroups,
    ['SALES','SALE_ITEMS','SALES_RETURN','SALES_RETURN_ITEMS','SALE_ITEM_LOTS',
     'VENDOR_SOURCING','EXPENSES','SALE_BUNDLE_COMPONENTS',
     'CUSTOMER_LEDGER','SUPPLIER_LEDGER']);
});

test('M09 Balance Sheet requires source Finance Transactions underlying owner capital and loan',()=>{
  const evidence=verified();
  delete evidence.sourceGroups.FINANCE_TRANSACTIONS;
  const x=inspect(evidence);
  assert.deepEqual(report(x,'balancesheet').missingGroups,['FINANCE_TRANSACTIONS']);
  assert.equal(report(x,'balancesheet').evidenceComplete,false);
  assert.equal(report(x,'balancesheet').ready,false);
  assert.equal(report(x,'stock').evidenceComplete,true);
  // Original FinanceModule.gs derives both owner/loan from activeRows_('FINANCE_TRANSACTIONS').
  const y=inspect(verified());
  assert.equal(report(y,'balancesheet').evidenceComplete,true);
  assert.equal(report(y,'balancesheet').ready,false);
});

test('M09 imported row-count drift and missing review block only dependent reports',()=>{
  const input=verified();
  input.sourceGroups.SALES.importedRows=2;
  input.sourceGroups.SALES.sourceRows=3;
  input.sourceGroups.PRODUCTS.provenanceReviewed=false;
  const original=JSON.stringify(input);
  const result=inspect(input);
  assert.deepEqual(report(result,'sales').countMismatchGroups,['SALES']);
  assert.deepEqual(report(result,'profit').countMismatchGroups,['SALES']);
  assert.deepEqual(report(result,'stock').unreviewedGroups,['PRODUCTS']);
  assert.equal(report(result,'purchase').evidenceComplete,true);
  assert.equal(report(result,'cashbank').evidenceComplete,true);
  assert.equal(report(result,'stock').evidenceComplete,false);
  assert.equal(JSON.stringify(input),original);
});

test('M09 a fully reviewed empty shop is not confused with missing data or actual live authorization',()=>{
  const result=inspect(verified());
  assert.equal(result.ready,false);
  for(const item of result.reports){
    assert.equal(item.evidenceComplete,true);
    assert.equal(item.ready,false);
    assert.equal(item.status,'AWAITING_AUTHENTICATED_D1_GATE');
    assert.deepEqual(item.missingGroups,[]);
    assert.deepEqual(item.unreviewedGroups,[]);
    assert.deepEqual(item.countMismatchGroups,[]);
    assert.deepEqual(item.missingReviews,[]);
  }
});

test('M09 independently blocks unreconciled gross finance, cost and settlement evidence',()=>{
  const input=verified();
  input.reviews.grossPartyAccountsReconciled=false;
  input.reviews.financeSummaryReconciled=false;
  input.reviews.costLayersReconciled=false;
  input.reviews.customerSettlementReconciled=false;
  const result=inspect(input);
  assert.ok(report(result,'sales').missingReviews.includes('customerSettlementReconciled'));
  assert.ok(report(result,'profit').missingReviews.includes('grossPartyAccountsReconciled'));
  assert.ok(report(result,'profit').missingReviews.includes('costLayersReconciled'));
  assert.ok(report(result,'balancesheet').missingReviews.includes('financeSummaryReconciled'));
  assert.equal(report(result,'stock').evidenceComplete,true);
  for(const item of result.reports)assert.equal(item.ready,false);
});

test('M09 no missing, malformed or partial source receipt can claim completeness',()=>{
  for(const bad of [
    {sourceRows:0,importedRows:0},
    {sourceRows:0,importedRows:-1,provenanceReviewed:true,deletionStateReviewed:true},
    {sourceRows:1,importedRows:0,provenanceReviewed:true,deletionStateReviewed:true},
    {sourceRows:'0',importedRows:0,provenanceReviewed:true,deletionStateReviewed:true},
    {sourceRows:0.5,importedRows:0.5,provenanceReviewed:true,deletionStateReviewed:true},
    null,[],false
  ]){
    const input=verified();
    input.sourceGroups.STOCK_LOTS=bad;
    const result=inspect(input);
    assert.equal(report(result,'stock').evidenceComplete,false);
    assert.equal(report(result,'balancesheet').ready,false);
  }
});

test('M09 rejects untrusted root/getter values without executing accessors or echoing secrets',()=>{
  for(const x of [undefined,null,[],false,{},{sourceGroups:[],reviews:{}},
    {sourceGroups:{},reviews:null}])
    assert.throws(()=>inspect(x),/manifest|evidence|review|source|trusted/i);
  let getterCalls=0;
  const sourceGroups={get SALES(){getterCalls++;throw Error('secret-token-not-for-display');}};
  assert.throws(()=>inspect({sourceGroups,reviews:{}}),/trusted|accessor|manifest/i);
  assert.equal(getterCalls,0);
  const source=verified(),settings={...source};
  Object.defineProperty(settings,'reviews',{get(){getterCalls++;throw Error('secret');}});
  assert.throws(()=>inspect(settings),/trusted|accessor|manifest/i);
  assert.equal(getterCalls,0);
  const answer=JSON.stringify(inspect({sourceGroups:{},reviews:{}}));
  assert.equal(answer.includes('secret-token-not-for-display'),false);
});
