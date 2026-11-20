import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,postOwnerCreditPurchase,readOwnerCashSession}
  from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerCashReturn,readOwnerInvoiceForReturn,searchOwnerInvoicesForReturn}
  from '../../src/db/m03-owner-mvp-cash-return.js';

const scope=o=>pilotShopConfiguration(o.env);
const subject=o=>o.env.PLATFORM_PILOT_SHOP_ID;
const today=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
const auth=o=>({token:o.token,ownerSubject:subject(o)});
const first=(db,sql)=>db.prepare(sql).first();
async function migrate(db) {
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
    'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
  ]) {
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(part=>db.prepare(part)));
  }
}
async function seed(owner) {
  const ctx=auth(owner),shop=scope(owner);
  assert.equal((await createOwnerProduct(shop,{...ctx,input:{
    operationId:crypto.randomUUID(),name:'Real FIFO pipe',brand:'',
    category:'Pipes',unit:'pcs',purchasePrice:'60.00',
    sellingPrice:'75.00',stock:'0',minStock:'0',barcode:'',
    productType:'Standard',components:[]
  }})).status,'created');
  assert.equal((await createOwnerSupplier(shop,{...ctx,input:{
    operationId:crypto.randomUUID(),name:'Real Supplier',phone:'01712345678',
    address:'',notes:'',openingBalance:'0'
  }})).status,'created');
  assert.equal((await openOwnerCashSession(shop,{...ctx,
    operationId:crypto.randomUUID(),openingCash:'0',notes:'Return acceptance'})).status,'started');
  assert.equal((await postOwnerCreditPurchase(shop,{...ctx,
    operationId:crypto.randomUUID(),
    payload:{supplierId:'SUP-000001',date:today(),backdatedReason:'',
      items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:'10',
        unitPrice:'60.00',sellingPrice:'75.00'}],
      discount:'0',paidAmount:'0',paymentMethod:'Cash',
      bankAccountId:'',notes:'Return source lot'}
  })).status,'created');
  const checkout=await postOwnerCashSale(shop,{...ctx,operationId:crypto.randomUUID(),
    shopName:'Shop Return Acceptance',
    payload:{customerId:'',customerName:'Counter Buyer',customerPhone:'01712345678',
      customerFatherName:'',customerRelationType:'',customerAddress:'',
      items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:2,unitPrice:75,
        priceMode:'auto',shortageResolution:'negative',bundleRevision:0,
        productType:'Standard'}],
      discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',bankAccountId:''}
  });
  assert.equal(checkout.status,'created');
  return checkout.invoice;
}
const payload=(invoice,patch={})=>({
  invoiceId:invoice.invoiceId,
  items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:1,price:75}],
  refundMethod:'Cash',reason:'Customer returned',notes:'',date:today(),
  backdatedReason:'',...patch
});
const post=(owner,body,operationId=crypto.randomUUID())=>
  postOwnerCashReturn(scope(owner),{...auth(owner),operationId,payload:body});

test('real two-Shop D1 Cash Return restores EXACT original FIFO purchase lot, debits Cash once, and source SRT receipt replays',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);
    const invoice=await seed(ownerA);
    const start=await readOwnerInvoiceForReturn(a,invoice.invoiceId);
    assert.equal(start.items[0].soldQty,2);
    assert.equal(start.items[0].availableQty,2);
    assert.equal(start.cashRefundAvailable,150);
    assert.equal((await searchOwnerInvoicesForReturn(a,invoice.invoiceId))[0].invoiceId,invoice.invoiceId);
    const op=crypto.randomUUID(),body=payload(invoice);
    const result=await post(ownerA,body,op);
    assert.equal(result.status,'created');
    assert.equal(result.returnId,'SRT-000001');
    assert.equal(result.totalReturnAmount,75);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,9000000);
    assert.equal((await first(a,'SELECT quantity_micro AS n FROM owner_mvp_product_stock')).n,9000000);
    assert.equal((await first(a,'SELECT debit_paisa AS n FROM owner_mvp_return_cash_book')).n,7500);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,1);
    assert.equal((await readOwnerCashSession(a)).expectedCash,75);
    const after=await readOwnerInvoiceForReturn(a,invoice.invoiceId);
    assert.equal(after.items[0].previouslyReturnedQty,1);
    assert.equal(after.items[0].availableQty,1);
    assert.equal(after.cashRefundAvailable,75);
    const same=await post(ownerA,body,op);
    assert.equal(same.status,'replayed');
    assert.equal(same.returnId,result.returnId);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_return_cash_book')).n,1);
    assert.equal((await post(ownerA,payload(invoice,{reason:'changed'}),op)).status,'conflict');
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,0);
    assert.equal((await post(ownerB,body,crypto.randomUUID())).status,'denied');
  }finally{await close();}
});

test('real Shop D1 denies over-return, over-refund, bad actor, unsupported mode and concurrent final return',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await migrate(a);await migrate(b);
    const invoice=await seed(ownerA);
    const original=payload(invoice);
    assert.equal((await post(ownerA,payload(invoice,{refundMethod:'Store Credit'}))).status,'unsupported');
    assert.equal((await post(ownerA,payload(invoice,{items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:3,price:75}]}))).status,'declined');
    assert.equal((await post(ownerA,payload(invoice,{items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:1,price:76}]}))).status,'unsupported');
    const swapped=await postOwnerCashReturn(scope(ownerB),{...auth(ownerA),
      operationId:crypto.randomUUID(),payload:original});
    assert.equal(swapped.status,'denied');
    const results=await Promise.all([
      post(ownerA,payload(invoice,{items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:2,price:75}]})),
      post(ownerA,payload(invoice,{items:[{productId:'PRD-000001',name:'Real FIFO pipe',qty:2,price:75}]}))
    ]);
    assert.deepEqual(results.map(x=>x.status).sort(),['created','declined']);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,1);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,10000000);
    assert.equal((await readOwnerCashSession(a)).expectedCash,0);
  }finally{await close();}
});

test('real Shop D1 injected refund-Cash Book failure rolls back receipt, stock, lot and retry',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await migrate(a);
    const invoice=await seed(ownerA);
    await a.prepare("CREATE TRIGGER test_refund_fail BEFORE INSERT ON owner_mvp_return_cash_book BEGIN SELECT RAISE(ABORT,'injected return cash failure'); END").run();
    await assert.rejects(()=>post(ownerA,payload(invoice)),/injected return cash failure/);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,0);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,8000000);
    assert.equal((await first(a,'SELECT quantity_micro AS n FROM owner_mvp_product_stock')).n,8000000);
    assert.equal((await readOwnerCashSession(a)).expectedCash,150);
    await a.prepare('DROP TRIGGER test_refund_fail').run();
    assert.equal((await post(ownerA,payload(invoice))).status,'created');
  }finally{await close();}
});
