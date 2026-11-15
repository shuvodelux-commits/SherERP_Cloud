import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AUTH_POLICY,createOfflinePasswordCredential,loginWithD1}
  from '../src/auth/d1-auth-core.js';
import {hashCanonicalOperationIntent}
  from '../src/db/operation-intent-fingerprint.js';
import {createM04SingleBusinessReceiptReadback}
  from '../src/db/m04-operation-receipt-read.js';
import {M04_RECEIPT_DDL,M04_RECEIPT_CLOCK,M04_RECEIPT_INTENT,
  M04_RECEIPT_TOKEN_A,M04_RECEIPT_TOKEN_B,M04_RECEIPT_TOKEN_C,
  M04_RECEIPT_PAYLOAD} from './fixtures/m03-m04-receipt-schema.mjs';

const BASE=M04_RECEIPT_CLOCK;
const DIGEST=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const AUTH_SQL=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const input=(patch={})=>({...M04_RECEIPT_INTENT,...patch});

function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(AUTH_SQL);
  for(const statement of M04_RECEIPT_DDL)sql.exec(statement);
  sql.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES('Cashier','Active','{}','POS')`).run();
  for(const [id,phone,role] of [
    ['USR-ADMIN','01710000001','Administrator'],
    ['USR-SECOND','01710000002','Administrator'],
    ['USR-CASHIER','01710000003','Cashier']
  ])sql.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
     status,password_hash,password_salt,password_iterations)
     VALUES(?,?,?,?,'Active',?,?,210000)`)
     .run(id,'Synthetic '+id,phone,role,'d'.repeat(64),'e'.repeat(48));
  const sessions=[
    [DIGEST(M04_RECEIPT_TOKEN_A),'USR-ADMIN',null],
    [DIGEST(M04_RECEIPT_TOKEN_B),'USR-SECOND',null],
    [DIGEST(M04_RECEIPT_TOKEN_C),'USR-CASHIER',1]
  ];
  for(const [hash,user,roleVersion] of sessions){
    sql.prepare(`INSERT INTO auth_sessions(
      token_hash,user_id,user_auth_version,role_auth_version,credential_version,
      created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES(?,?,1,?,1,?,?,?,NULL)`)
      .run(hash,user,roleVersion,BASE-600_000,BASE-300_000,BASE+1_200_000);
  }
  let reads=0;
  const DB={prepare(query){
    reads++;
    const statement=sql.prepare(query);
    return {bind(...args){
      return {
        async all(){return {success:true,results:statement.all(...args)}},
        async first(){return statement.get(...args)??null},
        async run(){const result=statement.run(...args);return {success:true,meta:{changes:result.changes}}}
      };
    }};
  }};
  const read=createM04SingleBusinessReceiptReadback({DB},{businessId:'BUSINESS-A'});
  return {sql,DB,read,reads:()=>reads,close:()=>sql.close()};
}
async function addReceipt(x,{businessId='BUSINESS-A',operationId='OP-1',
  actorId='USR-ADMIN',operationType='sales.post',payload=M04_RECEIPT_PAYLOAD,
  resultRef='SALE-1'}={}){
  const digest=await hashCanonicalOperationIntent({
    tenantId:businessId,actorId,operationType,payload
  });
  x.sql.prepare(`INSERT INTO operation_receipts
    (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
    VALUES(?,?,?,?,?,?,?)`).run(
      businessId,operationId,actorId,operationType,digest,resultRef,'2026-11-15T06:00:00Z');
}

test('exact M04 schema authorizes active Administrator and reads its receipt in one SQL read',async()=>{
  const x=fixture();try{
    await addReceipt(x);
    const count=x.reads();
    assert.deepEqual(await x.read.reconcile_(input()),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'
    });
    assert.equal(x.reads(),count+1);
    const original=x.sql.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get();
    assert.equal(original.n,1);
  }finally{x.close();}
});

test('same canonical payload order replays, changed total or operation type conflicts without ref',async()=>{
  const x=fixture();try{
    await addReceipt(x);
    assert.deepEqual(await x.read.reconcile_(input({payload:{
      total:'120.00',items:[{units:'1.000',sku:'PIPE'}]
    }})),{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
    for(const patch of [
      {payload:{...M04_RECEIPT_PAYLOAD,total:'120.01'}},
      {operationType:'purchase.post'}
    ]){
      assert.deepEqual(await x.read.reconcile_(input(patch)),{
        status:'CONFLICT',operationId:'OP-1'});
    }
  }finally{x.close();}
});

test('authorized missing receipt yields NEEDS_REVIEW, not an auto-retry instruction',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.read.reconcile_(input()),{
      status:'NEEDS_REVIEW',operationId:'OP-1'
    });
  }finally{x.close();}
});

