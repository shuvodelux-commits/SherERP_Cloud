import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import {before,after,test} from 'node:test';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

let browser,server,url,outputDir;
const audit={financialPosts:0,supplierReads:0,partyReads:0,supplierCreateBodies:[]};
let genericMode='source-only',failSupplierCreateOnce=false,denySupplierCreate=false;
const shopId='22222222-2222-4222-8222-222222222222';
const session={role:'Owner',shopId,dashboard:{displayName:'HisabIQ Fixture Shop',dataAvailable:false}};
const shell=buildSourceAppShellData({shopName:'HisabIQ Fixture Shop',currencySymbol:''}).data;
const supplier={
  'Supplier ID':'SUP-000007','Supplier Name':'Hossain Electric',
  Phone:'01912000000',Address:'Dhaka','Opening Balance':0,
  'Current Due':1200.55,Status:'Active'
};
const supplierRows=[supplier];
const send=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};
before(async()=>{
  outputDir=await mkdtemp(join(tmpdir(),'shererp-hisabiq-party-'));
  await buildOwnerFrontend({outputDir});
  server=createServer((req,res)=>{
    void (async()=>{
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='POST'&&path==='/api/owner/suppliers'){
        const chunks=[];for await(const c of req)chunks.push(c);
        const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        audit.supplierCreateBodies.push(payload);
        if(denySupplierCreate){
          send(res,403,{success:false,message:'Supplier access denied'});return;
        }
        if(failSupplierCreateOnce){
          failSupplierCreateOnce=false;
          send(res,503,{success:false,message:'Unconfirmed Supplier save'});return;
        }
        if(!payload.name||payload.openingBalance!=='0'){
          send(res,400,{success:false,message:'Invalid Supplier'});return;
        }
        let row=supplierRows.find(x=>x['Supplier Name']===payload.name);
        if(!row){
          row={'Supplier ID':'SUP-'+String(7+supplierRows.length).padStart(6,'0'),
            'Supplier Name':payload.name,Phone:payload.phone||'',
            Address:payload.address||'','Current Due':0,
            'Opening Balance':0,Status:'Active'};
          supplierRows.push(row);
        }
        send(res,201,{success:true,data:{id:row['Supplier ID']}});return;
      }
      if(req.method==='POST') {audit.financialPosts++;send(res,403,{error:'No financial writes'});return;}
      if(path==='/api/owner/auth/session'){send(res,200,session);return;}
      if(path==='/api/owner/app-shell'){send(res,200,{success:true,data:shell});return;}
      if(path==='/api/owner/parties'){
        audit.partyReads++;
        if(genericMode==='denied'){send(res,401,{error:'Owner session denied'});return;}
        if(genericMode==='unified'){
          send(res,200,{success:true,data:{parties:[{
            partyId:'PTY-000007',displayName:'Hossain Electric',nameBn:'হোসেন ইলেকট্রিক',
            phone:'01912000000',address:'Dhaka',
            roles:['Customer','Supplier','Lender'],
            sourceIds:{Supplier:'SUP-000007'},
            roleBalances:[
              {role:'Customer',receivablePaisa:500000,payablePaisa:0},
              {role:'Supplier',receivablePaisa:0,payablePaisa:120055},
              {role:'Lender',receivablePaisa:0,payablePaisa:2000000}
            ]
          }]}});return;
        }
        send(res,404,{error:'Not yet connected'});return;
      }
      if(path==='/api/owner/suppliers'){audit.supplierReads++;send(res,200,{suppliers:supplierRows,bankAccounts:[],currencySymbol:''});return;}
      if(path==='/api/owner/suppliers/SUP-000007/ledger'){
        send(res,200,{success:true,data:{
          scope:'purchase-credit-only',supplierId:'SUP-000007',
          supplierName:'Hossain Electric',phone:'01912000000',
          currentDuePaisa:120055,hasMore:false,
          entries:[{kind:'Purchase',reference:'PUR-000007',purchaseDate:'2026-11-20',
            debitPaisa:120055,creditPaisa:0,balancePaisa:120055}]
        }});return;
      }
      const filePath=resolve(outputDir,'.'+(path==='/app'?'/owner-erp.html':path));
      if(!filePath.startsWith(resolve(outputDir)+'/')){
        res.writeHead(404);res.end();return;
      }
      try{
        const body=await readFile(filePath);
        const suffix=extname(filePath);
        res.writeHead(200,{'Content-Type':suffix==='.html'?'text/html; charset=utf-8':
          suffix==='.css'?'text/css; charset=utf-8':
          suffix==='.js'||suffix==='.mjs'?'text/javascript; charset=utf-8':
          'application/octet-stream'});
        res.end(body);
      }catch{res.writeHead(404);res.end('Not found');}
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise((resolvePromise,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolvePromise);
  });
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
      {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}
  )});
});
after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(done=>server.close(done));
  if(outputDir)await rm(outputDir,{recursive:true,force:true});
});
async function openParty(page){
  await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
  if(page.viewportSize().width<768){
    await page.locator('#mobileBottomNav [data-mobile-page="more"]').click();
    await page.locator('#mobileMoreList [data-mobile-target="hisabiqParties"]').waitFor({state:'visible'});
    await page.locator('#mobileMoreList [data-mobile-target="hisabiqParties"]').click();
  }else{
    await page.locator('#navList [data-page="hisabiqParties"]').waitFor({state:'visible'});
    await page.locator('#navList [data-page="hisabiqParties"]').click();
  }
  await page.locator('#hparty-source-mode').getByText('Supplier-only D1 source view').waitFor({state:'visible'});
  await page.locator('#hparty-detail h2').getByText('Hossain Electric').waitFor({state:'visible'});
  await page.locator('#hparty-tab-content').getByText('PUR-000007').waitFor({state:'visible'});
}

