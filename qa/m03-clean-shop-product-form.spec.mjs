import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import {validateOwnerSession} from '../src/auth/platform-owner-sessions.js';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {connectCleanShopFixtureForm} from './fixtures/clean-shop-product-form.mjs';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const origin='https://a.example.test';
const cookieName='__Host-shererp-owner-session';

test('the existing Add Product form saves one product in an empty D1 shop even when the successful response is lost',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-clean-shop-form-'));
  let harness,browser;
  try{
    harness=await startCleanShopHarness();
    const {worker,ownerA,SHOP_A_DB,SHOP_B_DB}=harness;
    const built=await buildOwnerFrontend({outputDir:dir});
    const html=connectCleanShopFixtureForm(await readFile(built.indexPath,'utf8'));
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
      if(url.pathname==='/app')return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/api/owner/auth/session'||url.pathname==='/api/owner/app-shell'){
        const token=headers.cookie?.split('; ').find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        const session=await validateOwnerSession(ownerA.env,token,{dashboard:true});
        if(!session)return route.fulfill({status:401,json:{error:'Owner session required'}});
        const json=url.pathname.endsWith('/session')?session:buildSourceAppShellData({shopName:session.dashboard.displayName,currencySymbol:''});
        return route.fulfill({status:200,json});
      }
      if(url.pathname==='/__clean_shop__/products'){
        const body=request.postData();
        const method=request.method();
        const reply=await worker.fetch(request.url(),{method,headers,...(body?{body}:{})});
        if(method==='POST'){
          saves.push({request:JSON.parse(body),status:reply.status});
          if(saves.length===1)return route.fulfill({status:503,json:{error:'Could not confirm save. Retry Save Product.'}});
        }
        return route.fulfill({status:reply.status,json:await reply.json()});
      }
      return route.fulfill({status:404,body:'Not found'});
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
