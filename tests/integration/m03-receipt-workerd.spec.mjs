import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

// Local Workerd D1; no remote migrations or production schema changes.
const server=createTestHarness({workers:[{configPath:'./wrangler.m03-receipt-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-receipt-workerd-test');
const schema=readFileSync(new URL('../fixtures/m03-receipt-schema.sql',import.meta.url),'utf8');
const original=()=>({tenantId:'TENANT-1',operationId:'OP-42',actorId:'staff-1',
  operationType:'sales.post',payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}});
let DB;
before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  // D1 exec() splits on physical lines, so submit fixture DDL as three
  // complete prepared statements; nothing reaches production migrations.
  const statements=[
    schema.match(/CREATE TABLE[\s\S]*?\) STRICT;/)?.[0],
    schema.match(/CREATE TRIGGER receipt_no_update[\s\S]*?END;/)?.[0],
    schema.match(/CREATE TRIGGER receipt_no_delete[\s\S]*?END;/)?.[0]
  ];
  assert.ok(statements.every(Boolean));
  for(const sql of statements)await DB.prepare(sql).run();
  await DB.prepare(`CREATE TABLE synthetic_stock
    (sku TEXT PRIMARY KEY,available INTEGER NOT NULL CHECK(available>=0)) STRICT`).run();
  await DB.prepare(`CREATE TABLE synthetic_journal
    (operation_id TEXT PRIMARY KEY NOT NULL,
     receipt_ref TEXT NOT NULL CHECK(length(trim(receipt_ref))>0)) STRICT`).run();
  await DB.prepare("INSERT INTO synthetic_stock(sku,available) VALUES('PIPE',2)").run();
});
after(async()=>{await server.close();});
const post=async(path,body,method='POST')=>{
  const reply=await worker.fetch('http://m03-receipt.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:reply.status,body:await reply.json()};
};
const snapshot=async()=>({
  stock:(await DB.prepare("SELECT available FROM synthetic_stock WHERE sku='PIPE'").first()).available,
  receipts:(await DB.prepare(`SELECT tenant_id,operation_id,actor_id,operation_type,
    payload_hash,result_ref,committed_at
    FROM operation_receipts ORDER BY tenant_id,operation_id`).all()).results.map(row=>({...row})),
  journal:(await DB.prepare(`SELECT operation_id,receipt_ref
    FROM synthetic_journal ORDER BY operation_id`).all()).results.map(row=>({...row}))
});

test('before commit an unknown result is NEEDS_REVIEW with no receipt or stock effect',async()=>{
  assert.deepEqual(await post('/__m03_receipt__/reconcile-original'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-42'}
  });
  assert.deepEqual(await snapshot(),{stock:2,receipts:[],journal:[]});
});

test('D1 batch commits receipt, stock and journal but intentionally returns a lost-response HTTP status',async()=>{
  const r=await post('/__m03_receipt__/commit-lost');
  assert.equal(r.status,503);
  const state=await snapshot();
  assert.equal(state.stock,1);
  assert.equal(state.journal.length,1);
  assert.deepEqual(state.journal[0],{operation_id:'OP-42',receipt_ref:'SALE-7'});
  assert.equal(state.receipts.length,1);
  assert.equal(state.receipts[0].operation_id,'OP-42');
  assert.equal(state.receipts[0].tenant_id,'TENANT-1');
  const intent=original();
  const hash=await hashCanonicalOperationIntent({
    tenantId:intent.tenantId,actorId:intent.actorId,
    operationType:intent.operationType,payload:intent.payload
  });
  assert.equal(state.receipts[0].payload_hash,hash);
});

test('reconciliation after lost response recovers exactly the original committed result',async()=>{
  assert.deepEqual(await post('/__m03_receipt__/reconcile-original'),{
    status:200,body:{status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'}
  });
  const before=await snapshot();
  assert.deepEqual(await post('/__m03_receipt__/reconcile-reordered'),{
    status:200,body:{status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'}
  });
  assert.deepEqual(await snapshot(),before);
});

test('changed payload, actor or operation type returns CONFLICT and reveals no prior receipt reference',async()=>{
  const state=await snapshot();
  for(const path of [
    '/__m03_receipt__/reconcile-changed-total',
    '/__m03_receipt__/reconcile-changed-actor',
    '/__m03_receipt__/reconcile-changed-type'
  ]){
    assert.deepEqual(await post(path),{
      status:200,body:{status:'CONFLICT',operationId:'OP-42'}
    },path);
  }
  assert.deepEqual(await snapshot(),state);
});

test('same operation ID in another tenant does not reveal or consume original tenant receipt',async()=>{
  assert.deepEqual(await post('/__m03_receipt__/reconcile-other-tenant'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-42'}
  });
  const newTenant={...original(),tenantId:'TENANT-2'};
  const hash=await hashCanonicalOperationIntent({
    tenantId:newTenant.tenantId,actorId:newTenant.actorId,
    operationType:newTenant.operationType,payload:newTenant.payload
  });
  await DB.prepare(`INSERT INTO operation_receipts
    (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
    VALUES (?,?,?,?,?,?,?)`).bind('TENANT-2','OP-42','staff-1','sales.post',
    hash,'SALE-8','2026-11-15T06:00:00Z').run();
  assert.deepEqual(await post('/__m03_receipt__/reconcile-other-tenant'),{
    status:200,body:{status:'REPLAY',operationId:'OP-42',resultRef:'SALE-8'}
  });
  assert.deepEqual(await post('/__m03_receipt__/reconcile-original'),{
    status:200,body:{status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'}
  });
  assert.equal((await snapshot()).receipts.length,2);
});

test('late journal constraint error rolls back receipt insertion and stock delta in real D1',async()=>{
  const before=await snapshot();
  const response=await post('/__m03_receipt__/commit-late-failure');
  assert.equal(response.status,503);
  assert.deepEqual(await post('/__m03_receipt__/reconcile-late-failure'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-BAD'}
  });
  assert.deepEqual(await snapshot(),before);
});

test('retrying committed operation ID does not produce extra receipt, journal or stock decrement',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_receipt__/commit-lost')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('receipt update/delete are forbidden in real D1 and request body cannot supply SQL or actor',async()=>{
  const previous=await snapshot();
  await assert.rejects(
    ()=>DB.prepare("UPDATE operation_receipts SET result_ref='FAKE' WHERE operation_id='OP-42'").run(),
    /immutable|abort|D1_ERROR/i
  );
  await assert.rejects(
    ()=>DB.prepare("DELETE FROM operation_receipts WHERE operation_id='OP-42'").run(),
    /immutable|abort|D1_ERROR/i
  );
  assert.equal((await post('/__m03_receipt__/invalid')).status,404);
  assert.equal((await post('/__m03_receipt__/reconcile-original',undefined,'GET')).status,405);
  assert.deepEqual(await post('/__m03_receipt__/reconcile-original',{
    tenantId:'TENANT-2',actorId:'admin',operationId:'OP-42',
    sql:'DELETE FROM operation_receipts'
  }),{status:200,body:{status:'REPLAY',operationId:'OP-42',resultRef:'SALE-7'}});
  assert.deepEqual(await snapshot(),previous);
});
