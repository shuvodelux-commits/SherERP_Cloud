import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import ownerWorker from '../../src/m03-owner-redemption-worker.js';

/**
 * Synthetic, disposable Workerd/D1 HTTP acceptance through the existing
 * original Owner routes. No actual Cloudflare account, Admin first-run,
 * multi-shop provisioning, or production financial release is asserted.
 */
const ORIGIN='https://shop-pilot.example.test';
const day=()=>new Date(Date.now()+6*60*60*1000).toISOString().slice(0,10);
const flags=Object.freeze({
  OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
  OWNER_GMAIL_SIGNUP_ENABLED:'false',OWNER_CATALOG_ENABLED:'true',
  OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_WRITE_GRANTS_ENABLED:'true',
  OWNER_MVP_PURCHASE_ENABLED:'true',OWNER_MVP_POS_CASH_ENABLED:'true',
  OWNER_MVP_CASH_RETURN_ENABLED:'true'
});
const runtime=owner=>({
  ...owner.env,...flags,
  OWNER_AUTH_ORIGIN:ORIGIN,PLATFORM_AUTH_ORIGIN:'https://admin-pilot.example.test',
  PLATFORM_OWNER_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  OWNER_INGRESS:{limit:async()=>({success:true})}
});
const request=(owner,path,{body,token=owner.token,config=runtime(owner)}={})=>
  ownerWorker.request(ORIGIN+path,{
    method:body===undefined?'GET':'POST',
    headers:{
      Cookie:'__Host-shererp-owner-session='+token,
      ...(body===undefined?{}:{Origin:ORIGIN,'Content-Type':'application/json'})
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  },config);
async function expectJson(owner,path,expectedStatus,body){
  const response=await request(owner,path,{body});
  const json=await response.json();
  assert.equal(response.status,expectedStatus,path+': '+JSON.stringify(json).slice(0,300));
  return json;
}
const first=(db,sql)=>db.prepare(sql).first();

async function installOperations(db){
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
    'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql'
  ]){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(stmt=>db.prepare(stmt)));
  }
}

const product=()=>({
  operationId:crypto.randomUUID(),name:'HTTP Test Pipe',brand:'',
  category:'Pipes',unit:'pcs',purchasePrice:'60.00',sellingPrice:'75.00',
  stock:'0',minStock:'0',barcode:'',productType:'Standard',components:[]
});
const supplier=()=>({
  operationId:crypto.randomUUID(),name:'HTTP Test Supplier',phone:'01712345678',
  address:'',notes:'',openingBalance:'0'
});
const purchase=()=>({
  operationId:crypto.randomUUID(),
  payload:{
    supplierId:'SUP-000001',date:day(),backdatedReason:'',
    items:[{productId:'PRD-000001',name:'HTTP Test Pipe',qty:'10',
      unitPrice:'60.00',sellingPrice:'75.00'}],
    discount:'0',paidAmount:'0',paymentMethod:'Cash',
    bankAccountId:'',notes:'HTTP end-to-end stock'
  }
});
const sale=()=>({
  operationId:crypto.randomUUID(),
  payload:{
    customerId:'',customerName:'Walk-in',customerPhone:'01712345678',
    customerFatherName:'',customerRelationType:'',customerAddress:'',
    items:[{productId:'PRD-000001',name:'HTTP Test Pipe',qty:2,
      unitPrice:75,priceMode:'auto',shortageResolution:'negative',
      bundleRevision:0,productType:'Standard'}],
    discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',bankAccountId:''
  }
});
const refund=invoiceId=>({
  operationId:crypto.randomUUID(),
  payload:{
    invoiceId,items:[{productId:'PRD-000001',name:'HTTP Test Pipe',qty:1,price:75}],
    refundMethod:'Cash',reason:'Customer returned',notes:'',
    date:day(),backdatedReason:''
  }
});

