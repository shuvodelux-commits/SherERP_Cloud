import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M03_OVERSOLD_DDL} from '../fixtures/m03-oversold-atomic-schema.mjs';
import {createSyntheticOversoldSettlementProof} from '../fixtures/m03-oversold-atomic-contract.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-oversold-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-oversold-local-test');
let DB;
const A={tenantId:'SHOP-A',actorId:'USER-A',tokenHash:'a'.repeat(64),operationId:'OP-100',productId:'PIPE',purchaseId:'PUR-082',purchaseLotId:'LOT-940',expectedPurchaseRevision:1,expectedPurchaseRemainingUnits:240,now:1000,allocations:[{oversoldLotId:'LOT-939',expectedRevision:1,expectedRemainingUnits:-229,units:229},{oversoldLotId:'LOT-OLD-2',expectedRevision:1,expectedRemainingUnits:-2,units:2}]};
const post=()=>createSyntheticOversoldSettlementProof(DB);
const rows=async(sql)=>(await DB.prepare(sql).all()).results;
const state=async()=>({lots:await rows('SELECT * FROM m03_os_lots ORDER BY tenant_id,lot_id'),receipts:await rows('SELECT * FROM m03_os_receipts ORDER BY tenant_id,operation_id'),links:await rows('SELECT * FROM m03_os_links ORDER BY tenant_id,oversold_lot_id'),audit:await rows('SELECT * FROM m03_os_audit ORDER BY tenant_id,operation_id')});
before(async()=>{await harness.listen();({DB}=await worker.getEnv());});
after(async()=>harness.close());
beforeEach(async()=>{
 for(const table of ['m03_os_audit','m03_os_links','m03_os_receipts','m03_os_lots','m03_os_sessions','m03_os_users','m03_os_roles'])await DB.prepare('DROP TABLE IF EXISTS '+table).run();
 for(const ddl of M03_OVERSOLD_DDL)await DB.prepare(ddl).run();
 for(const [t,u,r,token] of [['SHOP-A','USER-A','ROLE-A','a'.repeat(64)],['SHOP-B','USER-B','ROLE-B','b'.repeat(64)]]){
  await DB.prepare('INSERT INTO m03_os_roles VALUES (?,?,1,1,1)').bind(t,r).run();
  await DB.prepare('INSERT INTO m03_os_users VALUES (?,?,?,1,1)').bind(t,u,r).run();
  await DB.prepare('INSERT INTO m03_os_sessions VALUES (?,?,?,?,1,1,2000,NULL)').bind(token,t,u,r).run();
 }
 for(const [id,type,orig,remaining,cost,date,source] of [['LOT-939','OVERSOLD',229,-229,6800,'2026-11-10','OVERSOLD'],['LOT-OLD-2','OVERSOLD',2,-2,6800,'2026-11-15','OVERSOLD'],['LOT-940','PURCHASE',240,240,6475,'2026-11-19','PUR-082']]){
  await DB.prepare("INSERT INTO m03_os_lots VALUES('SHOP-A','PIPE',?,?,?,?,?,?,?,1)").bind(id,source,type,orig,remaining,cost,date).run();
 }
});

test('isolated Worker exposes no settlement RPC',async()=>{
 const response=await worker.fetch('https://synthetic.local/api/rpc');assert.equal(response.status,404);
});
test('actual local Workerd/D1: two negative source lots settle atomically with 9 remaining',async()=>{
 assert.deepEqual(await post().settle(A),{status:'COMMITTED',operationId:'OP-100',purchaseRemainingUnits:9,settledUnits:231,variancePaisa:75075});
 const x=await state();assert.equal(x.links.length,2);assert.equal(x.receipts.length,1);assert.equal(x.audit.length,1);
 assert.equal(x.lots.find(z=>z.lot_id==='LOT-940').remaining_units,9);
 assert.equal(x.lots.filter(z=>z.kind==='OVERSOLD').reduce((n,z)=>n+z.remaining_units,0),0);
});
test('actual local Workerd/D1: identical replay and changed intent do not post again',async()=>{
 assert.equal((await post().settle(A)).status,'COMMITTED');const saved=await state();
 assert.equal((await post().settle(A)).status,'REPLAY');
 assert.equal((await post().settle({...A,allocations:[A.allocations[0]]})).status,'CONFLICT');
 assert.deepEqual(await state(),saved);
});
test('actual local Workerd/D1: forced audit failure rolls back stock, links and receipt',async()=>{
 const before=await state();await assert.rejects(()=>post().settle({...A,operationId:'OP-BAD'}),/NEEDS_REVIEW/);
 assert.deepEqual(await state(),before);
});
test('actual local Workerd/D1: concurrent operation IDs cannot settle same debt twice',async()=>{
 const x=await Promise.all([post().settle({...A,operationId:'OP-RACE-A'}),post().settle({...A,operationId:'OP-RACE-B'})]);
 assert.deepEqual(x.map(y=>y.status).sort(),['COMMITTED','DECLINED']);
 assert.equal((await rows('SELECT * FROM m03_os_receipts')).length,1);
});
test('actual local Workerd/D1: cross-tenant identity, revoked session and backdated negative deny',async()=>{
 assert.equal((await post().settle({...A,tenantId:'SHOP-B',actorId:'USER-B',tokenHash:'b'.repeat(64)})).status,'DECLINED');
 await DB.prepare("UPDATE m03_os_sessions SET revoked_at=1 WHERE tenant_id='SHOP-A'").run();
 assert.equal((await post().settle(A)).status,'DECLINED');
 await DB.prepare("UPDATE m03_os_sessions SET revoked_at=NULL WHERE tenant_id='SHOP-A'").run();
 await DB.prepare("UPDATE m03_os_lots SET occurred_at='2026-11-22' WHERE lot_id='LOT-939'").run();
 assert.equal((await post().settle(A)).status,'DECLINED');
 assert.equal((await rows('SELECT * FROM m03_os_receipts')).length,0);
});
