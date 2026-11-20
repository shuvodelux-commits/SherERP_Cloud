import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const file=relative=>new URL('../'+relative,import.meta.url);
const text=relative=>readFileSync(file(relative),'utf8');
const manifestPath='docs/m05/contracts.json';

test('M05→M03 private integration contract names 14 real tested source exports, not synthetic writers',async()=>{
  assert.ok(existsSync(file(manifestPath)),
    'Missing M05 machine-readable private integration handoff: '+manifestPath);
  const m=JSON.parse(text(manifestPath));
  assert.equal(m.schemaVersion,'m05-internal-handoff-v1');
  assert.equal(m.workstream,'M05');
  assert.equal(m.moduleIssue,314);
  assert.equal(m.coordinationIssue,456);
  assert.equal(m.sourceAuthority.canonicalSha,'29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2');
  assert.equal(m.sourceAuthority.supplementarySha,'590adfad128fe7155bfb7b608a2ed5665b202a9c');
  assert.equal(m.surfaces.length,14);
  assert.equal(new Set(m.surfaces.map(x=>x.id)).size,m.surfaces.length);
  assert.equal(new Set(m.surfaces.map(x=>x.path)).size,m.surfaces.length);
  const required=new Set([
    'prepareMultiUnitPurchasePaymentPreflight','prepareMultiUnitPurchasePreflight',
    'auditMultiUnitPurchaseSnapshot','auditHistoricalUnitLotHandoff',
    'auditPurchaseLotLineage','auditPurchaseStockMovementProvenance',
    'auditSourceStockLotBalances','auditTenantPurchaseFifoEvidence',
    'planConsistentStockPreview','auditPurchaseInvoiceConservation',
    'projectTileStockView','auditTileLotStock',
    'previewTilePurchaseLineCandidateD1','previewTilePurchaseBasketD1'
  ]);
  for(const s of m.surfaces){
    assert.match(s.id,/^[a-z0-9-]+$/,'stable surface id');
    assert.match(s.path,/^src\/modules\/m05-[a-z0-9-]+\.js$/,'M05 exclusively owns module');
    assert.match(s.test,/^tests\/m05-[a-z0-9-]+\.test\.mjs$/,'M05 owns unit test');
    assert.ok(existsSync(file(s.test)),'Missing actual M05 unit suite: '+s.test);
    assert.ok(existsSync(file(s.path)),'Missing implementation: '+s.path);
    assert.ok(typeof s.sourceOracle==='string' && s.sourceOracle.length>0,'Unreviewed source oracle');
    assert.ok(required.delete(s.exportName),'Unexpected or duplicate export: '+s.exportName);
    const mod=await import(file(s.path));
    assert.equal(typeof mod[s.exportName],'function',s.path+' does not export '+s.exportName);
    assert.equal(s.scope,'READ_ONLY_OR_PREVIEW');
    assert.equal(s.productionWriter,false);
    assert.equal(s.publicRpc,false);
  }
  assert.deepEqual([...required],[],'A required M05 source contract is missing');
});

