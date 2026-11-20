import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,postOwnerCreditPurchase,readOwnerCashSession}
  from '../../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale,readOwnerPosBootstrap,readOwnerCashSaleInvoice}
  from '../../src/db/m03-owner-mvp-cash-sale.js';

const origin='https://owner.example.test';
const scope=o=>pilotShopConfiguration(o.env);
const subject=o=>o.env.PLATFORM_PILOT_SHOP_ID;
const date=()=>new Date(Date.now()+6*60*60*1000).toISOString().slice(0,10);
const draftProduct=()=>({operationId:crypto.randomUUID(),name:'MVP pipe',brand:'',category:'Pipes',
  unit:'pcs',purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',minStock:'0',
  barcode:'',productType:'Standard',components:[]});
const draftSupplier=()=>({operationId:crypto.randomUUID(),name:'MVP supplier',phone:'01712345678',
  address:'',notes:'',openingBalance:'0'});
const sale=(overrides={})=>({
  customerId:'',customerName:'Counter Buyer',customerPhone:'01712345678',
  customerFatherName:'',customerRelationType:'',customerAddress:'',
  items:[{productId:'PRD-000001',name:'MVP pipe',qty:2,unitPrice:75,
    priceMode:'auto',shortageResolution:'negative',bundleRevision:0,productType:'Standard'}],
  discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',bankAccountId:'',
  ...overrides
});
async function apply(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
}
async function install(db){
  for(const path of [
    'migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
    'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
    'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  ])await apply(db,path);
}
async function prepare(owner,{units=10,price='75.00',open=true}={}){
  const auth={token:owner.token,ownerSubject:subject(owner)};
  assert.equal((await createOwnerProduct(scope(owner),{...auth,input:draftProduct()})).status,'created');
  assert.equal((await createOwnerSupplier(scope(owner),{...auth,input:draftSupplier()})).status,'created');
  if(open)assert.equal((await openOwnerCashSession(scope(owner),{...auth,
    operationId:crypto.randomUUID(),openingCash:'0',notes:'POS test Day'})).status,'started');
  if(units>0){
    assert.equal((await postOwnerCreditPurchase(scope(owner),{...auth,
      operationId:crypto.randomUUID(),
      payload:{supplierId:'SUP-000001',items:[{productId:'PRD-000001',name:'MVP pipe',
        qty:String(units),unitPrice:'60.00',sellingPrice:price}],
        date:date(),discount:'0',paidAmount:'0',paymentMethod:'Cash',
        bankAccountId:'',notes:'FIFO initial',backdatedReason:''}
    })).status,open?'created':'session-required');
  }
}
const post=(owner,input=sale(),operationId=crypto.randomUUID())=>
  postOwnerCashSale(scope(owner),{token:owner.token,ownerSubject:subject(owner),
    operationId,payload:input,shopName:'Verified Fixture Shop'});
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();

test('real Shop D1: one paid POS sale consumes original Purchase FIFO lot and posts one exact Cash Book row',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);await prepare(ownerA);await prepare(ownerB);
    const boot=await readOwnerPosBootstrap(a,{shopName:'Verified Fixture Shop'});
    assert.equal(boot.products[0].stock,10);
    assert.deepEqual(boot.products[0].lotPricing,[{qty:10,sellPrice:75}]);
    assert.equal(boot.activeSession.Status,'Open');
    assert.deepEqual(boot.customers,[]);
    const op=crypto.randomUUID(),raw=sale();
    const written=await post(ownerA,raw,op);
    assert.equal(written.status,'created');
    assert.equal(written.invoice.invoiceId,'INV-000001');
    assert.equal(written.invoice.grandTotal,150);
    assert.equal(written.invoice.paidAmount,150);
    assert.equal(written.invoice.customerName,'Counter Buyer');
    assert.equal(written.invoice.customerPhone,raw.customerPhone);
    assert.equal(written.invoice.shop.name,'Verified Fixture Shop');
    assert.equal(written.invoice.items[0].unit,'pcs');
    assert.equal((await first(a,"SELECT quantity_micro AS q FROM owner_mvp_product_stock WHERE product_id='PRD-000001'")).q,8000000);
    assert.equal((await first(a,"SELECT qty_micro AS q FROM owner_mvp_stock_lots WHERE product_id='PRD-000001'")).q,8000000);
    assert.equal((await first(a,'SELECT received_paisa AS n FROM owner_mvp_sale_cash_book')).n,15000);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,1);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM parties')).n,1,'walk-in cash does not create a customer Party');
    assert.equal((await readOwnerCashSession(a)).expectedCash,150);
    assert.deepEqual((await readOwnerCashSaleInvoice(a,'INV-000001')).items,written.invoice.items);
    assert.deepEqual(await post(ownerA,raw,op),{status:'replayed',invoice:written.invoice});
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,1);
    assert.equal((await post(ownerA,{...raw,customerName:'Changed buyer'},op)).status,'conflict');
    assert.equal((await first(a,'SELECT quantity_micro AS q FROM owner_mvp_product_stock')).q,8000000);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,0);
  }finally{await close();}
});

