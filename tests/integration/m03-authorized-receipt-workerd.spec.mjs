import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {AUTHORIZED_RECEIPT_DDL,AUTHORIZED_RECEIPT_SEED}
  from '../fixtures/m03-authorized-receipt-schema.mjs';

const server=createTestHarness({workers:[
  {configPath:'./wrangler.m03-authorized-receipt-test.jsonc'}
]});
const worker=server.getWorker('shererp-m03-authorized-receipt-workerd-test');
let DB;
const original=()=>({tenantId:'TENANT-A',operationId:'OP-1',actorId:'USER-A',
  operationType:'sales.post',payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}});
const insertReceipt=async({tenantId='TENANT-A',operationId='OP-1',
  actorId='USER-A',resultRef='SALE-1'}={})=>{
  const source=original();
  const digest=await hashCanonicalOperationIntent({
    tenantId,actorId,operationType:source.operationType,payload:source.payload
  });
  await DB.prepare(`INSERT INTO operation_receipts(
    tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
    VALUES (?,?,?,?,?,?,?)`).bind(tenantId,operationId,actorId,
      source.operationType,digest,resultRef,'2026-11-15T06:00:00Z').run();
};
const invoke=async(path,body,method='POST')=>{
  const response=await worker.fetch('http://m03-authorized.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
};
const stored=async()=>(
  await DB.prepare('SELECT tenant_id,operation_id,actor_id,result_ref FROM operation_receipts ORDER BY tenant_id,operation_id').all()
).results.map(x=>({...x}));

before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  for(const ddl of AUTHORIZED_RECEIPT_DDL)await DB.prepare(ddl).run();
  await insertReceipt({operationId:'OP-1'});
});
beforeEach(async()=>{
  // The immutable receipt is seeded once; only session authority is reset.
  for(const table of [
    'synthetic_auth_sessions','synthetic_auth_users','synthetic_auth_roles'
  ])await DB.prepare('DELETE FROM '+table).run();
  for(const [sql,values] of AUTHORIZED_RECEIPT_SEED)await DB.prepare(sql).bind(...values).run();
});
after(async()=>{await server.close();});

test('authorized real Workerd receipt lookup derives actor, returns matching result only',async()=>{
  assert.deepEqual(await invoke('/__m03_authorized__/replay'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
});

test('reordered request replay is stable; changed amount and type conflict without result reference',async()=>{
  const baseline=await stored();
  assert.deepEqual(await invoke('/__m03_authorized__/reordered'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
  for(const route of ['/__m03_authorized__/changed-amount','/__m03_authorized__/changed-type']){
    assert.deepEqual(await invoke(route),{
      status:200,body:{status:'CONFLICT',operationId:'OP-1'}
    });
  }
  assert.deepEqual(await stored(),baseline);
});

test('different actor same tenant and another tenant can never read the original receipt',async()=>{
  const baseline=await stored();
  assert.deepEqual(await invoke('/__m03_authorized__/other-actor'),{
    status:403,body:{error:'Denied'}
  });
  assert.deepEqual(await invoke('/__m03_authorized__/other-tenant'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-1'}
  });
  assert.deepEqual(await stored(),baseline);
});

test('expired and revoked sessions fail even when matching committed receipt exists',async()=>{
  await DB.prepare(`UPDATE synthetic_auth_sessions
    SET expires_at=1000 WHERE token_hash=?`).bind('a'.repeat(64)).run();
  assert.deepEqual(await invoke('/__m03_authorized__/replay'),{
    status:403,body:{error:'Denied'}
  });
  await DB.prepare(`UPDATE synthetic_auth_sessions
    SET expires_at=2000,revoked_at=999 WHERE token_hash=?`).bind('a'.repeat(64)).run();
  assert.deepEqual(await invoke('/__m03_authorized__/replay'),{
    status:403,body:{error:'Denied'}
  });
});

test('disabled or re-enabled user and role permission downgrade invalidate old session authority',async()=>{
  await DB.prepare("UPDATE synthetic_auth_users SET status='Inactive' WHERE user_id='USER-A'").run();
  assert.equal((await invoke('/__m03_authorized__/replay')).status,403);
  await DB.prepare("UPDATE synthetic_auth_users SET status='Active' WHERE user_id='USER-A'").run();
  assert.equal((await invoke('/__m03_authorized__/replay')).status,403);
  await DB.prepare("UPDATE synthetic_auth_roles SET can_read_receipt=0 WHERE role_id='ROLE-A'").run();
  assert.equal((await invoke('/__m03_authorized__/replay')).status,403);
  await DB.prepare("UPDATE synthetic_auth_roles SET can_read_receipt=1 WHERE role_id='ROLE-A'").run();
  assert.equal((await invoke('/__m03_authorized__/replay')).status,403);
});

test('missing committed receipt is NEEDS_REVIEW only when an active session can read',async()=>{
  assert.deepEqual(await invoke('/__m03_authorized__/missing'),{
    status:200,body:{status:'NEEDS_REVIEW',operationId:'OP-UNKNOWN'}
  });
  await DB.prepare("UPDATE synthetic_auth_roles SET can_read_receipt=0 WHERE role_id='ROLE-A'").run();
  assert.deepEqual(await invoke('/__m03_authorized__/missing'),{
    status:403,body:{error:'Denied'}
  });
});

test('another tenant may read its own same operation ID without revealing other tenant reference',async()=>{
  await insertReceipt({tenantId:'TENANT-B',actorId:'USER-B',resultRef:'SALE-B'});
  assert.deepEqual(await invoke('/__m03_authorized__/other-tenant'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-B'}
  });
  assert.deepEqual(await invoke('/__m03_authorized__/replay'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}
  });
});

test('invalid payload, forged actor body and unknown routes cannot access or mutate receipts',async()=>{
  const before=await stored();
  assert.deepEqual(await invoke('/__m03_authorized__/invalid-float'),{
    status:400,body:{error:'Invalid synthetic input'}
  });
  assert.equal((await invoke('/__m03_authorized__/missing',undefined,'GET')).status,405);
  assert.equal((await invoke('/__m03_authorized__/not-found')).status,404);
  assert.deepEqual(await invoke('/__m03_authorized__/replay',{
    tenantId:'TENANT-B',actorId:'USER-B',tokenHash:'b'.repeat(64),
    operationId:'OP-UNKNOWN',sql:'DROP TABLE operation_receipts'
  }),{status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'SALE-1'}});
  assert.deepEqual(await stored(),before);
});

test('test Worker has no public deployment or real auth/receipt route in production Worker',async()=>{
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m03-authorized-receipt-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.main,'tests/fixtures/m03-authorized-receipt-worker.mjs');
  assert.deepEqual(config.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000010']);
  const prod=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(prod.includes('authorized-operation-receipt'),false);
  assert.equal(prod.includes('synthetic_auth_sessions'),false);
});
