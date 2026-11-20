/**
 * M02: two PHYSICALLY SEPARATE, disposable local D1 Shop bindings.
 * All writes in this file are SYNTHETIC test data; never operational schema.
 */
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createAtomicSourceIdIssuer} from '../../src/db/atomic-source-id-issuer.js';
import {SYNTHETIC_M03_ID_DDL} from '../fixtures/m03-id-issuer-schema.mjs';
import {
  SYNTHETIC_M02_SUPPLIER_DDL,auditLocalSupplierD1
} from '../fixtures/m02-supplier-id-d1-readback.mjs';

const config='./wrangler.m02-supplier-id-test.jsonc';
const harness=createTestHarness({workers:[{configPath:config}]});
const worker=harness.getWorker('shererp-m02-supplier-id-two-d1-local');
const hash=c=>c.repeat(64);
let A,B;
const shops=()=>[{shopId:'SHOP-A',DB:A},{shopId:'SHOP-B',DB:B}];
const count=async(DB,table)=> (await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
const issue=(DB,shopId,operationId,intentHash)=>createAtomicSourceIdIssuer({DB},shopId)
  .allocate_({idKey:'SUPPLIERS',operationId,intentHash});
async function addPartyAndLink(DB,shopId,sourceId,partyId,status='ACTIVE'){
  return DB.batch([
    DB.prepare('INSERT INTO m02_test_supplier_parties(tenant_id,party_id,name) VALUES(?,?,?)')
      .bind(shopId,partyId,'Identical Supplier Name'),
    DB.prepare('INSERT INTO m02_test_supplier_links(tenant_id,source_group,source_id,party_id,role,status,link_basis) VALUES(?,?,?,?,?,?,?)')
      .bind(shopId,'SUPPLIERS',sourceId,partyId,'Supplier',status,'NEW_RECORD')
  ]);
}
const inspect=()=>auditLocalSupplierD1({shops:shops()});
const blocked=(report,code)=> {
  assert.equal(report.syntheticReceiptShapeValid,false);
  assert(report.blockers.some(x=>x.code===code),JSON.stringify(report));
};
before(async()=>{
  await harness.listen();
  ({SHOP_A:A,SHOP_B:B}=await worker.getEnv());
  assert(A&&B&&A!==B,'two independent local D1 bindings must exist');
  for(const DB of [A,B]){
    for(const sql of [...SYNTHETIC_M03_ID_DDL,...SYNTHETIC_M02_SUPPLIER_DDL])
      assert.equal((await DB.prepare(sql).run()).success,true);
  }
  assert.equal((await A.prepare('INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES (?,?,?,?)')
    .bind('SHOP-A','SUPPLIERS','SUP',0).run()).success,true);
  assert.equal((await B.prepare('INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES (?,?,?,?)')
    .bind('SHOP-B','SUPPLIERS','SUP',0).run()).success,true);
});
after(async()=>harness.close());

test('empty physically separate Shop D1s are no approval to issue or post money',async()=>{
  const r=await inspect();
  assert.equal(r.syntheticReceiptShapeValid,true);
  assert.deepEqual(r.counts,{shops:2,receipts:0,supplierLinks:0});
  assert.equal(r.sqlIssuanceAuthorized,false);
  assert.equal(r.historicalReconciled,false);
  assert.equal(r.financialPostingReady,false);
});
test('real local D1 issues same SUP-000001 in two physically separate Shop databases',async()=>{
  const [idA,idB]=await Promise.all([
    issue(A,'SHOP-A','OP-SUP-A-1',hash('a')),
    issue(B,'SHOP-B','OP-SUP-B-1',hash('b'))
  ]);
  assert.deepEqual(idA,{id:'SUP-000001',sequence:1});
  assert.deepEqual(idB,{id:'SUP-000001',sequence:1});
  await Promise.all([
    addPartyAndLink(A,'SHOP-A',idA.id,'PT-SAME-ID'),
    addPartyAndLink(B,'SHOP-B',idB.id,'PT-SAME-ID')
  ]);
  assert.equal(await count(A,'m02_test_supplier_parties'),1);
  assert.equal(await count(B,'m02_test_supplier_parties'),1);
  assert.equal(await count(A,'synthetic_m03_id_receipts'),1);
  assert.equal(await count(B,'synthetic_m03_id_receipts'),1);
  assert.deepEqual(await inspect(),{
    syntheticReceiptShapeValid:true,
    counts:{shops:2,receipts:2,supplierLinks:2},
    blockers:[],sqlIssuanceAuthorized:false,
    historicalReconciled:false,financialPostingReady:false
  });
});
test('real D1 replay is exactly once; changed immutable intent cannot consume a Supplier ID',async()=>{
  assert.deepEqual(await issue(A,'SHOP-A','OP-SUP-A-1',hash('a')),
    {id:'SUP-000001',sequence:1});
  await assert.rejects(()=>issue(A,'SHOP-A','OP-SUP-A-1',hash('c')),
    /collision|receipt|intent/i);
  assert.equal(await count(A,'synthetic_m03_id_receipts'),1);
  assert.equal((await A.prepare("SELECT current_sequence AS n FROM synthetic_m03_id_counters WHERE tenant_id='SHOP-A' AND id_key='SUPPLIERS'").first()).n,1);
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
});
test('issued source ID without Party link is a redacted blocker until separately committed link',async()=>{
  const issued=await issue(A,'SHOP-A','OP-SUP-A-2',hash('d'));
  assert.deepEqual(issued,{id:'SUP-000002',sequence:2});
  blocked(await inspect(),'SUPPLIER_PARTY_LINK_MISSING');
  await addPartyAndLink(A,'SHOP-A',issued.id,'PT-SECOND');
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
});
test('concurrent same-Shop claims never share Supplier ID or receipts in actual local D1',async()=>{
  const ids=await Promise.all(Array.from({length:5},(_,i)=>
    issue(A,'SHOP-A','OP-SUP-A-BULK-'+i,hash(String(i+1)))));
  assert.deepEqual(ids.map(x=>x.sequence).sort((a,b)=>a-b),[3,4,5,6,7]);
  for(const item of ids)await addPartyAndLink(A,'SHOP-A',item.id,'PT-BULK-'+item.sequence);
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
  assert.equal((await A.prepare('SELECT COUNT(DISTINCT issued_sequence) AS n FROM synthetic_m03_id_receipts').first()).n,7);
});
test('late failed synthetic Party+link batch rolls back both writes, never claiming Supplier creation',async()=>{
  const before=await count(A,'m02_test_supplier_parties');
  await assert.rejects(()=>addPartyAndLink(A,'SHOP-A','SUP-000001','PT-ROLLBACK'),
    /unique|constraint|D1_ERROR/i);
  assert.equal(await count(A,'m02_test_supplier_parties'),before);
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
});
test('unbacked exact Source ID and inactive Supplier Party link each fail closed',async()=>{
  await addPartyAndLink(B,'SHOP-B','SUP-000099','PT-ORPHAN');
  blocked(await inspect(),'ORPHAN_SHOP_SUPPLIER_LINK');
  await B.prepare("DELETE FROM m02_test_supplier_links WHERE source_id='SUP-000099'").run();
  await B.prepare("DELETE FROM m02_test_supplier_parties WHERE party_id='PT-ORPHAN'").run();
  await A.prepare("UPDATE m02_test_supplier_links SET status='INACTIVE' WHERE source_id='SUP-000001'").run();
  blocked(await inspect(),'SUPPLIER_PARTY_LINK_INVALID');
  await A.prepare("UPDATE m02_test_supplier_links SET status='ACTIVE' WHERE source_id='SUP-000001'").run();
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
});
test('issued D1 receipts are immutable and cannot be silently reassigned or deleted',async()=>{
  await assert.rejects(()=>A.prepare("UPDATE synthetic_m03_id_receipts SET issued_sequence=99 WHERE operation_id='OP-SUP-A-1'").run(),
    /immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>A.prepare("DELETE FROM synthetic_m03_id_receipts WHERE operation_id='OP-SUP-A-1'").run(),
    /immutable|abort|D1_ERROR/i);
  assert.equal((await inspect()).syntheticReceiptShapeValid,true);
});
test('nondeployable Worker has no public RPC, Supplier creation or owner login',async()=>{
  for(const path of ['/api/rpc','/api/suppliers/create','/api/platform/login','/']){
    const response=await worker.fetch('http://m02-supplier.test'+path);
    assert.equal(response.status,404,path);
  }
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m02-supplier-id-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.d1_databases.length,2);
  assert.equal(new Set(cfg.d1_databases.map(x=>x.database_id)).size,2);
  assert.equal(cfg.routes,undefined);
});
test('foreign-tenant receipt physically present in Shop A D1 blocks audit without leaking identity',async()=>{
  // Last test deliberately contaminates this disposable DB with an alien tenant.
  await A.prepare('INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES (?,?,?,?)')
    .bind('SHOP-B','SUPPLIERS','SUP',0).run();
  await issue(A,'SHOP-B','OP-SUP-FOREIGN',hash('f'));
  const report=await inspect();
  blocked(report,'FOREIGN_SHOP_D1_ROW');
  assert.doesNotMatch(JSON.stringify(report),/SHOP-A|SHOP-B|PT-SAME|SUP-000001|OP-SUP/);
  assert.equal(await count(B,'synthetic_m03_id_receipts'),1);
});
