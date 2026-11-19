import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {M03_OVERSOLD_DDL,seedOversoldProof} from './fixtures/m03-oversold-atomic-schema.mjs';
import {createSyntheticOversoldSettlementProof} from './fixtures/m03-oversold-atomic-contract.mjs';

function dbAdapter(db) {
  return {
    prepare(sql) {
      return { bind(...args) {return {sql,args}}, };
    },
    async batch(commands) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = commands.map(({sql,args})=>({success:true,results:db.prepare(sql).all(...args)}));
        db.exec('COMMIT');
        return results;
      } catch(error) {db.exec('ROLLBACK');throw error;}
    }
  };
}
function setup() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const sql of M03_OVERSOLD_DDL)db.exec(sql);
  seedOversoldProof(db);
  return {db,post:createSyntheticOversoldSettlementProof(dbAdapter(db))};
}
const A={tenantId:'SHOP-A',actorId:'USER-A',tokenHash:'a'.repeat(64),operationId:'OP-100',productId:'PIPE',purchaseId:'PUR-082',purchaseLotId:'LOT-940',expectedPurchaseRevision:1,expectedPurchaseRemainingUnits:240,now:1000,allocations:[{oversoldLotId:'LOT-939',expectedRevision:1,expectedRemainingUnits:-229,units:229},{oversoldLotId:'LOT-OLD-2',expectedRevision:1,expectedRemainingUnits:-2,units:2}]};
const B={...A,tenantId:'SHOP-B',actorId:'USER-B',tokenHash:'b'.repeat(64)};
const rows=(db,sql)=>db.prepare(sql).all();
const lot=(db,t,id)=>db.prepare('SELECT * FROM m03_os_lots WHERE tenant_id=? AND lot_id=?').get(t,id);
const snapshot=db=>({lots:rows(db,'SELECT * FROM m03_os_lots ORDER BY tenant_id,lot_id'),receipts:rows(db,'SELECT * FROM m03_os_receipts ORDER BY tenant_id,operation_id'),links:rows(db,'SELECT * FROM m03_os_links ORDER BY tenant_id,oversold_lot_id'),audit:rows(db,'SELECT * FROM m03_os_audit ORDER BY tenant_id,operation_id')});

test('single synthetic purchase settles two negatives atomically, preserving original quantity and signed variance evidence',async()=>{
 const {db,post}=setup();
 assert.deepEqual(await post.settle(A),{status:'COMMITTED',operationId:'OP-100',purchaseRemainingUnits:9,settledUnits:231,variancePaisa:75075});
 assert.equal(lot(db,'SHOP-A','LOT-940').original_units,240);
 assert.equal(lot(db,'SHOP-A','LOT-940').remaining_units,9);
 assert.equal(lot(db,'SHOP-A','LOT-939').remaining_units,0);
 assert.equal(lot(db,'SHOP-A','LOT-OLD-2').remaining_units,0);
 const d=snapshot(db);
 assert.equal(d.links.length,2);assert.equal(d.receipts[0].actual_cost_paisa,1495725);
 assert.equal(d.receipts[0].provisional_cost_paisa,1570800);
 assert.equal(d.receipts[0].variance_paisa,75075);
 assert.equal(d.audit.length,1);
 assert.equal(d.lots.reduce((n,l)=>n+(l.tenant_id==='SHOP-A'?l.remaining_units:0),0),9);
 db.close();
});

test('identical operation replays without changing rows and changed allocation intent conflicts',async()=>{
 const {db,post}=setup();assert.equal((await post.settle(A)).status,'COMMITTED');
 const saved=snapshot(db);
 assert.equal((await post.settle(A)).status,'REPLAY');
 assert.equal((await post.settle({...A,allocations:[{oversoldLotId:'LOT-939',expectedRevision:1,expectedRemainingUnits:-229,units:229}]})).status,'CONFLICT');
 assert.deepEqual(snapshot(db),saved);db.close();
});

