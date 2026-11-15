import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AUTHORIZED_RECEIPT_DDL,AUTHORIZED_RECEIPT_SEED}
  from './fixtures/m03-authorized-receipt-schema.mjs';
import {hashCanonicalOperationIntent} from '../src/db/operation-intent-fingerprint.js';
import {createAuthorizedOperationReceiptAdapter}
  from '../src/db/authorized-operation-receipt.js';

const intent=(changes={})=>({
  tokenHash:'a'.repeat(64),tenantId:'TENANT-A',now:1000,operationId:'OP-1',
  operationType:'sales.post',payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'},
  ...changes
});
function setup(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const sql of AUTHORIZED_RECEIPT_DDL)sqlite.exec(sql);
  for(const [sql,params] of AUTHORIZED_RECEIPT_SEED)sqlite.prepare(sql).run(...params);
  let calls=0,sqlText='';
  const DB={prepare(sql){
    calls++;sqlText=sql;
    const stmt=sqlite.prepare(sql);
    return {bind(...args){return {all:async()=>({success:true,results:stmt.all(...args)})}}};
  }};
  return {sqlite,adapter:createAuthorizedOperationReceiptAdapter({DB}),
    calls:()=>calls,sqlText:()=>sqlText,close:()=>sqlite.close()};
}
async function receipt(x,{tenantId='TENANT-A',operationId='OP-1',
  actorId='USER-A',operationType='sales.post',payload=intent().payload,
  resultRef='SALE-1'}={}){
  const digest=await hashCanonicalOperationIntent({tenantId,actorId,operationType,payload});
  x.sqlite.prepare(`INSERT INTO operation_receipts
    (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
    VALUES (?,?,?,?,?,?,?)`).run(tenantId,operationId,actorId,operationType,digest,resultRef,
      '2026-11-15T06:00:00Z');
}
const count=x=>x.sqlite.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n;

