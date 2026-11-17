import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Compiled-original-UI, loopback-only Playwright. No M03/D1 writes, checkout
// calls, public auth activation, or modifications to the pinned GAS source.
let browser,site;
before(async()=>{
  site=await serveCompiledUi();
  browser=await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
  });
});
after(async()=>{
  await browser?.close();
  await site?.close();
});

test('M03/M01 compiled POS V2 Add Product respects real visual permission across Chromium viewports',async t=>{
  const navItems=[
    {key:'dashboard',label:'Dashboard',icon:'dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',icon:'pos',sidebarGroup:0,sidebarOrder:20,
      landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
    {key:'products',label:'Products',icon:'products',sidebarGroup:1,sidebarOrder:30}
  ];
  for(const {width,height,phone,name} of [
    {width:320,height:640,phone:true,name:'phone'},
    {width:768,height:1024,phone:false,name:'tablet'},
    {width:1280,height:800,phone:false,name:'desktop'}
  ]){
    for(const allowed of [false,true]){
      await t.test(name+'-'+(allowed?'authorized':'denied'),async()=>{
        const page=await browser.newPage({
          viewport:{width,height},isMobile:phone,hasTouch:phone
        });
        const calls=[];
        try{
          await page.route('**/api/rpc',async route=>{
            const post=route.request().postDataJSON();
            calls.push(post?.fnName);
            if(post?.fnName!=='login' && post?.fnName!=='getAppShellData'){
              return route.continue();
            }
            const role={
              token:'c'.repeat(64),
              user:{id:'M01-CSS-POS-ONLY',name:'Synthetic POS Clerk',
                mobile:'01710000001',role:'Clerk'},
              allowedModules:allowed
                ?['dashboard','pos','products']:['dashboard','pos'],
              permissions:{
                dashboard:{view:true},pos:{view:true},
                ...(allowed?{products:{view:true,add:true}}:{})
              }
            };
            const data=post.fnName==='login'?role:{
              shopName:'Synthetic POS Visibility',currencySymbol:'৳',navItems
            };
            return route.fulfill({
              status:200,contentType:'application/json',
              body:JSON.stringify({success:true,data})
            });
          });
          await page.goto(site.url,{waitUntil:'domcontentloaded'});
          await page.locator('#loginOverlay:not([hidden])').waitFor();
          await page.locator('#loginMobile').fill('01710000001');
          await page.locator('#loginPassword').fill('m01-test-only');
          const login=page.waitForResponse(r=>r.url().endsWith('/api/rpc') &&
            r.request().postDataJSON()?.fnName==='login');
          await page.locator('#loginSubmitBtn').click();
          assert.equal((await login).status(),200);
          await page.waitForFunction(()=>
            document.getElementById('loginOverlay')?.hidden===true);
          if(phone){
            await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
          }else{
            await page.evaluate(()=>goToPage('pos'));
          }
          await page.waitForFunction(()=>
            currentPage==='posv2' &&
            document.body.classList.contains('pos-v2-active'));
          const button=page.locator('#v2AddProductBtn');
          await button.waitFor({state:'attached'});
          const actual=await page.evaluate(()=>{
            const b=document.getElementById('v2AddProductBtn');
            return {
              granted:hasActionPermission_('products','add'),
              hidden:b.hidden,
              display:getComputedStyle(b).display
            };
          });
          assert.equal(actual.granted,allowed,'synthetic Clerk role must match test');
          assert.equal(actual.hidden,!allowed,'source permission should toggle hidden');
          assert.equal(await button.isVisible(),allowed,
            'computed visibility must match products.add authority; '+JSON.stringify(actual));
          assert.equal(actual.display==='none',!allowed);
          const dir=join(process.cwd(),'test-results','m01-browser');
          await mkdir(dir,{recursive:true});
          await page.screenshot({
            path:join(dir,'posv2-css-'+name+'-'+(allowed?'allowed':'denied')+'.png'),
            fullPage:true
          });
          assert.equal(calls.filter(fn=>fn==='login').length,1);
          assert.equal(calls.some(fn=>/^(?:saveSale|postSale|completeSale)$/i.test(fn||'')),false);
        }finally{await page.close();}
      });
    }
  }
});
