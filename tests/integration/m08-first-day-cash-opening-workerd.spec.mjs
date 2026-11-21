/** RED -> GREEN: first actual drawer baseline does not invent current-day Cash Book money. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {openOwnerCashSession,closeOwnerCashSession,readOwnerCashSession,
  readOwnerCashOpeningSuggestion} from '../../src/db/m03-owner-mvp-purchase.js';

const migrations=[
 'migrations/0002_party_identity.sql',
 ...Array.from({length:7},(_,i)=>'staging-migrations/shop-owner-write/'+
   ['0005_owner_supplier_master.sql','0006_owner_mvp_credit_purchase.sql',
    '0007_owner_mvp_cash_sale.sql','0008_owner_mvp_cash_return.sql',
    '0009_owner_mvp_cash_close.sql','0010_owner_supplier_cash_pay.sql',
    '0011_owner_supplier_cash_reconciliation.sql'][i])
];
async function migrate(db,includeFirstDay=true){
 for(const path of [...migrations,
   ...(includeFirstDay?['staging-migrations/shop-owner-write/0012_owner_first_day_cash_opening.sql']:[])]){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
 }
}
const start=(owner,openingCash,operationId=crypto.randomUUID())=>openOwnerCashSession(
 pilotShopConfiguration(owner.env),{token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID,
 operationId,openingCash,notes:'Physical money in first-day drawer'});
const end=(owner,countedCash,operationId=crypto.randomUUID())=>closeOwnerCashSession(
 pilotShopConfiguration(owner.env),{token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID,
 operationId,countedCash,notes:'Physical Close Day count'});

test('first-ever nonzero drawer cash is an opening baseline with zero current Cash Book movement',async()=>{
 const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
 try{
  await migrate(a);await migrate(b);
  const amount='125.75';
  assert.deepEqual(await start(ownerA,amount),{status:'started',sessionId:'CS-000001'});
  const info=await readOwnerCashSession(a);
  assert.equal(info.openingCash,125.75);
  assert.equal(info.expectedCash,125.75);
  assert.equal(info.cashIn,0);
  assert.equal(info.cashOut,0);
  const row=await a.prepare('SELECT opening_paisa AS zero, carried_opening_paisa AS physical FROM owner_mvp_cash_sessions').first();
  assert.deepEqual(row,{zero:0,physical:12575});
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book').first()).n,0);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_supplier_payment_cash_book').first()).n,0);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_return_cash_book').first()).n,0);
  await assert.rejects(
    a.prepare("DELETE FROM owner_mvp_cash_sessions WHERE status='Open'").run(),
    /MVP_CASH_SESSION_IMMUTABLE/,
    'removing a Cash Session cannot reset first-day allowance');
  assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,0);
  assert.equal((await start(ownerB,'0')).status,'started');
 }finally{await close();}
});

test('first opening must be nonnegative, idempotent, and never reset after Close Day',async()=>{
 const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
 try{
  await migrate(a);
  assert.equal((await start(ownerA,'-100')).status,'invalid');
  assert.equal((await start(ownerA,'1.234')).status,'invalid');
  const operationId=crypto.randomUUID();
  assert.equal((await start(ownerA,'200.25',operationId)).status,'started');
  assert.equal((await start(ownerA,'200.25',operationId)).status,'replayed');
  assert.equal((await start(ownerA,'1')).status,'already-open');
  assert.equal((await end(ownerA,'190.10')).status,'closed');
  assert.equal((await readOwnerCashOpeningSuggestion(a)).openingCash,190.1);
  assert.equal((await start(ownerA,'200.25')).status,'opening-mismatch');
  assert.equal((await start(ownerA,'190.10')).status,'started');
  assert.equal((await readOwnerCashSession(a)).expectedCash,190.1);
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,2);
 }finally{await close();}
});

test('existing nonzero-opening restriction remains until approved migration and no in-place changes',async()=>{
 const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
 try{
  await migrate(a,false);
  assert.equal((await start(ownerA,'19.25')).status,'opening-mismatch');
  assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,0);
 }finally{await close();}
});
