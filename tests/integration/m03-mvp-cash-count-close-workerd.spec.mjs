import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,readOwnerCashSession,
  postOwnerCreditPurchase} from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';

const scope=owner=>pilotShopConfiguration(owner.env);
const identity=owner=>({token:owner.token,ownerSubject:owner.env.PLATFORM_PILOT_SHOP_ID});
const day=()=>new Date(Date.now()+6*3600*1000).toISOString().slice(0,10);
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
async function migrate(db,file){
  const sql=await readFile(file,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(q=>db.prepare(q)));
}
async function install(db){
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  ])await migrate(db,path);
}
async function seed(owner){
  const s=scope(owner),who=identity(owner);
  assert.equal((await createOwnerProduct(s,{...who,input:{
    operationId:crypto.randomUUID(),name:'MVP Counter Pipe',unit:'pcs',
    brand:'',category:'Pipe',barcode:'',purchasePrice:'60.00',
    sellingPrice:'75.00',stock:'0',minStock:'0',productType:'Standard',components:[],
  }})).status,'created');
  assert.equal((await createOwnerSupplier(s,{...who,input:{
    operationId:crypto.randomUUID(),name:'MVP Supplier',phone:'01712345678',
    address:'',notes:'',openingBalance:'0',
  }})).status,'created');
  assert.equal((await openOwnerCashSession(s,{...who,operationId:crypto.randomUUID(),
    openingCash:'0',notes:'MVP Start Day'})).status,'started');
  assert.equal((await postOwnerCreditPurchase(s,{...who,operationId:crypto.randomUUID(),
    payload:{supplierId:'SUP-000001',date:day(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'MVP Counter Pipe',
        qty:'10',unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
      notes:'First received stock'},
  }})).status,'created');
  assert.equal((await postOwnerCashSale(s,{...who,operationId:crypto.randomUUID(),
    shopName:'Fixture Shop',payload:{
      customerId:'',customerName:'Counter Buyer',customerPhone:'01712345678',
      customerFatherName:'',customerRelationType:'',customerAddress:'',
      items:[{productId:'PRD-000001',name:'MVP Counter Pipe',qty:2,unitPrice:75,
        priceMode:'auto',shortageResolution:'negative',bundleRevision:0,
        productType:'Standard'}],
      discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',
      bankAccountId:'',
    },
  })).status,'created');
}

test('counted 150 BDT closes a real paid cash Sale session and persists immutable source expected/count/variance',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);await seed(ownerA);
    assert.equal((await readOwnerCashSession(a)).expectedCash,150);
    const operationId=crypto.randomUUID(),input={...identity(ownerA),
      operationId,countedCash:'150.00',notes:'Cash matches drawer'};
    const closed=await closeOwnerCashSession(scope(ownerA),input);
    assert.deepEqual(closed,{status:'closed',sessionId:'CS-000001',
      expected:150,counted:150,variance:0});
    assert.deepEqual(await closeOwnerCashSession(scope(ownerA),input),{
      status:'replayed',sessionId:'CS-000001',expected:150,counted:150,variance:0,
    });
    assert.equal((await closeOwnerCashSession(scope(ownerA),{...input,countedCash:'149.99'})).status,'conflict');
    assert.equal(await readOwnerCashSession(a),null);
    assert.deepEqual(await first(a,`SELECT status,counted_paisa AS counted,
      expected_paisa AS expected,variance_paisa AS variance,
      close_notes AS note FROM owner_mvp_cash_sessions`),{
      status:'Closed',counted:15000,expected:15000,variance:0,
      note:'Cash matches drawer',
    });
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,1);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,0);
    await assert.rejects(a.prepare("UPDATE owner_mvp_cash_sessions SET counted_paisa=1 WHERE status='Closed'").run(),
      /IMMUTABLE|constraint|closed/i);
  }finally{await close();}
});

test('count variance is audit evidence, not a synthetic cash movement; replay preserves signed difference',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await install(a);await seed(ownerA);
    const operationId=crypto.randomUUID();
    const input={...identity(ownerA),operationId,countedCash:'145.00',notes:'Short by five'};
    const firstClose=await closeOwnerCashSession(scope(ownerA),input);
    assert.deepEqual(firstClose,{status:'closed',sessionId:'CS-000001',
      expected:150,counted:145,variance:-5});
    assert.deepEqual(await closeOwnerCashSession(scope(ownerA),input),{
      status:'replayed',sessionId:'CS-000001',expected:150,counted:145,variance:-5,
    });
    assert.equal((await first(a,'SELECT variance_paisa AS n FROM owner_mvp_cash_sessions')).n,-500);
    assert.equal((await first(a,'SELECT received_paisa AS n FROM owner_mvp_sale_cash_book')).n,15000);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,1);
    assert.equal((await first(a,"SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions WHERE status='Open'")).n,0);
  }finally{await close();}
});

test('SQL-time close guard blocks stale counted amount, revoked Owner grant and forged Shop; never closes on partial money',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);await seed(ownerA);
    const input={...identity(ownerA),operationId:crypto.randomUUID(),
      countedCash:'149.999',notes:'Ambiguous fraction'};
    assert.equal((await closeOwnerCashSession(scope(ownerA),input)).status,'invalid');
    const cross=await closeOwnerCashSession(scope(ownerB),input);
    assert.equal(cross.status,'denied');
    assert.equal((await first(a,"SELECT status FROM owner_mvp_cash_sessions")).status,'Open');
    await a.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.equal((await closeOwnerCashSession(scope(ownerA),{...input,countedCash:'150'})).status,'denied');
    assert.equal((await first(a,"SELECT status FROM owner_mvp_cash_sessions")).status,'Open');
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,1);
  }finally{await close();}
});