test('one SQL read derives actual session actor and retrieves only its committed result',async()=>{
  const x=setup();try{
    await receipt(x);
    assert.deepEqual(await x.adapter.reconcile_(intent()),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
    assert.equal(x.calls(),1);
    assert.match(x.sqlText(),/JOIN synthetic_auth_sessions|FROM synthetic_auth_sessions/);
    assert.match(x.sqlText(),/JOIN synthetic_auth_users/);
    assert.match(x.sqlText(),/JOIN synthetic_auth_roles/);
    assert.match(x.sqlText(),/LEFT JOIN operation_receipts/);
    assert.match(x.sqlText(),/auth_version|user_version/);
    assert.equal(count(x),1);
  }finally{x.close();}
});

test('canonical reorder is replay, changed amount or operation type conflicts without exposing resultRef',async()=>{
  const x=setup();try{
    await receipt(x);
    assert.deepEqual(await x.adapter.reconcile_(intent({payload:{
      total:'120.00',items:[{units:'1.000',sku:'PIPE'}]}})),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
    for(const input of [
      intent({payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.01'}}),
      intent({operationType:'purchase.post'})
    ]){
      assert.deepEqual(await x.adapter.reconcile_(input),{
        status:'CONFLICT',operationId:'OP-1'});
    }
    assert.equal(count(x),1);
  }finally{x.close();}
});

test('missing receipt is NEEDS_REVIEW only for authorized active session',async()=>{
  const x=setup();try{
    assert.deepEqual(await x.adapter.reconcile_(intent()),{
      status:'NEEDS_REVIEW',operationId:'OP-1'});
    await assert.rejects(()=>x.adapter.reconcile_(intent({tokenHash:'d'.repeat(64)})),/Denied/i);
    assert.equal(count(x),0);
  }finally{x.close();}
});

test('wrong tenant, another user in same tenant and invalid session reveal no original result',async()=>{
  const x=setup();try{
    await receipt(x);
    for(const changed of [
      {tokenHash:'a'.repeat(64),tenantId:'TENANT-B'},
      {tokenHash:'b'.repeat(64),tenantId:'TENANT-A'},
      {tokenHash:'d'.repeat(64)}
    ])await assert.rejects(()=>x.adapter.reconcile_(intent(changed)),/Denied/i);
    await assert.rejects(()=>x.adapter.reconcile_(intent({tokenHash:'c'.repeat(64)})),/Denied/i);
    assert.equal(count(x),1);
  }finally{x.close();}
});

test('revoked or expired session refuses before disclosing a receipt',async()=>{
  const x=setup();try{
    await receipt(x);
    await assert.rejects(()=>x.adapter.reconcile_(intent({now:2000})),/Denied/i);
    await x.sqlite.prepare(`UPDATE synthetic_auth_sessions
      SET revoked_at=1100 WHERE token_hash=?`).run('a'.repeat(64));
    await assert.rejects(()=>x.adapter.reconcile_(intent({now:1200})),/Denied/i);
  }finally{x.close();}
});

test('disable/reenable user and role, permission downgrade, version change invalidate old token',async()=>{
  const cases=[
    "UPDATE synthetic_auth_users SET status='Inactive' WHERE user_id='USER-A'",
    "UPDATE synthetic_auth_users SET auth_version=auth_version+1 WHERE user_id='USER-A'",
    "UPDATE synthetic_auth_roles SET status='Inactive' WHERE role_id='ROLE-A'",
    "UPDATE synthetic_auth_roles SET can_read_receipt=0 WHERE role_id='ROLE-A'",
    "UPDATE synthetic_auth_roles SET auth_version=auth_version+1 WHERE role_id='ROLE-A'"
  ];
  for(const sql of cases){
    const x=setup();try{
      await receipt(x);
      x.sqlite.prepare(sql).run();
      await assert.rejects(()=>x.adapter.reconcile_(intent()),/Denied/i,sql);
      assert.equal(count(x),1);
    }finally{x.close();}
  }
  const x=setup();try{
    await receipt(x);
    x.sqlite.prepare("UPDATE synthetic_auth_users SET status='Inactive' WHERE user_id='USER-A'").run();
    x.sqlite.prepare("UPDATE synthetic_auth_users SET status='Active' WHERE user_id='USER-A'").run();
    await assert.rejects(()=>x.adapter.reconcile_(intent()),/Denied/i);
  }finally{x.close();}
});

test('other tenant can independently reconcile the same operation ID without cross-tenant leakage',async()=>{
  const x=setup();try{
    await receipt(x);
    await receipt(x,{tenantId:'TENANT-B',actorId:'USER-B',resultRef:'SALE-B'});
    assert.deepEqual(await x.adapter.reconcile_(intent({
      tenantId:'TENANT-B',tokenHash:'b'.repeat(64)})),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-B'
    });
    assert.deepEqual(await x.adapter.reconcile_(intent()),{
      status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'});
  }finally{x.close();}
});

test('invalid input fields, actor injection, floating amounts, forged accessor fail before SQL',async()=>{
  const x=setup();try{
    const invalid=[
      null,[],{},'x',
      intent({tokenHash:'bad'}),intent({tenantId:' TENANT-A'}),
      intent({now:-1}),intent({now:'1000'}),
      intent({operationId:'op-lower'}),intent({operationType:'Sales.Post'}),
      intent({payload:{total:120.50}}),intent({payload:[]}),
      {...intent(),actorId:'USER-A'}, {...intent(),sql:'DROP TABLE operation_receipts'}
    ];
    const accessor=intent();Object.defineProperty(accessor,'tenantId',{enumerable:true,
      get(){throw Error('BAD GETTER');}});invalid.push(accessor);
    for(const bad of invalid)await assert.rejects(()=>x.adapter.reconcile_(bad),
      /invalid|unsupported|operation|tenant|session|context|descriptor/i);
    assert.equal(x.calls(),0);
  }finally{x.close();}
});

test('invalid, duplicate or mismatched result rows never return replay',async()=>{
  const valid=await hashCanonicalOperationIntent({
    tenantId:'TENANT-A',actorId:'USER-A',operationType:'sales.post',payload:intent().payload});
  const row={tenant_id:'TENANT-A',actor_id:'USER-A',
    receipt_tenant_id:'TENANT-A',operation_id:'OP-1',receipt_actor_id:'USER-A',
    operation_type:'sales.post',payload_hash:valid,result_ref:'SALE-1',
    committed_at:'2026-11-15T06:00:00Z'};
  const replies=[
    null,{success:false,results:[]},{success:true,results:null},
    {success:true,results:[row,row]},{success:true,results:[null]},
    {success:true,results:[{...row,tenant_id:'TENANT-B'}]},
    {success:true,results:[{...row,payload_hash:'bad'}]},
    {success:true,results:[{...row,operation_id:'OTHER'}]}
  ];
  for(const response of replies){
    const fake={DB:{prepare(){return {bind(){return {all:async()=>response}}}}}};
    await assert.rejects(()=>createAuthorizedOperationReceiptAdapter(fake).reconcile_(intent()),
      /NEEDS_REVIEW|invalid|ambiguous/i);
  }
});

test('D1 failures remain NEEDS_REVIEW uncertainty and missing DB fails closed',async()=>{
  assert.throws(()=>createAuthorizedOperationReceiptAdapter({}),/D1|binding/i);
  const fake={DB:{prepare(){throw new Error('D1 unreachable')}}};
  await assert.rejects(()=>createAuthorizedOperationReceiptAdapter(fake).reconcile_(intent()),
    /NEEDS_REVIEW/);
});
