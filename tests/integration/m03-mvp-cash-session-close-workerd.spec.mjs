/** M03/M08 RED -> GREEN: original Cash Session close/rollover on real Shop Workerd D1. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,readOwnerCashSession,
  readOwnerCashOpeningSuggestion,postOwnerCreditPurchase}
  from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerCashReturn} from '../../src/db/m03-owner-mvp-cash-return.js';

const scope=o=>pilotShopConfiguration(o.env);
const auth=o=>({token:o.token,ownerSubject:o.env.PLATFORM_PILOT_SHOP_ID});
const today=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const newOp=()=>crypto.randomUUID();
const first=(db,query)=>db.prepare(query).first();

async function migrate(db){
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
    'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
    'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql'
  ])await db.batch(unstable_splitSqlQuery(await readFile(path,'utf8')).map(s=>db.prepare(s)));
}
const start=(owner,openingCash='0',operationId=newOp())=>openOwnerCashSession(scope(owner),{
  ...auth(owner),operationId,openingCash,notes:'Real drawer opening'
});
const end=(owner,countedCash='0',operationId=newOp(),notes='Counted at end of day')=>
  closeOwnerCashSession(scope(owner),{...auth(owner),operationId,countedCash,notes});

async function setup(owner){
  const shop=scope(owner),ctx=auth(owner);
  assert.equal((await createOwnerProduct(shop,{...ctx,input:{
    operationId:newOp(),name:'MVP Cash Wire',unit:'pcs',category:'Electrical',brand:'',
    purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',minStock:'0',barcode:'',
    productType:'Standard',components:[]
  }})).status,'created');
  assert.equal((await createOwnerSupplier(shop,{...ctx,input:{
    operationId:newOp(),name:'MVP Cash Supplier',phone:'01712345678',
    openingBalance:'0',address:'',notes:''
  }})).status,'created');
  assert.equal((await start(owner)).status,'started');
  assert.equal((await postOwnerCreditPurchase(shop,{...ctx,operationId:newOp(),
    payload:{supplierId:'SUP-000001',date:today(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'MVP Cash Wire',qty:'10',
        unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
      notes:'Real FIFO Cost'}
  })).status,'created');
}
const checkout=async(owner,qty=2)=>postOwnerCashSale(scope(owner),{
  ...auth(owner),operationId:newOp(),shopName:'MVP Reconciliation Shop',
  payload:{customerId:'',customerName:'Counter Buyer',customerPhone:'01712345678',
    customerFatherName:'',customerRelationType:'',customerAddress:'',
    items:[{productId:'PRD-000001',name:'MVP Cash Wire',qty,unitPrice:75,
      priceMode:'auto',shortageResolution:'negative',bundleRevision:0,productType:'Standard'}],
    discount:0,paymentType:'Cash',paidAmount:75*qty,paymentMethod:'Cash',bankAccountId:''}
});

test('real two-Shop D1: Cash Sale and Cash Return close with durable counted variance, replay, next opening',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);await setup(ownerA);
    const sale=await checkout(ownerA);
    assert.equal(sale.status,'created');
    const refund=await postOwnerCashReturn(scope(ownerA),{
      ...auth(ownerA),operationId:newOp(),payload:{
        invoiceId:sale.invoice.invoiceId,
        items:[{productId:'PRD-000001',name:'MVP Cash Wire',qty:1,price:75}],
        refundMethod:'Cash',reason:'Item returned',notes:'',date:today(),backdatedReason:''
      }
    });
    assert.equal(refund.status,'created');
    const summary=await readOwnerCashSession(a);
    assert.equal(summary.status,'Open');
    assert.equal(summary.cashIn,150);
    assert.equal(summary.cashOut,75);
    assert.equal(summary.openingCash,0);
    assert.equal(summary.expectedCash,75);
    const id=newOp(),notes='One fifty paisa missing';
    const outcome=await end(ownerA,'74.50',id,notes);
    assert.equal(outcome.status,'closed');
    assert.equal(outcome.expected,75);
    assert.equal(outcome.counted,74.50);
    assert.equal(outcome.variance,-0.50);
    const closed=await first(a,`SELECT status,expected_paisa,counted_paisa,variance_paisa,
      close_actor_id,close_intent_hash,close_notes FROM owner_mvp_cash_sessions`);
    assert.deepEqual([closed.status,closed.expected_paisa,closed.counted_paisa,
      closed.variance_paisa,closed.close_actor_id,closed.close_notes],
      ['Closed',7500,7450,-50,'google:'+auth(ownerA).ownerSubject,notes]);
    assert.match(closed.close_intent_hash,/^[0-9a-f]{64}$/);
    assert.equal(await readOwnerCashSession(a),null);
    const replay=await end(ownerA,'74.50',id,notes);
    assert.equal(replay.status,'replayed');
    assert.deepEqual([replay.expected,replay.counted,replay.variance],[75,74.5,-0.5]);
    assert.equal((await end(ownerA,'75',id,notes)).status,'conflict');
    assert.equal((await end(ownerA,'74.50',id,'different note')).status,'conflict');
    assert.equal((await end(ownerA,'74.50')).status,'session-required');
    assert.equal((await checkout(ownerA)).status,'session-required');
    assert.equal((await readOwnerCashOpeningSuggestion(a)).openingCash,74.5);
    assert.equal((await start(ownerA,'0')).status,'opening-mismatch');
    assert.equal((await start(ownerA,'74.50')).status,'started');
    assert.equal((await readOwnerCashSession(a)).openingCash,74.5);
    assert.equal((await readOwnerCashSession(a)).expectedCash,74.5);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions')).n,2);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,1);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_return_cash_book')).n,1);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions')).n,0);
    assert.equal((await end(ownerB,'0')).status,'session-required');
  }finally{await close();}
});

test('SQL-time close refuses forged missing reconciliation fields and closes after actual concurrent posting order',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await setup(ownerA);
    const firstSale=await checkout(ownerA,1);assert.equal(firstSale.status,'created');
    await assert.rejects(()=>a.prepare(`UPDATE owner_mvp_cash_sessions
      SET status='Closed',closed_operation_id='FORGED',closed_at_ms=1
      WHERE status='Open'`).run(),/MVP_CLOSE_/);
    const [saleResult,closed]=await Promise.all([
      checkout(ownerA,1),end(ownerA,'75',newOp(),'Close raced with Sale')
    ]);
    assert.equal(closed.status,'closed');
    assert.ok(['created','session-required','declined'].includes(saleResult.status));
    const posted=await first(a,'SELECT COALESCE(SUM(received_paisa),0) AS n FROM owner_mvp_sale_cash_book');
    const row=await first(a,'SELECT expected_paisa,counted_paisa,variance_paisa FROM owner_mvp_cash_sessions');
    assert.equal(row.expected_paisa,posted.n,
      'SQL snapshot must include every sale that actually committed before close');
    assert.equal(row.variance_paisa,row.counted_paisa-row.expected_paisa);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions WHERE status=\'Closed\'')).n,1);
  }finally{await close();}
});

test('current Shop/Owner lease, immutable close, invalid counts and injected close failure protect audit records',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);await setup(ownerA);
    assert.equal((await checkout(ownerA,1)).status,'created');
    assert.equal((await end(ownerA,'-1')).status,'invalid');
    assert.equal((await end(ownerA,'abc')).status,'invalid');
    const other=await closeOwnerCashSession(scope(ownerA),{
      ...auth(ownerB),operationId:newOp(),countedCash:'75',notes:'Not my Shop'
    });
    assert.equal(other.status,'denied');
    await a.prepare(`CREATE TRIGGER injected_close_failure BEFORE UPDATE OF status
      ON owner_mvp_cash_sessions WHEN NEW.status='Closed'
      BEGIN SELECT RAISE(ABORT,'injected-close-failure'); END`).run();
    await assert.rejects(()=>end(ownerA,'75'),/injected-close-failure/);
    assert.equal((await first(a,'SELECT status FROM owner_mvp_cash_sessions')).status,'Open');
    await a.prepare('DROP TRIGGER injected_close_failure').run();
    assert.equal((await end(ownerA,'75')).status,'closed');
    await assert.rejects(()=>a.prepare(`UPDATE owner_mvp_cash_sessions
      SET counted_paisa=0 WHERE status='Closed'`).run(),/MVP_CLOSE_/);
    assert.equal((await first(a,'SELECT expected_paisa AS n FROM owner_mvp_cash_sessions')).n,7500);
  }finally{await close();}
});
