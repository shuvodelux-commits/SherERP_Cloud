import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';

// Nondeployable Worker with an isolated fake D1 binding: no remote DB data.
const server=createTestHarness({workers:[{configPath:'./wrangler.m03-intent-fingerprint-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-intent-workerd-test');
let DB;
before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  await DB.prepare(`CREATE TABLE synthetic_stock(
    account_id TEXT PRIMARY KEY,available INTEGER NOT NULL CHECK(available>=0)) STRICT`).run();
  await DB.prepare(`CREATE TABLE synthetic_operations(
    operation_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>0),state TEXT NOT NULL CHECK(state='COMMITTED')) STRICT`).run();
  await DB.prepare(`CREATE TABLE synthetic_movements(
    operation_id TEXT PRIMARY KEY REFERENCES synthetic_operations(operation_id),
    units INTEGER NOT NULL CHECK(units>0)) STRICT`).run();
  await DB.prepare("INSERT INTO synthetic_stock(account_id,available) VALUES ('counter',2)").run();
});
after(async()=>{await server.close();});
const request=async(path,body,method='POST')=>{
  const reply=await worker.fetch('http://m03-intent.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:reply.status,body:await reply.json()};
};
const state=async()=>({
  stock:(await DB.prepare("SELECT available FROM synthetic_stock WHERE account_id='counter'").first()).available,
  operations:(await DB.prepare('SELECT operation_id,payload_hash,units,state FROM synthetic_operations ORDER BY operation_id').all()).results.map(x=>({...x})),
  movements:(await DB.prepare('SELECT operation_id,units FROM synthetic_movements ORDER BY operation_id').all()).results.map(x=>({...x}))
});
const sorted='{"actorId":"staff-1","operationType":"sales.post","payload":{"items":[{"quantity":"1.000","sku":"PIPE"}],"total":"120.00"},"tenantId":"tenant-1"}';
const expected=createHash('sha256').update('SherERP:operation-intent:v1\n'+sorted,'utf8').digest('hex');

test('real Workerd computes SHA-256 canonical fingerprint and commits one synthetic D1 movement',async()=>{
  const r=await request('/__m03_intent__/commit');
  assert.deepEqual(r,{status:200,body:{status:'COMMITTED',operationId:'HASH-OP',fingerprint:expected}});
  assert.deepEqual(await state(),{
    stock:1,
    operations:[{operation_id:'HASH-OP',payload_hash:expected,units:1,state:'COMMITTED'}],
    movements:[{operation_id:'HASH-OP',units:1}]
  });
});

test('nested field reorder produces identical digest and a genuine D1 REPLAY, not another stock write',async()=>{
  const prior=await state();
  assert.deepEqual(await request('/__m03_intent__/reordered'),
    {status:200,body:{status:'REPLAY',operationId:'HASH-OP',fingerprint:expected}});
  assert.deepEqual(await state(),prior);
});

test('modified amount, other tenant, other actor or operation type yield D1 CONFLICT, no posting',async()=>{
  const prior=await state();
  for(const p of [
    '/__m03_intent__/changed-total',
    '/__m03_intent__/other-tenant',
    '/__m03_intent__/other-actor',
    '/__m03_intent__/other-type'
  ]){
    const result=await request(p);
    assert.equal(result.status,200,p);
    assert.equal(result.body.status,'CONFLICT',p);
    assert.notEqual(result.body.fingerprint,expected,p);
    assert.deepEqual(await state(),prior,p);
  }
});

test('invalid float and unsupported data are rejected before any D1 operation',async()=>{
  const prior=await state();
  for(const p of ['/__m03_intent__/invalid-float','/__m03_intent__/invalid-undefined']){
    const r=await request(p);
    assert.equal(r.status,400,p);
    assert.deepEqual(await state(),prior,p);
  }
});

test('test-only Worker rejects arbitrary route/method and ignores attacker-supplied request body',async()=>{
  const prior=await state();
  assert.equal((await request('/__m03_intent__/unknown')).status,404);
  assert.equal((await request('/__m03_intent__/commit',undefined,'GET')).status,405);
  const result=await request('/__m03_intent__/reordered',{
    tenantId:'attacker',actorId:'ADMIN',operationType:'money.transfer',
    payload:{quantity:'999999999'},sql:'DELETE FROM synthetic_operations'
  });
  assert.deepEqual(result,{status:200,body:{status:'REPLAY',operationId:'HASH-OP',fingerprint:expected}});
  assert.deepEqual(await state(),prior);
});
