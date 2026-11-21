import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {after,before,test} from 'node:test';
import {chromium} from 'playwright';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const session={role:'Owner',shopId:'22222222-2222-4222-8222-222222222222',
  dashboard:{displayName:'Fixture Machinery',dataAvailable:false}};
const appShell=buildSourceAppShellData({shopName:'Fixture Machinery',currencySymbol:'৳'}).data;
const products=[
  {id:'PRD-000001',name:'PVC Pipe 1 inch',unit:'pcs',category:'Plumbing',brand:'Best',stock:35,sellingPrice:420,autoSellingPrice:420},
  {id:'PRD-000002',name:'LED Bulb 12W',unit:'Box',category:'Electrical',brand:'Bright',stock:27,sellingPrice:1550,autoSellingPrice:1550},
  {id:'PRD-000003',name:'Wire Mesh Net',unit:'Gauge',category:'Hardware',brand:'Steel',stock:12,sellingPrice:180,autoSellingPrice:180},
  {id:'PRD-000004',name:'Cable 1m',unit:'Coil',category:'Electrical',brand:'Brand',stock:20,sellingPrice:2850,autoSellingPrice:2850}
];
let server,browser,root,dir,html,baseline,salePostCount=0;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'shererp-pos-qa-'));
  await buildOwnerFrontend({outputDir:dir});
  html=await readFile(join(dir,'owner-erp.html'),'utf8');
  baseline=html
    .replace(/<style id="hisabiq-pos-parity-styles">[\s\S]*?<\/style>\s*/,'')
    .replace(/<script type="module" id="hisabiq-pos-parity-controller">[\s\S]*?<\/script>\s*/,'');
  server=createServer((req,res)=>{
    void (async()=>{
      const u=new URL(req.url,'http://localhost');
      res.setHeader('Cache-Control','no-store');
      if(u.pathname==='/api/owner/auth/session'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify(session));return;
      }
      if(u.pathname==='/api/owner/app-shell'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,data:appShell}));return;
      }
      if(u.pathname==='/api/owner/pos/bootstrap'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,data:{products,customers:[],
          bankAccounts:[],vendors:[],vendorsAll:[],activeSession:null,
          recentDrafts:[],multiPaymentEnabled:false,showPurchasePrice:false,
          canViewCurrentInvoiceProfit:false}}));return;
      }
      if(u.pathname==='/api/owner/pos/drafts'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,data:[]}));return;
      }
      if(/\/api\/owner\/pos\/sales/.test(u.pathname) && req.method==='POST')salePostCount++;
      if(u.pathname.startsWith('/api/')){
        res.writeHead(404,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:'Fixture blocks other private calls'}));return;
      }
      if(u.pathname==='/baseline' || u.pathname==='/app'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end(u.pathname==='/baseline'?baseline:html);return;
      }
      const file=resolve(dir,'.'+u.pathname);
      if(!file.startsWith(resolve(dir)+'/')){res.writeHead(404);res.end();return;}
      try{
        const bytes=await readFile(file);
        const ext=extname(file);
        res.writeHead(200,{'Content-Type':ext==='.css'?'text/css':ext==='.js'||ext==='.mjs'?'text/javascript':'application/octet-stream'});
        res.end(bytes);
      }catch{res.writeHead(404);res.end();}
    })().catch(e=>{if(!res.headersSent)res.writeHead(500);res.end(e.message);});
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  root='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
});
after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(done=>server.close(done));
  if(dir)await rm(dir,{recursive:true,force:true});
});
async function visit(viewport,{before=false}={}){
  const page=await browser.newPage({viewport,reducedMotion:'reduce',hasTouch:viewport.width<=390});
  await page.route(/^https:\/\/(fonts|www.google)/,r=>r.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+(before?'/baseline':'/app'),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!document.querySelector('#navList .nav-item'));
  await page.evaluate(()=>goToPage('posv2'));
  await page.waitForFunction(()=>document.body.classList.contains('pos-v2-active'));
  await page.waitForFunction(()=>document.querySelectorAll('#posProductGrid .product-tile').length>=4);
  return {page,errors};
}
const folder=join(process.cwd(),'docs/reviews/m01-hisabiq-pos-ui-refine/images');
const sizes=[{width:320,height:760},{width:390,height:840},{width:768,height:1024},
  {width:1024,height:768},{width:1440,height:900}];
