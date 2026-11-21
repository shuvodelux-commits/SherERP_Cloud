import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {after,before,test} from 'node:test';
import {chromium} from 'playwright';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

let outputDir,server,browser,url,logoutCount=0,rpcCount=0,supplierCreates=0;
let cashOpen=false,ownerPurchaseSaves=0,nextOpeningReads=0;
const ownerPurchaseHistory=[];
const supplierRows=[];
const shopId='22222222-2222-4222-8222-222222222222';
const session={role:'Owner',shopId,dashboard:{displayName:'Fixture Machinery',dataAvailable:false}};
const appShell=buildSourceAppShellData({shopName:'Fixture Machinery',currencySymbol:''}).data;

before(async()=>{
  outputDir=await mkdtemp(join(tmpdir(),'shererp-owner-browser-'));
  await buildOwnerFrontend({outputDir});
  server=createServer((request,response)=>{
    void (async()=>{
      const path=new URL(request.url,'http://localhost').pathname;
      response.setHeader('Cache-Control','no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      if(path==='/api/owner/auth/session'){
        response.writeHead(logoutCount?401:200,{'Content-Type':'application/json'});
        response.end(JSON.stringify(logoutCount?{error:'Owner setup denied'}:session));
        return;
      }
      if(path==='/api/owner/app-shell'){
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({success:true,data:appShell}));
        return;
      }
      if(path==='/api/owner/catalog'){
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({data:[{productId:'P1',name:'Fixture Drill',category:'Tools',brand:'Maker',unit:'Each',listedPrice:'12.50',savedPurchasePrice:'8.25',stockAtBackup:'19.125'}]}));
        return;
      }
      if(path==='/api/owner/suppliers'){
        let status=200,body;
        if(request.method==='POST'){
          const chunks=[];
          for await(const part of request)chunks.push(part);
          const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          assert.match(input.operationId,/^[a-f0-9-]{36}$/);
          assert.equal(input.name,'Fixture Supplier');
          assert.equal(Number(input.openingBalance||0),0);
          supplierCreates++;
          if(!supplierRows.length)supplierRows.push({
            'Supplier ID':'SUP-000001','Supplier Name':input.name,
            Phone:input.phone||'',Address:input.address||'',Notes:input.notes||'',
            'Opening Balance':0,'Current Due':0,Status:'Active'
          });
          status=201;body={success:true,data:{id:'SUP-000001'}};
        }else body={suppliers:supplierRows,bankAccounts:[],currencySymbol:''};
        response.writeHead(status,{'Content-Type':'application/json'});
        response.end(JSON.stringify(body));
        return;
      }
      if(path==='/api/owner/purchase/bootstrap'&&request.method==='GET'){
        const data={products:[{id:'PRD-000001',name:'MVP Drill',brand:'',
          category:'Tools',unit:'pcs',barcode:'',stock:ownerPurchaseSaves?10:0,
          purchasePrice:'60.00',sellingPrice:'75.00'}],
          suppliers:[{id:'SUP-000001',name:'Fixture Supplier',phone:'',
            currentDue:ownerPurchaseSaves?600:0}],
          categories:[],bankAccounts:[],currencySymbol:'',
          cashSession:cashOpen?{sessionId:'CS-000001',status:'Open'}:null};
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({success:true,data}));
        return;
      }
      if(path==='/api/owner/cash-session/next-opening'&&request.method==='GET'){
        // The new private read-only physical cash count contract is required
        // before Start Day. This synthetic Owner fixture has never closed a day.
        nextOpeningReads++;
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({success:true,data:{openingCash:0}}));
        return;
      }
      if(path==='/api/owner/cash-session/start'&&request.method==='POST'){
        const chunks=[];
        for await(const part of request)chunks.push(part);
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.equal(Number(input.openingCash),0);
        assert.match(input.operationId,/^[a-f0-9-]{36}$/);
        cashOpen=true;
        response.writeHead(201,{'Content-Type':'application/json'});
        response.end(JSON.stringify({success:true,
          data:{sessionId:'CS-000001',status:'started'}}));
        return;
      }
      if(path==='/api/owner/purchases'){
        let status=200,body;
        if(request.method==='POST'){
          const chunks=[];
          for await(const part of request)chunks.push(part);
          const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          assert.match(input.operationId,/^[a-f0-9-]{36}$/);
          assert.equal(input.payload.supplierId,'SUP-000001');
          assert.equal(input.payload.paidAmount,'0');
          assert.equal(input.payload.items.length,1);
          ownerPurchaseSaves++;
          if(!ownerPurchaseHistory.length)ownerPurchaseHistory.push({
            purchaseId:'PUR-000001',date:'2026-11-20',supplierName:'Fixture Supplier',
            grandTotal:600,paidAmount:0,dueAmount:600,returnedAmount:0,
            paymentStatus:'Due',returnStatus:'No Return',editable:false,deletable:false
          });
          status=201;body={success:true,data:{
            purchaseId:'PUR-000001',grandTotal:600,dueAmount:600}};
        }else body={success:true,data:ownerPurchaseHistory};
        response.writeHead(status,{'Content-Type':'application/json'});
        response.end(JSON.stringify(body));
        return;
      }
      if(path==='/api/owner/auth/logout'&&request.method==='POST'){
        logoutCount++;
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({signedOut:true}));
        return;
      }
      if(path==='/api/rpc'){
        rpcCount++;
        response.writeHead(501,{'Content-Type':'application/json'});
        response.end(JSON.stringify({error:'RPC method not migrated'}));
        return;
      }
      const assetPath=path==='/'?'/index.html':path==='/app'?'/owner-erp.html':path;
      const file=resolve(outputDir,'.'+assetPath);
      if(!file.startsWith(resolve(outputDir)+'/')){
        response.writeHead(404);response.end();return;
      }
      try{
        const content=await readFile(file);
        const extension=extname(file);
        const type=extension==='.html'?'text/html; charset=utf-8':
          extension==='.js'||extension==='.mjs'?'text/javascript; charset=utf-8':
          extension==='.css'?'text/css; charset=utf-8':'application/octet-stream';
        response.writeHead(200,{'Content-Type':type});
        response.end(path==='/'?content.toString('utf8').replace('<body>','<body data-owner-erp="enabled">'):content);
      }catch{response.writeHead(404);response.end('Not found');}
    })().catch(()=>{if(!response.headersSent)response.writeHead(500);response.end();});
  });
  await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolvePromise);});
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});

