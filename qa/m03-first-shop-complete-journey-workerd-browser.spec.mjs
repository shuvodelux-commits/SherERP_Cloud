/**
 * M03/M04 P0 cross-layer acceptance: the preserved Owner browser sends
 * product/supplier/purchase/POS/return writes to real local Workerd/D1.
 * Two physically distinct Shop D1s; no hosted credentials or deployment.
 * Does not claim the login-only production Worker enables these features.
 */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {issueOwnerSession} from '../src/auth/platform-owner-sessions.js';
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

for(const view of [
  {name:'desktop',width:1280,height:900,phone:false},
  {name:'compact phone',width:375,height:812,phone:true}
]){
test('original Owner browser completes Product → Supplier → Purchase → POS → Return against one real Shop D1 ('+view.name+')',async()=>{
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
    let salesConfiguration=env;
    const screenshots=process.env.SHERERP_SALES_SCREENSHOTS;
    async function captureSales(state){
      if(!screenshots||view.phone)return;
      await mkdir(screenshots,{recursive:true});
      for(const width of [320,390,768,1024,1440]){
        await page.setViewportSize({width,height:900});
        await page.screenshot({path:join(screenshots,`${width}-${state}.png`),animations:'disabled'});
      }
      await page.setViewportSize({width:view.width,height:view.height});
    }
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:view.width,height:view.height},timezoneId:'Asia/Dhaka'});
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
      }),url.pathname.startsWith('/api/owner/sales')?salesConfiguration:env);
      if(req.method()==='POST'||url.pathname==='/api/rpc')
        records.push({path:url.pathname,method:req.method(),status:response.status,
          ...(req.method()==='POST'&&body?{body:JSON.parse(body)}:{})});
      await route.fulfill({status:response.status,
        headers:Object.fromEntries(response.headers),
        body:Buffer.from(await response.arrayBuffer())});
    });

    await page.goto(ORIGIN+'/app',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!currentUser);
    await page.evaluate(()=>goToPage('sales'));
    if(process.env.SHERERP_SALES_BASELINE){
      await captureSales('before');
      return;
    }
    await page.getByText('No invoices have been saved in this Shop.').waitFor({timeout:4000});
    await captureSales('empty');
    assert.doesNotMatch(await page.locator('#owner-data-notice').textContent(),/Business data is not connected/);
    if(view.phone) await page.locator('#mobileBottomNav [data-mobile-page="products"]').click();
    else await page.locator('#navList .nav-item[aria-label="Products"]').click();
    await page.locator('#prodAddBtn').click();
    await page.locator('#prodName').fill('Complete Journey Pipe');
    await page.locator('#prodUnit + .touch-select-trigger').click();
    await page.locator('#touchSelectMenuGlobal button').filter({hasText:'pcs'}).evaluate(button=>button.click());
    await page.locator('#prodPurchasePrice').fill('60.00');
    await page.locator('#prodSellingPrice').fill('75.00');
    await page.locator('#prodSaveBtn').click();
    await page.locator('#prodTableBody tr').filter({hasText:'Complete Journey Pipe'}).waitFor();
    assert.equal((await a.prepare('SELECT count(*) AS n FROM products').first()).n,1);

    if(view.phone){
      await page.locator('#mobileBottomNav [data-mobile-page="more"]').click();
      await page.locator('#mobileMoreList [data-mobile-target="suppliers"]').click();
    }else await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
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

    if(view.phone){
      await page.locator('#mobileBottomNav [data-mobile-page="more"]').click();
      await page.locator('#mobileMoreList [data-mobile-target="purchase"]').click();
    }else await page.locator('#navList .nav-item[aria-label="Purchases"]').click();
    await page.locator('#owner-purchase-start-day').click();
    await page.waitForFunction(()=>document.getElementById('owner-purchase-day-state')
      ?.textContent?.includes('Day Open'));
    // Do not bypass the original Purchase UI with a direct serverCall:
    // exercise supplier combobox, inline cart, confirmation and D1 POST.
    await page.locator('#purSupplierSearch').fill('Complete Journey Supplier');
    await page.locator('#purSupplierResults [role="option"]').filter({
      hasText:'Complete Journey Supplier'
    }).first().click();
    assert.equal(await page.locator('#purSupplier').inputValue(),'SUP-000001');
    await page.locator('#purCartList [data-pur-product-input][data-pur-product-mode="add"]')
      .fill('Complete Journey Pipe');
    await page.locator('#purCartProductPopup [data-pur-product-pick="PRD-000001"]').click();
    await page.locator('#purCartList input[data-f="qty"]').first().fill('10');
    await page.locator('#purNotes').fill('Original browser to real D1');
    await page.locator('#purSubmitBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    await page.locator('#confirmActionConfirm').click();
    await page.waitForFunction(()=>document.getElementById('purCartCount')?.textContent==='0');
    assert.equal(records.filter(x=>x.path==='/api/owner/purchases'&&x.method==='POST').length,1);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_purchase_receipts').first()).n,1);
    await page.locator('#page-purchase .tab-btn[data-tab="purHistory"]').click();
    await page.locator('#purHistRefreshBtn').click();
    await page.locator('#purHistoryBody').getByText('PUR-000001').waitFor();

    if(view.phone) await page.locator('#mobileBottomNav [data-mobile-page="pos"]').click();
    else await page.locator('#navList .nav-item[aria-label="POS"]').click();
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
    // The original mobile POS uses Customer/Payment tabs. The approved
    // HisabIQ Owner layout keeps those old tabs hidden and exposes the
    // original inputs directly; exercise whichever navigation is visible,
    // never force-click a hidden legacy tab or bypass the real D1 writer.
    if(view.phone){
      const customerTab=page.locator('#page-pos [data-pos-v2-tab="customer"]');
      if(await customerTab.isVisible())await customerTab.click();
    }
    assert.equal(await page.locator('#posCustomerName').isVisible(),true);
    assert.equal(await page.locator('#posCustomerPhone').isVisible(),true);
    await page.locator('#posCustomerName').fill('Walk-in Tester');
    await page.locator('#posCustomerPhone').fill('01712345678');
    if(view.phone){
      const paymentTab=page.locator('#page-pos [data-pos-v2-tab="payment"]');
      if(await paymentTab.isVisible())await paymentTab.click();
    }
    assert.equal(await page.locator('#posAmountReceived').isVisible(),true);
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

    await page.evaluate(()=>{closeModal('invoiceModal');goToPage('sales');});
    await page.locator('#smTableBody').getByText('INV-000001').waitFor({timeout:4000});
    await page.reload({waitUntil:'domcontentloaded'});
    if(view.phone) await page.locator('#mobileBottomNav [data-mobile-page="pos"]').waitFor();
    else await page.locator('#navList .nav-item[aria-label="POS"]').waitFor();
    const invoice=await page.evaluate(()=>serverCall('findInvoice','','INV-000001'));
    assert.equal(invoice.invoiceId,'INV-000001');
    assert.match(await page.evaluate(data=>renderInvoiceHtml_(data),invoice),/Complete Journey Pipe/);

    await page.evaluate(()=>goToPage('sales'));
    await page.locator('#smTableBody').getByText('INV-000001').waitFor();
    assert.match(await page.locator('#smTableBody').innerText(),/Partially Returned/);
    await captureSales('loaded');
    if(view.phone){
      const badges=await page.locator('#smTableBody td .badge').evaluateAll(items=>
        items.map(badge=>[getComputedStyle(badge).whiteSpace,badge.getBoundingClientRect().width]));
      assert.ok(badges.every(([wrap,width])=>wrap==='nowrap'&&width>20));
    }
    await page.locator('#smTableBody').getByRole('button',{name:'INV-000001',exact:true}).click();
    await page.locator('#smViewModal').waitFor();
    assert.match(await page.locator('#smViewProfit').innerText(),/15/);
    assert.equal(await page.locator('#smViewDeleteBtn').isVisible(),false);
    await captureSales('detail');
    await page.locator('#smViewModal .modal-close').click();
    salesConfiguration={...env,OWNER_MVP_CASH_RETURN_ENABLED:'false'};
    await page.locator('#smRefreshBtn').click();
    await page.locator('#smTableBody').getByRole('button',{name:'INV-000001',exact:true}).click();
    await page.locator('#smViewModal').waitFor();
    assert.equal(await page.locator('#smViewReturnBtn').isVisible(),false);
    await page.locator('#smViewModal .modal-close').click();

    salesConfiguration={...env,OWNER_MVP_POS_CASH_ENABLED:'false'};
    await page.locator('#refreshBtn').click();
    await page.getByText('Sales history is unavailable in this release.').waitFor();
    await page.locator('#refreshBtn:not(.spinning)').waitFor();
    assert.equal(await page.getByText('Refreshed.',{exact:true}).isVisible(),false);
    assert.equal(await page.locator('#smTableBody tr').count(),0);
    await captureSales('unavailable');
    salesConfiguration={...env,PLATFORM_PILOT_DB:b};
    await page.locator('#smRefreshBtn').click();
    await page.getByText('This Shop storage could not be verified. Contact your administrator.').waitFor();
    salesConfiguration={...env,PLATFORM_PILOT_DB:undefined};
    await page.locator('#smRefreshBtn').click();
    await page.getByText('Shop storage is unavailable. Contact your administrator.').waitFor();
    await captureSales('error');
    salesConfiguration=env;
    await page.evaluate(()=>{goToPage('dashboard');goToPage('sales');});
    await page.locator('#smTableBody').getByText('INV-000001').waitFor();

    const newToken=await issueOwnerSession(ownerA.env,{
      issuer:'https://accounts.google.com',subject:'fixture-owner-a'
    });
    assert.equal(typeof newToken,'string');
    await page.locator('#smRefreshBtn').click();
    await page.getByText('Your session expired. Sign in again.').waitFor();
    await context.addCookies([{name:OWNER_COOKIE,value:newToken,url:ORIGIN,
      secure:true,httpOnly:true,sameSite:'Strict'}]);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!currentUser);
    await page.evaluate(()=>goToPage('sales'));
    await page.locator('#smTableBody').getByText('INV-000001').waitFor();

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
}
