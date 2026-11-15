import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {AUTHORIZED_POST_DDL,seedAuthorizedPost}
  from '../fixtures/m03-authorized-post-schema.mjs';

const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m03-authorized-post-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m03-authorized-post-workerd-test');
let DB;
const invoke=async(path,body,method='POST')=>{
  const response=await worker.fetch('http://m03-authorized-post.local'+path,{
    method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
  });
  return {status:response.status,body:await response.json()};
};
async function state(){
  const parts={};
  for(const [name,query] of Object.entries({
    stock:'SELECT tenant_id,available FROM synthetic_post_stock ORDER BY tenant_id',
    receipts:`SELECT tenant_id,operation_id,actor_id,payload_hash,units,amount,result_ref
      FROM synthetic_auth_post_receipts ORDER BY tenant_id,operation_id`,
    movements:'SELECT tenant_id,operation_id,sku,units FROM synthetic_post_movements ORDER BY tenant_id,operation_id'
  })){
    const out=await DB.prepare(query).all();
    assert.equal(out.success,true,name);
    parts[name]=out.results.map(x=>({...x}));
  }
  return parts;
}
const remaining=(state,tenant)=>state.stock.find(s=>s.tenant_id===tenant)?.available;
before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const sql of AUTHORIZED_POST_DDL)await DB.prepare(sql).run();
  await seedAuthorizedPost(DB);
});
after(async()=>{await harness.close();});

test('local D1 confirms current session and inserts receipt+movement while reducing owned stock once',async()=>{
  assert.deepEqual(await invoke('/__m03_post__/post-a'),{
    status:200,body:{status:'COMMITTED',operationId:'OP-1',resultRef:'OP-1'}
  });
  const s=await state();
  assert.equal(remaining(s,'TENANT-A'),1);
  assert.equal(remaining(s,'TENANT-B'),2);
  assert.equal(s.receipts.length,1);
  assert.equal(s.movements.length,1);
  assert.deepEqual(s.movements[0],{
    tenant_id:'TENANT-A',operation_id:'OP-1',sku:'PIPE-1',units:1
  });
});

test('same authenticated ID replays with original result and changed money collides',async()=>{
  const before=await state();
  assert.deepEqual(await invoke('/__m03_post__/post-a'),{
    status:200,body:{status:'REPLAY',operationId:'OP-1',resultRef:'OP-1'}
  });
  assert.deepEqual(await invoke('/__m03_post__/post-a-changed'),{
    status:200,body:{status:'CONFLICT',operationId:'OP-1'}
  });
  assert.deepEqual(await state(),before);
});

test('forged actor and second actor session cannot disclose prior receipt or overwrite it',async()=>{
  const before=await state();
  for(const route of ['/__m03_post__/post-a-forged','/__m03_post__/post-a-other-actor']){
    assert.deepEqual(await invoke(route),{
      status:200,body:{status:'DECLINED',operationId:'OP-1'}
    },route);
    assert.deepEqual(await state(),before,route);
  }
});

test('same operation ID in another tenant creates separate committed receipt',async()=>{
  assert.deepEqual(await invoke('/__m03_post__/post-b'),{
    status:200,body:{status:'COMMITTED',operationId:'OP-1',resultRef:'OP-1'}
  });
  const s=await state();
  assert.equal(remaining(s,'TENANT-A'),1);
  assert.equal(remaining(s,'TENANT-B'),1);
  assert.equal(s.receipts.filter(r=>r.operation_id==='OP-1').length,2);
  assert.notEqual(s.receipts[0].payload_hash,s.receipts[1].payload_hash);
});

test('HTTP 503 after atomic commit is recovered by stable operation ID without repost',async()=>{
  const r=await invoke('/__m03_post__/post-c-lost');
  assert.equal(r.status,503);
  const before=await state();
  assert.equal(remaining(before,'TENANT-C'),1);
  assert.equal(before.receipts.filter(r=>r.tenant_id==='TENANT-C').length,1);
  assert.deepEqual(await invoke('/__m03_post__/post-c-replay'),{
    status:200,body:{status:'REPLAY',operationId:'OP-LOST',resultRef:'OP-LOST'}
  });
  assert.deepEqual(await state(),before);
});

test('concurrent different operation IDs for final unit are serialized by real D1',async()=>{
  const results=await Promise.all([
    invoke('/__m03_post__/race-d-a'),
    invoke('/__m03_post__/race-d-b')
  ]);
  assert.deepEqual(results.map(x=>x.body.status).sort(),['COMMITTED','DECLINED']);
  const s=await state();
  assert.equal(remaining(s,'TENANT-D'),0);
  assert.equal(s.receipts.filter(x=>x.tenant_id==='TENANT-D').length,1);
  assert.equal(s.movements.filter(x=>x.tenant_id==='TENANT-D').length,1);
});

