import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {hashCanonicalOperationIntent} from '../src/db/operation-intent-fingerprint.js';
import {createOperationReceiptReconciliationAdapter} from '../src/db/operation-receipt-reconcile.js';

const schema=readFileSync(new URL('./fixtures/m03-receipt-schema.sql',import.meta.url),'utf8');
const sample=()=>({tenantId:'TENANT-1',operationId:'OP-42',actorId:'staff-1',
  operationType:'sales.post',payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}});
const committedAt='2026-11-15T06:00:00Z';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(schema);
  let prepares=0;
  const DB={prepare(sql){
    prepares++;
    const query=sqlite.prepare(sql);
    return {bind(...values){return {all:async()=>({success:true,results:query.all(...values)})};}};
  }};
  return {sqlite,DB,adapter:createOperationReceiptReconciliationAdapter({DB}),
    prepares:()=>prepares,close:()=>sqlite.close()};
}
async function insertReceipt(x,intent=sample(),resultRef='SALE-7'){
  const {tenantId,operationId,actorId,operationType,payload}=intent;
  const hash=await hashCanonicalOperationIntent({tenantId,actorId,operationType,payload});
  x.sqlite.prepare(`INSERT INTO operation_receipts
    (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
    VALUES (?,?,?,?,?,?,?)`).run(tenantId,operationId,actorId,operationType,hash,resultRef,committedAt);
  return hash;
}
const count=x=>x.sqlite.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n;

test('a committed receipt exactly matching the canonical intent resolves to REPLAY with original resultRef',async()=>{
  const x=fixture();
  try{
    await insertReceipt(x);
    assert.deepEqual(await x.adapter.reconcile_(sample()),{
      status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'
    });
    assert.equal(count(x),1);
    assert.equal(x.prepares(),1);
  }finally{x.close();}
});

test('different object key order is genuine replay; different payload, actor or type is CONFLICT',async()=>{
  const x=fixture();
  try{
    await insertReceipt(x);
    const intent=sample();
    const reordered={operationType:'sales.post',actorId:'staff-1',tenantId:'TENANT-1',
      operationId:'OP-42',payload:{total:'120.00',items:[{units:'1.000',sku:'PIPE'}]}};
    assert.deepEqual(await x.adapter.reconcile_(reordered),{
      status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'});
    for(const changed of [
      {...intent,payload:{...intent.payload,total:'120.01'}},
      {...intent,actorId:'staff-2'},
      {...intent,operationType:'purchase.post'}
    ]){
      assert.deepEqual(await x.adapter.reconcile_(changed),{
        status:'CONFLICT',operationId:'OP-42'});
    }
    assert.equal(count(x),1);
  }finally{x.close();}
});

test('missing receipt after unknown outcome is NEEDS_REVIEW, never SAFE_TO_RETRY or DECLINED',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.reconcile_(sample()),{
      status:'NEEDS_REVIEW',operationId:'OP-42'});
    assert.equal(count(x),0);
  }finally{x.close();}
});

