import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const origin='https://a.example.test';
const cookieName='__Host-shererp-owner-session';

test('the existing Add Product form saves one product in an empty D1 shop even when the successful response is lost',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-clean-shop-form-'));
  let harness,browser;
  try{
    harness=await startCleanShopHarness();
    const {ownerA,SHOP_A_DB,SHOP_B_DB}=harness;
    const built=await buildOwnerFrontend({outputDir:dir});
    const env={...ownerA.env,OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',OWNER_INGRESS:{limit:async()=>({success:true})},
      ASSETS:{async fetch(request){
        const path=resolve(dir,'.'+new URL(request.url).pathname);
        if(!path.startsWith(dir+sep))return new Response(null,{status:404});
        return readFile(path).then(bytes=>new Response(bytes),()=>new Response(null,{status:404}));
      }},
    };
    assert.equal(built.outputDir,dir);
    browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addCookies([{name:cookieName,value:ownerA.token,url:origin,secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();
    page.setDefaultTimeout(8000);
    const saves=[];
    await page.route('**/*',async route=>{
      const request=route.request();
      const url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      const headers=await request.allHeaders();
      const body=request.postData();
      const method=request.method();
      const reply=await ownerWorker.fetch(new Request(request.url(),{method,headers,...(body?{body}:{})}),env);
      if(method==='POST'&&url.pathname==='/api/owner/catalog'){
        saves.push({request:JSON.parse(body),status:reply.status});
        if(saves.length===1)return route.abort('failed');
      }
      return route.fulfill({status:reply.status,
        headers:Object.fromEntries(reply.headers),body:Buffer.from(await reply.arrayBuffer())});
    });
    const products=page.locator('#navList .nav-item[aria-label="Products"]');
    const add=page.locator('#prodAddBtn');
    const row=page.locator('#prodTableBody tr').filter({hasText:'Fixture wrench'});
    await page.goto(origin+'/app',{waitUntil:'domcontentloaded'});
    await products.click();
    await add.click({timeout:5000});
    await page.locator('#prodName').fill('Fixture wrench');
    await page.locator('#prodUnit + .touch-select-trigger').click();
    const unitOption=page.locator('#touchSelectMenuGlobal button').filter({hasText:'pcs'});
    await unitOption.waitFor();
    await unitOption.evaluate(button=>button.click());
    assert.equal(await page.locator('#prodUnit').inputValue(),'pcs');
    await page.locator('#prodPurchasePrice').fill('8.25');
    await page.locator('#prodSellingPrice').fill('12.50');
    assert.equal(await page.locator('#prodStock').inputValue(),'0');
    assert.equal(await page.locator('#prodStock').isDisabled(),true);
    await page.locator('#prodSaveBtn').click();
    await page.getByText('Could not confirm save. Retry Save Product.').waitFor();
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
    await page.locator('#prodSaveBtn').click();
    await row.waitFor();
    assert.match(await row.innerText(),/12\.50/);
    assert.deepEqual(saves.map(x=>x.status),[201,200]);
    assert.deepEqual(saves[0].request,saves[1].request);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
    assert.equal((await SHOP_B_DB.prepare('SELECT count(*) AS n FROM products').first()).n,0);
    await page.reload();
    await products.click();
    await row.waitFor();
    assert.equal(await row.count(),1);
  }finally{
    try{await browser?.close();}finally{
      try{await harness?.close();}finally{await rm(dir,{recursive:true,force:true});}
    }
  }
});