test('late movement failure rolls back receipt claim and stock as one D1 transaction',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_post__/bad-e')).status,409);
  assert.deepEqual(await state(),before);
  assert.deepEqual(await invoke('/__m03_post__/good-e'),{
    status:200,body:{status:'COMMITTED',operationId:'OP-GOOD',resultRef:'OP-GOOD'}
  });
  assert.equal(remaining(await state(),'TENANT-E'),1);
});

test('revoked session cannot post or receive prior successful result even with remaining stock',async()=>{
  const prior=await state();
  await DB.prepare(`UPDATE synthetic_post_sessions SET revoked_at=1100
    WHERE token_hash=?`).bind('c'.repeat(64)).run();
  assert.deepEqual(await invoke('/__m03_post__/post-c-after-revoke'),{
    status:200,body:{status:'DECLINED',operationId:'OP-AFTER'}
  });
  assert.deepEqual(await invoke('/__m03_post__/post-c-replay'),{
    status:200,body:{status:'DECLINED',operationId:'OP-LOST'}
  });
  assert.deepEqual(await state(),prior);
});

test('role permission removed then restored invalidates the earlier session version',async()=>{
  const prior=await state();
  await DB.prepare(`UPDATE synthetic_post_roles SET can_post=0
    WHERE tenant_id='TENANT-A'`).run();
  assert.deepEqual(await invoke('/__m03_post__/post-a-after-change'),{
    status:200,body:{status:'DECLINED',operationId:'OP-NEW'}
  });
  await DB.prepare(`UPDATE synthetic_post_roles SET can_post=1
    WHERE tenant_id='TENANT-A'`).run();
  assert.deepEqual(await invoke('/__m03_post__/post-a-after-change'),{
    status:200,body:{status:'DECLINED',operationId:'OP-NEW'}
  });
  assert.deepEqual(await state(),prior);
});

test('user disabled and re-enabled cannot resurrect posting authority',async()=>{
  const prior=await state();
  await DB.prepare(`UPDATE synthetic_post_users SET status='Inactive'
    WHERE tenant_id='TENANT-B' AND user_id='USER-B'`).run();
  await DB.prepare(`UPDATE synthetic_post_users SET status='Active'
    WHERE tenant_id='TENANT-B' AND user_id='USER-B'`).run();
  assert.deepEqual(await invoke('/__m03_post__/post-b-after-change'),{
    status:200,body:{status:'DECLINED',operationId:'OP-NEW'}
  });
  assert.deepEqual(await state(),prior);
});

test('immutable receipt and movements cannot be forged, edited or deleted in actual D1',async()=>{
  const before=await state();
  await assert.rejects(()=>DB.prepare(`UPDATE synthetic_auth_post_receipts
    SET actor_id='FORGED' WHERE operation_id='OP-1'`).run(),/immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM synthetic_auth_post_receipts
    WHERE operation_id='OP-1'`).run(),/immutable|abort|D1_ERROR/i);
  await assert.rejects(()=>DB.prepare(`UPDATE synthetic_post_movements
    SET units=9 WHERE operation_id='OP-1'`).run(),/immutable|abort|D1_ERROR/i);
  assert.deepEqual(await state(),before);
});

test('test Worker ignores attacker request body, denies other routes and has no public RPC import',async()=>{
  const before=await state();
  assert.equal((await invoke('/__m03_post__/unknown')).status,404);
  assert.equal((await invoke('/__m03_post__/post-a',undefined,'GET')).status,405);
  assert.deepEqual(await invoke('/__m03_post__/post-b',{
    tokenHash:'a'.repeat(64),actorId:'USER-A',tenantId:'TENANT-A',
    operationId:'OP-FORGED',units:999,amount:'999999.00',
    sql:'DELETE FROM synthetic_auth_post_receipts'
  }),{
    status:200,body:{status:'DECLINED',operationId:'OP-1'}
  });
  assert.deepEqual(await state(),before);
  const conf=JSON.parse(readFileSync(new URL('../../wrangler.m03-authorized-post-test.jsonc',import.meta.url),'utf8'));
  assert.equal(conf.workers_dev,false);
  assert.equal(conf.routes,undefined);
  assert.equal(conf.main,'tests/fixtures/m03-authorized-post-worker.mjs');
  assert.deepEqual(conf.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000011']);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m03-authorized-post-contract'),false);
  assert.equal(live.includes('synthetic_post_'),false);
});
