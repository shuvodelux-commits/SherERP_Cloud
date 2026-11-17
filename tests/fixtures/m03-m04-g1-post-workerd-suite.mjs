import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createM04AtomicG1SaleProof} from '../../src/db/m04-atomic-g1-sale-proof.js';
import {M04_RECEIPT_DDL} from './m03-m04-receipt-schema.mjs';
import {M03_G1_POST_DDL,M03_G1_NOW as NOW,
  M03_G1_TOKEN_ADMIN as ADMIN,M03_G1_TOKEN_CASHIER as CASHIER,
  M03_G1_TOKEN_DENY as DENY,M03_G1_TOKEN_SECOND as SECOND}
  from './m03-m04-g1-post-schema.mjs';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-g1-post-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m03-m04-g1-post-workerd-test');
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const input=(token,operationId,patch={})=>({
  token,nowMs:NOW,operationId,units:1,amount:'120.00',...patch
});
let DB,posting;
const snapshot=async()=>({
  stock:(await DB.prepare('SELECT business_id,available FROM synthetic_m03_g1_stock ORDER BY business_id').all()).results,
  receipts:(await DB.prepare('SELECT tenant_id,operation_id,actor_id,result_ref FROM operation_receipts ORDER BY operation_id').all()).results,
  journal:(await DB.prepare('SELECT business_id,operation_id,account_kind,signed_cents FROM synthetic_m03_g1_journal ORDER BY operation_id,account_kind').all()).results
});
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  for(const ddl of [...M04_RECEIPT_DDL,...M03_G1_POST_DDL]){
    await DB.prepare(ddl).run();
  }
  for(const [role,permission] of [
    ['Cashier','{"sales":{"add":true}}'],['Denied','{"sales":{"add":false}}']
  ]){
    await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES(?,'Active',?)")
      .bind(role,permission).run();
  }
  for(const [id,role,phone,token,epoch] of [
    ['ADMIN','Administrator','01710000001',ADMIN,null],
    ['CASHIER','Cashier','01710000002',CASHIER,1],
    ['DENIED','Denied','01710000003',DENY,1],
    ['SECOND','Administrator','01710000004',SECOND,null]
  ]){
    await DB.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
      status,password_hash,password_salt,password_iterations)
      VALUES(?,?,?,?,'Active',?,?,210000)`)
      .bind(id,'G1 '+id,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
    await DB.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
      role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
      VALUES(?,?,1,?,1,?,?,?)`)
      .bind(hash(token),id,epoch,NOW-600_000,NOW-10_000,NOW+600_000).run();
  }
  for(const [id,amount] of [['BUSINESS-A',2],['BUSINESS-B',5]]){
    await DB.prepare('INSERT INTO synthetic_m03_g1_stock(business_id,sku,available) VALUES(?,?,?)')
      .bind(id,'PIPE-1',amount).run();
  }
  await DB.prepare(`INSERT INTO synthetic_m03_g1_cash_sessions
    (business_id,session_id,status) VALUES('BUSINESS-A','SESSION-1','Open')`).run();
  posting=createM04AtomicG1SaleProof({DB},{businessId:'BUSINESS-A'});
});
after(async()=>{await harness.close();});

test('actual Workerd D1 commits M04-authorized receipt, stock CAS and two balanced signed journal legs atomically',async()=>{
  assert.deepEqual(await posting.post_(input(ADMIN,'OP-W1')),{status:'COMMITTED',operationId:'OP-W1',resultRef:'SYNTH-OP-W1'});
  const now=await snapshot();
  assert.equal(now.stock[0].available,1);
  assert.equal(now.stock[1].available,5);
  assert.deepEqual(now.receipts.map(r=>[r.operation_id,r.actor_id]),[['OP-W1','ADMIN']]);
  assert.deepEqual(now.journal.map(r=>[r.account_kind,r.signed_cents]),[
    ['cash',12000],['sales_revenue',-12000]
  ]);
  assert.equal(now.journal.reduce((sum,leg)=>sum+leg.signed_cents,0),0);
});

