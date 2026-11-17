import test from 'node:test';
import assert from 'node:assert/strict';

const impl=await import('../src/modules/m09-report-source-lineage-evidence.js')
  .catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
function inspect(root){
  assert.equal(typeof impl?.evaluateM09ReportsLineageEvidence,'function',
    'M09 report lineage evidence composition not implemented');
  return impl.evaluateM09ReportsLineageEvidence(root);
}
const groups=[
  'SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMER_LEDGER',
  'PURCHASES','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS','SUPPLIER_LEDGER',
  'PRODUCTS','STOCK_LOTS','CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS',
  'SALE_ITEMS','SALE_ITEM_LOTS','VENDOR_SOURCING','EXPENSES',
  'SALE_BUNDLE_COMPONENTS','FINANCE_TRANSACTIONS'
];
const reviewKeys=[
  'authBoundaryReviewed','tenantBoundaryReviewed','sourceSnapshotReviewed',
  'sourceIdentityReviewed','returnLineageReconciled','customerSettlementReconciled',
  'supplierSettlementReconciled','stockLotsReconciled','cashBankReconciled',
  'costLayersReconciled','settlementDiscountReconciled','grossPartyAccountsReconciled',
  'financeSummaryReconciled'
];
const verifiedManifest=()=>({
  sourceGroups:Object.fromEntries(groups.map(key=>[key,{
    sourceRows:0,importedRows:0,provenanceReviewed:true,deletionStateReviewed:true
  }])),
  reviews:Object.fromEntries(reviewKeys.map(key=>[key,true]))
});
const sales=()=>({
  allSales:[{'Invoice ID':'INV-A','Is Deleted':''}],
  returnHeaders:[{'Return ID':'SR-A','Invoice ID':'INV-A','Is Deleted':''}],
  returnItems:[{'Return ID':'SR-A','Invoice ID':'INV-A','Is Deleted':''}]
});
const purchase=()=>({
  allPurchases:[{'Purchase ID':'PO-A','Is Deleted':''}],
  returnHeaders:[{'Return ID':'PR-A','Purchase ID':'PO-A','Is Deleted':''}],
  returnItems:[{'Return ID':'PR-A','Purchase ID':'PO-A','Is Deleted':''}]
});
const complete=()=>({manifest:verifiedManifest(),salesSnapshot:sales(),purchaseSnapshot:purchase()});
const byKey=(result,key)=>result.reports.find(r=>r.key===key);

test('M09 complete historical lineage can improve source evidence but can never authorize reports',()=>{
  const data=complete(),before=JSON.stringify(data);
  const out=inspect(data);
  assert.equal(out.ready,false);
  assert.deepEqual(out.reports.map(x=>x.key),
    ['sales','purchase','stock','cashbank','profit','balancesheet']);
  for(const report of out.reports){
    assert.equal(report.ready,false);
    assert.equal(report.evidenceComplete,true);
    assert.equal(report.status,'AWAITING_AUTHENTICATED_D1_GATE');
    assert.deepEqual(report.lineageBlockers,[]);
    assert.equal(Object.hasOwn(report,'totals'),false);
  }
  assert.equal(JSON.stringify(data),before);
});

test('M09 missing Sales source snapshot blocks Sales and Profit only',()=>{
  const data=complete();delete data.salesSnapshot;
  const out=inspect(data);
  assert.deepEqual(byKey(out,'sales').lineageBlockers,['SALES_RETURN_LINEAGE_MISSING']);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,['SALES_RETURN_LINEAGE_MISSING']);
  assert.equal(byKey(out,'sales').status,'BLOCKED');
  assert.equal(byKey(out,'purchase').evidenceComplete,true);
  assert.equal(byKey(out,'stock').evidenceComplete,true);
  assert.equal(byKey(out,'cashbank').evidenceComplete,true);
  assert.equal(byKey(out,'balancesheet').evidenceComplete,true);
});

test('M09 missing Purchase source snapshot blocks Purchase and Profit only',()=>{
  const data=complete();delete data.purchaseSnapshot;
  const out=inspect(data);
  assert.deepEqual(byKey(out,'purchase').lineageBlockers,['PURCHASE_RETURN_LINEAGE_MISSING']);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,['PURCHASE_RETURN_LINEAGE_MISSING']);
  assert.equal(byKey(out,'sales').evidenceComplete,true);
  assert.equal(byKey(out,'stock').evidenceComplete,true);
});