for(const width of [320,390,768,1024,1440]){
  test('HisabIQ Party authenticated responsive layout '+width+'px',async()=>{
    const page=await browser.newPage({viewport:{width,height:900}});
    try{
      await page.route(/^https:\/\/fonts\./,route=>route.abort());
      await openParty(page);
      const compact=width<1024;
      assert.equal(await page.locator('#page-hisabiqParties').isVisible(),true);
      assert.equal(await page.locator('.hparty-directory').isVisible(),!compact);
      assert.equal(await page.locator('#page-customers').count(),1);
      assert.equal(await page.locator('#page-supplierLedger').count(),1);
      assert.equal(await page.locator('#hparty-detail .hparty-badge').count(),1);
      assert.equal(await page.locator('.hparty-balance-card').count(),2);
      assert.match(await page.locator('#hparty-source-mode').textContent(),/Supplier-only D1 source/);
      const pageDims=await page.locator('#page-hisabiqParties').evaluate(node=>({
        scroll:node.scrollWidth,client:node.clientWidth
      }));
      assert.ok(pageDims.scroll<=pageDims.client+2,
        'Party UI unexpectedly overflows at '+width+'px: '+JSON.stringify(pageDims));
      if(compact){
        await page.locator('#hparty-change').click();
        const picker=page.locator('#hparty-picker');
        await picker.waitFor({state:'visible'});
        const transform=await picker.locator('.hparty-picker-panel').evaluate(node=>getComputedStyle(node).transform);
        assert.ok(transform);
        const rect=await picker.locator('.hparty-picker-panel').boundingBox();
        assert.ok(rect&&rect.width<=width+1);
        if(width>=768)assert.ok(rect.width<=441);
        await picker.locator('#hparty-picker-close').click();
        await page.locator('#hparty-change').focus();
      }
      await page.locator('.hparty-tab[data-tab="Payments"]').click();
      assert.match(await page.locator('#hparty-tab-content').textContent(),/No verified source rows found/);
      await page.locator('.hparty-tab[data-tab="Ledger"]').click();
      assert.equal(await page.locator('#hparty-tab-content table tbody tr').count(),1);
      const family=await page.locator('#hparty-detail').evaluate(node=>getComputedStyle(node).fontFamily);
      assert.ok(!family.includes('monospace'));
    }finally{await page.close();}
  });
}

test('dark system theme and reduced motion keep role selection and source truth',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
    await openParty(page);
    assert.equal(await page.locator('#page-hisabiqParties').getAttribute('data-theme'),'dark');
    assert.equal(await page.locator('#content').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(11, 26, 44)');
    await page.locator('#hparty-change').click();
    await page.locator('#hparty-picker').waitFor({state:'visible'});
    const transition=await page.locator('.hparty-picker-panel').evaluate(node=>getComputedStyle(node).transitionDuration);
    assert.ok(transition.split(',').every(x=>parseFloat(x)===0));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#hparty-picker').getAttribute('data-open'),'false');
  }finally{await page.close();}
});


test('synthetic unified Party response renders one identity with independent Customer/Supplier/Lender accounts',async()=>{
  genericMode='unified';
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList [data-page="hisabiqParties"]').click();
    await page.locator('#hparty-source-mode').getByText('Unified Party identities').waitFor();
    assert.equal(await page.locator('#hparty-list [role="option"]').count(),1);
    assert.match(await page.locator('#hparty-list').innerText(),/Multiple ledgers/);
    assert.match(await page.locator('.hparty-balance-card[data-kind="Receivable"]').innerText(),/5,000\.00/);
    assert.equal(await page.locator('#hparty-detail .hparty-badge').count(),3);
    await page.locator('#hparty-detail select').selectOption('Supplier');
    await page.locator('#hparty-tab-content').getByText('PUR-000007').waitFor();
    assert.match(await page.locator('.hparty-balance-card[data-kind="Payable"]').innerText(),/1,200\.55/);
    await page.locator('#hparty-detail select').selectOption('Lender');
    assert.match(await page.locator('.hparty-balance-card[data-kind="Payable"]').innerText(),/20,000\.00/);
    assert.match(await page.locator('#hparty-tab-content').innerText(),/relationship ledger is not connected/);
    assert.equal(await page.locator('.hparty-balance-card[data-kind="Receivable"]').innerText().then(s=>s.includes('5,000')),false);
  }finally{genericMode='source-only';await page.close();}
});