test('isolated first-Shop Owner HTTP lifecycle: product → supplier → purchase → FIFO POS → cash return → readbacks',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await installOperations(a);
    await installOperations(b);
    // A signed-out visitor must not obtain business records, even with all
    // the synthetic test flags enabled. Flags never grant identity.
    assert.equal((await request(ownerA,'/api/owner/catalog',{token:'0'.repeat(64)})).status,401);
    assert.equal((await request(ownerA,'/api/owner/pos/bootstrap',{
      config:{...runtime(ownerA),OWNER_MVP_POS_CASH_ENABLED:'false'}
    })).status,404);

    const initial=await expectJson(ownerA,'/api/owner/catalog',200);
    assert.deepEqual(initial.data,[]);
    const initialPurchases=await expectJson(ownerA,'/api/owner/purchases',200);
    assert.deepEqual(initialPurchases.data,[]);

    const createdProduct=await expectJson(ownerA,'/api/owner/catalog',201,product());
    assert.equal(createdProduct.data.id,'PRD-000001');
    const createdSupplier=await expectJson(ownerA,'/api/owner/suppliers',201,supplier());
    assert.equal(createdSupplier.data.id,'SUP-000001');
    const opening=await expectJson(ownerA,'/api/owner/cash-session/start',201,{
      operationId:crypto.randomUUID(),openingCash:'0',notes:'First Shop Day'
    });
    assert.equal(opening.data.sessionId,'CS-000001');

    const buying=purchase();
    const bought=await expectJson(ownerA,'/api/owner/purchases',201,buying);
    assert.equal(bought.data.purchaseId,'PUR-000001');
    assert.equal(bought.data.dueAmount,600);
    assert.equal((await expectJson(ownerA,'/api/owner/purchases',200,buying)).data.purchaseId,'PUR-000001');

    const stocked=await expectJson(ownerA,'/api/owner/pos/bootstrap',200);
    assert.equal(stocked.data.products[0].stock,10);
    const checkout=sale();
    const sold=await expectJson(ownerA,'/api/owner/pos/sales',201,checkout);
    assert.equal(sold.data.invoiceId,'INV-000001');
    assert.equal(sold.data.grandTotal,150);
    assert.equal((await expectJson(ownerA,'/api/owner/pos/sales',200,checkout)).data.invoiceId,'INV-000001');

    const invoice=await expectJson(ownerA,'/api/owner/pos/invoices/INV-000001',200);
    assert.equal(invoice.data.items[0].qty,2);
    const returnReceipt=refund(sold.data.invoiceId);
    const returned=await expectJson(ownerA,'/api/owner/returns',201,returnReceipt);
    assert.equal(returned.data.returnId,'SRT-000001');
    assert.equal(returned.data.totalReturnAmount,75);
    assert.equal((await expectJson(ownerA,'/api/owner/returns',200,returnReceipt)).data.returnId,'SRT-000001');

    const cashBook=await expectJson(ownerA,'/api/owner/cash-book',200);
    assert.equal(cashBook.data.scope,'cash-sale-and-cash-return-only');
    assert.equal(cashBook.data.receivedPaisa,15000);
    assert.equal(cashBook.data.paidPaisa,7500);
    assert.equal(cashBook.data.netPaisa,7500);
    assert.equal(cashBook.data.entries.length,2);
    assert.deepEqual(
      cashBook.data.entries.map(row=>[row.kind,row.reference,row.receivedPaisa,row.paidPaisa]).sort((a,b)=>a[0].localeCompare(b[0])),
      [['Cash Sale','INV-000001',15000,0],['Cash Return','SRT-000001',0,7500]]
    );
    assert.equal(cashBook.data.hasMore,false);
    const ledger=await expectJson(ownerA,'/api/owner/suppliers/SUP-000001/ledger',200);
    assert.equal(ledger.data.scope,'purchase-credit-only');
    assert.equal(ledger.data.supplierId,'SUP-000001');
    assert.equal(ledger.data.currentDuePaisa,60000);
    assert.equal(ledger.data.entries.length,1);
    assert.equal(ledger.data.entries[0].reference,'PUR-000001');
    assert.equal(ledger.data.entries[0].debitPaisa,60000);
    assert.equal(ledger.data.hasMore,false);
    assert.equal((await request(ownerA,'/api/owner/suppliers/SUP-999999/ledger')).status,404);
    assert.equal((await request(ownerA,'/api/owner/suppliers/INVALID/ledger')).status,404);
    assert.equal((await request(ownerA,'/api/owner/cash-book',{token:ownerB.token})).status,401);
    assert.equal((await request(ownerA,'/api/owner/suppliers/SUP-000001/ledger',{
      token:ownerB.token
    })).status,401);
    assert.equal((await request(ownerA,'/api/owner/cash-book',{
      config:{...runtime(ownerA),OWNER_MVP_CASH_RETURN_ENABLED:'false'}
    })).status,404);
    assert.equal((await request(ownerA,'/api/owner/suppliers/SUP-000001/ledger',{
      config:{...runtime(ownerA),OWNER_MVP_PURCHASE_ENABLED:'false'}
    })).status,404);

    const catalog=await expectJson(ownerA,'/api/owner/catalog',200);
    assert.equal(catalog.data[0].stock,9);
    const after=await expectJson(ownerA,'/api/owner/cash-session',200);
    assert.equal(after.data.expectedCash,75);
    assert.equal((await first(a,'SELECT current_due_paisa AS n FROM owner_supplier_master')).n,60000);
    assert.equal((await first(a,'SELECT debit_paisa AS n FROM owner_mvp_supplier_ledger')).n,60000);
    assert.equal((await first(a,'SELECT quantity_micro AS n FROM owner_mvp_product_stock')).n,9000000);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,9000000);
    assert.equal((await first(a,'SELECT received_paisa AS n FROM owner_mvp_sale_cash_book')).n,15000);
    assert.equal((await first(a,'SELECT debit_paisa AS n FROM owner_mvp_return_cash_book')).n,7500);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,1);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,1);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM parties')).n,1,
      'Walk-in cash sale does not create an artificial customer Party');

    // Shop B and swapped authentication must reveal neither Shop A's
    // catalog, invoice nor movements.
    const shopB=await expectJson(ownerB,'/api/owner/catalog',200);
    assert.deepEqual(shopB.data,[]);
    assert.equal((await request(ownerB,'/api/owner/pos/invoices/INV-000001')).status,404);
    assert.equal((await request(ownerA,'/api/owner/pos/invoices/INV-000001',{
      token:ownerB.token
    })).status,401);
    const otherCash=await expectJson(ownerB,'/api/owner/cash-book',200);
    assert.equal(otherCash.data.entries.length,0);
    assert.equal(otherCash.data.receivedPaisa,0);
    assert.equal(otherCash.data.paidPaisa,0);
    assert.equal((await request(ownerB,'/api/owner/suppliers/SUP-000001/ledger')).status,404);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,0);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts')).n,0);
  }finally{await close();}
});

