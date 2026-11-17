import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

// B19 is a documentation + source-contract inventory (not new behavior).
// Real RED for a missing runtime feature would be artificial here. This suite
// binds handoff claims to ACTUAL exported main-branch modules and source/tests.
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const exists=path=>existsSync(new URL('../'+path,import.meta.url));
const manifest=JSON.parse(read('docs/m07/contracts.json'));
const handoff=read('docs/m07/INTEGRATION_HANDOFF.md');
const distinct=items=>new Set(items).size===items.length;

test('M07 handoff is a single frozen historical source inventory, not a production enable flag',()=>{
 assert.equal(manifest.schemaVersion,'m07-b19-v1');
 assert.equal(manifest.workstream,'M07');
 assert.equal(manifest.moduleIssue,314);
 assert.equal(manifest.coordinationIssue,456);
 assert.match(manifest.baseMain,/^[a-f\d]{40}$/);
 assert.equal(manifest.sourceAuthority.canonicalRepository,'shuvodelux-commits/Mohim_ERP');
 assert.equal(manifest.sourceAuthority.canonicalSha,
  '29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2');
 assert.equal(manifest.sourceAuthority.supplementarySha,
  '590adfad128fe7155bfb7b608a2ed5665b202a9c');
 for(const key of [
  'productionIntegrationReady','publicRpcEnabled','livePostingVerified',
  'sharedReversalReady','realSourceReconciled'
 ])assert.equal(manifest.readiness[key],false,
  'A source/preflight handoff cannot assert '+key);
 assert.equal(manifest.readiness.parallelPreparationReady,true);
 assert.equal(manifest.readyForProduction,false);
 assert.equal(exists(manifest.documentation),true);
 assert.match(handoff,/PREPARATION HANDOFF, NOT PRODUCTION COMPLETE/);
 assert.match(handoff,/PARALLEL-SHARED-TRANSACTION-WRITES=BLOCKED/);
});

test('all ten M07 source-facing adapter paths, named exports and test proof names exist',async()=>{
 assert.equal(manifest.surfaces.length,10);
 assert.equal(distinct(manifest.surfaces.map(x=>x.id)),true);
 assert.equal(distinct(manifest.surfaces.map(x=>x.path)),true);
 assert.equal(distinct(manifest.surfaces.map(x=>x.exportName)),true);
 for(const contract of manifest.surfaces){
  assert.match(contract.path,/^src\/modules\/[a-z0-9-]+\.js$/);
  assert.match(contract.test,/^tests\/m07-[a-z0-9-]+\.test\.mjs$/);
  assert.match(contract.sourceOracle,/^[A-Za-z]+\.gs$/);
  assert.ok(exists(contract.path),'Missing owned adapter '+contract.path);
  assert.ok(exists(contract.test),'Missing named focused regression '+contract.test);
  assert.ok(exists('legacy/source/'+contract.sourceOracle),
   'Missing original source oracle '+contract.sourceOracle);
  const imported=await import(new URL('../'+contract.path,import.meta.url));
  assert.equal(typeof imported[contract.exportName],'function',
   'Handoff export does not exist: '+contract.exportName);
  assert.equal(contract.scope,'READ_ONLY_PLAN_OR_EVIDENCE');
  assert.equal(contract.publicRpc,false);
  assert.equal(contract.productionWriter,false);
  assert.ok(handoff.includes(contract.exportName),
   'Human handoff dropped export '+contract.exportName);
 }
});

test('frozen native Sales Return edit/delete exists while original Purchase Return has create/view only',()=>{
 assert.equal(manifest.nativeSourceCapabilities.length,2);
 const sales=manifest.nativeSourceCapabilities.find(x=>x.path==='legacy/source/SalesReturn.gs');
 const purchase=manifest.nativeSourceCapabilities.find(x=>x.path==='legacy/source/PurchaseReturn.gs');
 assert.ok(sales);
 assert.ok(purchase);
 assert.equal(sales.editDeleteSupport,true);
 assert.equal(purchase.editDeleteSupport,false);
 for(const capability of [sales,purchase]){
  const source=read(capability.path);
  for(const functionName of capability.functions)
   assert.ok(source.includes('function '+functionName+'('),
    'Native source does not contain '+functionName);
 }
 assert.ok(sales.functions.includes('updateSalesReturn'));
 assert.ok(sales.functions.includes('deleteSalesReturn'));
 assert.ok(purchase.functions.includes('completePurchaseReturn'));
 assert.ok(purchase.functions.includes('getPurchaseReturnHistory'));
 assert.ok(purchase.functions.includes('getPurchaseReturnDetail'));
 for(const name of ['updatePurchaseReturn','deletePurchaseReturn']){
  assert.ok(purchase.missingFunctions.includes(name));
  assert.equal(read(purchase.path).includes('function '+name+'('),false,
   'Never falsely claim the frozen source includes a Purchase Return correction');
 }
 assert.equal(manifest.futurePurchaseReturnEditDelete,
  'NEW_FEATURE_REQUIRES_SEPARATE_DESIGN_APPROVAL_NOT_NATIVE_SOURCE_PORT');
 assert.match(handoff,/does not contain .*updatePurchaseReturn.*deletePurchaseReturn/);
});

test('all fifteen M07 Workerd/D1 specs are classified LOCAL, not source-account posting production evidence',()=>{
 assert.equal(manifest.workerd.length,15);
 assert.ok(distinct(manifest.workerd.map(x=>x.path)));
 for(const proof of manifest.workerd){
  assert.match(proof.path,/^tests\/integration\/m07-[a-z0-9-]+-workerd\.spec\.mjs$/);
  assert.equal(exists(proof.path),true,'Missing M07 D1 test '+proof.path);
  assert.equal(proof.evidenceLevel,'ISOLATED_LOCAL_WORKERD_D1');
  assert.equal(proof.productionPostingProof,false);
 }
 assert.match(handoff,/synthetic schemas/);
 assert.match(handoff,/do not demonstrate/);
});

test('all dependency gates are explicitly open, with one accountable integrator for shared writes',()=>{
 const gates=manifest.mandatoryAcceptance;
 assert.equal(gates.length,9);
 assert.equal(distinct(gates.map(x=>x.code)),true);
 for(const gate of gates){
  assert.match(gate.code,/^M07-GATE-0[1-9]$/);
  assert.ok(['M02','M03','M04','M05','M06','M08','M10','M11'].includes(gate.owner));
  assert.ok(gate.evidence.length>25);
  assert.equal(gate.passed,false,'B19 cannot silently sign off '+gate.code);
 }
 assert.equal(manifest.upstreamOwners.atomicRepositoryAndKernel,'M03');
 assert.equal(manifest.upstreamOwners.tenantSessionRbac,'M04');
 assert.equal(manifest.upstreamOwners.cashBankGrossAccounts,'M08');
 assert.match(handoff,/one.*SQL-atomic journal\/reservation\/reversal kernel/i);
 assert.match(handoff,/M03 owns any proposed shared/);
});

test('handoff explicitly requires live replay, competing IDs, stale CAS, crash rollback and signed gross accounts',()=>{
 for(const term of [
  'REPLAY','CONFLICT','NEEDS_REVIEW','stale CAS','SQL','Cash','Bank',
  'Supplier','Customer','Vendor','gross','49 groups','owner-approved cutover'
 ])assert.ok(handoff.includes(term),'Missing mandatory integration boundary: '+term);
 assert.match(handoff,/No D1 cutover/);
 assert.match(handoff,/not a release signal/);
});
