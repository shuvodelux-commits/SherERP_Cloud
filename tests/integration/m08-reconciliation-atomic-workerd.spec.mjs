import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M08_RECON_DDL,seedM08Reconciliation}
  from '../fixtures/m08-reconciliation-atomic-schema.mjs';
import {createSyntheticD1CashReconciliationContract}
  from '../fixtures/m08-reconciliation-atomic-contract.mjs';

const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m08-reconciliation-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m08-reconciliation-d1-test');
let DB;
const A=Object.freeze({
  tenantId:'SHOP-A',actorId:'USER-A',tokenHash:'a'.repeat(64),
  operationId:'OP-1',sessionId:'SESSION-1',realEntryId:'REAL-1',
  legacyEntryId:'LEG-1',revision:1,now:1000
});
const B=Object.freeze({
  ...A,tenantId:'SHOP-B',actorId:'USER-B',tokenHash:'b'.repeat(64)
});
const contract=()=>createSyntheticD1CashReconciliationContract(DB);
const rows=async(sql)=>(await DB.prepare(sql).all()).results.map(row=>({...row}));
async function snapshot(){
  const out={};
  for(const [key,sql] of Object.entries({
    sessions:'SELECT * FROM m08_test_cash_sessions ORDER BY tenant_id,session_id',
    entries:'SELECT * FROM m08_test_cash_entries ORDER BY tenant_id,entry_id',
    links:'SELECT * FROM m08_test_links ORDER BY tenant_id,entry_id',
    receipts:'SELECT * FROM m08_test_receipts ORDER BY tenant_id,operation_id',
    audits:'SELECT * FROM m08_test_audit ORDER BY tenant_id,operation_id'
  }))out[key]=await rows(sql);
  return out;
}
before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});
beforeEach(async()=>{
  for(const table of [
    'm08_test_audit','m08_test_links','m08_test_receipts',
    'm08_test_cash_entries','m08_test_cash_sessions',
    'm08_test_sessions','m08_test_users','m08_test_roles'
  ])await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const sql of M08_RECON_DDL)await DB.prepare(sql).run();
  await seedM08Reconciliation(DB);
});

test('one authorized closing explanation commits real link, retires adjustment and updates variance atomically',async()=>{
  assert.deepEqual(await contract().post(A),
    {status:'COMMITTED',operationId:'OP-1',sessionId:'SESSION-1'});
  const s=await snapshot();
  assert.deepEqual(s.links.map(x=>x.entry_id),['REAL-1']);
  assert.equal(s.receipts.length,1);
  assert.equal(s.audits.length,1);
  const shop=s.sessions.find(x=>x.tenant_id==='SHOP-A');
  assert.equal(shop.expected_cents,13000);
  assert.equal(shop.variance_cents,0);
  assert.equal(shop.revision,2);
  assert.equal(shop.closing_entry_id,'REAL-1');
  const legacy=s.entries.find(x=>x.tenant_id==='SHOP-A'&&x.entry_id==='LEG-1');
  assert.equal(legacy.credit_cents,0);
  assert.equal(legacy.debit_cents,0);
  assert.equal(legacy.description,
    'Legacy day close — legacy automatic adjustment retired by Cash Reconciliation');
  const real=s.entries.find(x=>x.tenant_id==='SHOP-A'&&x.entry_id==='REAL-1');
  assert.equal(real.credit_cents,3000);
  assert.equal(s.sessions.find(x=>x.tenant_id==='SHOP-B').expected_cents,10000);
});

test('identical stable ID replay cannot double-retire; changed intent conflicts',async()=>{
  assert.equal((await contract().post(A)).status,'COMMITTED');
  const state=await snapshot();
  assert.equal((await contract().post(A)).status,'REPLAY');
  assert.equal((await contract().post({...A,realEntryId:'REAL-2'})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),state);
});

