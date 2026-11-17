import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui/hisabiq-dashboard.html',import.meta.url),'utf8');
const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
import {evaluateM09DashboardReadModelEvidence} from '../src/modules/m09-dashboard-read-model-evidence.js';

const GROUPS=[
  'SALES','SALE_ITEMS','SALES_RETURN','SALES_RETURN_ITEMS','SALE_ITEM_LOTS',
  'SALE_BUNDLE_COMPONENTS','VENDOR_SOURCING','CUSTOMER_LEDGER','SUPPLIER_LEDGER',
  'CUSTOMERS','SUPPLIERS','PRODUCTS','STOCK_LOTS','CASH_BOOK','BANK_BOOK',
  'BANK_ACCOUNTS','FINANCE_TRANSACTIONS','FINANCE_PERSONS','EXPENSES',
  'PURCHASES','PURCHASE_ITEMS','SETTINGS'
];
const REVIEWS=[
  'authBoundaryReviewed','tenantBoundaryReviewed','sourceSnapshotReviewed',
  'sourceIdentityReviewed','shopLocalDatesReviewed','invoiceIdsUnique',
  'returnLineageReconciled','returnPricingReconciled','customerSettlementReconciled',
  'supplierSettlementReconciled','grossPartyAccountsReconciled',
  'financeSummaryReconciled','partySourceLinksReviewed','cashBankReconciled',
  'stockLotsReconciled','costLayersReconciled','settlementDiscountReconciled',
  'detailSourceIdsReviewed','detailFiltersReviewed','purchaseRecordLineageReviewed'
];
const EXPECTED=[
  'today-sales','receivable','payable','cash','gross-profit','low-stock',
  'today-collection','today-expense','today-purchase','borrower-receivable',
  'outstanding-loan','sales-trend','cashflow','recent-sales','dues'
];
function manifest(){
  return {
    sourceGroups:Object.fromEntries(GROUPS.map(key=>[key,{
      sourceRows:1,importedRows:1,provenanceReviewed:true,
      deletionStateReviewed:true,sourceIdsReviewed:true
    }])),
    reviews:Object.fromEntries(REVIEWS.map(key=>[key,true]))
  };
}
const widget=(x,key)=>{
  const item=x.widgets.find(w=>w.key===key);
  assert.ok(item,'Missing M09 dashboard widget '+key);
  return item;
};

test('M09 dashboard read gate names all 15 current HisabIQ widgets and remains non-authorizing',()=>{
  const result=evaluateM09DashboardReadModelEvidence(manifest());
  assert.equal(result.ready,false);
  assert.deepEqual(result.widgets.map(w=>w.key),EXPECTED);
  assert.equal(new Set(EXPECTED).size,EXPECTED.length);
  for(const item of result.widgets){
    assert.match(ui,new RegExp('data-hdb-widget="'+item.key+'"'));
    for(const view of ['summary','detail']){
      assert.equal(item[view].ready,false);
      assert.equal(item[view].evidenceComplete,true);
      assert.equal(item[view].status,'AWAITING_AUTHENTICATED_D1_GATE');
      assert.deepEqual(item[view].missingGroups,[]);
      assert.deepEqual(item[view].unreviewedGroups,[]);
      assert.deepEqual(item[view].countMismatchGroups,[]);
      assert.deepEqual(item[view].missingReviews,[]);
    }
  }
  assert.doesNotMatch(JSON.stringify(result),/amount|balance|currencySymbol|invoiceId|customerName|token|secret/);
  assert.match(source,/requirePermission_\(token, 'dashboard', 'view'\)/);
  assert.doesNotMatch(registry,/getDashboardStats\s*:/);
});

test('missing source is not accepted as empty and blocks only source-dependent summaries/details',()=>{
  const data=manifest();
  delete data.sourceGroups.SALES;
  const result=evaluateM09DashboardReadModelEvidence(data);
  for(const key of ['today-sales','today-collection','sales-trend','recent-sales','gross-profit']){
    assert.equal(widget(result,key).summary.evidenceComplete,false,key);
    assert.ok(widget(result,key).summary.missingGroups.includes('SALES'));
    assert.equal(widget(result,key).summary.status,'BLOCKED');
  }
  for(const key of ['low-stock','cash','payable']){
    assert.equal(widget(result,key).summary.evidenceComplete,true,key);
    assert.equal(widget(result,key).summary.ready,false);
  }
  // A real, reviewed zero-row source is distinct from a missing source.
  data.sourceGroups.SALES={
    sourceRows:0,importedRows:0,provenanceReviewed:true,
    deletionStateReviewed:true,sourceIdsReviewed:true
  };
  assert.equal(widget(evaluateM09DashboardReadModelEvidence(data),'today-sales').summary.evidenceComplete,true);
});

test('source identity, historical deletion and row counts are independent hard blockers',()=>{
  const data=manifest();
  data.sourceGroups.SALES.importedRows=0;
  data.sourceGroups.PRODUCTS.sourceIdsReviewed=false;
  data.sourceGroups.SUPPLIERS.deletionStateReviewed=false;
  data.sourceGroups.CASH_BOOK.provenanceReviewed=false;
  const out=evaluateM09DashboardReadModelEvidence(data);
  assert.deepEqual(widget(out,'today-sales').summary.countMismatchGroups,['SALES']);
  assert.ok(widget(out,'low-stock').summary.unreviewedGroups.includes('PRODUCTS'));
  assert.ok(widget(out,'payable').summary.unreviewedGroups.includes('SUPPLIERS'));
  assert.ok(widget(out,'cash').summary.unreviewedGroups.includes('CASH_BOOK'));
  assert.equal(widget(out,'receivable').summary.evidenceComplete,true);
});