test('401 on unified Party endpoint fails closed instead of silently showing unrelated Supplier',async()=>{
  genericMode='denied';
  const readsBefore=audit.supplierReads;
  const page=await browser.newPage({viewport:{width:1024,height:900}});
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList [data-page="hisabiqParties"]').click();
    await page.locator('#hparty-source-mode').getByText('Shop session denied').waitFor();
    assert.equal(await page.locator('#hparty-list [role="option"]').count(),0);
    assert.equal(audit.supplierReads,readsBefore);
  }finally{genericMode='source-only';await page.close();}
});


test('source-only Add Supplier posts zero-opening authorized intent and selects saved source ID',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try {
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await openParty(page);
    const button=page.locator('#hparty-add-party');
    assert.equal(await button.isEnabled(),true);
    assert.match(await button.innerText(),/Add Supplier/);
    assert.equal(await page.locator('#owner-data-notice').evaluate(x=>getComputedStyle(x).display),'none');
    await button.click();
    await page.locator('#hparty-supplier-name').fill('New Hardware');
    await page.locator('#hparty-supplier-phone').fill('01888000111');
    await page.locator('#hparty-supplier-address').fill('Khulna');
    await page.locator('#hparty-supplier-save').click();
    await page.locator('#hparty-detail h2').getByText('New Hardware').waitFor();
    await page.locator('#hparty-supplier-modal').waitFor({state:'hidden'});
    assert.equal(await page.locator('#hparty-supplier-modal').isVisible(),false);
    const body=audit.supplierCreateBodies.at(-1);
    assert.equal(body.name,'New Hardware');
    assert.equal(body.openingBalance,'0');
    assert.match(body.operationId,/^[0-9a-f-]{36}$/);
    assert.equal(await page.locator('.hparty-balance-card[data-kind="Payable"]').innerText().then(s=>s.includes('0.00')),true);
    assert.equal(audit.financialPosts,0);
  }finally{await page.close();}
});

test('Supplier timeout retry reuses exact payload and operationId',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  failSupplierCreateOnce=true;
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await openParty(page);
    await page.locator('#hparty-add-party').click();
    await page.locator('#hparty-supplier-name').fill('Retry Electric');
    await page.locator('#hparty-supplier-save').click();
    await page.locator('#hparty-supplier-status').getByText('Retry unchanged').waitFor();
    const previous=audit.supplierCreateBodies.at(-1);
    await page.locator('#hparty-supplier-save').click();
    await page.locator('#hparty-detail h2').getByText('Retry Electric').waitFor();
    assert.deepEqual(audit.supplierCreateBodies.at(-1),previous);
    assert.equal(audit.financialPosts,0);
  }finally{failSupplierCreateOnce=false;await page.close();}
});

test('403 Supplier save stays denied without adding a client-side Party',async()=>{
  denySupplierCreate=true;
  const page=await browser.newPage({viewport:{width:1024,height:900}});
  try {
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await openParty(page);
    const count=await page.locator('#hparty-list [role="option"]').count();
    await page.locator('#hparty-add-party').click();
    await page.locator('#hparty-supplier-name').fill('Blocked Supplier');
    await page.locator('#hparty-supplier-save').click();
    await page.locator('#hparty-supplier-status').getByText('access denied').waitFor();
    assert.equal(await page.locator('#hparty-list [role="option"]').count(),count);
    assert.equal(await page.locator('#hparty-supplier-modal').isVisible(),true);
    assert.equal(audit.financialPosts,0);
  } finally {denySupplierCreate=false;await page.close();}
});

test('unified three-role directory never exposes the source-only Supplier writer',async()=>{
  genericMode='unified';
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList [data-page="hisabiqParties"]').click();
    await page.locator('#hparty-source-mode').getByText('Unified Party identities').waitFor();
    assert.equal(await page.locator('#hparty-add-party').isEnabled(),false);
    assert.match(await page.locator('#hparty-add-party').innerText(),/Add Party/);
  }finally{genericMode='source-only';await page.close();}
});

test('read-only Party never triggers a new financial POST or clones missing Customer dues',()=>{
  assert.equal(audit.financialPosts,0);
  assert.ok(audit.partyReads>=1,'Attempted only approved Party read route');
  assert.ok(audit.supplierReads>=1,'Fallback from explicit 404 reads existing Supplier source');
});