test('concurrent different IDs competing for same session cannot double attribute cash',async()=>{
  const result=await Promise.all([
    contract().post({...A,operationId:'OP-RACE-1'}),
    contract().post({...A,operationId:'OP-RACE-2',realEntryId:'REAL-2'})
  ]);
  assert.deepEqual(result.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  const s=await snapshot();
  assert.equal(s.receipts.filter(x=>x.tenant_id==='SHOP-A').length,1);
  assert.equal(s.links.filter(x=>x.tenant_id==='SHOP-A').length,1);
  assert.equal(s.audits.filter(x=>x.tenant_id==='SHOP-A').length,1);
  assert.equal(s.sessions.find(x=>x.tenant_id==='SHOP-A').revision,2);
});

test('late audit insert aborts ENTIRE D1 operation, including legacy clearing',async()=>{
  const beforeState=await snapshot();
  await assert.rejects(()=>contract().post({...A,operationId:'OP-FAIL'}),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),beforeState);
  assert.equal((await contract().post({...A,operationId:'OP-GOOD'})).status,'COMMITTED');
});

test('stale revision, false amount, wrong sign and deleted/synthetic transaction all decline',async()=>{
  const beforeState=await snapshot();
  assert.equal((await contract().post({...A,revision:2})).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET credit_cents=2000 WHERE tenant_id='SHOP-A' AND entry_id='REAL-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET credit_cents=0,debit_cents=3000 WHERE tenant_id='SHOP-A' AND entry_id='REAL-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET debit_cents=0,credit_cents=3000,is_deleted=1 WHERE tenant_id='SHOP-A' AND entry_id='REAL-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET is_deleted=0,type='Session Open' WHERE tenant_id='SHOP-A' AND entry_id='REAL-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  const result=await snapshot();
  assert.equal(result.links.length,0);
  assert.equal(result.receipts.length,0);
  assert.equal(result.audits.length,0);
  assert.equal(result.sessions[0].revision,1);
  assert.equal(beforeState.sessions[0].revision,result.sessions[0].revision);
});

test('reused real transaction link, wrong legacy reference or previously retired adjustment refuse',async()=>{
  await DB.prepare("INSERT INTO m08_test_links (tenant_id,session_id,phase,entry_id,operation_id) VALUES ('SHOP-A','OLD','closing','REAL-1','OLD-OP')").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("DELETE FROM m08_test_links WHERE operation_id='OLD-OP'").run();
  await DB.prepare("UPDATE m08_test_cash_entries SET reference='SOMETHING-ELSE' WHERE tenant_id='SHOP-A' AND entry_id='LEG-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET reference='SESSION-1',credit_cents=0 WHERE tenant_id='SHOP-A' AND entry_id='LEG-1'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
});

test('revocation/expiry/role downgrade inside SQL write and cross-tenant token forgery decline',async()=>{
  const baseline=await snapshot();
  assert.equal((await contract().post({...A,tokenHash:B.tokenHash})).status,'DECLINED');
  assert.equal((await contract().post({...A,now:4000})).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_sessions SET revoked_at=1100 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_sessions SET revoked_at=NULL WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m08_test_roles SET can_edit=0 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_roles SET can_edit=1 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(A)).status,'DECLINED');
  const outcome=await snapshot();
  assert.equal(outcome.receipts.length,0);
  assert.equal(outcome.links.length,0);
  assert.equal(outcome.sessions[0].revision,baseline.sessions[0].revision);
});

test('same source identities can independently reconcile in another tenant',async()=>{
  assert.equal((await contract().post(A)).status,'COMMITTED');
  assert.equal((await contract().post(B)).status,'COMMITTED');
  assert.equal((await snapshot()).links.length,2);
});

test('malformed input and missing D1 fail closed, no externally routable ERP write',async()=>{
  assert.throws(()=>createSyntheticD1CashReconciliationContract(null),/D1/);
  for(const input of [null,{}, {...A,tenantId:'SHOP-A;DROP'}, {...A,revision:0},
    {...A,now:'1000'}, {...A,tokenHash:'bad'}]){
    await assert.rejects(()=>contract().post(input),TypeError);
  }
  const resp=await worker.fetch('http://m08.test/api/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...A,sql:'DROP TABLE'})
  });
  assert.equal(resp.status,404);
  assert.equal((await snapshot()).receipts.length,0);
});