test('handoff is a documented NO-GO, with exact 4 local synthetic Workerd suites and seven independent owner gates',()=>{
  assert.ok(existsSync(file(manifestPath)),'Missing M05 handoff contract');
  const m=JSON.parse(text(manifestPath));
  assert.equal(m.documentation,'docs/m05/INTEGRATION_HANDOFF.md');
  assert.ok(existsSync(file(m.documentation)),'Missing human review handoff');
  const doc=text(m.documentation);
  for(const word of ['NO-GO','M03','M02','M04','M07','M08','M10','M11',
    'Cash Session','145 Pcs','730 BDT','NEEDS_REVIEW','Original Lot','immutable','SQL']) {
    assert.ok(doc.includes(word),'Missing operational handoff invariant: '+word);
  }
  assert.deepEqual(m.readiness.parallelPreparationReady,true);
  for(const [key,value] of Object.entries(m.readiness))
    if(key!=='parallelPreparationReady')
      assert.equal(value,false,'Must not claim live production gate: '+key);
  assert.deepEqual(m.dependencies.map(x=>x.workstream),[
    'M02','M03','M04','M07','M08','M10','M11'
  ]);
  for(const d of m.dependencies) {
    assert.equal(d.accepted,false,'No external gate silently approved: '+d.workstream);
    assert.ok(Number.isInteger(d.issue) && d.issue>0);
    assert.ok(typeof d.requiredEvidence==='string' && d.requiredEvidence.length>20);
  }
  const expected=[
    'tests/integration/m05-purchase-multiline-workerd.spec.mjs',
    'tests/integration/m05-purchase-posting-workerd.spec.mjs',
    'tests/integration/m05-tile-atomic-receiving-workerd.spec.mjs',
    'tests/integration/m05-tile-purchase-line-workerd.spec.mjs'
  ];
  assert.deepEqual(m.workerd.map(x=>x.path),expected);
  for(const w of m.workerd) {
    assert.ok(existsSync(file(w.path)),'Missing actual M05 isolated Workerd suite: '+w.path);
    assert.equal(w.evidenceLevel,'ISOLATED_LOCAL_WORKERD_D1');
    assert.equal(w.productionPostingProof,false);
  }
  assert.equal(m.releaseEffect,'DOCUMENTATION_AND_TEST_ONLY');
});

test('public RPC remains empty and deployed frontend Worker is inert while M03 G1 writer is blocked',()=>{
  const registry=text('src/rpc/registry.js');
  const worker=text('src/index.js');
  assert.match(registry,/rpcRegistry\s*=\s*Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(worker,/database\s*:\s*'not-connected'/);
  assert.doesNotMatch(registry,/prepareMultiUnitPurchasePaymentPreflight|auditHistoricalUnitLotHandoff|m05-/);
  assert.doesNotMatch(worker,/m05-|purchasePost|postPurchase/);
});

test('review-only source purchase uses 145 base Pcs from one Bag, two Boxes, five Pcs for 730 BDT',async()=>{
  const {prepareMultiUnitPurchasePreflight}=await import(
    file('src/modules/m05-multi-unit-purchase-preflight.js'));
  const {auditMultiUnitPurchaseSnapshot}=await import(
    file('src/modules/m05-purchase-unit-snapshot-conservation.js'));
  const products=[{'Product ID':'P-1','Product Name':'Cable',
    'Product Type':'Standard',Unit:'Pcs','Purchase Price':6,
    'Selling Price':10,'Current Stock':0}];
  const suppliers=[{'Supplier ID':'S-1','Supplier Name':'Supplier One',Status:'Active'}];
  const conversionRows=[
    {'Conversion ID':'BAG','Product ID':'P-1','Unit Name':'Bag',
      'Conversion Factor':100,'Purchase Price':500,'Sort Order':1,Status:'Active'},
    {'Conversion ID':'BOX','Product ID':'P-1','Unit Name':'Box',
      'Conversion Factor':20,'Purchase Price':100,'Sort Order':2,Status:'Active'}
  ];
  const r=prepareMultiUnitPurchasePreflight({
    supplierId:'S-1',items:[{productId:'P-1',name:'Browser label',qty:145,
      unitPrice:1,sellingPrice:10,unitBreakdown:[
        {conversionId:'BAG',qty:1},{conversionId:'BOX',qty:2},
        {conversionId:'BASE',qty:5}
      ]}]
  },{products,suppliers,conversionRows});
  assert.equal(r.lines.length,1);
  assert.equal(r.lines[0].qty,145);
  assert.equal(r.lines[0].unit.lineTotal,730);
  assert.deepEqual(r.lines[0].unit.unitSnapshot.map(c=>[c.factor,c.qty]),[
    [100,1],[20,2],[1,5]
  ]);
  assert.equal(auditMultiUnitPurchaseSnapshot(r).ready,true);
});