test('Owner POS composed screen remains visible at five source breakpoints and preserves price/cart UI',async t=>{
  await mkdir(folder,{recursive:true});
  const evidence=[];
  for(const viewport of sizes){
    await t.test(viewport.width+'px',async()=>{
      const {page,errors}=await visit(viewport);
      try{
        assert.equal(await page.locator('#posHisabiqHeader').count(),1);
        assert.equal(await page.locator('#posHisabiqInvoiceHead').count(),1);
        assert.ok(await page.locator('#posCartList [data-cart-product-mode="add"]').isVisible());
        assert.ok(await page.locator('#posProductGrid .product-tile').first().isVisible(),'quick product is visible');
        await page.locator('#posProductGrid .product-tile').first().click();
        await page.locator('#posProductGrid .product-tile').nth(1).click();
        await page.waitForFunction(()=>document.querySelectorAll('#posCartList .cart-row:not(.pos-cart-entry-row)').length>=2);
        const metrics=await page.evaluate(()=>{
          const el=id=>document.getElementById(id);
          const style=id=>getComputedStyle(el(id));
          const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom};};
          return {
            viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
            cart:box(document.querySelector('#page-pos .pos-cart-section')),
            quick:box(document.querySelector('#page-pos .pos-product-card')),
            checkout:box(document.querySelector('#page-pos .pos-customer-section')),
            cartRowCount:document.querySelectorAll('#posCartList .cart-row:not(.pos-cart-entry-row)').length,
            cartTotal:el('posGrandTotal')?.textContent,
            cartUnit:document.querySelector('#posCartList .c-unit')?.textContent,
            lineTotal:document.querySelector('#posCartList .c-line-total')?.textContent,
            completionLabel:el('posCompleteBtn')?.textContent,
            searchPresent:!!el('posSearch'), cartButton:!!el('posClearCartBtn'),
            parentLayout:style('page-pos').display,
            grid:getComputedStyle(document.querySelector('#page-pos .pos-layout')).gridTemplateAreas
          };
        });
        assert.ok(metrics.cartRowCount>=2,'two source products in cart');
        assert.ok(metrics.documentWidth<=viewport.width+2,'horizontal overflow: '+JSON.stringify(metrics));
        assert.ok(metrics.cart.width>0&&metrics.checkout.width>0);
        if(viewport.width<1024){
          assert.ok(metrics.cart.y<metrics.quick.y && metrics.quick.y<metrics.checkout.y,
            'mobile/tablet cart→quick→checkout: '+JSON.stringify(metrics));
        }else{
          assert.ok(Math.abs(metrics.cart.y-metrics.checkout.y)<30,'desktop cart/checkout split');
        }
        assert.ok(await page.locator('#posCompleteBtn').isVisible(),'checkout CTA visible');
        assert.ok(await page.locator('#posCartList .cart-remove').first().isVisible(),'cart remove visible');
        for(const id of ['posUpdateBanner','posDraftBanner','posDraftConflict']){
          assert.equal(await page.locator('#'+id).isVisible(),false,'hidden source banner '+id);
        }
        assert.deepEqual(errors,[],'JavaScript errors');
        await page.screenshot({path:join(folder,viewport.width+'-after.png'),fullPage:true});
        evidence.push({width:viewport.width,...metrics});
      }finally{await page.close();}
    });
  }
  await writeFile(join(process.cwd(),'docs/reviews/m01-hisabiq-pos-ui-refine/qa-results.json'),JSON.stringify(evidence,null,2));
  assert.equal(salePostCount,0,'visual QA cannot post any sale');
});
test('before vs after screenshots from actual compiled Owner shell',async()=>{
  await mkdir(folder,{recursive:true});
  for(const width of [390,1440]){
    const {page}=await visit({width,height:width===390?840:900},{before:true});
    try{
      await page.evaluate(()=>posAddToCart_(posState.products[0]));
      await page.screenshot({path:join(folder,width+'-before.png'),fullPage:true});
    }finally{await page.close();}
  }
});
test('Owner POS search button focuses real entry and preserves existing product workflow without RPC writes',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.locator('#posHisabiqHeader button.hisabiq-pos-search-trigger').click();
    const result=await page.evaluate(()=>({
      actual:document.activeElement?.getAttribute('data-cart-product-mode')||document.activeElement?.id,
      tags:Array.from(document.querySelectorAll('#posHisabiqHeader .hisabiq-pos-action-slot button')).map(x=>x.id)
    }));
    assert.ok(result.actual==='add'||result.actual==='posSearch','focus actual cart entry');
    assert.ok(result.tags.includes('v2DraftsBtn'),'original Drafts handler moved');
    assert.deepEqual(errors,[]);
    assert.equal(salePostCount,0);
  }finally{await page.close();}
});

test('mobile cart quantity and removal recalculate the unchanged source totals',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posProductGrid .product-tile').nth(1).click();
    assert.match(await page.locator('#posGrandTotal').innerText(),/1,970/);
    const qty=page.locator('#posCartList input[data-f="qty"]').first();
    await qty.fill('3');
    await qty.dispatchEvent('change');
    await page.waitForFunction(()=>document.getElementById('posGrandTotal')?.textContent?.includes('2,810'));
    assert.match(await page.locator('#posGrandTotal').innerText(),/2,810/);
    await page.locator('#posCartList .cart-remove').first().click();
    await page.waitForFunction(()=>document.getElementById('posGrandTotal')?.textContent?.includes('1,550'));
    assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').count(),1);
    assert.deepEqual(errors,[]);
    assert.equal(salePostCount,0,'cart editing cannot submit sale');
  }finally{await page.close();}
});

test('Owner POS route reactivation reuses one presentation layer and original Draft handler',async()=>{
  const {page,errors}=await visit({width:768,height:1024});
  try{
    await page.evaluate(()=>goToPage('dashboard'));
    await page.evaluate(()=>goToPage('posv2'));
    assert.equal(await page.locator('#posHisabiqHeader').count(),1);
    assert.equal(await page.locator('#posHisabiqInvoiceHead').count(),1);
    assert.equal(await page.locator('#v2DraftsBtn').count(),1);
    assert.ok(await page.locator('#v2DraftsBtn').isVisible());
    await page.locator('#v2DraftsBtn').click();
    await page.locator('#v2DraftsModal:not([hidden])').waitFor();
    assert.equal(salePostCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
