import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M08_MULTI_DDL,seedM08Multi}
  from '../fixtures/m08-reconciliation-multi-schema.mjs';
import {createSyntheticD1MultiCashReconciliationContract}
  from '../fixtures/m08-reconciliation-multi-contract.mjs';

// Test-only local Workerd/D1: no real business database or publicly routable RPC.
const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m08-reconciliation-multi-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m08-reconciliation-multi-test');
let DB;
const input=Object.freeze({
  tenantId:'SHOP-A',actorId:'USER-A',tokenHash:'a'.repeat(64),
  operationId:'OP-MULTI-1',sessionId:'SESSION-1',legacyEntryId:'LEG-1',
  entryIds:['REAL-1','REAL-2'],revision:1,now:1000
});
const contract=()=>createSyntheticD1MultiCashReconciliationContract(DB);
const rows=async(sql)=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
async function snapshot(){
  const out={};
  const queries={
    sessions:'SELECT * FROM m08_test_cash_sessions ORDER BY tenant_id,session_id',
    cash:'SELECT * FROM m08_test_cash_entries ORDER BY tenant_id,entry_id',
    claims:'SELECT * FROM m08_multi_receipts ORDER BY tenant_id,operation_id',
    links:'SELECT * FROM m08_multi_links ORDER BY tenant_id,entry_id',
    audits:'SELECT * FROM m08_multi_audit ORDER BY tenant_id,operation_id',
    previous:'SELECT * FROM m08_multi_prior_usage ORDER BY tenant_id,entry_id'
  };
  for(const [name,sql] of Object.entries(queries))out[name]=await rows(sql);
  return out;
}
const a=x=>({...input,...x});
const shop=(records,tenant='SHOP-A')=>records.filter(x=>x.tenant_id===tenant);
before(async()=>{await harness.listen();({DB}=await worker.getEnv());});
after(async()=>harness.close());
beforeEach(async()=>{
  for(const table of [
    'm08_multi_audit','m08_multi_links','m08_multi_receipts',
    'm08_multi_prior_usage','m08_test_audit','m08_test_links',
    'm08_test_receipts','m08_test_cash_entries','m08_test_cash_sessions',
    'm08_test_sessions','m08_test_users','m08_test_roles'
  ])await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const statement of M08_MULTI_DDL)await DB.prepare(statement).run();
  await seedM08Multi(DB);
});

test('two real cash-in entries atomically retire synthetic close and update session, receipt and audit',async()=>{
  assert.deepEqual(await contract().post(input),
    {status:'COMMITTED',operationId:'OP-MULTI-1',sessionId:'SESSION-1',
      entryIds:['REAL-1','REAL-2']});
  const state=await snapshot();
  assert.deepEqual(shop(state.links).map(x=>x.entry_id),['REAL-1','REAL-2']);
  assert.equal(shop(state.claims).length,1);
  assert.equal(shop(state.audits).length,1);
  const cash=shop(state.cash);
  assert.deepEqual(cash.filter(x=>x.entry_id.startsWith('REAL-'))
    .map(x=>x.credit_cents),[1000,2000]);
  const retired=cash.find(x=>x.entry_id==='LEG-1');
  assert.deepEqual([retired.credit_cents,retired.debit_cents],[0,0]);
  assert.equal(retired.description,
    'Legacy day close — legacy automatic adjustment retired by Cash Reconciliation');
  const session=shop(state.sessions)[0];
  assert.equal(session.expected_cents,13000);
  assert.equal(session.variance_cents,0);
  assert.equal(session.revision,2);
  assert.equal(session.closing_entry_id,'OP-MULTI-1');
  assert.equal(shop(state.sessions,'SHOP-B')[0].revision,1);
  assert.equal(shop(state.claims,'SHOP-B').length,0);
});

test('duplicates and CSV/JSON source selection normalize; same set in another order is inert replay',async()=>{
  const initial=a({entryIds:'REAL-2, REAL-1, REAL-2'});
  assert.equal((await contract().post(initial)).status,'COMMITTED');
  const state=await snapshot();
  assert.deepEqual(await contract().post(a({entryIds:'["REAL-1","REAL-2"]'})),
    {status:'REPLAY',operationId:'OP-MULTI-1',sessionId:'SESSION-1',
      entryIds:['REAL-1','REAL-2']});
  assert.equal((await contract().post(a({entryIds:['REAL-1','REAL-3']}))).status,'CONFLICT');
  assert.deepEqual(await snapshot(),state);
});

test('three distinct real entries update exact sum and link count, not merely first two',async()=>{
  await DB.prepare("UPDATE m08_test_cash_entries SET credit_cents=500 WHERE tenant_id='SHOP-A' AND entry_id='REAL-2'").run();
  await DB.prepare("INSERT INTO m08_test_cash_entries VALUES ('SHOP-A','REAL-3','Sale','INV-3',1500,0,0,'Another real sale')").run();
  const result=await contract().post(a({entryIds:['REAL-1','REAL-2','REAL-3']}));
  assert.equal(result.status,'COMMITTED');
  assert.deepEqual(shop((await snapshot()).links).map(x=>x.entry_id),
    ['REAL-1','REAL-2','REAL-3']);
  const count=await DB.prepare("SELECT COUNT(*) n FROM m08_multi_links WHERE tenant_id='SHOP-A'").first();
  assert.equal(count.n,3);
});

