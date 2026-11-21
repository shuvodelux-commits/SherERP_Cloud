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
      assert.equal(await page.locator('#posCartList :is(.hi-pos-grip, .pos-v2-reorder-handle)').count(),3);
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
    assert.equal(await page.locator('#posCartList :is(.hi-pos-grip, .pos-v2-reorder-handle)').count(),3);
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
    await page.locator('#posCartList :is(.hi-pos-grip, .pos-v2-reorder-handle)').first().focus();
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
    await page.route('**/api/owner/customers',route=>route.fulfill({json:{success:true,
      data:{customers:[],bankAccounts:[],currencySymbol:''}}}));
    await page.locator('#hi-pos-quick-add').click();
    assert.equal(await page.locator('#custModal').isVisible(),true);
    assert.equal(await page.locator('#posCartList :is(.hi-pos-grip, .pos-v2-reorder-handle)').count(),3);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('POS Quick Add checks private Shop Customer D1 before opening form, preserves cart on unavailable',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  let reads=0,writes=0;
  try{
    const errors=await setup(page);
    const before=await page.evaluate(()=>posState.cart.map(x=>x.productId));
    await page.route('**/api/owner/customers',async route=>{
      if(route.request().method()==='GET'){
        reads++;
        await route.fulfill({status:404,contentType:'application/json',body:'{"error":"Unavailable"}'});
      }else{writes++;await route.abort();}
    });
    await page.locator('#hi-pos-quick-add').click();
    assert.equal(reads,1,'must check the authenticated private Customer route');
    assert.equal(writes,0,'unavailable Customer backend must not be posted');
    assert.equal(await page.locator('#custModal').isVisible(),false);
    const status=page.locator('#hi-pos-customer-status');
    assert.equal(await status.isVisible(),true);
    assert.match(await status.innerText(),/Customer.*D1|Customer.*not connected/i);
    assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),before);
    const shotDir=resolve('docs/reviews/m01-pos-customer-ui-refine/images');
    await mkdir(shotDir,{recursive:true});
    await page.locator('#toast').evaluate(el=>{el.hidden=true;});
    await page.locator('.hi-pos-customer-panel').screenshot({path:join(shotDir,'390-unavailable-customer.png'),animations:'disabled'});
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('POS Quick Add ready Shop opens original Customer form with zero-opening locked and name focused',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  let reads=0;
  try{
    const errors=await setup(page);
    await page.route('**/api/owner/customers',async route=>{
      reads++;
      await route.fulfill({json:{success:true,data:{customers:[],bankAccounts:[],currencySymbol:''}}});
    });
    await page.locator('#hi-pos-quick-add').click();
    assert.equal(reads,1);
    await page.locator('#custModal').waitFor({state:'visible'});
    assert.equal(await page.locator('#custOpening').isDisabled(),true,
      'POS Quick Add cannot create misleading historical opening balances');
    assert.equal(await page.locator('#custOpening').inputValue(),'0');
    assert.equal(await page.locator('#custOpening').isVisible(),false,
      'historical balance must not clutter POS Customer Quick Add');
    assert.equal(await page.locator('#custPhone').isVisible(),true);
    assert.equal(await page.locator('#custFatherName').isVisible(),false,
      'nonessential details start collapsed');
    assert.equal(await page.locator('#custRelationNameLabel').isVisible(),false,
      'optional Guardian label must not remain visible without its field');
    assert.equal(await page.locator('#custNotes').isVisible(),false);
    assert.equal(await page.locator('#hi-pos-customer-more').isVisible(),true);
    assert.equal(await page.locator('#custName').evaluate(el=>document.activeElement===el),true);
    const shotDir=resolve('docs/reviews/m01-pos-customer-ui-refine/images');
    await mkdir(shotDir,{recursive:true});
    await page.locator('#toast').evaluate(el=>{el.hidden=true;});
    await page.screenshot({path:join(shotDir,'1440-ready-modal.png'),animations:'disabled'});
    await page.locator('#hi-pos-customer-more').click();
    assert.equal(await page.locator('#custFatherName').isVisible(),true);
    assert.equal(await page.locator('#custAddress').isVisible(),true);
    assert.equal(await page.locator('#custNotes').isVisible(),true);
    assert.equal(await page.locator('#hi-pos-customer-more').getAttribute('aria-expanded'),'true');
    await page.locator('#custModal .modal-close').click();
    assert.equal(await page.locator('#hi-pos-quick-add').evaluate(el=>document.activeElement===el),true,
      'closing dialog must return keyboard focus to its trigger');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

for(const width of [320,390]){
  test('POS verified Customer Quick Add keeps name and phone reachable on '+width+'px touch phone',async()=>{
    const page=await browser.newPage({viewport:{width,height:820},hasTouch:true,reducedMotion:'reduce'});
    try{
      const errors=await setup(page);
      const initial=await page.evaluate(()=>posState.cart.map(x=>x.productId));
      await page.route('**/api/owner/customers',route=>route.fulfill({json:{success:true,
        data:{customers:[],bankAccounts:[],currencySymbol:''}}}));
      await page.locator('#hi-pos-quick-add').click();
      await page.locator('#custModal').waitFor({state:'visible'});
      assert.equal(await page.locator('#custName').isVisible(),true);
      assert.equal(await page.locator('#custPhone').isVisible(),true);
      assert.equal(await page.locator('#custOpening').isVisible(),false);
      const dialog=await page.locator('#custModal .modal').boundingBox();
      assert.ok(dialog&&dialog.x>=-1&&dialog.x+dialog.width<=width+1,
        'Customer dialog must not exceed viewport width: '+JSON.stringify(dialog));
      if(width===390){
        const dir=resolve('docs/reviews/m01-pos-customer-ui-refine/images');
        await mkdir(dir,{recursive:true});
        await page.locator('#toast').evaluate(el=>{el.hidden=true;});
        await page.screenshot({path:join(dir,'390-ready-modal.png'),animations:'disabled'});
      }
      await page.locator('#custModal .modal-close').click();
      assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),initial);
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  });
}

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

test('pointer drag cart reorder persists in the original posState cart',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    const errors=await setup(page);
    const handles=page.locator('#posCartList :is(.hi-pos-grip, .pos-v2-reorder-handle)');
    const target=page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').nth(1);
    await target.scrollIntoViewIfNeeded();
    await handles.first().scrollIntoViewIfNeeded();
    const from=await handles.first().boundingBox(),to=await target.boundingBox();
    assert.ok(from&&to,'native source pointer handle and target row must have boxes');
    // The native V2 reorder commits only when the pointer passes the target
    // row midpoint; HTML dragTo(handle center) legitimately inserts BEFORE
    // that row and therefore does not change the cart.
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
    await page.mouse.down();
    await page.mouse.move(to.x+Math.min(to.width*.4,65),to.y+to.height*.75,{steps:8});
    await page.mouse.up();
    await page.waitForFunction(()=>posState.cart[0]?.productId==='PRD-000002');
    assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),
      ['PRD-000002','PRD-000001','PRD-000003']);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