test('financial POST denies no Open Session, unauthorized Shop, oversell, edited quote and unsupported payment or item modes',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);await prepare(ownerA,{units:0,open:false});
    await prepare(ownerB,{units:2});
    assert.equal((await post(ownerA)).status,'session-required');
    const switched=await postOwnerCashSale(scope(ownerB),{token:ownerA.token,
      ownerSubject:subject(ownerA),operationId:crypto.randomUUID(),payload:sale(),shopName:'Other'});
    assert.equal(switched.status,'denied');
    assert.equal((await post(ownerB,sale({items:[{...sale().items[0],qty:3}],paidAmount:225}))).status,'declined');
    assert.equal((await post(ownerB,sale({items:[{...sale().items[0],unitPrice:74}],paidAmount:148}))).status,'unsupported');
    const unsupported=[
      {...sale(),paymentType:'Due',paidAmount:0},
      {...sale(),paymentMethod:'Bank',bankAccountId:'BANK-1'},
      {...sale(),payments:[{id:'cash',method:'Cash',accountId:'',amount:'150.00'}]},
      {...sale(),discount:1,paidAmount:149},
      {...sale(),items:[...sale().items,{...sale().items[0],productId:'PRD-000002'}]},
      {...sale(),items:[{...sale().items[0],productType:'Bundle'}]},
      {...sale(),items:[{...sale().items[0],shortageResolution:'vendor'}]},
      {...sale(),sourceDraftId:'DRF-1',sourceDraftVersion:1},
    ];
    for(const input of unsupported){
      const status=(await post(ownerB,input)).status;
      assert.ok(['unsupported','invalid'].includes(status),status);
    }
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,0);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,0);
  }finally{await close();}
});

test('two concurrent last-unit cash claims and Cash Book failure cannot double-post or half-write lot/receipt',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await install(a);await prepare(ownerA,{units:1});
    const input=sale({items:[{...sale().items[0],qty:1}],paidAmount:75});
    const [x,y]=await Promise.all([post(ownerA,input),post(ownerA,input)]);
    assert.deepEqual([x.status,y.status].sort(),['created','declined']);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,1);
    assert.equal((await first(a,'SELECT received_paisa AS n FROM owner_mvp_sale_cash_book')).n,7500);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,0);
  }finally{await close();}
  const second=await startCleanShopHarness();
  try{
    const a=second.SHOP_A_DB;
    await install(a);await prepare(second.ownerA,{units:1});
    await a.prepare(`CREATE TRIGGER fixture_cash_failure BEFORE INSERT ON owner_mvp_sale_cash_book
      BEGIN SELECT RAISE(ABORT,'fixture_cash_failure'); END`).run();
    await assert.rejects(post(second.ownerA,sale({items:[{...sale().items[0],qty:1}],paidAmount:75})),
      /fixture_cash_failure/);
    assert.equal((await first(a,'SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts')).n,0);
    assert.equal((await first(a,'SELECT quantity_micro AS n FROM owner_mvp_product_stock')).n,1000000);
    assert.equal((await first(a,'SELECT qty_micro AS n FROM owner_mvp_stock_lots')).n,1000000);
  }finally{await second.close();}
});

test('private Owner API serves original POS shape + saved invoice; denies foreign Owner, unauthorized route and posted replay',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);await prepare(ownerA);await prepare(ownerB);
    const {default:worker}=await import('../../src/m03-owner-redemption-worker.js');
    const env=o=>({...o.env,OWNER_LOGIN_ENABLED:'true',OWNER_CLEAN_PRODUCTS_ENABLED:'true',
      OWNER_WRITE_GRANTS_ENABLED:'true',OWNER_MVP_PURCHASE_ENABLED:'true',
      OWNER_MVP_POS_CASH_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{limit:async()=>({success:true})}});
    const request=(o,path,{body,token=o.token,enabled=true}={})=>
      worker.request(origin+path,{method:body?'POST':'GET',
        headers:{Cookie:'__Host-shererp-owner-session='+token,
          ...(body?{Origin:origin,'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})},
      {...env(o),OWNER_MVP_POS_CASH_ENABLED:String(enabled)});
    assert.equal((await request(ownerA,'/api/owner/pos/bootstrap',{enabled:false})).status,404);
    assert.equal((await request(ownerA,'/api/owner/pos/bootstrap',{token:ownerB.token})).status,401);
    const boot=await request(ownerA,'/api/owner/pos/bootstrap');
    assert.equal(boot.status,200);
    assert.equal((await boot.json()).data.products[0].stock,10);
    const input={operationId:crypto.randomUUID(),payload:sale()};
    const firstPost=await request(ownerA,'/api/owner/pos/sales',{body:input});
    assert.equal(firstPost.status,201);
    assert.equal((await firstPost.json()).data.invoiceId,'INV-000001');
    assert.equal((await request(ownerA,'/api/owner/pos/sales',{body:input})).status,200);
    const invoice=await request(ownerA,'/api/owner/pos/invoices/INV-000001');
    assert.equal((await invoice.json()).data.grandTotal,150);
    assert.equal((await request(ownerB,'/api/owner/pos/invoices/INV-000001')).status,404);
    assert.equal((await first(b,'SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book')).n,0);
  }finally{await close();}
});