after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(resolvePromise=>server.close(resolvePromise));
  if(outputDir)await rm(outputDir,{recursive:true,force:true});
});

test('Purchase screen reports unavailable data on a disabled route and an expired session on 401',async()=>{
  const page=await browser.newPage();
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="Purchases"]').waitFor();
    for(const [status,message] of [[404,'Purchase data is unavailable.'],[401,'Your session expired. Sign in again.']]){
      await page.route('**/api/owner/purchase/bootstrap',route=>
        route.fulfill({status,contentType:'text/plain',body:'Not Found'}));
      const error=await page.evaluate(()=>serverCall('getPurchaseBootstrap','').then(()=>null,e=>e.message));
      assert.equal(error,message);
      await page.unroute('**/api/owner/purchase/bootstrap');
    }
  }finally{await page.close();}
});

test('late supplier read cannot overwrite the selected supplier or enable settlement',async()=>{
  const page=await browser.newPage();
  try{
    let firstRequest;
    const pending=new Promise(resolve=>{firstRequest=resolve;});
    const ledger=(id,name)=>({success:true,data:{scope:'purchase-credit-only',supplierId:id,
      supplierName:name,phone:'',currentDuePaisa:1000,entries:[],hasMore:false}});
    await page.route('**/SUP-000001/ledger',route=>firstRequest(route));
    await page.route('**/SUP-000002/ledger',route=>route.fulfill({json:ledger('SUP-000002','Supplier B')}));
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
    await page.evaluate(()=>supOpenDetail_('SUP-000001'));
    const delayed=await pending;
    await page.evaluate(()=>supOpenDetail_('SUP-000002'));
    await page.locator('#supDetailModal:not([hidden])').waitFor();
    await delayed.fulfill({json:ledger('SUP-000001','Supplier A')});
    await page.waitForLoadState('networkidle');
    assert.match(await page.locator('#supDetailName').innerText(),/Supplier B/);
    await page.locator('#supPayAmount').evaluate(input=>{
      input.value='1';
      input.dispatchEvent(new Event('input'));
    });
    assert.ok(await page.locator('#supPaySettleFullBtn').isDisabled());
  }finally{await page.close();}
});

