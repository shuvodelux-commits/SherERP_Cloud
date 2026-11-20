/**
 * M08 P0 Counter Supplier Pay — isolated authorized D1 cash-payment slice.
 *
 * Test-first: verifies a real cash payment against an existing supplier debt,
 * exact paisa accounting, same-Shop lease, immutable receipts, replay and
 * SQL-atomic rollback. No application UI/API integration or live D1 writes.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,postOwnerCreditPurchase,closeOwnerCashSession}
  from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerSupplierCashPayment,readOwnerSupplierCashPayments}
  from '../../src/db/m08-owner-supplier-cash-pay.js';

const migrationPaths=[
  'migrations/0002_party_identity.sql',
  'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
  'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
  'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
  'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql',
  'staging-migrations/shop-owner-write/0010_owner_supplier_cash_pay.sql',
];
const scope=owner=>pilotShopConfiguration(owner.env);
const actor=owner=>({token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID});
const nowDay=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const product=()=>({
  operationId:crypto.randomUUID(),name:'Supplier Pay Pipe',brand:'',category:'Pipes',
  unit:'pcs',purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',
  minStock:'0',barcode:'',productType:'Standard',components:[]
});
const supplier=()=>({
  operationId:crypto.randomUUID(),name:'Supplier Pay Merchant',phone:'01712345678',
  address:'',notes:'',openingBalance:'0'
});
async function migrate(db){
  for(const path of migrationPaths){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
}
async function init(owner,{open=true}={}){
  const shop=scope(owner),auth=actor(owner);
  assert.equal((await createOwnerProduct(shop,{...auth,input:product()})).status,'created');
  assert.equal((await createOwnerSupplier(shop,{...auth,input:supplier()})).status,'created');
  if(open)assert.equal((await openOwnerCashSession(shop,{...auth,operationId:crypto.randomUUID(),
    openingCash:'0',notes:'Counter Supplier Pay'})).status,'started');
  return shop;
}
async function purchase(owner){
  return postOwnerCreditPurchase(scope(owner),{...actor(owner),
    operationId:crypto.randomUUID(),payload:{
      supplierId:'SUP-000001',date:nowDay(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'Supplier Pay Pipe',qty:'10',
        unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',
      bankAccountId:'',notes:'Source credit purchase'
    }
  });
}
async function sale(owner){
  return postOwnerCashSale(scope(owner),{...actor(owner),
    operationId:crypto.randomUUID(),shopName:'Cash Test Shop',
    payload:{
      customerId:'',customerName:'Walk-in',customerPhone:'01712345678',
      customerFatherName:'',customerRelationType:'',customerAddress:'',
      items:[{productId:'PRD-000001',name:'Supplier Pay Pipe',qty:2,
        unitPrice:75,priceMode:'auto',shortageResolution:'negative',
        bundleRevision:0,productType:'Standard'}],
      discount:0,paymentType:'Cash',paidAmount:150,
      paymentMethod:'Cash',bankAccountId:''
    }
  });
}
const payment=(patch={})=>({
  supplierId:'SUP-000001',amount:'100.25',paymentMethod:'Cash',
  bankAccountId:'',notes:'Cash to supplier',date:nowDay(),backdatedReason:'',
  ...patch
});
const post=(owner,payload=payment(),operationId=crypto.randomUUID())=>
  postOwnerSupplierCashPayment(scope(owner),{...actor(owner),operationId,payload});
const first=(db,query)=>db.prepare(query).first();

test('Counter Supplier Pay: credit purchase then cash payout posts exact due and Cash Book once, with replay',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);
    await init(ownerA);await init(ownerB);
    assert.equal((await purchase(ownerA)).status,'created');
    assert.equal((await post(ownerA)).status,'insufficient-cash');
    assert.equal((await sale(ownerA)).status,'created');
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,60000);
    const operationId=crypto.randomUUID(),input=payment();
    const result=await post(ownerA,input,operationId);
    assert.deepEqual(result,{
      status:'created',paymentId:'SPY-000001',supplierId:'SUP-000001',
      amount:100.25,currentDue:499.75
    });
    assert.deepEqual(await post(ownerA,input,operationId),{...result,status:'replayed'});
    assert.equal((await post(ownerA,payment({amount:'101.00'}),operationId)).status,'conflict');
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,49975);
    assert.equal((await first(a,'SELECT credit_paisa AS paid FROM owner_mvp_supplier_payment_ledger')).paid,10025);
    assert.equal((await first(a,'SELECT paid_paisa AS paid FROM owner_mvp_supplier_payment_cash_book')).paid,10025);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,1);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_ledger')).n,1,
      'Original purchase debit ledger remains immutable');
    assert.equal((await first(a,'SELECT opening_paisa AS opening FROM owner_mvp_cash_sessions')).opening,0,
      'Historical opening balance is NOT a current-session cash transaction');
    const history=await readOwnerSupplierCashPayments(scope(ownerA),{...actor(ownerA),supplierId:'SUP-000001'});
    assert.equal(history.status,'ok');
    assert.equal(history.currentDuePaisa,49975);
    assert.equal(history.entries[0].paymentId,'SPY-000001');
    assert.equal(history.entries[0].paidPaisa,10025);
    assert.equal(history.entries.length,1);
    assert.equal((await first(b,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,0);
    assert.equal((await first(b,'SELECT count(*) AS n FROM owner_mvp_supplier_payment_cash_book')).n,0);
  }finally{await close();}
});

test('Supplier Pay rejects closed/missing session, invalid amount, unsupported bank, insufficient due',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await init(ownerA,{open:false});
    assert.equal((await post(ownerA)).status,'session-required');
    assert.equal((await openOwnerCashSession(scope(ownerA),{...actor(ownerA),
      operationId:crypto.randomUUID(),openingCash:'0',notes:'Open'})).status,'started');
    assert.equal((await post(ownerA)).status,'insufficient-due');
    assert.equal((await post(ownerA,payment({supplierId:'SUP-999999'}))).status,'denied');
    assert.equal((await post(ownerA,payment({amount:'0'}))).status,'invalid');
    assert.equal((await post(ownerA,payment({amount:'12.345'}))).status,'invalid');
    assert.equal((await post(ownerA,payment({amount:'-1.00'}))).status,'invalid');
    assert.equal((await post(ownerA,payment({paymentMethod:'Bank',bankAccountId:'BANK1'}))).status,'unsupported');
    assert.equal((await post(ownerA,payment({date:'2020-01-01'}))).status,'unsupported');
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,0);
    assert.equal((await closeOwnerCashSession(scope(ownerA),{...actor(ownerA),
      operationId:crypto.randomUUID(),countedCash:'0',notes:'Close'})).status,'closed');
    assert.equal((await post(ownerA)).status,'session-required');
  }finally{await close();}
});

test('Supplier Pay requires current owner lease and exact shop; no cross-Shop read/write',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);await init(ownerA);await init(ownerB);
    assert.equal((await purchase(ownerA)).status,'created');
    const swapped=await postOwnerSupplierCashPayment(scope(ownerB),{
      ...actor(ownerA),operationId:crypto.randomUUID(),payload:payment()});
    assert.equal(swapped.status,'denied');
    assert.equal((await readOwnerSupplierCashPayments(scope(ownerB),{
      ...actor(ownerA),supplierId:'SUP-000001'})).status,'denied');
    await a.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.equal((await post(ownerA)).status,'denied');
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,60000);
    assert.equal((await first(b,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,0);
  }finally{await close();}
});

test('SQL trigger failure rolls back receipt, due, credit ledger and cash leg atomically; retry works',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await init(ownerA);
    assert.equal((await purchase(ownerA)).status,'created');
    assert.equal((await sale(ownerA)).status,'created');
    await a.prepare(`CREATE TRIGGER test_fail_cash BEFORE INSERT ON
      owner_mvp_supplier_payment_cash_book
      BEGIN SELECT RAISE(ABORT,'injected supplier cash failure'); END`).run();
    await assert.rejects(()=>post(ownerA),/injected supplier cash failure/);
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,60000);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,0);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_payment_ledger')).n,0);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_payment_cash_book')).n,0);
    await a.prepare('DROP TRIGGER test_fail_cash').run();
    assert.equal((await post(ownerA)).status,'created');
  }finally{await close();}
});

test('a Cash Session with supplier payout cannot be falsely closed by the older Sale/Return-only cash formula',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await init(ownerA);await purchase(ownerA);
    assert.equal((await sale(ownerA)).status,'created');
    assert.equal((await post(ownerA)).status,'created');
    const closeAttempt=await closeOwnerCashSession(scope(ownerA),{...actor(ownerA),
      operationId:crypto.randomUUID(),countedCash:'0',notes:'Incomplete formula'});
    assert.equal(closeAttempt.status,'reconciliation-required');
    assert.equal((await first(a,"SELECT status FROM owner_mvp_cash_sessions")).status,'Open');
  }finally{await close();}
});

test('direct D1 spoofed grant cannot bypass SQL-time Owner validation; posted legs stay immutable',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);await init(ownerA);await purchase(ownerA);
    await assert.rejects(()=>a.prepare(`INSERT INTO owner_mvp_supplier_cash_payment_receipts(
      operation_id,actor_id,intent_hash,shop_id,database_id,database_marker,
      token_hash,supplier_id,cash_sequence,paid_paisa,note_text,paid_date,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(),'google:forged','f'.repeat(64),
        ownerA.env.PLATFORM_PILOT_SHOP_ID,ownerA.env.PLATFORM_PILOT_D1_ID,
        ownerA.env.PLATFORM_PILOT_MARKER,'0'.repeat(64),'SUP-000001',
        1,100,'forged',nowDay(),Date.now()).run(),/MVP_SUPPLIER_CASH_OWNER_REQUIRED/);
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,60000);
    assert.equal((await first(a,'SELECT count(*) AS n FROM owner_mvp_supplier_cash_payment_receipts')).n,0);
    assert.equal((await sale(ownerA)).status,'created');
    assert.equal((await post(ownerA)).status,'created');
    await assert.rejects(()=>a.prepare(
      "UPDATE owner_mvp_supplier_payment_ledger SET credit_paisa=1 WHERE payment_sequence=1"
    ).run(),/MVP_SUPPLIER_CASH_LEDGER_IMMUTABLE/);
    await assert.rejects(()=>a.prepare(
      "DELETE FROM owner_mvp_supplier_payment_cash_book WHERE payment_sequence=1"
    ).run(),/MVP_SUPPLIER_CASH_BOOK_IMMUTABLE/);
    assert.equal((await first(a,'SELECT current_due_paisa AS due FROM owner_supplier_master')).due,49975);
    assert.equal((await first(a,'SELECT paid_paisa FROM owner_mvp_supplier_payment_cash_book')).paid_paisa,10025);
  }finally{await close();}
});