test('M09 Sales mismatched child and missing parent are source blockers, not financial totals',()=>{
  const data=complete();
  data.salesSnapshot.allSales.push({'Invoice ID':'INV-B','Is Deleted':''});
  data.salesSnapshot.returnItems[0]['Invoice ID']='INV-B';
  const out=inspect(data);
  assert.deepEqual(byKey(out,'sales').lineageBlockers,['SALES_RETURN_LINEAGE_NEEDS_REVIEW']);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,['SALES_RETURN_LINEAGE_NEEDS_REVIEW']);
  assert.deepEqual(byKey(out,'purchase').lineageBlockers,[]);
  assert.equal(JSON.stringify(out).includes('INV-B'),false);
});

test('M09 Purchase mismatch blocks Purchase and Profit but not Sales',()=>{
  const data=complete();
  data.purchaseSnapshot.allPurchases.push({'Purchase ID':'PO-B','Is Deleted':''});
  data.purchaseSnapshot.returnItems[0]['Purchase ID']='PO-B';
  const out=inspect(data);
  assert.deepEqual(byKey(out,'purchase').lineageBlockers,['PURCHASE_RETURN_LINEAGE_NEEDS_REVIEW']);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,['PURCHASE_RETURN_LINEAGE_NEEDS_REVIEW']);
  assert.equal(byKey(out,'sales').evidenceComplete,true);
  assert.equal(JSON.stringify(out).includes('PO-B'),false);
});

test('M09 two independent bad return sources block Profit with both fixed codes',()=>{
  const data=complete();
  data.salesSnapshot.returnItems.push({'Return ID':'GHOST','Invoice ID':'INV-A'});
  data.purchaseSnapshot.returnHeaders[0]['Purchase ID']='MISSING';
  const out=inspect(data);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,[
    'SALES_RETURN_LINEAGE_NEEDS_REVIEW','PURCHASE_RETURN_LINEAGE_NEEDS_REVIEW'
  ]);
  assert.equal(byKey(out,'profit').evidenceComplete,false);
  assert.equal(byKey(out,'profit').status,'BLOCKED');
});

test('M09 original manifest count drift is still blocked independently',()=>{
  const data=complete();
  data.manifest.sourceGroups.SALES.sourceRows=3;
  const out=inspect(data);
  assert.deepEqual(byKey(out,'sales').countMismatchGroups,['SALES']);
  assert.equal(byKey(out,'sales').evidenceComplete,false);
  assert.deepEqual(byKey(out,'sales').lineageBlockers,[]);
  assert.equal(byKey(out,'stock').evidenceComplete,true);
});

test('M09 malformed source arrays and accessors are invalid, never evaluated or leaked',()=>{
  let invoked=0;
  const data=complete();
  Object.defineProperty(data.purchaseSnapshot.returnItems[0],'Purchase ID',{
    get(){invoked++;throw Error('PRIVATE-SOURCE-SECRET');}
  });
  const out=inspect(data);
  assert.deepEqual(byKey(out,'purchase').lineageBlockers,['PURCHASE_RETURN_LINEAGE_INVALID']);
  assert.deepEqual(byKey(out,'profit').lineageBlockers,['PURCHASE_RETURN_LINEAGE_INVALID']);
  assert.equal(invoked,0);
  assert.equal(JSON.stringify(out).includes('PRIVATE-SOURCE-SECRET'),false);
  const sparse=complete();sparse.salesSnapshot.returnItems.length=3;
  assert.deepEqual(byKey(inspect(sparse),'sales').lineageBlockers,['SALES_RETURN_LINEAGE_INVALID']);
});

test('M09 rejects untrusted root or manifest getter without invoking side effects',()=>{
  for(const invalid of [null,undefined,[],{}, {manifest:null,salesSnapshot:sales(),purchaseSnapshot:purchase()}])
    assert.throws(()=>inspect(invalid),/trusted|manifest|source/i);
  let invoked=0;
  const root=complete();
  Object.defineProperty(root,'manifest',{get(){invoked++;throw Error('DO-NOT-READ');}});
  assert.throws(()=>inspect(root),/trusted|manifest|record/i);
  assert.equal(invoked,0);
});
