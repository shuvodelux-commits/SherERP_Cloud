import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1PostingContract} from '../fixtures/m03-transaction-contract.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-transaction-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-transaction-workerd-test');
let db;
const digest=value=>createHash('sha256').update(value).digest('hex');
const action=(operationId,units,payloadHash=digest(operationId+':'+units))=>({operationId,payloadHash,units});

before(async()=>{
  await harness.listen();
  ({DB:db}=await worker.getEnv());
  await db.prepare(`CREATE TABLE synthetic_stock(
    account_id TEXT PRIMARY KEY, available INTEGER NOT NULL CHECK(available>=0)) STRICT;`).run();
  await db.prepare(`CREATE TABLE synthetic_operations(
    operation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
    units INTEGER NOT NULL CHECK(units>0),
    state TEXT NOT NULL CHECK(state='COMMITTED')) STRICT;`).run();
  await db.prepare(`CREATE TABLE synthetic_movements(
    operation_id TEXT PRIMARY KEY REFERENCES synthetic_operations(operation_id),
    units INTEGER NOT NULL CHECK(units>0)) STRICT;`).run();
  await db.prepare("INSERT INTO synthetic_stock(account_id,available) VALUES ('counter',2)").run();
});
beforeEach(async()=>{
  await db.prepare('DROP TRIGGER IF EXISTS fail_synthetic_movement').run();
  await db.prepare('DELETE FROM synthetic_movements').run();
  await db.prepare('DELETE FROM synthetic_operations').run();
  await db.prepare("UPDATE synthetic_stock SET available=2 WHERE account_id='counter'").run();
});
after(async()=>{await harness.close();});

const view=async()=>({
  stock:(await db.prepare("SELECT available FROM synthetic_stock WHERE account_id='counter'").first()).available,
  operations:(await db.prepare('SELECT operation_id,payload_hash,units,state FROM synthetic_operations ORDER BY operation_id').all()).results,
  movements:(await db.prepare('SELECT operation_id,units FROM synthetic_movements ORDER BY operation_id').all()).results
});

test('one synthetic operation inserts intent, reduces stock, and writes one movement atomically',async()=>{
  const posting=createSyntheticD1PostingContract(db);
  const p=action('OP-SALE-1',2);
  assert.deepEqual(await posting.post(p),{status:'COMMITTED',operationId:'OP-SALE-1'});
  assert.deepEqual(await view(),{
    stock:0,
    operations:[{operation_id:p.operationId,payload_hash:p.payloadHash,units:2,state:'COMMITTED'}],
    movements:[{operation_id:p.operationId,units:2}]
  });
});

test('stable operation ID and identical intent replay makes no second movement',async()=>{
  const posting=createSyntheticD1PostingContract(db);
  const p=action('OP-REPLAY',1);
  assert.deepEqual(await posting.post(p),{status:'COMMITTED',operationId:p.operationId});
  const before=await view();
  assert.deepEqual(await posting.post(p),{status:'REPLAY',operationId:p.operationId});
  assert.deepEqual(await view(),before);
});

test('reused operation ID with changed payload hash or units is a conflict, never a posting',async()=>{
  const posting=createSyntheticD1PostingContract(db);
  const p=action('OP-CONFLICT',1);
  assert.equal((await posting.post(p)).status,'COMMITTED');
  const before=await view();
  assert.deepEqual(await posting.post(action('OP-CONFLICT',2)),{status:'CONFLICT',operationId:p.operationId});
  assert.deepEqual(await posting.post({...p,payloadHash:digest('attacker-intent')}),{status:'CONFLICT',operationId:p.operationId});
  assert.deepEqual(await view(),before);
});

test('insufficient synthetic owned stock declines without reserving operation ID or posting a movement',async()=>{
  const posting=createSyntheticD1PostingContract(db);
  const p=action('OP-NOSTOCK',3);
  assert.deepEqual(await posting.post(p),{status:'DECLINED',operationId:p.operationId});
  assert.deepEqual(await view(),{stock:2,operations:[],movements:[]});
});

test('two concurrent different operation IDs racing for the last unit cannot both commit',async()=>{
  await db.prepare("UPDATE synthetic_stock SET available=1 WHERE account_id='counter'").run();
  const posting=createSyntheticD1PostingContract(db);
  const results=await Promise.all([posting.post(action('OP-RACE-A',1)),posting.post(action('OP-RACE-B',1))]);
  assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  const saved=await view();
  assert.equal(saved.stock,0);
  assert.equal(saved.operations.length,1);
  assert.equal(saved.movements.length,1);
  assert.equal(saved.operations[0].operation_id,saved.movements[0].operation_id);
});

test('forced journal failure rolls back earlier operation record and stock update in real D1 batch',async()=>{
  await db.prepare(`CREATE TRIGGER fail_synthetic_movement BEFORE INSERT ON synthetic_movements
    WHEN NEW.operation_id='OP-ROLLBACK'
    BEGIN SELECT RAISE(ABORT,'synthetic-journal-failure'); END;`).run();
  const posting=createSyntheticD1PostingContract(db);
  await assert.rejects(()=>posting.post(action('OP-ROLLBACK',1)),/synthetic-journal-failure|D1_ERROR|constraint/i);
  assert.deepEqual(await view(),{stock:2,operations:[],movements:[]});
});

test('invalid operation inputs and unavailable transaction binding fail before any SQL',async()=>{
  assert.throws(()=>createSyntheticD1PostingContract({}),/batch|D1|binding/i);
  const broken={prepare(){throw new Error('MUST NOT EXECUTE SQL');},batch(){throw new Error('MUST NOT BATCH');}};
  const posting=createSyntheticD1PostingContract(broken);
  for(const input of [null,[],{},action('',1),action(' bad ',1),action('OP',0),action('OP',-1),
    action('OP',1.5),action('OP','1'),{...action('OP',1),payloadHash:'bad'},
    {...action('OP',1),extra:'injected'}]){
    await assert.rejects(()=>posting.post(input),/invalid|unsupported|required|operation|unit|digest|hash/i);
  }
});

test('local-only fixture has synthetic DB UUID, no public API route and no deployed imports',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m03-transaction-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.name,'shererp-m03-transaction-workerd-test');
  assert.equal(cfg.main,'tests/fixtures/m03-transaction-worker.mjs');
  assert.equal(cfg.routes,undefined);
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),['00000000-0000-0000-0000-000000000004']);
  const response=await worker.fetch('http://local/__m03_posting_contract__',{method:'POST'});
  assert.equal(response.status,404);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m03-transaction-contract'),false);
  assert.equal(live.includes('synthetic_operations'),false);
});