test('competing operation IDs for identical session cannot double-link or retire',async()=>{
  const result=await Promise.all([
    contract().post(a({operationId:'OP-RACE-A'})),
    contract().post(a({operationId:'OP-RACE-B'}))
  ]);
  assert.deepEqual(result.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  const state=await snapshot();
  assert.equal(shop(state.claims).length,1);
  assert.equal(shop(state.links).length,2);
  assert.equal(shop(state.audits).length,1);
  assert.equal(shop(state.sessions)[0].revision,2);
});

test('wrong signs, missing/deleted/synthetic IDs, duplicate dirty rows and wrong total decline',async()=>{
  const unchanged=await snapshot();
  for(const ids of [['REAL-1','MISSING'],['REAL-1','LEG-1']]){
    assert.equal((await contract().post(a({entryIds:ids}))).status,'DECLINED');
  }
  await DB.prepare("UPDATE m08_test_cash_entries SET debit_cents=2500,credit_cents=0 WHERE tenant_id='SHOP-A' AND entry_id='REAL-2'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET debit_cents=0,credit_cents=1900 WHERE tenant_id='SHOP-A' AND entry_id='REAL-2'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET credit_cents=2000,is_deleted=1 WHERE tenant_id='SHOP-A' AND entry_id='REAL-2'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_cash_entries SET is_deleted=0,type='Day Close Adjustment' WHERE tenant_id='SHOP-A' AND entry_id='REAL-2'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  const state=await snapshot();
  assert.equal(shop(state.claims).length,0);
  assert.equal(shop(state.links).length,0);
  assert.equal(shop(state.audits).length,0);
  assert.equal(shop(state.sessions)[0].revision,1);
  assert.equal(shop(state.cash).find(x=>x.entry_id==='LEG-1').credit_cents,
    shop(unchanged.cash).find(x=>x.entry_id==='LEG-1').credit_cents);
});

test('an entry already used in another session or phase fails the entire selection',async()=>{
  for(const [session,phase] of [['OTHER-SESSION','closing'],['SESSION-1','opening']]){
    await DB.prepare('INSERT INTO m08_multi_prior_usage VALUES (?,?,?,?)')
      .bind('SHOP-A','REAL-2',session,phase).run();
    const beforeState=await snapshot();
    assert.equal((await contract().post(input)).status,'DECLINED');
    assert.deepEqual(await snapshot(),beforeState);
    await DB.prepare('DELETE FROM m08_multi_prior_usage').run();
  }
  assert.equal((await contract().post(input)).status,'COMMITTED');
});

test('stale revision, revoked session, expired token and downgraded role fail SQL guard',async()=>{
  assert.equal((await contract().post(a({revision:2}))).status,'DECLINED');
  assert.equal((await contract().post(a({tokenHash:'b'.repeat(64)}))).status,'DECLINED');
  assert.equal((await contract().post(a({now:9000}))).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_sessions SET revoked_at=999 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_sessions SET revoked_at=NULL WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m08_test_roles SET can_edit=0 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(input)).status,'DECLINED');
  await DB.prepare("UPDATE m08_test_roles SET can_edit=1 WHERE tenant_id='SHOP-A'").run();
  assert.equal((await contract().post(input)).status,'DECLINED',
    'restored permission still fails after role auth version changed');
  assert.equal(shop((await snapshot()).claims).length,0);
});

test('late failure on second linked row rolls back first link, receipt and legacy retirement',async()=>{
  await DB.prepare(`CREATE TRIGGER m08_multi_fail_second BEFORE INSERT ON m08_multi_links
    WHEN NEW.entry_id='REAL-2' BEGIN SELECT RAISE(ABORT,'failure-on-second-link'); END`).run();
  const unchanged=await snapshot();
  await assert.rejects(()=>contract().post(input),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),unchanged);
  await DB.prepare('DROP TRIGGER m08_multi_fail_second').run();
  assert.equal((await contract().post(input)).status,'COMMITTED');
});

test('late audit failure rolls back both links, entire session update and synthetic retirement',async()=>{
  const beforeState=await snapshot();
  await assert.rejects(()=>contract().post(a({operationId:'OP-MULTI-FAIL'})),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),beforeState);
  assert.equal((await contract().post(input)).status,'COMMITTED');
});

test('two tenants may reconcile same source IDs, but receipt and link identities remain tenant-scoped',async()=>{
  const other=a({tenantId:'SHOP-B',actorId:'USER-B',tokenHash:'b'.repeat(64)});
  assert.equal((await contract().post(input)).status,'COMMITTED');
  assert.equal((await contract().post(other)).status,'COMMITTED');
  assert.equal((await snapshot()).links.length,4);
});

test('untrusted input and non-routable test worker fail closed',async()=>{
  assert.throws(()=>createSyntheticD1MultiCashReconciliationContract(null),/D1/);
  for(const value of [
    null,{},a({entryIds:['REAL-1']}),a({entryIds:[]}),
    a({entryIds:Array(17).fill('REAL-1').map((x,i)=>x+i)}),
    a({entryIds:['REAL-1','REAL-1']}),a({entryIds:['REAL-1',3]}),
    a({entryIds:['REAL-1','REAL-2;DROP TABLE']}),a({revision:0}),
    a({entryIds:Promise.resolve(['REAL-1','REAL-2'])}),
    a({sql:'DELETE FROM m08_test_cash_entries'})
  ])await assert.rejects(()=>contract().post(value),TypeError);
  assert.equal((await worker.fetch('https://m08.test/api/rpc',{
    method:'POST',body:JSON.stringify(input)
  })).status,404);
  assert.equal(shop((await snapshot()).claims).length,0);
});
