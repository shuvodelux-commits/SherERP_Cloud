import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';

const origin='https://admin.example.test';
const shop={
  shopId:'dc31cd7b-1a0d-432b-9cc3-44765e707aba',
  operationId:'ada9f35f-fefc-4481-83b0-95f73a9a96e5',
  displayName:'Sher Hardware',ownerEmail:'owner@gmail.com',
  status:'ready',failedStage:null
};
const response=(route,body,status=200)=>route.fulfill({
  status,contentType:'application/json',
  body:JSON.stringify(body)
});

test('M03 hosted Admin opens and ends 5-minute read-only Support View for a ready Shop',async t=>{
  const assets=new Map();
  for(const file of ['index.html','platform-auth.css','platform-auth.js']){
    assets.set('/'+(file==='index.html'?'':file),
      await readFile('frontend/platform-auth/'+file,'utf8'));
  }
  const browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const calls=[];
  await page.route(origin+'/**',async route=>{
    const req=route.request();
    const path=new URL(req.url()).pathname;
    if(path==='/api/platform/auth/session')
      return response(route,{role:'PlatformSuperAdmin',
        shopDirectoryEnabled:true,supportDiagnosticsEnabled:true});
    if(path==='/api/platform/shops/list')return response(route,{shops:[shop]});
    if(path.startsWith('/api/platform/support/')){
      const body=JSON.parse(req.postData()||'{}');
      calls.push({path,method:req.method(),body});
      if(path.endsWith('/start'))return response(route,{
        status:'created',operationId:body.operationId,
        supportToken:'f'.repeat(64),expiresAtMs:Date.now()+300000
      },201);
      if(path.endsWith('/diagnostics'))return response(route,{
        status:'ok',shopId:shop.shopId,
        catalog:{status:'available',categories:3,units:5},
      });
      if(path.endsWith('/end'))return response(route,{status:'revoked'});
    }
    if(assets.has(path)){
      return route.fulfill({status:200,contentType:path.endsWith('.css')?'text/css':
        path.endsWith('.js')?'application/javascript':'text/html',body:assets.get(path)});
    }
    return route.fulfill({status:404});
  });
  await page.goto(origin+'/');
  const visit=page.getByRole('button',{name:'Visit '+shop.displayName+' for read-only support'});
  await visit.waitFor();
  assert.equal(await page.getByText('No Owner impersonation or financial edits.',{exact:false}).count(),1);
  assert.equal(calls.length,0,'opening the roster does not issue a grant');
  await visit.click();
  assert.equal(await page.getByRole('heading',{name:'Visit Shop for Support'}).isVisible(),true);
  const openErp=page.getByRole('link',{name:'Open actual Shop ERP · Read only'});
  assert.equal(await openErp.isVisible(),false,'ERP must not open before an audited grant');
  assert.equal(await page.locator('#support-selected').textContent(),
    'Business: '+shop.displayName+'. Read-only setup inspection.');
  await page.getByRole('textbox',{name:'Reason for read-only support'})
    .fill('Checking product categories after owner request');
  await page.getByRole('button',{name:'Start read-only support'}).click();
  await page.getByText('Categories: 3').waitFor();
  assert.equal(await page.getByText('Units: 5').isVisible(),true);
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.path),[
    '/api/platform/support/start','/api/platform/support/diagnostics']);
  assert.equal(calls[0].body.shopId,shop.shopId);
  assert.equal(calls[1].body.supportToken.length,64);
  assert.equal(await page.getByRole('button',{name:'End support'}).isVisible(),true);
  assert.equal(await openErp.isVisible(),true,'ready Shop now offers the actual ERP');
  assert.equal(await openErp.getAttribute('href'),'/support/erp');
  assert.equal(await openErp.getAttribute('target'),'_blank');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  await page.getByRole('button',{name:'End support'}).click();
  await page.getByText('Support session ended.').waitFor();
  assert.equal(calls.length,3);
  assert.equal(calls[2].path,'/api/platform/support/end');
  assert.equal(calls[2].body.operationId,calls[0].body.operationId);
  assert.equal(await page.getByText('Categories: 3').isVisible(),false);
  assert.equal(await openErp.isVisible(),false,'End Support must hide ERP access');
});
