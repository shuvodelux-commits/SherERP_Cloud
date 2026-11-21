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
const sizes=process.env.POS_QA_WIDTH==='390'?[{width:390,height:840}]:
  [{width:320,height:760},{width:390,height:840},{width:768,height:1024},
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
        assert.ok(await page.locator('#posCustomerName').isVisible(),'primary cash customer name visible');
        assert.ok(await page.locator('#posCustomerPhone').isVisible(),'primary cash customer phone visible');
        assert.ok(await page.locator('#posCartList [data-cart-product-mode="add"]').isVisible());
        assert.ok(await page.locator('#posProductGrid .product-tile').first().isVisible(),'quick product is visible');
        await page.locator('#posProductGrid .product-tile').first().click();
        await page.locator('#posProductGrid .product-tile').nth(1).click();
        await page.waitForFunction(()=>document.querySelectorAll('#posCartList .cart-row:not(.pos-cart-entry-row)').length>=2);
        const metrics=await page.evaluate(()=>{
          const el=id=>document.getElementById(id);
          const style=id=>getComputedStyle(el(id));
          const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
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
            grid:getComputedStyle(document.querySelector('#page-pos .pos-layout')).gridTemplateAreas,
            words:(()=>{
              const p=document.querySelector('#posHisabiqAmountWords p');
              if(!p)return null;
              return {text:p.textContent,display:getComputedStyle(p).display,
                visibility:getComputedStyle(p).visibility,rect:box(p),
                panelRect:box(p.parentElement),
                parentDisplay:getComputedStyle(p.parentElement).display,
                outer:p.parentElement.outerHTML.slice(0,500)};
            })(),
            overflowNodes:Array.from(document.querySelectorAll('body *')).map(e=>{
              const r=e.getBoundingClientRect();
              return {name:e.tagName.toLowerCase()+'#'+e.id+'.'+String(e.className||'').slice(0,60),
                x:r.x,right:r.right,width:r.width,height:r.height,
                display:getComputedStyle(e).display};
            }).filter(r=>r.right>innerWidth+2&&r.width>0&&r.height>0&&r.display!=='none')
              .slice(0,30)
          };
        });
        assert.ok(metrics.cartRowCount>=2,'two source products in cart');
        assert.match(metrics.words?.text||'',/One thousand nine hundred seventy taka only/i,
          'amount in words follows real cart total');
        assert.ok((metrics.words?.rect?.height||0)>10,'words helper is actually rendered: '+JSON.stringify(metrics.words));
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
        await page.evaluate(()=>window.scrollTo({left:0,top:0,behavior:'instant'}));
        await page.screenshot({path:join(folder,viewport.width+'-after.png'),fullPage:true});
        if(viewport.width===390||viewport.width===1440){
          await page.screenshot({path:join(folder,viewport.width+'-top-viewport.png'),fullPage:false});
          await page.locator('#posHisabiqPreviewButton').scrollIntoViewIfNeeded();
          await page.screenshot({path:join(folder,viewport.width+'-checkout-viewport.png'),fullPage:false});
        }
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
      await page.evaluate(()=>window.scrollTo({left:0,top:0,behavior:'instant'}));
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


test('HisabIQ checkout shows source-connected customer picker, sale modes and draft-preserving details',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    assert.equal(await page.locator('#posHisabiqSaleModes [data-sale-mode="installment"]').isDisabled(),true,
      'unconnected installment sale must not appear operational');
    assert.equal(await page.locator('#posHisabiqCustomerDetails').count(),1);
    await page.locator('#posHisabiqCustomerPicker').click();
    assert.equal(await page.locator('#posHisabiqCustomerDetails').getAttribute('open'),'');
    await page.locator('#posCustomerName').fill('Rahim');
    await page.locator('#posCustomerPhone').fill('01710000001');
    await mkdir(folder,{recursive:true});
    await page.locator('#posCustomerName').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(folder,'390-customer-details-viewport.png'),fullPage:false});
    await page.locator('#posHisabiqCustomerDetails summary').click();
    assert.equal(await page.locator('#posCustomerName').inputValue(),'Rahim');
    assert.equal(await page.locator('#posCustomerPhone').inputValue(),'01710000001');
    assert.deepEqual(errors,[]);
    assert.equal(salePostCount,0);
  }finally{await page.close();}
});

