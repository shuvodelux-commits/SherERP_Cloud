import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const widths=[320,390,768,1024,1440];
const shell=buildSourceAppShellData({shopName:'Reference POS Shop',currencySymbol:'৳'}).data;
const evidence=resolve('docs/reviews/m01-hisabiq-pos-annotated/images');
let folder,server,url,browser;
before(async()=>{
  folder=await mkdtemp(join(tmpdir(),'shererp-pos-annotated-'));
  await buildOwnerFrontend({outputDir:folder});
  server=createServer(async(req,res)=>{
    const p=new URL(req.url,'http://localhost').pathname;
    const target=resolve(folder,'.'+(p==='/'?'/owner-erp.html':p));
    if(!target.startsWith(resolve(folder)+'/')){res.writeHead(404);res.end();return;}
    try{
      const data=await readFile(target);
      const ext=extname(target);
      res.writeHead(200,{'Content-Type':ext==='.html'?'text/html':ext==='.js'?'text/javascript':'application/octet-stream'});
      res.end(data);
    }catch{res.writeHead(404);res.end('not found');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  await mkdir(evidence,{recursive:true});
});
after(async()=>{
  await browser?.close();
  if(server)await new Promise(done=>server.close(done));
  if(folder)await rm(folder,{recursive:true,force:true});
});
async function setup(page){
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https:\/\/fonts\./,route=>route.abort());
  await page.route('**/api/owner/auth/session',route=>route.fulfill({json:{
    role:'Owner',shopId:'22222222-2222-4222-8222-222222222222',
    dashboard:{displayName:'Reference POS Shop',dataAvailable:false}
  }}));
  await page.route('**/api/owner/app-shell',route=>route.fulfill({json:{success:true,data:shell}}));
  await page.goto(url+'/owner-erp.html',{waitUntil:'domcontentloaded'});
  // Wait for the real Owner-authenticated shell to settle before opening POS;
  // otherwise its asynchronous dashboard navigation can re-hide our fixture.
  await page.waitForFunction(()=>typeof currentUser!=='undefined'&&!!currentUser&&
    document.getElementById('loginOverlay')?.hidden===true,{timeout:8000});
  await page.evaluate(()=>{
    const app=document.getElementById('app');
    app.hidden=false;app.style.visibility='';app.style.removeProperty('display');
    document.getElementById('loginOverlay').hidden=true;
    goToPage('pos');
    document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-pos');
    window.currentPage='pos';
    posState.products=[
      {id:'PRD-000001',name:'PVC Pipe 1 inch',unit:'pcs',sellingPrice:420,stock:100,productType:'Standard'},
      {id:'PRD-000002',name:'LED Bulb 12W',unit:'pcs',sellingPrice:500,stock:100,productType:'Standard'},
      {id:'PRD-000003',name:'Mesh Net',unit:'Gauge',sellingPrice:180,stock:100,productType:'Standard'},
      {id:'PRD-000004',name:'Teflon Tape',unit:'pcs',sellingPrice:60,stock:100,productType:'Standard'},
    ];
    posState.productStockById={'PRD-000001':100,'PRD-000002':100,'PRD-000003':100,'PRD-000004':100};
    posState.cart=[
      {productId:'PRD-000001',name:'PVC Pipe 1 inch',unit:'pcs',qty:4,unitPrice:420,priceMode:'fixed',lineTotal:1680,productType:'Standard',shortageResolution:'own'},
      {productId:'PRD-000002',name:'LED Bulb 12W',unit:'pcs',qty:2,unitPrice:500,priceMode:'fixed',lineTotal:1000,productType:'Standard',shortageResolution:'own'},
      {productId:'PRD-000003',name:'Mesh Net',unit:'Gauge',qty:1,unitPrice:180,priceMode:'fixed',lineTotal:180,productType:'Standard',shortageResolution:'own'},
    ];
    posState.customers=[{id:'CUS-000001',name:'Rahim Hardware',phone:'01712345678',address:''}];
    posRenderCart_();
    posRenderProductGrid_();
  });
  await page.locator('#hi-pos-customer-picker').waitFor();
  await page.locator('#hi-pos-invoice-number').waitFor();
  return errors;
}
for(const width of widths){
  test('reference-style POS 10 annotated controls visible and isolated at '+width+'px',async()=>{
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<500,reducedMotion:'reduce'});
    try{
      const errors=await setup(page);
      const required=['#hi-pos-quick-add','#hi-pos-customer-picker','#hi-pos-details-toggle',
        '#hi-pos-discount-input','#hi-pos-add-payment','#hi-pos-fill-remaining',
        '#posCartList [data-cart-product-mode="add"]','#hi-pos-payment-presets','#posCompleteBtn'];
      for(const selector of required)assert.equal(await page.locator(selector).count(),1,selector);
      assert.equal(await page.locator('#posCartList .hi-pos-grip').count(),3);
      assert.equal(await page.locator('#posProductGrid .product-tile').count(),4,
        'native product quick-item tiles must render, not be fabricated by CSS');
      assert.equal(await page.locator('[data-hi-pos-unit]').count(),3);
      assert.equal(await page.locator('#hi-pos-add-payment').isDisabled(),true,
        'unconnected split-payment backend must not falsely accept Add');
      // Synthetic browser fixture has no live Owner catalog API. Suppress only
      // the connection toast in the visual screenshot; do not suppress errors
      // or pretend this fixture is a hosted Shop D1 session.
      await page.locator('#toast').evaluate(node=>{node.hidden=true;});
      await page.screenshot({path:join(evidence,width+'-after.png'),fullPage:true,animations:'disabled'});
      const bounds=await page.locator('#page-pos').boundingBox();
      assert.ok(bounds.x>=-2&&bounds.x+bounds.width<=width+3,
        'POS root must not overflow screen: '+JSON.stringify(bounds));
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  });
}
test('customer dropdown chooses verified ID, guest clears it, details expand without cart reset',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    const errors=await setup(page);
    await page.locator('#hi-pos-customer-picker').click();
    await page.locator('#hi-pos-customer-menu [data-hi-customer-id="CUS-000001"]').click();
    assert.equal(await page.locator('#posCustomerName').evaluate(e=>e.dataset.customerId),'CUS-000001');
    assert.match(await page.locator('#hi-pos-customer-picker').innerText(),/Rahim Hardware/);
    await page.locator('#hi-pos-details-toggle').click();
    assert.equal(await page.locator('#hi-pos-details-body').getAttribute('data-open'),'true');
    await page.locator('#hi-pos-customer-picker').click();
    await page.locator('#hi-pos-customer-menu [data-hi-customer-guest]').click();
    assert.equal(await page.locator('#posCustomerName').evaluate(e=>e.dataset.customerId),'');
    assert.equal(await page.locator('#posCartList .hi-pos-grip').count(),3);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('discount percent, Exact/Remaining, and keyboard reorder update original cart/totals',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    const errors=await setup(page);
    await page.locator('[data-hi-discount-mode="percent"]').click();
    await page.locator('#hi-pos-discount-input').fill('10');
    assert.equal(await page.locator('#posDiscount').inputValue(),'286');
    await page.locator('#hi-pos-fill-remaining').click();
    assert.equal(await page.locator('#posAmountReceived').inputValue(),'2574');
    await page.locator('#posCartList .hi-pos-grip').first().focus();
    await page.keyboard.press('ArrowDown');
    const names=await page.evaluate(()=>posState.cart.map(x=>x.name));
    assert.deepEqual(names,['LED Bulb 12W','PVC Pipe 1 inch','Mesh Net']);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
test('Quick Add launches original customer modal, but the Owner backend remains authoritative',async()=>{
  const page=await browser.newPage({viewport:{width:1024,height:900}});
  try{
    const errors=await setup(page);
    await page.locator('#hi-pos-quick-add').click();
    assert.equal(await page.locator('#custModal').isVisible(),true);
    assert.equal(await page.locator('#posCartList .hi-pos-grip').count(),3);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('Quick Items buttons reuse the original POS add-to-cart flow',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    const errors=await setup(page);
    const qtyBefore=await page.evaluate(()=>posState.cart[0].qty);
    await page.locator('#posProductGrid .product-tile').first().click();
    const qtyAfter=await page.evaluate(()=>posState.cart[0].qty);
    assert.equal(qtyAfter,qtyBefore+1);
    assert.equal(await page.locator('#posCartList input[data-f="qty"]').first().inputValue(),String(qtyAfter));
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('unconnected multi-unit controls are blocked instead of silently mis-posting quantities',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await setup(page);
    assert.equal(await page.locator('#posCartList [data-hi-pos-unit]:disabled').count(),3);
    assert.match(await page.locator('[data-hi-pos-unit]').first().getAttribute('title'),/verified multi-unit Shop D1/i);
    assert.equal(await page.locator('#hi-pos-add-payment').isDisabled(),true);
    assert.equal(await page.evaluate(()=>posState.paymentRows.length),1);
  }finally{await page.close();}
});

test('inline Add Product combobox adds a new product through native POS handlers',async()=>{
  const page=await browser.newPage({viewport:{width:1024,height:900}});
  try{
    const errors=await setup(page);
    const add=page.locator('#posCartList input[data-cart-product-mode="add"]');
    await add.fill('Teflon');
    await add.press('Enter');
    assert.equal(await page.evaluate(()=>posState.cart.length),4,
      'native POS adds the selected catalog product to the existing cart');
    assert.equal(await page.evaluate(()=>posState.cart[3].name),'Teflon Tape');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