test('first-Shop operational mode never activates from the Owner-login-only production profile',async()=>{
  const {buildShopUserDeployment}=await import('../../scripts/build-shop-user-deploy.mjs');
  const args={
    WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',
    SHERERP_OWNER_LOGIN_RELEASE:'OWNER_LOGIN_ONLY_APPROVED',
    SHERERP_ACCOUNT_ID:'0123456789abcdef0123456789abcdef',
    SHERERP_CONTROL_DB_NAME:'control-fixture',
    SHERERP_CONTROL_DB_ID:'11111111-1111-4111-8111-111111111111',
    SHERERP_SHOP_DB_NAME:'shop-fixture',
    SHERERP_SHOP_DB_ID:'22222222-2222-4222-8222-222222222222',
    SHERERP_SHOP_ID:'33333333-3333-4333-8333-333333333333',
    SHERERP_SHOP_MARKER:'44444444-4444-4444-8444-444444444444',
    SHERERP_OWNER_GOOGLE_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
    SHERERP_OWNER_RATE_LIMIT_NAMESPACE:'654322'
  };
  const conf=buildShopUserDeployment(args);
  for(const flag of ['OWNER_WRITE_GRANTS_ENABLED','OWNER_CLEAN_PRODUCTS_ENABLED',
    'OWNER_MVP_PURCHASE_ENABLED','OWNER_MVP_POS_CASH_ENABLED',
    'OWNER_MVP_CASH_RETURN_ENABLED'])assert.equal(conf.vars[flag],'false',flag);
});