for(const width of [390,1440]){
  test('authenticated user-facing POS V2 displays the new annotated checkout at '+width+'px',async()=>{
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    try{
      const errors=await setup(page);
      await page.evaluate(()=>goToPage('posv2'));
      await page.waitForFunction(()=>document.body.classList.contains('pos-v2-active'));
      assert.equal(await page.locator('#page-pos').getAttribute('data-hisabiq-pos'),'',
        'the user-facing POS V2 must not silently downgrade to old layout');
      for(const target of ['#hi-pos-customer-picker','#hi-pos-quick-add',
        '#hi-pos-details-toggle','#hi-pos-discount-input',
        '#hi-pos-payment-amount','#hi-pos-fill-remaining',
        '#hi-pos-proxy-complete']){
        assert.equal(await page.locator(target).isVisible(),true,
          'annotated control must be visible on real POS route: '+target);
      }
      await page.locator('#hi-pos-details-toggle').click();
      await page.locator('[data-hi-native-field="posCustomerName"]').fill('Real Route Buyer');
      assert.equal(await page.locator('#posCustomerName').inputValue(),'Real Route Buyer');
      assert.equal(await page.locator('#hi-pos-add-payment').isDisabled(),true);
      const columns=await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').first().evaluate(row=>{
        const rect=css=>row.querySelector(css)?.getBoundingClientRect();
        return {name:rect('.c-name')?.width,qty:rect('.c-qty-wrap')?.width,
          number:rect('.pos-v2-line-no')?.width,
          grip:getComputedStyle(row.querySelector('.pos-v2-reorder-handle')).display};
      });
      assert.ok(columns.name>=145,'V2 product name column must remain readable '+JSON.stringify(columns));
      assert.ok(columns.qty<130,'V2 Qty input must not occupy product column '+JSON.stringify(columns));
      assert.ok(columns.number>0,'V2 native row number must remain '+JSON.stringify(columns));
      assert.notEqual(columns.grip,'none','native pointer drag handle must remain accessible');
      // The synthetic fixture has no real Cash Session API; omit its toast
      // only from the screenshot, never from the active application logic.
      await page.locator('#toast').evaluate(node=>{node.hidden=true;});
      await page.screenshot({path:join(evidence,width+'-active-posv2.png'),fullPage:true,animations:'disabled'});
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  });
}

