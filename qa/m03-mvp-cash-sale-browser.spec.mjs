/**
 * Original-preserved Owner ERP browser acceptance on LOCAL real Workerd/D1.
 * This is the original POS button → confirmation → private Sale POST → print
 * renderer; no fake RPC, mock transaction, hosted D1 or preview deployment.
 */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../src/db/m03-owner-supplier-create.js';
import {openOwnerCashSession,postOwnerCreditPurchase} from '../src/db/m03-owner-mvp-purchase.js';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const origin='https://mvp-owner.example.test';
const cookie='__Host-shererp-owner-session';
async function migrate(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(x=>db.prepare(x)));
}
const today=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);

test('original POS checkout button and invoice renderer post ONE real saved D1 cash receipt; reprint after reload',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-cash-pos-mvp-'));
  let browser,harness;
  try{
    harness=await startCleanShopHarness();
    const {ownerA,SHOP_A_DB:a,SHOP_B_DB:b}=harness;
    for(const db of [a,b]){
      for(const path of [
        'migrations/0002_party_identity.sql',
        'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql',
        'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql',
        'staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql',
      ])await migrate(db,path);
    }
    const scope=pilotShopConfiguration(ownerA.env);
    const auth={token:ownerA.token,ownerSubject:ownerA.env.PLATFORM_PILOT_SHOP_ID};
    assert.equal((await createOwnerProduct(scope,{...auth,input:{
      operationId:crypto.randomUUID(),name:'MVP Copper Cable',unit:'pcs',category:'Electrical',
      brand:'',purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',minStock:'0',
      barcode:'',productType:'Standard',components:[],
    }})).status,'created');
    assert.equal((await createOwnerSupplier(scope,{...auth,input:{
      operationId:crypto.randomUUID(),name:'MVP Supplier',phone:'01712345678',
      openingBalance:'0',address:'',notes:'',
    }})).status,'created');
    assert.equal((await openOwnerCashSession(scope,{...auth,operationId:crypto.randomUUID(),
      openingCash:'0',notes:'POS original screen'})).status,'started');
    assert.equal((await postOwnerCreditPurchase(scope,{...auth,operationId:crypto.randomUUID(),
      payload:{supplierId:'SUP-000001',date:today(),backdatedReason:'',
        items:[{productId:'PRD-000001',name:'MVP Copper Cable',qty:'10',
          unitPrice:'60.00',sellingPrice:'75.00'}],
        discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
        notes:'Original POS stock'},
    })).status,'created');
    await buildOwnerFrontend({outputDir:dir});
    const requests=[];
    const env={...ownerA.env,
      OWNER_LOGIN_ENABLED:'true',OWNER_CLEAN_PRODUCTS_ENABLED:'true',
      OWNER_WRITE_GRANTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_MVP_PURCHASE_ENABLED:'true',OWNER_MVP_POS_CASH_ENABLED:'true',
      OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{limit:async()=>({success:true})},
      ASSETS:{async fetch(request){
        const path=resolve(dir,'.'+new URL(request.url).pathname);
        if(!path.startsWith(dir+sep))return new Response(null,{status:404});
        return readFile(path).then(data=>new Response(data),()=>new Response(null,{status:404}));
      }},
    };
    browser=await chromium.launch();
    const browserContext=await browser.newContext({viewport:{width:1280,height:900}});
    await browserContext.addCookies([{name:cookie,value:ownerA.token,url:origin,
      secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await browserContext.newPage();
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)return route.abort();
      const headers=await req.allHeaders(),body=req.postData();
      const res=await ownerWorker.fetch(new Request(req.url(),{
        method:req.method(),headers,...(body?{body}:{})
      }),env);
      if(url.pathname.includes('/api/owner/pos/'))requests.push({
        path:url.pathname,method:req.method(),status:res.status,
        ...(body?{body:JSON.parse(body)}:{})
      });
      return route.fulfill({status:res.status,
        headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
    });
    await page.goto(origin+'/app',{waitUntil:'domcontentloaded'});
    // Wait for the authenticated app shell's actual POS navigation. A
    // premature goToPage() races its asynchronous dashboard bootstrap.
    await page.locator('#navList .nav-item[aria-label="POS"]').click();
    await page.locator('#page-pos').waitFor({state:'visible'});
    await page.waitForFunction(()=>typeof posState!=='undefined'&&
      posState.products?.some(p=>p.name==='MVP Copper Cable'));
    await page.evaluate(()=>{
      const product=posState.products.find(x=>x.name==='MVP Copper Cable');
      const line=posCreateCartLine_(product);
      line.qty=2;
      posApplyAutomaticPricing_(line);
      posState.cart=[line];
      posRenderCart_();
    });
    await page.locator('#posCustomerName').fill('Counter Buyer');
    await page.locator('#posCustomerPhone').fill('01712345678');
    await page.locator('#posAmountReceived').fill('150');
    await page.locator('#posCompleteBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    await page.locator('#confirmActionConfirm').click();
    await page.waitForFunction(()=>posState._lastInvoice?.invoiceId==='INV-000001');
    assert.match(await page.locator('#invoicePaper').innerText(),/INV-000001/);
    const printed=await page.evaluate(()=>renderInvoiceHtml_(posState._lastInvoice));
    assert.match(printed,/Counter Buyer/);
    assert.match(printed,/MVP Copper Cable/);
    assert.equal(requests.filter(q=>q.path==='/api/owner/pos/sales'&&q.method==='POST').length,1);
    assert.equal(requests.find(q=>q.path==='/api/owner/pos/sales').status,201);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts').first()).n,1);
    assert.equal((await a.prepare('SELECT received_paisa AS value FROM owner_mvp_sale_cash_book').first()).value,15000);
    assert.equal((await a.prepare('SELECT quantity_micro AS stock FROM owner_mvp_product_stock').first()).stock,8000000);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_receipts').first()).n,0);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof serverCall==='function');
    const restored=await page.evaluate(()=>serverCall('findInvoice','', 'INV-000001'));
    assert.equal(restored.invoiceId,'INV-000001');
    assert.equal(restored.customerName,'Counter Buyer');
    assert.match(await page.evaluate(invoice=>renderInvoiceHtml_(invoice),restored),/INV-000001/);
    // Reopen the supplier through the original action menu after reloading the Shop.
    await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
    const supplierRow=page.locator('#supTableBody tr').filter({hasText:'MVP Supplier'});
    await supplierRow.getByRole('button',{name:/Actions/}).click();
    await page.getByRole('menuitem',{name:'View',exact:true}).click();
    await page.locator('#supDetailModal').waitFor({state:'visible'});
    assert.match(await page.locator('#supDetailName').innerText(),/MVP Supplier.*01712345678/);
    const payAmount=page.locator('#supPayAmount');
    if(await payAmount.isEnabled())await payAmount.fill('1');
    assert.equal(await page.locator('#supPaySaveBtn').isDisabled(),true);
    assert.equal(await page.locator('#supPaySettleFullBtn').isDisabled(),true);
    assert.match(await page.locator('#supDetailModal').innerText(),/credit purchases only|purchase[- ]only|unpaid purchases only|purchase ledger only/i);
    const purchaseAmount=await page.evaluate(()=>formatMoney(600));
    assert.equal(await page.locator('#supDetailDue').innerText(),'Credit '+purchaseAmount);
    const ledgerRow=page.locator('#supLedgerBody tr');
    assert.equal(await ledgerRow.count(),1);
    assert.equal(await ledgerRow.locator('td').nth(1).innerText(),'Purchase');
    assert.equal(await ledgerRow.locator('td').nth(2).innerText(),'PUR-000001');
    assert.equal(await ledgerRow.locator('td').nth(3).innerText(),purchaseAmount);
    assert.equal(await ledgerRow.locator('td').nth(4).innerText(),'');
    assert.equal(await ledgerRow.locator('td').nth(5).innerText(),purchaseAmount);
    assert.equal(errors.length,0,'original browser JS errors: '+errors.join(' | '));
  }finally{
    try{await browser?.close();}finally{
      try{await harness?.close();}finally{await rm(dir,{recursive:true,force:true});}
    }
  }
});
