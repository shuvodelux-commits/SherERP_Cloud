import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createM04AtomicG1SaleProof} from '../../src/db/m04-atomic-g1-sale-proof.js';
import {M04_RECEIPT_DDL} from '../fixtures/m03-m04-receipt-schema.mjs';
import {M03_G1_POST_DDL,M03_G1_NOW as NOW,
  M03_G1_TOKEN_ADMIN as ADMIN,M03_G1_TOKEN_CASHIER as CASHIER,
  M03_G1_TOKEN_DENY as DENY,M03_G1_TOKEN_SECOND as SECOND}
  from '../fixtures/m03-m04-g1-post-schema.mjs';

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
  await DB.prepare('UPDATE auth_sessions SET role_auth_version=(SELECT auth_version FROM auth_roles WHERE role_name=?) WHERE token_hash=?')
    .bind('Cashier',hash(CASHIER)).run();
  await assert.rejects(()=>posting.post_(input(CASHIER,'OP-NO-GRANT')),/Denied/i);
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
