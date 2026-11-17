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
const complete=()=>{
  const manifest=verifiedManifest(),salesSnapshot=sales(),purchaseSnapshot=purchase();
  // The manifest represents complete source history, including deleted rows.
  for(const [key,rows] of [
    ['SALES',salesSnapshot.allSales],
    ['SALES_RETURN',salesSnapshot.returnHeaders],
    ['SALES_RETURN_ITEMS',salesSnapshot.returnItems],
    ['PURCHASES',purchaseSnapshot.allPurchases],
    ['PURCHASE_RETURN',purchaseSnapshot.returnHeaders],
    ['PURCHASE_RETURN_ITEMS',purchaseSnapshot.returnItems]
  ]){
    manifest.sourceGroups[key].sourceRows=rows.length;
    manifest.sourceGroups[key].importedRows=rows.length;
  }
  return {manifest,salesSnapshot,purchaseSnapshot};
};
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
  data.manifest.sourceGroups.SALES.sourceRows=2;
  data.manifest.sourceGroups.SALES.importedRows=2;
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
  data.manifest.sourceGroups.PURCHASES.sourceRows=2;
  data.manifest.sourceGroups.PURCHASES.importedRows=2;
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
  data.manifest.sourceGroups.SALES_RETURN_ITEMS.sourceRows=2;
  data.manifest.sourceGroups.SALES_RETURN_ITEMS.importedRows=2;
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
  assert.deepEqual(byKey(out,'sales').lineageBlockers,['SALES_SOURCE_ROWS_MISMATCH']);
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

test('M09 six full historical source counts must agree with reviewed manifest counts',()=>{
  for(const [side,keys,dependent] of [
    ['salesSnapshot',['SALES','SALES_RETURN','SALES_RETURN_ITEMS'],['sales','profit']],
    ['purchaseSnapshot',['PURCHASES','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS'],['purchase','profit']]
  ]){
    for(const group of keys){
      const data=complete();
      // Both original-vs-imported manifest totals still agree, but disagree
      // with the full source-shaped snapshot actually supplied to the auditor.
      data.manifest.sourceGroups[group].sourceRows=0;
      data.manifest.sourceGroups[group].importedRows=0;
      const result=inspect(data);
      for(const key of dependent){
        const item=byKey(result,key);
        assert.deepEqual(item.lineageBlockers,[group+'_SOURCE_ROWS_MISMATCH'],
          side+' '+group+' must block '+key);
        assert.equal(item.evidenceComplete,false);
        assert.equal(item.status,'BLOCKED');
        assert.equal(item.ready,false);
      }
      for(const other of ['sales','purchase','stock','cashbank','profit','balancesheet']){
        if(!dependent.includes(other)){
          assert.equal(byKey(result,other).evidenceComplete,true,
            side+' '+group+' must not block '+other);
          assert.deepEqual(byKey(result,other).lineageBlockers,[]);
        }
      }
      assert.equal(JSON.stringify(result).includes('INV-A'),false);
      assert.equal(JSON.stringify(result).includes('PO-A'),false);
    }
  }
});

test('M09 full source counts include deleted parent and original invoice/purchase rows',()=>{
  const data=complete();
  data.salesSnapshot.allSales.push({'Invoice ID':'INV-DEL','Is Deleted':'True'});
  data.salesSnapshot.returnHeaders.push({
    'Return ID':'SR-DELETED','Invoice ID':'INV-A','Is Deleted':'true'
  });
  data.purchaseSnapshot.allPurchases.push({'Purchase ID':'PO-DEL','Is Deleted':'TRUE'});
  const result=inspect(data);
  assert.deepEqual(byKey(result,'sales').lineageBlockers,[
    'SALES_SOURCE_ROWS_MISMATCH','SALES_RETURN_SOURCE_ROWS_MISMATCH'
  ]);
  assert.deepEqual(byKey(result,'purchase').lineageBlockers,[
    'PURCHASES_SOURCE_ROWS_MISMATCH'
  ]);
  assert.deepEqual(byKey(result,'profit').lineageBlockers,[
    'SALES_SOURCE_ROWS_MISMATCH','SALES_RETURN_SOURCE_ROWS_MISMATCH',
    'PURCHASES_SOURCE_ROWS_MISMATCH'
  ]);
  assert.equal(byKey(result,'stock').evidenceComplete,true);
});

test('M09 mismatched child relationships and row counts fail independently in one report',()=>{
  const data=complete();
  data.salesSnapshot.returnItems.push({'Return ID':'UNKNOWN','Invoice ID':'INV-A'});
  const result=inspect(data);
  assert.deepEqual(byKey(result,'sales').lineageBlockers,[
    'SALES_RETURN_LINEAGE_NEEDS_REVIEW','SALES_RETURN_ITEMS_SOURCE_ROWS_MISMATCH'
  ]);
  assert.deepEqual(byKey(result,'profit').lineageBlockers,[
    'SALES_RETURN_LINEAGE_NEEDS_REVIEW','SALES_RETURN_ITEMS_SOURCE_ROWS_MISMATCH'
  ]);
  assert.equal(byKey(result,'purchase').evidenceComplete,true);
});

test('M09 incomplete and accessor source receipts fail closed without calling getters',()=>{
  const missing=complete();
  delete missing.manifest.sourceGroups.SALES_RETURN;
  const result=inspect(missing);
  assert.deepEqual(byKey(result,'sales').missingGroups,['SALES_RETURN']);
  assert.equal(byKey(result,'sales').evidenceComplete,false);
  assert.equal(byKey(result,'sales').ready,false);

  let called=0;
  const accessors=complete();
  Object.defineProperty(accessors.manifest.sourceGroups.PURCHASE_RETURN,
    'sourceRows',{configurable:true,get(){called++;throw Error('SOURCE-PRIVATE');}});
  const bad=inspect(accessors);
  assert.equal(called,0);
  assert.deepEqual(byKey(bad,'purchase').unreviewedGroups,['PURCHASE_RETURN']);
  assert.equal(byKey(bad,'purchase').evidenceComplete,false);
  assert.equal(JSON.stringify(bad).includes('SOURCE-PRIVATE'),false);
});

test('M09 returns original six-report response keys with no totals or input mutation',()=>{
  const data=complete(),original=JSON.stringify(data);
  const out=inspect(data);
  assert.equal(out.ready,false);
  for(const item of out.reports){
    assert.deepEqual(item.lineageBlockers,[]);
    assert.equal(item.ready,false);
    assert.equal(Object.hasOwn(item,'totals'),false);
  }
  assert.equal(JSON.stringify(data),original);
});
