/** Real original Cash Session topbar -> Shop D1 guarded Close Day and Start Day. */
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
import {openOwnerCashSession,postOwnerCreditPurchase,readOwnerCashSession}
  from '../src/db/m03-owner-mvp-purchase.js';
import {postOwnerCashSale} from '../src/db/m03-owner-mvp-cash-sale.js';
import {postOwnerCashReturn} from '../src/db/m03-owner-mvp-cash-return.js';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const origin='https://mvp-cash-close.example.test';
const cookie='__Host-shererp-owner-session';
const today=()=>new Date(Date.now()+21600000).toISOString().slice(0,10);
async function migrate(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(x=>db.prepare(x)));
}
test('original Cash Session topbar closes counted Sale–Return cash and reopens with previous count',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-cash-close-mvp-'));
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
        'staging-migrations/shop-owner-write/0008_owner_mvp_cash_return.sql',
        'staging-migrations/shop-owner-write/0009_owner_mvp_cash_close.sql'
      ])await migrate(db,path);
    }
    const scope=pilotShopConfiguration(ownerA.env);
    const auth={token:ownerA.token,ownerSubject:ownerA.env.PLATFORM_PILOT_SHOP_ID};
    assert.equal((await createOwnerProduct(scope,{...auth,input:{
      operationId:crypto.randomUUID(),name:'Real Copper Wire',unit:'pcs',category:'Electrical',
      brand:'',purchasePrice:'60.00',sellingPrice:'75.00',stock:'0',
      minStock:'0',barcode:'',productType:'Standard',components:[]
    }})).status,'created');
    assert.equal((await createOwnerSupplier(scope,{...auth,input:{
      operationId:crypto.randomUUID(),name:'Real Supplier',phone:'01712345678',
      openingBalance:'0',address:'',notes:''
    }})).status,'created');
    assert.equal((await openOwnerCashSession(scope,{...auth,
      operationId:crypto.randomUUID(),openingCash:'0',notes:'original return browser'})).status,'started');
    assert.equal((await postOwnerCreditPurchase(scope,{...auth,operationId:crypto.randomUUID(),
      payload:{supplierId:'SUP-000001',date:today(),backdatedReason:'',
        items:[{productId:'PRD-000001',name:'Real Copper Wire',qty:'10',
          unitPrice:'60.00',sellingPrice:'75.00'}],
        discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
        notes:'Real source lot'}
    })).status,'created');
    const sale=await postOwnerCashSale(scope,{...auth,operationId:crypto.randomUUID(),
      shopName:'Browser Real Shop',payload:{
        customerId:'',customerName:'Walkin Refund',customerPhone:'01712345678',
        customerFatherName:'',customerRelationType:'',customerAddress:'',
        items:[{productId:'PRD-000001',name:'Real Copper Wire',qty:2,unitPrice:75,
          priceMode:'auto',shortageResolution:'negative',bundleRevision:0,
          productType:'Standard'}],
        discount:0,paymentType:'Cash',paidAmount:150,paymentMethod:'Cash',bankAccountId:''
      }});
    assert.equal(sale.status,'created');
    const refunded=await postOwnerCashReturn(scope,{...auth,operationId:crypto.randomUUID(),
      payload:{invoiceId:sale.invoice.invoiceId,
        items:[{productId:'PRD-000001',name:'Real Copper Wire',qty:1,price:75}],
        refundMethod:'Cash',reason:'Drawer test returned item',notes:'',
        date:today(),backdatedReason:''}});
    assert.equal(refunded.status,'created');
    assert.equal((await readOwnerCashSession(a)).expectedCash,75);
    await buildOwnerFrontend({outputDir:dir});
    const requests=[],env={...ownerA.env,
      OWNER_LOGIN_ENABLED:'true',OWNER_CLEAN_PRODUCTS_ENABLED:'true',
      OWNER_WRITE_GRANTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_MVP_PURCHASE_ENABLED:'true',OWNER_MVP_POS_CASH_ENABLED:'true',
      OWNER_MVP_CASH_RETURN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{limit:async()=>({success:true})},
      ASSETS:{async fetch(request){
        const path=resolve(dir,'.'+new URL(request.url).pathname);
        if(!path.startsWith(dir+sep))return new Response(null,{status:404});
        return readFile(path).then(data=>new Response(data),()=>new Response(null,{status:404}));
      }}
    };
    browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addCookies([{name:cookie,value:ownerA.token,url:origin,
      secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin)return route.abort();
      const headers=await req.allHeaders(),body=req.postData();
      const res=await ownerWorker.fetch(new Request(req.url(),{
        method:req.method(),headers,...(body?{body}:{})
      }),env);
      if(url.pathname.includes('/api/owner/cash-session'))requests.push({
        path:url.pathname,method:req.method(),status:res.status});
      return route.fulfill({status:res.status,
        headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
    });
    await page.goto(origin+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="POS"]').waitFor();
    await page.locator('#cashSessionToggleBtn').click();
    await page.locator('#posCloseSessionBtn').click();
    await page.locator('#posCloseExpected').waitFor({state:'visible'});
    assert.match(await page.locator('#posCloseExpected').innerText(),/75/);
    await page.locator('#posCountedCash').fill('74.50');
    await page.locator('#posCloseNote').fill('Original drawer count for MVP');
    await page.locator('#posCloseConfirmBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    // The static page starts with a Closed label before Owner bootstrap.
    // Wait for the actual completed POST, not merely the initial label.
    const closeResponsePromise=page.waitForResponse(response=>
      new URL(response.url()).pathname==='/api/owner/cash-session/close' &&
      response.request().method()==='POST');
    await page.locator('#confirmActionConfirm').click();
    const closeResponse=await closeResponsePromise;
    assert.equal(closeResponse.status(),200,JSON.stringify(await closeResponse.json()));
    await page.waitForFunction(()=>document.getElementById('cashSessionTopbarStatus')?.textContent==='Closed' &&
      posState.activeSession===null);
    const closeCalls=requests.filter(x=>x.path==='/api/owner/cash-session/close'&&x.method==='POST');
    assert.equal(closeCalls.length,1);
    assert.equal(closeCalls[0].status,200);
    const audited=await a.prepare('SELECT status,expected_paisa,counted_paisa,variance_paisa FROM owner_mvp_cash_sessions').first();
    assert.deepEqual([audited.status,audited.expected_paisa,audited.counted_paisa,audited.variance_paisa],
      ['Closed',7500,7450,-50]);
    assert.equal(await readOwnerCashSession(a),null);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,0);

    // The original topbar calls GET summary first and only then the
    // authorized opening suggestion. Prove both the real HTTP contract and
    // the value eventually displayed in the existing editable input.
    const openingResponsePromise=page.waitForResponse(response=>
      new URL(response.url()).pathname==='/api/owner/cash-session/next-opening' &&
      response.request().method()==='GET');
    await page.locator('#cashSessionToggleBtn').click();
    const openingResponse=await openingResponsePromise;
    assert.equal(openingResponse.status(),200);
    assert.equal((await openingResponse.json()).data.openingCash,74.5);
    await page.waitForFunction(()=>Number(document.getElementById('posOpeningCash')?.value)===74.5);
    await page.locator('#posStartSessionBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    const startResponsePromise=page.waitForResponse(response=>
      new URL(response.url()).pathname==='/api/owner/cash-session/start' &&
      response.request().method()==='POST');
    await page.locator('#confirmActionConfirm').click();
    const startResponse=await startResponsePromise;
    assert.equal(startResponse.status(),201,JSON.stringify(await startResponse.json()));
    await page.waitForFunction(()=>document.getElementById('cashSessionTopbarStatus')?.textContent==='Open' &&
      posState.activeSession?.Status==='Open');
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_cash_sessions').first()).n,2);
    assert.equal((await readOwnerCashSession(a)).openingCash,74.5);
    assert.equal((await readOwnerCashSession(a)).expectedCash,74.5);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_sale_cash_book').first()).n,1);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_mvp_return_cash_book').first()).n,1);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof serverCall==='function');
    const restored=await page.evaluate(()=>serverCall('getCashSessionSummary',''));
    assert.equal(restored.status,'Open');
    assert.equal(restored.openingCash,74.5);
    assert.equal(restored.expectedCash,74.5);
    assert.equal(errors.length,0,'Original Cash Session browser errors: '+errors.join(' | '));
  }finally{
    try{await browser?.close();}finally{
      try{await harness?.close();}finally{await rm(dir,{recursive:true,force:true});}
    }
  }
});