test('tenant-scoped composite IDs neither leak other tenant receipts nor prevent same ID in second tenant',async()=>{
  const x=fixture();
  try{
    await insertReceipt(x);
    const other={...sample(),tenantId:'TENANT-2'};
    assert.deepEqual(await x.adapter.reconcile_(other),{
      status:'NEEDS_REVIEW',operationId:'OP-42'});
    await insertReceipt(x,other,'SALE-8');
    assert.deepEqual(await x.adapter.reconcile_(other),{
      status:'REPLAY',operationId:'OP-42',resultRef:'SALE-8'});
    assert.deepEqual(await x.adapter.reconcile_(sample()),{
      status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'});
    assert.equal(count(x),2);
  }finally{x.close();}
});

test('committed receipts cannot be updated or deleted and same-tenant duplicate ID is rejected',async()=>{
  const x=fixture();
  try{
    await insertReceipt(x);
    assert.throws(()=>x.sqlite.prepare("UPDATE operation_receipts SET result_ref='EVIL' WHERE operation_id='OP-42'").run(),/immutable/i);
    assert.throws(()=>x.sqlite.prepare("DELETE FROM operation_receipts WHERE operation_id='OP-42'").run(),/immutable/i);
    assert.throws(()=>x.sqlite.prepare(`INSERT INTO operation_receipts
      (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
      SELECT tenant_id,operation_id,actor_id,operation_type,payload_hash,'DUP',committed_at FROM operation_receipts`).run(),
      /UNIQUE|PRIMARY KEY|constraint/i);
    assert.equal(count(x),1);
  }finally{x.close();}
});

test('invalid operation ID, unknown keys, unsupported payload, forged accessor and non-object intent are rejected before D1',async()=>{
  const x=fixture();
  try{
    const malformed=[
      {...sample(),operationId:''},
      {...sample(),operationId:'lowercase'},
      {...sample(),operationId:' OP-42'},
      {...sample(),operationId:'A'.repeat(65)},
      {...sample(),extra:'injected'},
      {...sample(),payload:{amount:120.5}},
      {...sample(),tenantId:''},
      {...sample(),actorId:' att'},
      {...sample(),operationType:'Cash.POST'},
      null,[],Object.create(Date.prototype)
    ];
    const accessor=sample();Object.defineProperty(accessor,'payload',{enumerable:true,get(){throw new Error('GETTER CALLED');}});
    malformed.push(accessor);
    for(const attempt of malformed){
      await assert.rejects(()=>x.adapter.reconcile_(attempt),/Invalid|invalid|unsupported|operation|context|amount|value/i);
    }
    assert.equal(x.prepares(),0);
    assert.equal(count(x),0);
  }finally{x.close();}
});

test('synthetic receipt record is not mutable by reads; wrong result shape and multiple rows never report replay',async()=>{
  const x=fixture();
  try{
    await insertReceipt(x);
    const previous=x.sqlite.prepare('SELECT * FROM operation_receipts').get();
    await x.adapter.reconcile_(sample());
    assert.deepEqual(x.sqlite.prepare('SELECT * FROM operation_receipts').get(),previous);
    const misleading={
      DB:{prepare(){return {bind(){return {all:async()=>({success:true,results:[
        {...previous}, {...previous}
      ]})}}}}}
    };
    await assert.rejects(()=>createOperationReceiptReconciliationAdapter(misleading).reconcile_(sample()),
      /NEEDS_REVIEW|invalid|ambiguous/i);
  }finally{x.close();}
});

test('DB unavailable, result shape malformed, stored corrupt digest or mixed identity fail closed',async()=>{
  assert.throws(()=>createOperationReceiptReconciliationAdapter({}),/D1|binding/i);
  const badResults=[
    null,
    {success:false,results:[]},
    {success:true,results:null},
    {success:true,results:[null]},
    {success:true,results:[{tenant_id:'OTHER',operation_id:'OP-42'}]},
    {success:true,results:[{tenant_id:'TENANT-1',operation_id:'OP-42',payload_hash:'bad'}]}
  ];
  for(const payload of badResults){
    const fake={DB:{prepare(){return {bind(){return {all:async()=>payload}}}}}};
    await assert.rejects(()=>createOperationReceiptReconciliationAdapter(fake).reconcile_(sample()),
      /NEEDS_REVIEW|invalid|ambiguous|result/i);
  }
});

test('D1 query errors report NEEDS_REVIEW uncertainty instead of treating a missing DB as no committed receipt',async()=>{
  const fake={DB:{prepare(){return {bind(){return {all:async()=>{throw new Error('D1 network read failed')}}}}}}};
  await assert.rejects(()=>createOperationReceiptReconciliationAdapter(fake).reconcile_(sample()),
    /NEEDS_REVIEW|D1|network/i);
});