test('other Administrator cannot disclose a different actors committed receipt',async()=>{
  const x=fixture();try{
    await addReceipt(x);
    await assert.rejects(()=>x.read.reconcile_(input({
      token:M04_RECEIPT_TOKEN_B
    })),/Denied/);
    assert.deepEqual(await x.read.reconcile_(input()),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
  }finally{x.close();}
});

test('custom-role staff is denied even with active M04 session until source permission mapping is approved',async()=>{
  const x=fixture();try{
    await addReceipt(x,{actorId:'USR-CASHIER'});
    await assert.rejects(()=>x.read.reconcile_(input({
      token:M04_RECEIPT_TOKEN_C
    })),/Denied/);
  }finally{x.close();}
});

test('M04 inclusive idle and exclusive absolute expiry boundaries prevent stale sessions',async()=>{
  const x=fixture();try{
    await addReceipt(x);
    await assert.rejects(()=>x.read.reconcile_(input({
      nowMs:BASE+AUTH_POLICY.sessionIdleMs-300_000
    })),/Denied/);
    // Refresh the last-activity timestamp in the isolated M04 fixture to
    // distinguish the exact absolute expiry boundary from idle expiry.
    x.sql.prepare('UPDATE auth_sessions SET last_activity_at_ms=? WHERE token_hash=?')
      .run(BASE+1_190_000,DIGEST(M04_RECEIPT_TOKEN_A));
    assert.deepEqual(await x.read.reconcile_(input({nowMs:BASE+1_199_999})),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'
    });
    await assert.rejects(()=>x.read.reconcile_(input({
      nowMs:BASE+1_200_000
    })),/Denied/);
  }finally{x.close();}
});

test('revocation, user disable/reenable, credential version and role reassignment invalidate old M04 session',async()=>{
  for(const mutate of [
    sql=>sql.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(BASE-10,DIGEST(M04_RECEIPT_TOKEN_A)),
    sql=>{
      sql.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-ADMIN'").run();
      sql.prepare("UPDATE auth_users SET status='Active' WHERE user_id='USR-ADMIN'").run();
    },
    sql=>sql.prepare("UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='USR-ADMIN'").run(),
    sql=>sql.prepare("UPDATE auth_users SET role_name='Cashier' WHERE user_id='USR-ADMIN'").run()
  ]){
    const x=fixture();try{
      await addReceipt(x);mutate(x.sql);
      await assert.rejects(()=>x.read.reconcile_(input()),/Denied/);
    }finally{x.close();}
  }
});

test('business context is constructor-owned and cannot read other scoped receipt by request',async()=>{
  const x=fixture();try{
    await addReceipt(x,{businessId:'BUSINESS-B',resultRef:'PRIVATE'});
    assert.deepEqual(await x.read.reconcile_(input()),{
      status:'NEEDS_REVIEW',operationId:'OP-1'});
    await assert.rejects(()=>x.read.reconcile_(input({
      businessId:'BUSINESS-B'
    })),/Invalid/);
  }finally{x.close();}
});

test('real M04 login token validates against readback after hashing the bearer bytes',async()=>{
  const x=fixture();try{
    const cred=await createOfflinePasswordCredential('SyntheticPassword123!');
    x.sql.prepare(`UPDATE auth_users SET password_hash=?,password_salt=?,
      password_iterations=? WHERE user_id='USR-ADMIN'`)
      .run(cred.passwordHash,cred.passwordSalt,cred.iterations);
    await addReceipt(x);
    const nowMs=BASE+60_000;
    const auth=await loginWithD1(x.DB,{
      phoneKey:'01710000001',password:'SyntheticPassword123!',nowMs
    });
    assert.equal(auth.authenticated,true);
    assert.match(auth.token,/^[0-9a-f]{64}$/);
    assert.deepEqual(await x.read.reconcile_(input({
      token:auth.token,nowMs
    })),{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
  }finally{x.close();}
});

test('rejects forged actor, untrusted extra fields, accessors and malformed tokens before SQL',async()=>{
  const x=fixture();try{
    const c=x.reads();
    const invalid=[
      null,[],{},input({token:'incorrect'}),input({nowMs:-1}),
      input({nowMs:1.2}),input({operationId:'op-1'}),
      input({operationType:'SALE.POST'}),input({payload:{total:120.1}}),
      {...input(),actorId:'USR-ADMIN'},{...input(),tenantId:'BUSINESS-A'},
    ];
    const accessor=input();Object.defineProperty(accessor,'token',{enumerable:true,
      get(){throw new Error('GETTER');}});invalid.push(accessor);
    for(const value of invalid){
      await assert.rejects(()=>x.read.reconcile_(value),/Invalid|unsupported/i);
    }
    assert.equal(x.reads(),c);
  }finally{x.close();}
});

test('ambiguous, malformed D1 readbacks and unavailable D1 never report REPLAY',async()=>{
  assert.throws(()=>createM04SingleBusinessReceiptReadback({},{
    businessId:'BUSINESS-A'}),/D1|binding/i);
  assert.throws(()=>createM04SingleBusinessReceiptReadback({DB:{
    prepare(){} }},{businessId:' BUSINESS-A'}),/Invalid/);
  const replies=[null,{success:false,results:[]},{success:true,results:null},
    {success:true,results:[{},{}]},{success:true,results:[{}]},
    {success:true,results:[{actor_id:'BAD'}]}];
  for(const answer of replies){
    const DB={prepare(){return {bind(){return {all:async()=>answer}}}}};
    await assert.rejects(()=>createM04SingleBusinessReceiptReadback({DB},{
      businessId:'BUSINESS-A'}).reconcile_(input()),/NEEDS_REVIEW/);
  }
  const DB={prepare(){throw Error('connection unavailable');}};
  await assert.rejects(()=>createM04SingleBusinessReceiptReadback({DB},{
    businessId:'BUSINESS-A'}).reconcile_(input()),/NEEDS_REVIEW/);
});

test('M04 fixture receipts remain immutable',async()=>{
  const x=fixture();try{
    await addReceipt(x);
    assert.throws(()=>x.sql.exec("UPDATE operation_receipts SET result_ref='FAKE'"),/immutable/i);
    assert.throws(()=>x.sql.exec("DELETE FROM operation_receipts"),/immutable/i);
  }finally{x.close();}
});
