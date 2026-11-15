import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {AUTH_POLICY,createOfflinePasswordCredential,loginWithD1}
  from '../../src/auth/d1-auth-core.js';
import {createM04SingleBusinessReceiptReadback}
  from '../../src/db/m04-operation-receipt-read.js';
import {M04_RECEIPT_DDL,M04_RECEIPT_CLOCK,M04_RECEIPT_TOKEN_A,
  M04_RECEIPT_TOKEN_B,M04_RECEIPT_TOKEN_C,M04_RECEIPT_INTENT,
  M04_RECEIPT_PAYLOAD} from '../fixtures/m03-m04-receipt-schema.mjs';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-receipt-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-m04-receipt-workerd-test');
const BASE=M04_RECEIPT_CLOCK;
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
let DB,issuedToken;
async function seed(){
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('Cashier','Active','{}','POS')`).run();
  for(const [user,phone,role] of [
    ['USR-ADMIN','01710000001','Administrator'],
    ['USR-SECOND','01710000002','Administrator'],
    ['USR-CASHIER','01710000003','Cashier']
  ]){
    await DB.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
      status,password_hash,password_salt,password_iterations)
      VALUES (?,?,?,?,'Active',?,?,210000)`)
      .bind(user,'Synthetic '+user,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  }
  for(const [token,user,roleVersion] of [
    [M04_RECEIPT_TOKEN_A,'USR-ADMIN',null],
    [M04_RECEIPT_TOKEN_B,'USR-SECOND',null],
    [M04_RECEIPT_TOKEN_C,'USR-CASHIER',1]
  ]){
    await DB.prepare(`INSERT INTO auth_sessions
      (token_hash,user_id,user_auth_version,role_auth_version,
       credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES (?,?,1,?,1,?,?,?,NULL)`).bind(
      digest(token),user,roleVersion,BASE-600_000,BASE-300_000,BASE+1_200_000
    ).run();
  }
  for(const [op,user,ref] of [['OP-1','USR-ADMIN','SALE-1'],['OP-2','USR-SECOND','SALE-2']]){
    const hash=await hashCanonicalOperationIntent({
      tenantId:'BUSINESS-A',actorId:user,operationType:'sales.post',
      payload:M04_RECEIPT_PAYLOAD
    });
    await DB.prepare(`INSERT INTO operation_receipts(
      tenant_id,operation_id,actor_id,operation_type,
      payload_hash,result_ref,committed_at) VALUES (?,?,?,?,?,?,?)`)
      .bind('BUSINESS-A',op,user,'sales.post',hash,ref,'2026-11-15T06:00:00Z').run();
  }
}
const request=async(path,body,method='POST')=>{
  const resp=await worker.fetch('http://m03m04.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)}:{})
  });
  return {status:resp.status,body:await resp.json()};
};
const state=async()=>(
  await DB.prepare(`SELECT tenant_id,operation_id,actor_id,result_ref
    FROM operation_receipts ORDER BY tenant_id,operation_id`).all()
).results.map(row=>({...row}));

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  for(const sql of M04_RECEIPT_DDL)await DB.prepare(sql).run();
  await seed();
});
after(async()=>{await server.close();});