test('HisabIQ cash shortcuts use original payment totals, preview has no posting side effect',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posProductGrid .product-tile').nth(1).click();
    await page.locator('[data-pos-cash-shortcut="exact"]').click();
    assert.equal(await page.locator('#posAmountReceived').inputValue(),'1970');
    assert.equal(await page.locator('#posHisabiqPaymentStatus').getAttribute('data-due'),'0');
    await page.locator('[data-pos-cash-shortcut="2000"]').click();
    assert.equal(await page.locator('#posAmountReceived').inputValue(),'2000');
    assert.match(await page.locator('#posChangeDue').innerText(),/30/);
    await page.locator('#posHisabiqPreviewButton').click();
    assert.ok(await page.locator('#posHisabiqPreview[aria-modal="true"]').isVisible());
    assert.match(await page.locator('#posHisabiqPreview').innerText(),/PVC Pipe 1 inch/);
    assert.match(await page.locator('#posHisabiqPreview').innerText(),/1,970/);
    assert.equal(salePostCount,0);
    await mkdir(folder,{recursive:true});
    await page.screenshot({path:join(folder,'390-preview-viewport.png'),fullPage:false});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#posHisabiqPreview').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'posHisabiqPreviewButton');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('keyboard F2 focuses cart product picker and source readonly cash pilot does not allow Bank',async()=>{
  const {page,errors}=await visit({width:1440,height:900});
  try{
    await page.keyboard.press('F2');
    const focused=await page.evaluate(()=>document.activeElement?.dataset.cartProductMode||
      document.activeElement?.id);
    assert.ok(['add','posSearch'].includes(focused));
    const options=await page.locator('#posPaymentMethod option').evaluateAll(
      nodes=>nodes.map(n=>({value:n.value,disabled:n.disabled})));
    assert.ok(options.filter(x=>x.value!=='Cash').every(x=>x.disabled),
      'Owner pilot cannot advertise unconnected payment writers');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('keyboard product combobox selects actual catalog item without posting a sale',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.locator('#posSearch').fill('Wire Mesh');
    await mkdir(folder,{recursive:true});
    await page.screenshot({path:join(folder,'390-search-popup-viewport.png'),fullPage:false});
    await page.locator('#posSearch').press('Enter');
    const active=page.locator('#posCartList .pos-cart-entry-row.is-active [data-cart-entry-qty]');
    await active.waitFor({state:'visible',timeout:7000});
    await active.fill('2');
    await active.press('Enter');
    await page.waitForFunction(()=>document.querySelectorAll(
      '#posCartList .cart-row:not(.pos-cart-entry-row)').length===1);
    assert.match(await page.locator('#posCartList .c-name-title').first().innerText(),/Wire Mesh/i);
    assert.match(await page.locator('#posGrandTotal').innerText(),/360/,
      'source product entry uses its real unit price × confirmed quantity');
    assert.deepEqual(errors,[]);
    assert.equal(salePostCount,0);
  }finally{await page.close();}
});

