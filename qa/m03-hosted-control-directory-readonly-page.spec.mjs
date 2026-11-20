import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';

const origin='https://platform.example.test';
const shop={
  operationId:'c05997a3-f275-4769-b48b-7dfbb2e571a2',
  displayName:'Test Hardware Shop',
  shopId:'adfc1d44-a8cc-4659-94be-969ae7fc44a6',
  ownerEmail:'owner@gmail.com',status:'reserved',failedStage:null,
};

test('hosted Control Center shows read-only business directory without setup buttons',async t=>{
  const assets=new Map();
  for(const filename of ['index.html','platform-auth.css','platform-auth.js']){
    assets.set('/'+(filename==='index.html'?'':filename),
      await readFile('frontend/platform-auth/'+filename,'utf8'));
  }
  const browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const requests=[];
  await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    requests.push([route.request().method(),url.pathname]);
    if(url.pathname==='/api/platform/auth/session'){
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({role:'PlatformSuperAdmin',shopDirectoryEnabled:true})});
    }
    if(url.pathname==='/api/platform/shops/list'){
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({shops:[shop]})});
    }
    if(assets.has(url.pathname)){
      const kind=url.pathname.endsWith('.js')?'application/javascript'
        :url.pathname.endsWith('.css')?'text/css':'text/html';
      return route.fulfill({status:200,contentType:kind,body:assets.get(url.pathname)});
    }
    return route.fulfill({status:404});
  });
  await page.goto(origin+'/');
  await page.getByText(shop.displayName).waitFor();
  assert.equal(await page.locator('#business-roster').isVisible(),true);
  assert.equal(await page.getByText('Owner: '+shop.ownerEmail,{exact:false}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Resume setup for '+shop.displayName}).count(),0);
  assert.equal(await page.locator('#business-form').isVisible(),false);
  assert.equal(await page.locator('#business-pending-count').textContent(),'1');
  await page.getByRole('searchbox',{name:'Search recent businesses'}).fill('not-a-shop');
  await page.getByText(shop.displayName).waitFor({state:'hidden'});
  assert.equal(await page.getByText('No businesses match your filters.').count(),1);
  assert.equal(requests.some(([method,path])=>method==='POST'||path==='/api/platform/shops/resume'),false);
});