test('actual M04 schema session plus tenant-checked immutable receipt returns original result',async()=>{
  assert.deepEqual(await request('/__m03_m04_receipt__/owner'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
  assert.equal((await state()).length,2);
});

test('canonical JSON reorder replays, while changed amount and operation type conflict',async()=>{
  const previous=await state();
  assert.deepEqual(await request('/__m03_m04_receipt__/reordered'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
  for(const path of [
    '/__m03_m04_receipt__/changed-amount',
    '/__m03_m04_receipt__/changed-type'
  ]){
    assert.deepEqual(await request(path),{
      status:200,body:{status:'CONFLICT',operationId:'OP-1'}
    });
  }
  assert.deepEqual(await state(),previous);
});

test('second Administrator, valid custom-role and forged token cannot reveal original actor receipt',async()=>{
  const previous=await state();
  for(const path of [
    '/__m03_m04_receipt__/other-admin',
    '/__m03_m04_receipt__/cashier',
    '/__m03_m04_receipt__/unknown-token'
  ]){
    assert.deepEqual(await request(path),{
      status:403,body:{error:'Denied'}
    },path);
  }
  assert.deepEqual(await request('/__m03_m04_receipt__/second-own'),{
    status:200,body:{status:'REPLAY',operationId:'OP-2',resultRef:'SALE-2'}
  });
  assert.deepEqual(await state(),previous);
});

test('valid Administrator gets NEEDS_REVIEW for no receipt and other trusted business scope',async()=>{
  assert.deepEqual(await request('/__m03_m04_receipt__/missing'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-UNKNOWN'}
  });
  assert.deepEqual(await request('/__m03_m04_receipt__/other-business'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-1'}
  });
});

test('M04 30-minute idle timeout and absolute expiry deny matching stored receipt',async()=>{
  for(const path of [
    '/__m03_m04_receipt__/expired-idle',
    '/__m03_m04_receipt__/expired-absolute'
  ]){
    assert.deepEqual(await request(path),{
      status:403,body:{error:'Denied'}
    },path);
  }
});

test('fixed test Worker refuses arbitrary requests and never uses supplied actor or SQL',async()=>{
  const prior=await state();
  assert.deepEqual(await request('/__m03_m04_receipt__/owner',{
    token:M04_RECEIPT_TOKEN_B,actorId:'USR-SECOND',
    businessId:'BUSINESS-B',operationId:'OP-HACK',
    sql:'DELETE FROM operation_receipts'
  }),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
  assert.equal((await request('/__m03_m04_receipt__/owner',undefined,'GET')).status,405);
  assert.equal((await request('/__m03_m04_receipt__/unknown')).status,404);
  assert.deepEqual(await state(),prior);
});

test('actual M04 PBKDF2 login issues bearer token accepted by D1-aligned readback',async()=>{
  const credential=await createOfflinePasswordCredential('SyntheticPassword123!');
  await DB.prepare(`UPDATE auth_users
    SET password_hash=?,password_salt=?,password_iterations=?
    WHERE user_id='USR-ADMIN'`)
    .bind(credential.passwordHash,credential.passwordSalt,credential.iterations).run();
  const auth=await loginWithD1(DB,{
    phoneKey:'01710000001',password:'SyntheticPassword123!',nowMs:BASE+10_000
  });
  assert.equal(auth.authenticated,true);
  assert.match(auth.token,/^[0-9a-f]{64}$/);
  issuedToken=auth.token;
  assert.deepEqual(await createM04SingleBusinessReceiptReadback({DB},{
    businessId:'BUSINESS-A'}).reconcile_({...M04_RECEIPT_INTENT,
      token:auth.token,nowMs:BASE+10_000
    }),{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
});

test('credential reset after login invalidates that fresh session and old static session',async()=>{
  assert.ok(issuedToken);
  await DB.prepare(`UPDATE auth_users SET credential_version=credential_version+1
    WHERE user_id='USR-ADMIN'`).run();
  await assert.rejects(()=>createM04SingleBusinessReceiptReadback({DB},{
    businessId:'BUSINESS-A'}).reconcile_({...M04_RECEIPT_INTENT,
      token:issuedToken,nowMs:BASE+20_000
    }),/Denied/);
  assert.deepEqual(await request('/__m03_m04_receipt__/owner'),{
    status:403,body:{error:'Denied'}
  });
});

test('disable and re-enable second Administrator invalidates its earlier session version',async()=>{
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-SECOND'").run();
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='USR-SECOND'").run();
  assert.deepEqual(await request('/__m03_m04_receipt__/second-own'),{
    status:403,body:{error:'Denied'}
  });
});

test('test-only immutable receipts reject update and delete in real local D1',async()=>{
  const previous=await state();
  await assert.rejects(()=>DB.prepare(`UPDATE operation_receipts SET result_ref='FORGED'
    WHERE operation_id='OP-1'`).run(),/immutable|D1_ERROR|abort/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM operation_receipts WHERE operation_id='OP-1'").run(),
    /immutable|D1_ERROR|abort/i);
  assert.deepEqual(await state(),previous);
});

test('integration remains local-only; public Worker has no schema-aligned receipt route',async()=>{
  const conf=JSON.parse(readFileSync(new URL('../../wrangler.m03-m04-receipt-test.jsonc',import.meta.url),'utf8'));
  assert.equal(conf.main,'tests/fixtures/m03-m04-receipt-worker.mjs');
  assert.equal(conf.workers_dev,false);
  assert.equal(conf.routes,undefined);
  assert.equal(conf.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000012');
  assert.equal(conf.d1_databases[0].migrations_dir,'tests/fixtures/m04-auth-migrations');
  const prod=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(prod.includes('m04-operation-receipt-read'),false);
  assert.equal(prod.includes('operation_receipts'),false);
});