test('stale purchase revision, wrong negative quantity, duplicate debt ID, backdate and cross-product refuse without mutation',async()=>{
 for(const override of [
  {expectedPurchaseRevision:2},
  {allocations:[{oversoldLotId:'LOT-939',expectedRevision:1,expectedRemainingUnits:-230,units:229}]},
  {productId:'OTHER'},
 ]){
  const {db,post}=setup();const before=snapshot(db);
  const result=await post.settle({...A,...override});assert.equal(result.status,'DECLINED');
  assert.deepEqual(snapshot(db),before);db.close();
 }
 const invalid=setup();await assert.rejects(()=>invalid.post.settle({...A,allocations:[A.allocations[0],A.allocations[0]]}),/Invalid synthetic settlement allocation/i);invalid.db.close();
 const {db,post}=setup(); db.prepare("UPDATE m03_os_lots SET occurred_at='2026-11-21' WHERE tenant_id='SHOP-A' AND lot_id='LOT-939'").run();
 assert.equal((await post.settle(A)).status,'DECLINED');db.close();
});

test('failed late audit abort rolls back receipt and BOTH lot changes',async()=>{
 const {db,post}=setup();const before=snapshot(db);
 await assert.rejects(()=>post.settle({...A,operationId:'OP-BAD'}),/NEEDS_REVIEW/);
 assert.deepEqual(snapshot(db),before);
 assert.equal((await post.settle({...A,operationId:'OP-GOOD'})).status,'COMMITTED');db.close();
});

test('other tenant cannot claim a receipt or settle another tenant lot',async()=>{
 const {db,post}=setup();const before=snapshot(db);
 assert.equal((await post.settle({...A,tenantId:'SHOP-B',actorId:'USER-B',tokenHash:B.tokenHash})).status,'DECLINED');
 assert.deepEqual(snapshot(db),before);
 assert.equal((await post.settle(A)).status,'COMMITTED');
 assert.equal((await post.settle({...B,operationId:A.operationId})).status,'DECLINED');db.close();
});

test('revoked/expired/disabled or stale session cannot settle even if upstream preflight was previously valid',async()=>{
 for(const sql of [
  "UPDATE m03_os_sessions SET revoked_at=1 WHERE tenant_id='SHOP-A'",
  "UPDATE m03_os_sessions SET expires_at=999 WHERE tenant_id='SHOP-A'",
  "UPDATE m03_os_roles SET can_post=0,auth_version=2 WHERE tenant_id='SHOP-A'",
  "UPDATE m03_os_users SET active=0,auth_version=2 WHERE tenant_id='SHOP-A'"
 ]){
  const {db,post}=setup();db.exec(sql);const before=snapshot(db);
  assert.equal((await post.settle(A)).status,'DECLINED');assert.deepEqual(snapshot(db),before);db.close();
 }
});

test('competing distinct operations for the same debt never double-settle',async()=>{
 const {db,post}=setup();const r=await Promise.all([post.settle({...A,operationId:'OP-RACE-A'}),post.settle({...A,operationId:'OP-RACE-B'})]);
 assert.deepEqual(r.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
 assert.equal(rows(db,'SELECT * FROM m03_os_receipts').length,1);
 assert.equal(lot(db,'SHOP-A','LOT-940').remaining_units,9);db.close();
});

test('committed settlement receipt/link evidence cannot be edited or deleted',async()=>{
 const {db,post}=setup();assert.equal((await post.settle(A)).status,'COMMITTED');
 assert.throws(()=>db.exec("UPDATE m03_os_receipts SET variance_paisa=0 WHERE tenant_id='SHOP-A'"),/immutable/i);
 assert.throws(()=>db.exec("DELETE FROM m03_os_links WHERE tenant_id='SHOP-A'"),/immutable/i);db.close();
});

test('reject accessor and unknown keys before SQL',async()=>{
 const {db,post}=setup();let touched=false;const withGetter={...A};Object.defineProperty(withGetter,'tenantId',{get(){touched=true;throw new Error('getter');}});
 await assert.rejects(()=>post.settle(withGetter),/invalid/i);assert.equal(touched,false);
 await assert.rejects(()=>post.settle({...A,extra:'not allowed'}),/invalid/i);db.close();
});