test('gross Party roles stay distinct and return/cost lineage cannot borrow unrelated review flags',()=>{
  const data=manifest();
  data.reviews.grossPartyAccountsReconciled=false;
  data.reviews.returnLineageReconciled=false;
  data.reviews.costLayersReconciled=false;
  data.reviews.settlementDiscountReconciled=false;
  const out=evaluateM09DashboardReadModelEvidence(data);
  assert.ok(widget(out,'receivable').summary.missingReviews.includes('grossPartyAccountsReconciled'));
  assert.ok(widget(out,'payable').summary.missingReviews.includes('grossPartyAccountsReconciled'));
  assert.ok(widget(out,'borrower-receivable').summary.missingReviews.includes('grossPartyAccountsReconciled'));
  assert.ok(widget(out,'today-sales').summary.missingReviews.includes('returnLineageReconciled'));
  assert.ok(widget(out,'gross-profit').summary.missingReviews.includes('costLayersReconciled'));
  assert.ok(widget(out,'gross-profit').summary.missingReviews.includes('settlementDiscountReconciled'));
  assert.equal(widget(out,'today-expense').summary.evidenceComplete,true);
});

test('summary completion does not imply record/point detail lineage and dates are approved',()=>{
  const data=manifest();
  data.reviews.detailSourceIdsReviewed=false;
  data.reviews.detailFiltersReviewed=false;
  const out=evaluateM09DashboardReadModelEvidence(data);
  for(const key of ['recent-sales','dues','sales-trend','cashflow','low-stock']){
    const item=widget(out,key);
    assert.equal(item.summary.evidenceComplete,true,key);
    assert.equal(item.detail.evidenceComplete,false,key);
    assert.ok(item.detail.missingReviews.includes('detailSourceIdsReviewed'),key);
    assert.ok(item.detail.missingReviews.includes('detailFiltersReviewed'),key);
  }
  data.reviews.detailSourceIdsReviewed=true;
  data.reviews.detailFiltersReviewed=true;
  delete data.sourceGroups.SALE_ITEMS;
  const next=evaluateM09DashboardReadModelEvidence(data);
  assert.equal(widget(next,'recent-sales').summary.evidenceComplete,true);
  assert.ok(widget(next,'recent-sales').detail.missingGroups.includes('SALE_ITEMS'));
});

test('malformed, sparse, accessor-bearing and untrusted receipts fail closed without reading secrets',()=>{
  for(const invalid of [null,undefined,[],{},Promise.resolve({}),{sourceGroups:{},reviews:null}]){
    assert.throws(()=>evaluateM09DashboardReadModelEvidence(invalid),
      /invalid|trusted|source|manifest/i);
  }
  const data=manifest(), copy=structuredClone(data);
  assert.deepEqual(evaluateM09DashboardReadModelEvidence(data),
    evaluateM09DashboardReadModelEvidence(copy));
  assert.deepEqual(data,copy,'M09 evidence cannot mutate supplied data');
  let observed=false;
  const bad={...data,get reviews(){observed=true;throw Error('PRIVATE_PASSWORD_TOKEN');}};
  assert.throws(()=>evaluateM09DashboardReadModelEvidence(bad),
    error=>!String(error).includes('PRIVATE_PASSWORD_TOKEN'));
  assert.equal(observed,false,'do not invoke accessors on root input');
  const sourceAccessor=manifest();
  Object.defineProperty(sourceAccessor.sourceGroups,'SALES',{get(){observed=true;throw Error('PRIVATE_PHONE');}});
  const out=evaluateM09DashboardReadModelEvidence(sourceAccessor);
  assert.equal(observed,false,'do not invoke getters on source receipt map');
  assert.ok(widget(out,'today-sales').summary.unreviewedGroups.includes('SALES'));
  for(const badCount of [-1,1.5,NaN,Infinity,'0',undefined]){
    const badReceipt=manifest();badReceipt.sourceGroups.SALES.sourceRows=badCount;
    assert.ok(widget(evaluateM09DashboardReadModelEvidence(badReceipt),'today-sales')
      .summary.unreviewedGroups.includes('SALES'));
  }
});

test('the dashboard gate contains no D1/RPC/financial projection and has no fake totals',()=>{
  const path=new URL('../src/modules/m09-dashboard-read-model-evidence.js',import.meta.url);
  const code=readFileSync(path,'utf8');
  assert.doesNotMatch(code,/\b(?:fetch|prepare|batch|exec|write|insert|update|delete|serverCall)\s*\(/i);
  assert.doesNotMatch(code,/getDashboardStats\s*\(/);
  const manifestData=manifest();
  const r=evaluateM09DashboardReadModelEvidence(manifestData);
  assert.ok(r.widgets.every(w=>w.summary.ready===false&&w.detail.ready===false));
});