test('local D1 replay returns original immutable reference, changed payload conflicts, unrelated actor cannot read receipt',async()=>{
  const original=await snapshot();
  assert.deepEqual(await posting.post_(input(ADMIN,'OP-W1')),{status:'REPLAY',operationId:'OP-W1',resultRef:'SYNTH-OP-W1'});
  assert.deepEqual(await posting.post_(input(ADMIN,'OP-W1',{amount:'121.00'})),{
    status:'CONFLICT',operationId:'OP-W1'
  });
  assert.deepEqual(await posting.post_(input(SECOND,'OP-W1')),{status:'DECLINED',operationId:'OP-W1'});
  await assert.rejects(()=>posting.post_(input(DENY,'OP-DENIED')),/Denied/i);
  assert.deepEqual(await snapshot(),original);
});

test('concurrent last-unit claims across distinct IDs serialize in real D1 without duplicate receipt or money',async()=>{
  const settled=await Promise.all([
    posting.post_(input(CASHIER,'OP-W2')),
    posting.post_(input(SECOND,'OP-W3'))
  ]);
  assert.deepEqual(settled.map(v=>v.status).sort(),['COMMITTED','DECLINED']);
  const s=await snapshot();
  assert.equal(s.stock[0].available,0);
  assert.equal(s.stock[1].available,5);
  assert.equal(s.receipts.length,2);
  assert.equal(s.journal.length,4);
  assert.equal(s.journal.reduce((sum,leg)=>sum+leg.signed_cents,0),0);
});

test('current M04 revocation and permission epoch changes deny before any private posting',async()=>{
  const original=await snapshot();
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW,hash(ADMIN)).run();
  await assert.rejects(()=>posting.post_(input(ADMIN,'OP-REVOKE')),/Denied/i);
  await DB.prepare("UPDATE auth_roles SET permissions_json='{}' WHERE role_name='Cashier'").run();
  await assert.rejects(()=>posting.post_(input(CASHIER,'OP-STALE-ROLE')),/Denied/i);
  // A changed role epoch requires a freshly issued session; the previous
  // M04 session authority snapshot is intentionally immutable.
  const freshCashier='f'.repeat(64);
  const epoch=(await DB.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Cashier'").first()).auth_version;
  await DB.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
    role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms)
    VALUES(?, 'CASHIER',1,?,1,?,?,?)`)
    .bind(hash(freshCashier),epoch,NOW-600_000,NOW-10_000,NOW+600_000).run();
  await assert.rejects(()=>posting.post_(input(freshCashier,'OP-NO-GRANT')),/Denied/i);
  assert.deepEqual(await snapshot(),original);
});

test('actual Workerd D1 late journal fault rolls back receipt and stock completely',async()=>{
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=1 WHERE business_id='BUSINESS-A'").run();
  await DB.prepare(`CREATE TRIGGER synthetic_g1_fail_late BEFORE INSERT ON synthetic_m03_g1_journal
    WHEN NEW.account_kind='sales_revenue'
    BEGIN SELECT RAISE(ABORT,'forced local D1 journal failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting.post_(input(SECOND,'OP-W-FAULT')),/NEEDS_REVIEW/i);
  assert.deepEqual(await snapshot(),before);
  await DB.prepare('DROP TRIGGER synthetic_g1_fail_late').run();
  assert.equal((await posting.post_(input(SECOND,'OP-W-FAULT'))).status,'COMMITTED');
});

test('ambiguous response after D1 committed mutation requires same-operation replay, never another posting',async()=>{
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=1 WHERE business_id='BUSINESS-A'").run();
  let injected=false;
  const proxy={prepare(sql){
    const statement=DB.prepare(sql);
    if(!sql.includes('INSERT INTO operation_receipts'))return statement;
    return {bind(...values){
      const bound=statement.bind(...values);
      return {...bound,async first(){
        const result=await bound.first();
        if(!injected&&result){injected=true;throw new Error('simulated lost D1 response after COMMIT');}
        return result;
      }};
    }};
  }};
  const uncertain=createM04AtomicG1SaleProof({DB:proxy},{businessId:'BUSINESS-A'});
  await assert.rejects(()=>uncertain.post_(input(SECOND,'OP-W-LOST')),/NEEDS_REVIEW/i);
  assert.equal(injected,true);
  const after=await snapshot();
  assert.deepEqual(await posting.post_(input(SECOND,'OP-W-LOST')),{status:'REPLAY',
    operationId:'OP-W-LOST',resultRef:'SYNTH-OP-W-LOST'});
  assert.deepEqual(await snapshot(),after);
});