test('active POS V2 preview delegates to source and never posts a sale',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    const errors=await setup(page);
    await page.evaluate(()=>goToPage('posv2'));
    assert.equal(await page.locator('#hi-pos-proxy-preview').isVisible(),true);
    assert.equal(await page.locator('#hi-pos-payment-method option:not(:disabled)').count(),1);
    await page.locator('#hi-pos-proxy-preview').click();
    assert.ok(await page.locator('#posHisabiqPreview[aria-modal="true"]').isVisible(),
      'must reuse the source preview modal');
    assert.match(await page.locator('#posHisabiqPreview').innerText(),/PVC Pipe 1 inch/);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('POS Quick Add persists a Customer through private API then selects returned ID without clearing cart',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  let writes=0;
  let customers=[];
  await page.route('**/api/owner/customers',async route=>{
    const method=route.request().method();
    if(method==='POST'){
      writes++;
      const body=JSON.parse(route.request().postData()||'{}');
      assert.ok(/^[a-f0-9-]{36}$/.test(body.operationId));
      assert.equal(body.openingBalance,'0');
      customers=[{'Customer ID':'CUS-000002','Customer Name':body.name,
        Phone:body.phone,'Father Name':'','Relation Type':'Father',
        Address:'',Notes:'','Opening Balance':0,'Current Due':0,Status:'Active'}];
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({
        success:true,data:{id:'CUS-000002'}
      })});
    }else{
      await route.fulfill({contentType:'application/json',body:JSON.stringify({
        success:true,data:{customers,bankAccounts:[],currencySymbol:''}
      })});
    }
  });
  await page.route('**/api/owner/pos/bootstrap',async route=>{
    await route.fulfill({contentType:'application/json',body:JSON.stringify({
      success:true,data:{customers:customers.map(row=>({id:row['Customer ID'],
        name:row['Customer Name'],phone:row.Phone,currentDue:0}))}
    })});
  });
  try{
    const errors=await setup(page);
    const before=await page.evaluate(()=>posState.cart.map(x=>x.productId));
    await page.locator('#hi-pos-quick-add').click();
    await page.locator('#custName').fill('New POS Customer');
    await page.locator('#custPhone').fill('01712345678');
    await page.locator('#custSaveBtn').click();
    await page.waitForFunction(()=>document.getElementById('posCustomerName').dataset.customerId==='CUS-000002',null,{timeout:5000});
    assert.equal(writes,1);
    assert.equal(await page.locator('#posCustomerName').inputValue(),'New POS Customer');
    assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),before);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
