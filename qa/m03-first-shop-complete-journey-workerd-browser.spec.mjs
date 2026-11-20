/**
 * M03/M04 P0 cross-layer acceptance: the preserved Owner browser sends
 * product/supplier/purchase/POS/return writes to real local Workerd/D1.
 * Two physically distinct Shop D1s; no hosted credentials or deployment.
 * Does not claim the login-only production Worker enables these features.
 */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const ORIGIN='https://first-shop-browser.example.test';
const OWNER_COOKIE='__Host-shererp-owner-session';
const day=()=>new Date(Date.now()+6*60*60*1000).toISOString().slice(0,10);
const operationFiles=[
  'migrations/0002_party_identity.sql',
  'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
  'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
  'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
  'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql'
];
async function migrate(db){
  for(const path of operationFiles){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  }
}

test('original Owner browser creates a product, supplier, purchase, POS invoice and return against one real Shop D1',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-real-journey-'));
  let fixtures,browser;
  try{
    fixtures=await startCleanShopHarness();
    const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b}=fixtures;
    await migrate(a); await migrate(b);
    await buildOwnerFrontend({outputDir:dir});

    const env={...ownerA.env,
      OWNER_LOGIN_ENABLED:'true',
      OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_CATALOG_ENABLED:'true',
      OWNER_CLEAN_PRODUCTS_ENABLED:'true',
      OWNER_WRITE_GRANTS_ENABLED:'true',
      OWNER_MVP_PURCHASE_ENABLED:'true',
      OWNER_MVP_POS_CASH_ENABLED:'true',
      OWNER_MVP_CASH_RETURN_ENABLED:'true',
      OWNER_AUTH_ORIGIN:ORIGIN,
      PLATFORM_AUTH_ORIGIN:'https://admin-fixture.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{limit:async()=>({success:true})},
      ASSETS:{async fetch(request){
        const path=resolve(dir,'.'+new URL(request.url).pathname);
        if(!path.startsWith(dir+sep))return new Response(null,{status:404});
        return readFile(path).then(data=>new Response(data),()=>new Response(null,{status:404}));
      }}
    };
    const records=[];
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Dhaka'});
    await context.addCookies([{name:OWNER_COOKIE,value:ownerA.token,url:ORIGIN,
      secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();
    page.setDefaultTimeout(11000);
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==ORIGIN)return route.abort();
      const headers=await req.allHeaders(),body=req.postData();
      const response=await ownerWorker.fetch(new Request(req.url(),{
        method:req.method(),headers,...(body?{body}:{})
      }),env);
      if(req.method()==='POST'||url.pathname==='/api/rpc')
        records.push({path:url.pathname,method:req.method(),status:response.status,
          ...(req.method()==='POST'&&body?{body:JSON.parse(body)}:{})});
      await route.fulfill({status:response.status,
        headers:Object.fromEntries(response.headers),
        body:Buffer.from(await response.arrayBuffer())});
    });

    await page.goto(ORIGIN+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="Products"]').click();
    await page.locator('#prodAddBtn').click();
    await page.locator('#prodName').fill('Complete Journey Pipe');
    await page.locator('#prodUnit + .touch-select-trigger').click();
    await page.locator('#touchSelectMenuGlobal button').filter({hasText:'pcs'}).evaluate(button=>button.click());
    await page.locator('#prodPurchasePrice').fill('60.00');
    await page.locator('#prodSellingPrice').fill('75.00');
    await page.locator('#prodSaveBtn').click();
    await page.locator('#prodTableBody tr').filter({hasText:'Complete Journey Pipe'}).waitFor();
    assert.equal((await a.prepare('SELECT count(*) AS n FROM products').first()).n,1);

    await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
    await page.locator('#supAddBtn').click();
    await page.locator('#supName').fill('Complete Journey Supplier');
    await page.locator('#supSaveBtn').click();
    await page.locator('#supTableBody tr').filter({hasText:'Complete Journey Supplier'}).waitFor();
    const supplierPosts=()=>records.filter(row=>row.path==='/api/owner/suppliers'&&row.method==='POST');
    assert.deepEqual(Object.keys(supplierPosts()[0].body).sort(),
      ['address','name','notes','openingBalance','operationId','phone'].sort(),
      'The original edit-only openingBalanceReason must not be sent to the strict create endpoint');
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_supplier_master').first()).n,1);
    const deniedHistorical=await page.evaluate(async()=>serverCall('addSupplier','',{
      name:'Do not post historical opening',phone:'',address:'',notes:'',
      openingBalance:'0',openingBalanceReason:'Manual historical opening'
    }).then(()=>null,error=>error.message));
    assert.match(deniedHistorical,/Historical opening balances are not connected/);
    assert.equal(supplierPosts().length,1,'Unsupported historical reason must never reach Shop API');

    await page.locator('#navList .nav-item[aria-label="Purchases"]').click();
    await page.locator('#owner-purchase-start-day').click();
    await page.waitForFunction(()=>document.getElementById('owner-purchase-day-state')
      ?.textContent?.includes('Day Open'));
    const purchased=await page.evaluate(async today=>
      serverCall('createPurchase','',{
        supplierId:'SUP-000001',date:today,backdatedReason:'',
        items:[{productId:'PRD-000001',name:'Complete Journey Pipe',
          qty:'10',unitPrice:'60.00',sellingPrice:'75.00'}],
        discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
        notes:'Original browser to real D1'
      }),day());
    assert.equal(purchased.purchaseId,'PUR-000001');
    assert.equal(purchased.dueAmount,600);
    await page.locator('#page-purchase .tab-btn[data-tab="purHistory"]').click();
    await page.locator('#purHistRefreshBtn').click();
    await page.locator('#purHistoryBody').getByText('PUR-000001').waitFor();

    await page.locator('#navList .nav-item[aria-label="POS"]').click();
    await page.waitForFunction(()=>typeof posState!=='undefined'&&
      posState.products?.some(row=>row.name==='Complete Journey Pipe'&&Number(row.stock)===10));
    await page.evaluate(()=>{
      const p=posState.products.find(row=>row.name==='Complete Journey Pipe');
      const line=posCreateCartLine_(p);
      line.qty=2;
      posApplyAutomaticPricing_(line);
      posState.cart=[line];
      posRenderCart_();
    });
    await page.locator('#posCustomerName').fill('Walk-in Tester');
    await page.locator('#posCustomerPhone').fill('01712345678');
    await page.locator('#posAmountReceived').fill('150');
    await page.locator('#posCompleteBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    await page.locator('#confirmActionConfirm').click();
    await page.waitForFunction(()=>posState._lastInvoice?.invoiceId==='INV-000001');
    assert.match(await page.locator('#invoicePaper').innerText(),/INV-000001/);

    const returned=await page.evaluate(async today=>
      serverCall('completeReturn','',{
        invoiceId:'INV-000001',
        items:[{productId:'PRD-000001',name:'Complete Journey Pipe',qty:1,price:75}],
        refundMethod:'Cash',reason:'First Shop browser return',notes:'',
        date:today,backdatedReason:''
      }),day());
    assert.equal(returned.returnId,'SRT-000001');
    assert.equal(returned.totalReturnAmount,75);
    assert.equal((await a.prepare('SELECT quantity_micro AS n FROM owner_mvp_product_stock').first()).n,9000000);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts').first()).n,1);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_return_receipts').first()).n,1);

    const money=await page.evaluate(async()=>{
      const response=await fetch('/api/owner/cash-book',{credentials:'same-origin'});
      return {status:response.status,body:await response.json()};
    });
    assert.equal(money.status,200);
    assert.equal(money.body.data.receivedPaisa,15000);
    assert.equal(money.body.data.paidPaisa,7500);
    assert.equal(money.body.data.netPaisa,7500);

    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="POS"]').waitFor();
    const invoice=await page.evaluate(()=>serverCall('findInvoice','','INV-000001'));
    assert.equal(invoice.invoiceId,'INV-000001');
    assert.match(await page.evaluate(data=>renderInvoiceHtml_(data),invoice),/Complete Journey Pipe/);

    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts').first()).n,0);
    const wrongShop=await ownerWorker.request(ORIGIN+'/api/owner/catalog',{
      headers:{Cookie:OWNER_COOKIE+'='+ownerB.token}
    },env);
    assert.equal(wrongShop.status,401);
    assert.equal(records.filter(x=>x.path==='/api/rpc').length,0);
    for(const endpoint of ['/api/owner/catalog','/api/owner/suppliers',
      '/api/owner/cash-session/start','/api/owner/purchases',
      '/api/owner/pos/sales','/api/owner/returns'])
      assert.equal(records.filter(x=>x.path===endpoint&&x.method==='POST'&&x.status<300).length,1,endpoint);
    assert.deepEqual(pageErrors,[]);
  }finally{
    await browser?.close();
    await fixtures?.close();
    await rm(dir,{recursive:true,force:true});
  }
});