test('private G1 D1 overlay is not deployed or activated as a public sale RPC',async()=>{
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m03-m04-g1-post-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000019');
  assert.equal(config.d1_databases[0].migrations_dir,'tests/fixtures/m04-auth-migrations');
  const live=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  assert.equal(live.includes('m04-atomic-g1-sale-proof'),false);
  assert.equal(live.includes('synthetic_m03_g1_stock'),false);
  const reply=await worker.fetch('http://local.test/__m03_m04_g1__/sale',{method:'POST'});
  assert.equal(reply.status,404);
});

test('G2 real Workerd D1: no Open session means neither stock nor journal can post',async()=>{
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=3 WHERE business_id='BUSINESS-A'").run();
  for(const status of ['Starting','Closing','Closed']){
    await DB.prepare('UPDATE synthetic_m03_g1_cash_sessions SET status=? WHERE business_id=?')
      .bind(status,'BUSINESS-A').run();
    const before=await snapshot();
    assert.deepEqual(await posting.post_(input(SECOND,'OP-G2-'+status.toUpperCase())),{
      status:'DECLINED',operationId:'OP-G2-'+status.toUpperCase()
    });
    assert.deepEqual(await snapshot(),before);
  }
  await DB.prepare("DELETE FROM synthetic_m03_g1_cash_sessions WHERE business_id='BUSINESS-A'").run();
  await DB.prepare(`INSERT INTO synthetic_m03_g1_cash_sessions
    (business_id,session_id,status) VALUES('BUSINESS-B','B-SESSION','Open')`).run();
  const noSession=await snapshot();
  assert.deepEqual(await posting.post_(input(SECOND,'OP-G2-NONE')),{status:'DECLINED',operationId:'OP-G2-NONE'});
  assert.deepEqual(await snapshot(),noSession);
  await DB.prepare(`INSERT INTO synthetic_m03_g1_cash_sessions
    (business_id,session_id,status) VALUES('BUSINESS-A','SESSION-2','Open')`).run();
});

test('G2 real D1: close between actor verification and receipt claim denies stale operation',async()=>{
  const before=await snapshot();
  let hit=false;
  const proxy={prepare(sql){
    const statement=DB.prepare(sql);
    if(!sql.includes('INSERT INTO operation_receipts'))return statement;
    return {bind(...values){
      const bound=statement.bind(...values);
      return {...bound,async first(){
        if(!hit){
          hit=true;
          await DB.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'").run();
        }
        return bound.first();
      }};
    }};
  }};
  const trial=createM04AtomicG1SaleProof({DB:proxy},{businessId:'BUSINESS-A'});
  assert.deepEqual(await trial.post_(input(SECOND,'OP-G2-RACE')),{
    status:'DECLINED',operationId:'OP-G2-RACE'
  });
  assert.equal(hit,true);
  assert.deepEqual(await snapshot(),before);
  await DB.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status='Open' WHERE business_id='BUSINESS-A'").run();
});

test('G2 real Workerd D1: closed session preserves stable prior receipt replay without new posting',async()=>{
  assert.equal((await posting.post_(input(SECOND,'OP-G2-OPEN'))).status,'COMMITTED');
  const after=await snapshot();
  await DB.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status='Closing' WHERE business_id='BUSINESS-A'").run();
  assert.deepEqual(await posting.post_(input(SECOND,'OP-G2-OPEN')),{status:'REPLAY',
    operationId:'OP-G2-OPEN',resultRef:'SYNTH-OP-G2-OPEN'});
  assert.deepEqual(await posting.post_(input(SECOND,'OP-G2-CLOSED')),{status:'DECLINED',
    operationId:'OP-G2-CLOSED'});
  assert.deepEqual(await snapshot(),after);
});