test('supplier ledger rejects an amount the original currency formatter would round incorrectly',async()=>{
  const page=await browser.newPage();
  try{
    await page.route('**/SUP-000001/ledger',route=>route.fulfill({json:{success:true,data:{
      scope:'purchase-credit-only',supplierId:'SUP-000001',supplierName:'Test',phone:'',
      currentDuePaisa:Number.MAX_SAFE_INTEGER,entries:[],hasMore:false
    }}}));
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await assert.rejects(page.evaluate(()=>serverCall('getSupplierDetail','','SUP-000001')),/cannot display/i);
  }finally{await page.close();}
});

test('Owner Supplier screen lists and saves through the private API without public RPC',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url+'/app');
    await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
    await page.locator('#supAddBtn').click();
    await page.locator('#supName').fill('Fixture Supplier');
    await page.locator('#supSaveBtn').click();
    await page.locator('#supTableBody').getByText('Fixture Supplier').waitFor({timeout:7000});
    assert.equal(supplierCreates,1,'one confirmed Shop Supplier save');
    assert.equal(await page.locator('#supTableBody tr').count(),1);
    assert.equal(rpcCount,0,'Supplier must use private Owner API, not public RPC');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('Original Purchases page offers Start Day and sends one real Owner Purchase operation without public RPC',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url+'/app');
    await page.locator('#navList .nav-item[aria-label="Purchases"]').click();
    await page.locator('#owner-purchase-day-bar').waitFor({timeout:10000});
    assert.match(await page.locator('#owner-purchase-day-state').textContent(),/Start Day/);
    await page.locator('#owner-purchase-start-day').click();
    await page.waitForFunction(()=>document.getElementById('owner-purchase-day-state')?.textContent?.includes('Day Open'));
    assert.ok(nextOpeningReads>=1,'read-only next opening must be verified before Start Day');
    const saved=await page.evaluate(async()=>{
      return serverCall('createPurchase','',{
        supplierId:'SUP-000001',items:[{productId:'PRD-000001',name:'MVP Drill',
          qty:'10',unitPrice:'60.00',sellingPrice:'75.00'}],
        discount:'0',paidAmount:'0',paymentMethod:'Cash',bankAccountId:'',
        notes:'MVP Purchase browser',date:new Date().toISOString().slice(0,10),
        backdatedReason:''
      });
    });
    assert.equal(saved.purchaseId,'PUR-000001');
    assert.equal(ownerPurchaseSaves,1);
    await page.locator('#page-purchase .tab-btn[data-tab="purHistory"]').click();
    await page.locator('#purHistRefreshBtn').click();
    await page.locator('#purHistoryBody').getByText('PUR-000001').waitFor();
    assert.equal(rpcCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('Owner session restore opens ERP modules, blocks RPC, and signs out through Owner auth',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url+'/app');
    await page.locator('#owner-data-notice').waitFor();
    assert.equal(await page.locator('#app').evaluate(element=>getComputedStyle(element).visibility),'visible');
    await page.locator('#navList .nav-item[aria-label="Sales"]').waitFor();
    assert.equal(await page.locator('#shopNameLabel').textContent(),'Fixture Machinery');
    await page.locator('#navList .nav-item[aria-label="Products"]').waitFor();
    await page.locator('#logoutBtn').waitFor();
    assert.match(await page.locator('#owner-data-notice').innerText(),
      /Shop D1 is connected for enabled modules/);
    assert.doesNotMatch(await page.locator('#owner-data-notice').innerText(),
      /reads and saves are unavailable/);
    assert.equal(await page.locator('#loginMobile, #loginPassword').count(),0);
    await page.waitForLoadState('networkidle');
    assert.equal(rpcCount,0,'the Owner UI must not send business RPCs');

    await page.locator('#navList .nav-item[aria-label="Products"]').click();
    const product=page.locator('#prodTableBody tr').filter({hasText:'Fixture Drill'});
    await product.waitFor({timeout:5000});
    assert.match(await product.innerText(),/12\.50/);
    assert.match(await product.innerText(),/8\.25/);
    assert.match(await product.innerText(),/19\.125/);
    assert.equal(await product.getByText('Unavailable',{exact:true}).count(),1);
    assert.equal(await page.locator('#prodAddBtn').isVisible(),false);
    await page.locator('#prodSearch').fill('not in the catalog');
    await product.waitFor({state:'hidden'});

    await page.locator('#logoutBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    await page.locator('#confirmActionConfirm').click();
    await page.waitForURL(url+'/');
    await page.locator('#login:not([hidden])').waitFor();
    assert.equal(logoutCount,1);
    assert.equal(rpcCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('original Supplier screen enables only verified Cash Pay and retries the same operation after an uncertain network error',async()=>{
  const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Dhaka'});
  const page=await context.newPage();
  const requests=[];
  try{
    // The earlier logout test mutates the shared fixture; independently
    // provision an Owner session for this Supplier-only browser scenario.
    await page.route('**/api/owner/auth/session',route=>
      route.fulfill({json:session}));
    await page.route('**/api/owner/suppliers/SUP-000001/ledger',route=>
      route.fulfill({json:{success:true,data:{
        scope:'purchase-and-cash-payment',supplierId:'SUP-000001',
        supplierName:'Fixture Supplier',phone:'',currentDuePaisa:60000,
        cashPayAvailable:true,entries:[],hasMore:false
      }}}));
    await page.route('**/api/owner/suppliers/SUP-000001/cash-pay',async route=>{
      const body=route.request().postDataJSON();
      requests.push(body);
      if(requests.length===1)return route.abort('failed');
      return route.fulfill({status:201,json:{success:true,data:{
        paymentId:'SPY-000001',supplierId:'SUP-000001',amount:100.25,currentDue:499.75
      }}});
    });
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="Suppliers"]').click();
    await page.evaluate(()=>supOpenDetail_('SUP-000001'));
    await page.locator('#supDetailModal:not([hidden])').waitFor();
    await page.waitForFunction(()=>!document.getElementById('owner-supplier-cash-pay')?.disabled);
    assert.equal(await page.locator('#supPayDiscount').isDisabled(),true);
    assert.equal(await page.locator('#supPaySettleFullBtn').isDisabled(),true);
    assert.deepEqual(await page.locator('#supPayMethod option').evaluateAll(options=>options.map(x=>x.value)),['Cash']);
    assert.equal(await page.locator('#supPayDate').getAttribute('readonly'),'');
    const payload=()=>page.evaluate(async()=>{
      const today=new Date(Date.now()+21600000).toISOString().slice(0,10);
      return serverCall('paySupplier','','SUP-000001','100.25','Cash','','Cash payout',today,'',0,'');
    });
    await assert.rejects(payload(),/Could not confirm Cash payment/i);
    const saved=await payload();
    assert.equal(saved.paymentId,'SPY-000001');
    assert.equal(saved.currentDue,499.75);
    assert.equal(requests.length,2);
    assert.equal(requests[0].operationId,requests[1].operationId);
    assert.equal(requests[0].payload.amount,'100.25');
    assert.equal(requests[0].payload.paymentMethod,'Cash');
    assert.equal(requests[0].payload.supplierId,'SUP-000001');
    assert.equal(requests[0].payload.date,new Date(Date.now()+21600000).toISOString().slice(0,10));
    await assert.rejects(page.evaluate(()=>serverCall('paySupplier','','SUP-000001',
      '100.25','Bank','BANK-000001','','2026-11-21','',0,'')),/Only Cash supplier payment/);
    assert.equal(requests.length,2,'unsupported Bank must never contact API');
  }finally{await context.close();}
});