test('source dark-theme POS remains readable on phone and desktop with screenshots',async()=>{
  await mkdir(folder,{recursive:true});
  for(const {width,height} of [{width:390,height:840},{width:1440,height:900}]){
    const {page,errors}=await visit({width,height});
    try{
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      await page.locator('#posProductGrid .product-tile').first().click();
      const colors=await page.evaluate(()=>({
        primary:getComputedStyle(document.body).getPropertyValue('--pos-v2-primary').trim(),
        surface:getComputedStyle(document.body).getPropertyValue('--pos-v2-surface').trim()
      }));
      assert.match(colors.primary,/#3DB8AC/i);
      assert.match(colors.surface,/#14263B/i);
      const readable=await page.evaluate(()=>({
        subtotal:getComputedStyle(document.getElementById('posSubtotal')).color,
        received:getComputedStyle(document.getElementById('posAmountReceived')).backgroundColor,
        receivedText:getComputedStyle(document.getElementById('posAmountReceived')).color
      }));
      assert.equal(readable.subtotal,'rgb(237, 243, 250)','subtotal needs light ink');
      assert.equal(readable.received,'rgb(20, 38, 59)','payment input needs dark surface');
      assert.equal(readable.receivedText,'rgb(237, 243, 250)','payment input needs light ink');
      assert.equal(await page.locator('#posCompleteBtn').isVisible(),true);
      await page.evaluate(()=>window.scrollTo({left:0,top:0,behavior:'instant'}));
      await page.screenshot({path:join(folder,width+'-dark-after.png'),fullPage:true});
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  }
});

test('cash-only pilot blocks a multi-line checkout before any Owner POST, with an actionable inline reason',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.evaluate(()=>{
      posState.activeSession={sessionId:'11111111-1111-4111-8111-111111111111',status:'Open'};
      posRenderSessionUI_();
    });
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posProductGrid .product-tile').nth(1).click();
    await page.locator('#posHisabiqCustomerPicker').click();
    await page.locator('#posCustomerName').fill('Test Buyer');
    await page.locator('#posCustomerPhone').fill('01710000001');
    await page.locator('[data-pos-cash-shortcut="exact"]').click();
    await page.locator('#posCompleteBtn').click();
    assert.equal(salePostCount,0,'known unsupported mode must not reach financial writer');
    assert.match(await page.locator('#posFormError').innerText(),/one product|one in-stock|single product/i);
    assert.ok(await page.locator('#posFormError').isVisible());
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('empty cart shows HisabIQ source-guided empty copy and hides it as products are added',async()=>{
  const {page,errors}=await visit({width:320,height:760});
  try{
    assert.ok(await page.locator('#posHisabiqEmptyCart').isVisible());
    assert.match(await page.locator('#posHisabiqEmptyCart').innerText(),/empty|পণ্য/i);
    await page.locator('#posProductGrid .product-tile').first().click();
    assert.equal(await page.locator('#posHisabiqEmptyCart').isVisible(),false);
    await page.locator('#posCartList .cart-remove').first().click();
    assert.ok(await page.locator('#posHisabiqEmptyCart').isVisible());
    assert.equal(salePostCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('preview includes customer and accounting breakdown without posting or changing live inputs',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posHisabiqCustomerPicker').click();
    await page.locator('#posCustomerName').fill('Nila Ahmed');
    await page.locator('#posCustomerPhone').fill('01711000001');
    await page.locator('#posDiscount').fill('20');
    await page.locator('#posDiscount').dispatchEvent('input');
    await page.locator('#posAmountReceived').fill('300');
    await page.locator('#posAmountReceived').dispatchEvent('input');
    await page.locator('#posHisabiqPreviewButton').click();
    const preview=page.locator('#posHisabiqPreview');
    assert.match(await preview.innerText(),/Nila Ahmed/);
    assert.match(await preview.innerText(),/01711000001/);
    assert.match(await preview.innerText(),/Discount/i);
    assert.match(await preview.innerText(),/Paid|Amount received/i);
    assert.match(await preview.innerText(),/Due/i);
    assert.equal(salePostCount,0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#posDiscount').inputValue(),'20');
    assert.equal(await page.locator('#posAmountReceived').inputValue(),'300');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('eligible one-product full-Cash sale still reaches the original source confirmation, never auto-posts',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    await page.evaluate(()=>{
      posState.activeSession={sessionId:'11111111-1111-4111-8111-111111111111',status:'Open'};
      posRenderSessionUI_();
    });
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posHisabiqCustomerPicker').click();
    await page.locator('#posCustomerName').fill('Eligible Cash Buyer');
    await page.locator('#posCustomerPhone').fill('01710000002');
    await page.locator('[data-pos-cash-shortcut="exact"]').click();
    await page.locator('#posCompleteBtn').click();
    assert.equal(await page.locator('#posFormError').innerText(),'',
      'new early-rejection path must not block the supported cart shape');
    assert.equal(salePostCount,0,'confirmation never auto-submits');
    assert.ok(await page.locator('#confirmActionModal:not([hidden])').isVisible(),
      'existing source financial confirmation must be preserved');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('new empty-cart and detailed-preview before/after screenshots use the actual compiled Owner UI',async()=>{
  await mkdir(folder,{recursive:true});
  const baselineVisit=await visit({width:320,height:760},{before:true});
  try{
    await baselineVisit.page.screenshot({path:join(folder,'320-empty-before.png'),fullPage:false});
  }finally{await baselineVisit.page.close();}
  const {page,errors}=await visit({width:320,height:760});
  try{
    await page.screenshot({path:join(folder,'320-empty-after.png'),fullPage:false});
    await page.locator('#posProductGrid .product-tile').first().click();
    await page.locator('#posHisabiqCustomerPicker').click();
    await page.locator('#posCustomerName').fill('Preview Buyer');
    await page.locator('#posCustomerPhone').fill('01710000003');
    await page.locator('#posDiscount').fill('10');
    await page.locator('#posDiscount').dispatchEvent('input');
    await page.locator('#posAmountReceived').fill('300');
    await page.locator('#posAmountReceived').dispatchEvent('input');
    await page.locator('#posHisabiqPreviewButton').click();
    await page.screenshot({path:join(folder,'320-preview-details-after.png'),fullPage:false});
    assert.match(await page.locator('#posHisabiqPreview').innerText(),/Due/);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('original Cash checkout customer name and phone remain visible without opening optional details',async()=>{
  const {page,errors}=await visit({width:390,height:840});
  try{
    assert.equal(await page.locator('#posHisabiqCustomerDetails').getAttribute('open'),null);
    assert.ok(await page.locator('#posCustomerName').isVisible(),'original Cash sale customer must stay accessible');
    assert.ok(await page.locator('#posCustomerPhone').isVisible(),'original Cash sale phone must stay accessible');
    await page.locator('#posCustomerName').fill('Counter Buyer');
    await page.locator('#posCustomerPhone').fill('01712345678');
    assert.equal(await page.locator('#posCustomerName').inputValue(),'Counter Buyer');
    assert.equal(await page.locator('#posCustomerPhone').inputValue(),'01712345678');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