test('G3 real Workerd: posted receipt includes stock movement and replays after unrelated stock changes',async()=>{
  await DB.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status='Open' WHERE business_id='BUSINESS-A'").run();
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=3 WHERE business_id='BUSINESS-A'").run();
  assert.equal((await posting.post_(input(SECOND,'OP-G3-WORKER'))).status,'COMMITTED');
  const movements=(await DB.prepare(`SELECT business_id,operation_id,sku,units_out
    FROM synthetic_m03_g1_stock_movements WHERE operation_id=?`)
    .bind('OP-G3-WORKER').all()).results;
  assert.deepEqual(movements,[{
    business_id:'BUSINESS-A',operation_id:'OP-G3-WORKER',sku:'PIPE-1',units_out:1
  }]);
  const before=await snapshot();
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=0 WHERE business_id='BUSINESS-A'").run();
  assert.deepEqual(await posting.post_(input(SECOND,'OP-G3-WORKER')),{
    status:'REPLAY',operationId:'OP-G3-WORKER',resultRef:'SYNTH-OP-G3-WORKER'
  });
  const after=await snapshot();
  assert.deepEqual(after.receipts,before.receipts);
  assert.deepEqual(after.journal,before.journal);
});

test('G3 real Workerd: missing child journal leg makes prior receipt NEEDS_REVIEW without another posting',async()=>{
  await DB.prepare('DROP TRIGGER synthetic_m03_g1_journal_immutable_delete').run();
  await DB.prepare(`DELETE FROM synthetic_m03_g1_journal
    WHERE operation_id=? AND account_kind='sales_revenue'`).bind('OP-G3-WORKER').run();
  const afterDeletion=await snapshot();
  await assert.rejects(()=>posting.post_(input(SECOND,'OP-G3-WORKER')),
    /NEEDS_REVIEW|integrity|journal/i);
  assert.deepEqual(await snapshot(),afterDeletion);
});

test('G3 real Workerd: stock movement drift also refuses replay; late movement fault rolls back',async()=>{
  await DB.prepare('DROP TRIGGER synthetic_m03_g3_movement_immutable_delete').run();
  await DB.prepare('DELETE FROM synthetic_m03_g1_stock_movements WHERE operation_id=?')
    .bind('OP-G3-WORKER').run();
  await assert.rejects(()=>posting.post_(input(SECOND,'OP-G3-WORKER')),
    /NEEDS_REVIEW|integrity|movement/i);
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=1 WHERE business_id='BUSINESS-A'").run();
  await DB.prepare(`CREATE TRIGGER synthetic_m03_g3_fault BEFORE INSERT ON synthetic_m03_g1_stock_movements
    BEGIN SELECT RAISE(ABORT,'G3 forced movement failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting.post_(input(SECOND,'OP-G3-ROLLBACK')),/NEEDS_REVIEW/i);
  assert.deepEqual(await snapshot(),before);
  await DB.prepare('DROP TRIGGER synthetic_m03_g3_fault').run();
});

test('G4 Workerd D1 issues one source invoice ID with authorized sale and stable replay',async()=>{
  await DB.prepare("UPDATE synthetic_m03_g1_stock SET available=2 WHERE business_id='BUSINESS-A'").run();
  await DB.prepare("UPDATE synthetic_m03_g1_cash_sessions SET status='Open' WHERE business_id='BUSINESS-A'").run();
  const counter=async()=>(await DB.prepare("SELECT current_sequence FROM synthetic_m03_g4_sale_counters WHERE business_id='BUSINESS-A'").first()).current_sequence;
  const before=await counter();
  const inputValue=input(SECOND,'OP-G4-WORKER-1');
  assert.equal((await posting.post_(inputValue)).status,'COMMITTED');
  assert.equal(await counter(),before+1);
  const row=await DB.prepare("SELECT source_invoice_id FROM operation_receipts WHERE operation_id=?").bind('OP-G4-WORKER-1').first();
  assert.equal(row.source_invoice_id,'INV-'+String(before+1).padStart(6,'0'));
  const prior=await snapshot();
  assert.equal((await posting.post_(inputValue)).status,'REPLAY');
  assert.equal(await counter(),before+1);
  assert.deepEqual(await snapshot(),prior);
});
