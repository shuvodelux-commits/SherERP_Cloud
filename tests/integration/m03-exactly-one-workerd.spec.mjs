import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

// Isolated, nondeployable synthetic Workerd and D1; never uses remote data.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-exactly-one-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-guard-workerd-test');
let DB;
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`CREATE TABLE proof_operations(
    operation_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL
  ) STRICT`).run();
  await DB.prepare(`CREATE TABLE proof_stock(
    sku TEXT PRIMARY KEY,quantity INTEGER NOT NULL CHECK(quantity>=0)
  ) STRICT`).run();
  await DB.prepare(`CREATE TABLE proof_journal(
    operation_id TEXT PRIMARY KEY,sku TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0)
  ) STRICT`).run();
  await DB.prepare(`CREATE TABLE proof_receipts(
    operation_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,posted INTEGER NOT NULL
  ) STRICT`).run();
  await DB.prepare("INSERT INTO proof_stock(sku,quantity) VALUES ('PIPE',2),('SINGLE',1),('EMPTY',0)").run();
});
after(async()=>{await harness.close();});

async function post(path,body){
  const response=await worker.fetch('http://m03-atomic.local'+path,{
    method:'POST',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
}
async function snapshot(){
  const sql={
    operations:'SELECT operation_id,payload_hash FROM proof_operations ORDER BY operation_id',
    stock:'SELECT sku,quantity FROM proof_stock ORDER BY sku',
    journal:'SELECT operation_id,sku,quantity FROM proof_journal ORDER BY operation_id',
    receipts:'SELECT operation_id,payload_hash,posted FROM proof_receipts ORDER BY operation_id'
  };
  const result={};
  for(const [key,query] of Object.entries(sql)){
    const rows=await DB.prepare(query).all();
    assert.equal(rows.success,true);
    result[key]=rows.results.map(row=>({...row}));
  }
  return result;
}

test('actual workerd D1 commits one synthetic operation claim, stock delta, journal and receipt together',async()=>{
  assert.deepEqual(await post('/__m03_guard__/post-first'),{status:200,body:{posted:true}});
  const x=await snapshot();
  assert.equal(x.stock.find(r=>r.sku==='PIPE').quantity,1);
  assert.deepEqual(x.operations,[{operation_id:'OP-FIRST',payload_hash:'hash-original'}]);
  assert.deepEqual(x.journal,[{operation_id:'OP-FIRST',sku:'PIPE',quantity:1}]);
  assert.deepEqual(x.receipts,[{operation_id:'OP-FIRST',payload_hash:'hash-original',posted:1}]);
});

test('actual D1 refuses duplicate same operation ID without second stock or journal write',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_guard__/post-first')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('same operation ID with different payload fingerprint cannot replace original receipt',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_guard__/post-collision')).status,409);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await DB.prepare("SELECT payload_hash FROM proof_receipts WHERE operation_id='OP-FIRST'").first()).payload_hash,
    'hash-original');
});

test('zero affected stock fails SQL assertion and rolls back previously inserted operation claim',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_guard__/post-empty')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('later journal constraint failure rolls back both earlier claim and stock write',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_guard__/post-bad-journal')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('two concurrent operations against one remaining stock item commit at most once',async()=>{
  const [a,b]=await Promise.all([
    post('/__m03_guard__/last-a'),
    post('/__m03_guard__/last-b')
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  const now=await snapshot();
  assert.equal(now.stock.find(r=>r.sku==='SINGLE').quantity,0);
  const latest=now.receipts.filter(r=>r.operation_id.startsWith('OP-LAST-'));
  assert.equal(latest.length,1);
  assert.equal(now.journal.filter(r=>r.sku==='SINGLE').length,1);
});

test('accidental two-row mutation aborts entirely despite valid SQL statement',async()=>{
  const before=await snapshot();
  assert.equal((await post('/__m03_guard__/multirow')).status,409);
  assert.deepEqual(await snapshot(),before);
});

test('only fixed test actions exist; request body never supplies table, SQL or operation IDs',async()=>{
  const attack=await post('/__m03_guard__/post-first',{
    sql:'DELETE FROM settings',operationId:'attacker',sku:'SINGLE',
    amount:999
  });
  assert.equal(attack.status,409);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
  assert.equal((await post('/__m03_guard__/unknown')).status,404);
  const get=await worker.fetch('http://m03-atomic.local/__m03_guard__/post-first');
  assert.equal(get.status,405);
});
