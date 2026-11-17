import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

let server;
let browser;

before(async () => {
  server = await serveCompiledUi();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}: {})
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('desktop browser displays real legacy sign-in without revealing the protected shell', async () => {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const pageErrors=[];
  page.on('pageerror', error=>pageErrors.push(error.message));
  try {
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await assert.doesNotReject(()=>page.locator('#loginOverlay:not([hidden])').waitFor());
    assert.equal(await page.locator('#loginMobile').count(),1);
    assert.equal(await page.locator('#loginPassword').count(),1);
    assert.equal(await page.locator('#printHost').count(),1);
    assert.equal(await page.locator('#floatingHScroll').count(),1);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.deepEqual(pageErrors,[]);
    await saveArtifact(page,'desktop-1280.png');
  } finally { await page.close(); }
});


test('mobile sign-in is reachable and fits the 375px viewport',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  try {
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const box=await page.locator('.login-card').boundingBox();
    assert.ok(box && box.width>200,'login card must be visible');
    assert.ok(box.x>=-1,'login card cannot extend off left edge');
    assert.ok(box.x+box.width<=376,'login card cannot extend off right edge');
    assert.equal(await page.locator('#loginSubmitBtn').isVisible(),true);
    await saveArtifact(page,'mobile-375.png');
  }finally{await page.close();}
});

test('an unsuccessful login stays unauthenticated and shows a controlled failure',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.locator('#loginMobile').fill('01700000000'); // synthetic, not customer data
    await page.locator('#loginPassword').fill('invalid-fixture');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/rpc') &&
      r.request().method()==='POST' &&
      r.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginSubmitBtn').click();
    const rpc=await response;
    assert.equal(rpc.status(),503);
    await page.locator('#loginError').getByText('Sign-in is unavailable because server authentication is not configured yet.').waitFor();
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.locator('#loginSubmitBtn').isEnabled(),true);
  }finally{await page.close();}
});

test('Chromium print media preserves A4 invoice header repeats and row non-splitting',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      const host=document.getElementById('printHost');
      host.innerHTML='<div class="invoice-paper"><div class="invoice-page">'+
        '<table class="inv-table"><thead><tr><th>Product</th><th>Qty</th></tr></thead>'+
        '<tbody><tr><td>Fixture item</td><td>1</td></tr></tbody></table></div></div>';
      document.body.classList.add('printing-invoice');
    });
    await page.emulateMedia({media:'print'});
    const styles=await page.evaluate(()=>{
      const css=(selector,prop)=>getComputedStyle(document.querySelector(selector)).getPropertyValue(prop);
      return {
        host:css('#printHost','display'),
        shell:css('#app','display'),
        thead:css('.inv-table thead','display'),
        breakInside:css('.inv-table tbody tr','break-inside')
      };
    });
    assert.equal(styles.host,'block');
    assert.equal(styles.shell,'none');
    assert.equal(styles.thead,'table-header-group');
    assert.equal(styles.breakInside,'avoid');
    const pdf=await page.pdf({format:'A4',printBackground:true});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    assert.ok(pdf.length>1000);
    await saveArtifactBuffer(pdf,'synthetic-a4.pdf');
  }finally{await page.close();}
});

import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const artifactDirectory=join(process.cwd(),'test-results','m01-browser');
async function saveArtifact(page,filename){
  await mkdir(artifactDirectory,{recursive:true});
  await page.screenshot({path:join(artifactDirectory,filename),fullPage:true});
}
async function saveArtifactBuffer(bytes,filename){
  await mkdir(artifactDirectory,{recursive:true});
  await writeFile(join(artifactDirectory,filename),bytes);
}

test('original invoice A4 renderer keeps exact 1/25/49-item physical page boundaries', async (t) => {
  // Synthetic only: invoke the frozen javascript.html renderer, never an
  // emulated invoice function, logged-in POS session, or financial RPC.
  for (const count of [1, 25, 49]) {
    await t.test(count + ' original source items', async () => {
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try {
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        const structure=await page.evaluate((itemCount)=>{
          if(typeof renderInvoicePrintHtml_!=='function')
            throw new Error('Original print renderer unavailable in compiled frontend');
          const items=Array.from({length:itemCount},(_,i)=>({
            name:'Synthetic cable '+String(i+1),
            qty:1,unit:'pcs',unitPrice:10,lineTotal:10
          }));
          const inv={
            invoiceId:'M01-PRINT-'+itemCount,date:'2026-11-15',
            customerName:'Synthetic Customer',customerPhone:'',
            items,subtotal:itemCount*10,discount:0,
            grandTotal:itemCount*10,paidAmount:itemCount*10,dueAmount:0,
            paymentMethod:'Cash',payments:[],
            shop:{
              name:'Synthetic Hardware',nameBangla:'',address:'',
              phone1:'',phone2:'',currencySymbol:'৳',
              showBismillah:false,showSignature:false,
              footer:'Synthetic footer — not a real invoice',
              paymentMethods:'[]',terms:'[]'
            }
          };
          const host=document.getElementById('printHost');
          host.innerHTML='<div class="invoice-paper">'+renderInvoicePrintHtml_(inv)+'</div>';
          document.body.classList.add('printing-invoice');
          const pages=[...host.querySelectorAll('.invoice-print-page')];
          return {
            count:pages.length,
            rows:pages.map(el=>el.querySelectorAll('.inv-table tbody tr').length),
            headers:pages.map(el=>el.querySelectorAll('.inv-header, .inv-table thead').length),
            customers:pages.map(el=>el.querySelectorAll('.inv-customer-info-row').length),
            totals:pages.map(el=>el.querySelectorAll('.inv-bottom').length),
            footers:pages.map(el=>el.querySelectorAll('.inv-footer-block').length),
            paidBadges:pages.map(el=>el.querySelectorAll('.inv-paid-badge').length),
            firstIndex:pages[0].querySelector('.inv-table tbody tr .idx')?.textContent,
            lastIndex:pages.at(-1).querySelector('.inv-table tbody tr:last-child .idx')?.textContent,
            expectedLastIndex:toBn_(itemCount)
          };
        },count);
        const pageCount=Math.ceil(count/24);
        assert.equal(structure.count,pageCount,'original renderer chunk count');
        assert.deepEqual(structure.rows,Array.from({length:pageCount},(_,i)=>Math.min(24,count-i*24)));
        assert.deepEqual(structure.headers,Array(pageCount).fill(2),'shop and table headers repeated');
        assert.deepEqual(structure.customers,Array.from({length:pageCount},(_,i)=>i===0?1:0));
        assert.deepEqual(structure.totals,Array.from({length:pageCount},(_,i)=>i===pageCount-1?1:0));
        assert.deepEqual(structure.footers,Array.from({length:pageCount},(_,i)=>i===pageCount-1?1:0));
        assert.deepEqual(structure.paidBadges,Array.from({length:pageCount},(_,i)=>i===pageCount-1?1:0));
        assert.equal(structure.firstIndex,'১');
        assert.equal(structure.lastIndex,structure.expectedLastIndex,'row indices continue across pages');

        await page.emulateMedia({media:'print'});
        const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});
        assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
        const physicalPages=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.equal(physicalPages,pageCount,'original invoice must print without overflow or blank A4 pages');
        await saveArtifactBuffer(pdf,'original-invoice-'+count+'-a4.pdf');
      } finally { await page.close(); }
    });
  }
});


test('original login Enter key validates blank fields locally then rejects one real Worker RPC', async () => {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const loginRequests=[];
  try {
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    page.on('request',request=>{
      if(request.url().endsWith('/api/rpc') && request.method()==='POST' &&
         request.postDataJSON()?.fnName==='login')loginRequests.push(request);
    });
    await page.locator('#loginMobile').press('Enter');
    await page.locator('#loginError').getByText('Enter your mobile number and password.').waitFor();
    assert.equal(loginRequests.length,0,'blank input must not send a login RPC');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');

    await page.locator('#loginMobile').fill('01700000000');
    await page.locator('#loginPassword').fill('synthetic-invalid-password');
    const rpcResponse=page.waitForResponse(response=>response.url().endsWith('/api/rpc') &&
      response.request().method()==='POST' &&
      response.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginPassword').press('Enter');
    const reply=await rpcResponse;
    assert.equal(reply.status(),503,'real public Worker has no active login backend');
    await page.locator('#loginError').getByText('Sign-in is unavailable because server authentication is not configured yet.').waitFor();
    await page.locator('#loginSubmitBtn:not([disabled])').waitFor();
    assert.equal(await page.locator('#loginSubmitBtn').getAttribute('aria-busy'),'false');
    assert.equal(loginRequests.length,1,'Enter on password must submit exactly once');
    assert.deepEqual(loginRequests[0].postDataJSON().args,['01700000000','synthetic-invalid-password']);
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});

test('original login Show/Hide is keyboard-activatable without sending credentials',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  let loginCount=0;
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    page.on('request',request=>{
      if(request.url().endsWith('/api/rpc') && request.method()==='POST' &&
        request.postDataJSON()?.fnName==='login')loginCount++;
    });
    const password=page.locator('#loginPassword');
    const toggle=page.locator('#loginTogglePassword');
    await password.fill('synthetic-keyboard-password');
    assert.equal(await password.getAttribute('type'),'password');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await password.getAttribute('type'),'text');
    assert.equal(await toggle.textContent(),'Hide');
    assert.equal(await password.inputValue(),'synthetic-keyboard-password');
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await password.getAttribute('type'),'password');
    assert.equal(await toggle.textContent(),'Show');
    assert.equal(await password.inputValue(),'synthetic-keyboard-password');
    assert.equal(loginCount,0,'visibility toggle must never submit');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});

test('original mobile sign-in controls fit and remain tappable at 320px',async()=>{
  const width=320;
  const page=await browser.newPage({viewport:{width,height:640},isMobile:true,hasTouch:true});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const targets=['.login-card','#loginMobile','#loginPassword','#loginTogglePassword','#loginSubmitBtn'];
    for(const selector of targets){
      const locator=page.locator(selector);
      assert.equal(await locator.isVisible(),true,selector+' is visible');
      const rect=await locator.boundingBox();
      assert.ok(rect && rect.width>0,selector+' has positive width');
      assert.ok(rect.x>=-1,selector+' stays inside left edge');
      assert.ok(rect.x+rect.width<=width+1,selector+' stays inside right edge');
    }
    await page.locator('#loginTogglePassword').tap();
    assert.equal(await page.locator('#loginPassword').getAttribute('type'),'text');
    await page.locator('#loginTogglePassword').tap();
    assert.equal(await page.locator('#loginPassword').getAttribute('type'),'password');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    await saveArtifact(page,'mobile-320-login.png');
  }finally{await page.close();}
});


test('rejected login permits one intentional retry without creating a browser session',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const attempts=[];
  const matchesLogin=request=>request.url().endsWith('/api/rpc') &&
    request.method()==='POST' && request.postDataJSON()?.fnName==='login';
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    page.on('request',request=>{if(matchesLogin(request))attempts.push(request.postDataJSON().args);});
    await page.locator('#loginMobile').fill('01700000000');
    await page.locator('#loginPassword').fill('invalid-synthetic-first');
    for(const [index,password] of ['invalid-synthetic-first','invalid-synthetic-retry'].entries()){
      if(index===1)await page.locator('#loginPassword').fill(password);
      const response=page.waitForResponse(r=>matchesLogin(r.request()));
      if(index===0)await page.locator('#loginSubmitBtn').click();
      else await page.locator('#loginPassword').press('Enter');
      const rpc=await response;
      assert.equal(rpc.status(),503,'inert Worker must never authenticate a test user');
      await page.locator('#loginError').getByText(
        'Sign-in is unavailable because server authentication is not configured yet.').waitFor();
      await page.locator('#loginSubmitBtn:not([disabled])').waitFor();
      assert.equal(await page.locator('#loginSubmitBtn').getAttribute('aria-busy'),'false');
      assert.equal(await page.locator('#loginOverlay').isVisible(),true);
      assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
      assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
      assert.equal(attempts.length,index+1,'one RPC per intentional attempt');
    }
    assert.deepEqual(attempts,[
      ['01700000000','invalid-synthetic-first'],
      ['01700000000','invalid-synthetic-retry']
    ]);
  }finally{await page.close();}
});

test('stale browser token is rejected, cleared and not revalidated on next reload',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const validations=[];
  const matchesValidation=request=>request.url().endsWith('/api/rpc') &&
    request.method()==='POST' && request.postDataJSON()?.fnName==='validateSession';
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.evaluate(()=>localStorage.setItem('hwerp.session.token','f'.repeat(64)));
    page.on('request',request=>{
      if(matchesValidation(request))validations.push(request.postDataJSON().args);
    });
    const validation=page.waitForResponse(r=>matchesValidation(r.request()));
    await page.reload({waitUntil:'domcontentloaded'});
    const rpc=await validation;
    assert.equal(rpc.status(),501,'public Worker has no session-validation implementation');
    assert.deepEqual(validations,[['f'.repeat(64)]]);
    await page.waitForFunction(()=>localStorage.getItem('hwerp.session.token')===null);
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.evaluate(()=>authToken),'');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    assert.equal(validations.length,1,'cleared token must not be revalidated');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});


test('original thermal renderer prints short 58mm and 80mm receipts at actual paper width', async t=>{
  for(const size of ['58mm','80mm']){
    await t.test(size+' original receipt',async()=>{
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        const structure=await page.evaluate(receiptSize=>{
          if(typeof renderInvoiceHtmlThermal_!=='function')
            throw new Error('Original thermal renderer unavailable in compiled frontend');
          const inv={
            invoiceId:'M01-THERMAL-SYNTHETIC',date:'2026-11-15',
            customerName:'Synthetic Buyer',customerPhone:'',
            items:[
              {name:'Synthetic cable',qty:1,unit:'pcs',unitPrice:50,lineTotal:50},
              {name:'Synthetic switch',qty:2,unit:'pcs',unitPrice:35,lineTotal:70}
            ],
            subtotal:120,discount:20,grandTotal:100,paidAmount:100,dueAmount:0,
            customerCreditUsed:0,paymentMethod:'Cash',
            payments:[{method:'Cash',applied:100,tendered:110,change:10}],
            shop:{
              name:'Synthetic Hardware',nameBangla:'',address:'Synthetic Road',
              phone1:'',phone2:'',currencySymbol:'৳',receiptSize,
              showBismillah:false,showSignature:false,
              terms:'[{"text":"Synthetic terms excluded from thermal"}]',
              paymentMethods:'[{"label":"Synthetic payment chip","value":"000"}]',
              footer:'A4-only footer'
            }
          };
          const host=document.getElementById('printHost');
          host.innerHTML='<div class="invoice-paper thermal'+
            (receiptSize==='58mm'?' size-58':'')+'">'+renderInvoiceHtmlThermal_(inv)+'</div>';
          document.body.classList.add('printing-invoice');
          const paper=host.querySelector('.invoice-paper');
          return {
            namedPage:getComputedStyle(paper).getPropertyValue('page').trim(),
            pages:host.querySelectorAll('.thermal-page').length,
            items:host.querySelectorAll('.thermal-item').length,
            breakdown:host.querySelectorAll('.thermal-payment-breakdown').length,
            text:host.innerText,
            a4Tables:host.querySelectorAll('.inv-table').length,
            a4Footers:host.querySelectorAll('.inv-footer-block, .inv-signatures, .inv-payment-chip').length
          };
        },size);
        assert.equal(structure.namedPage,size==='58mm'?'thermal58':'thermal80');
        assert.equal(structure.pages,1);
        assert.equal(structure.items,2);
        assert.equal(structure.breakdown,1);
        assert.equal(structure.a4Tables,0);
        assert.equal(structure.a4Footers,0);
        assert.match(structure.text,/Synthetic cable/);
        assert.match(structure.text,/Synthetic switch/);
        assert.match(structure.text,/Payments at Sale/);
        assert.match(structure.text,/Cash Change:/);
        assert.doesNotMatch(structure.text,/A4-only footer|Synthetic terms excluded from thermal|Synthetic payment chip/);
        await page.emulateMedia({media:'print'});
        const pdf=await page.pdf({printBackground:true,preferCSSPageSize:true});
        assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
        const body=pdf.toString('latin1');
        const physicalPages=[...body.matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.equal(physicalPages,1,'short thermal receipt must not print a blank page');
        const mediaBox=body.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
        assert.ok(mediaBox,'Chromium PDF must expose physical page MediaBox');
        const expectedWidth=(size==='58mm'?58:80)*72/25.4;
        assert.ok(Math.abs(Number(mediaBox[1])-expectedWidth)<1.5,
          size+' PDF paper width must match configured thermal roll, not A4');
        await saveArtifactBuffer(pdf,'original-thermal-'+size+'.pdf');
      }finally{await page.close();}
    });
  }
});

test('original thermal draft renderer shows draft marker without A4-only paid decoration',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(()=>{
      const source={
        invoiceId:'M01-SYNTHETIC-DRAFT',date:'2026-11-15',customerName:'Synthetic Buyer',
        items:[{name:'Synthetic item',qty:1,unitPrice:10,lineTotal:10}],
        subtotal:10,discount:0,grandTotal:10,paidAmount:0,dueAmount:10,
        shop:{name:'Synthetic Shop',currencySymbol:'৳',receiptSize:'58mm'}
      };
      const host=document.getElementById('printHost');
      const render=isDraft=>{
        host.innerHTML='<div class="invoice-paper thermal size-58">'+
          renderInvoiceHtmlThermal_({...source,isDraft})+'</div>';
        return {
          draft:host.querySelectorAll('.thermal-draft').length,
          due:host.querySelectorAll('.thermal-due').length,
          paid:host.querySelectorAll('.inv-paid-badge').length,
          rows:host.querySelectorAll('.thermal-item').length
        };
      };
      return {draft:render(true),normal:render(false)};
    });
    assert.deepEqual(result.draft,{draft:1,due:1,paid:0,rows:1});
    assert.deepEqual(result.normal,{draft:0,due:1,paid:0,rows:1});
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});


test('rapid Enter while sign-in is pending sends only one RPC and permits retry afterward',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const requests=[];
  let startFirst,releaseFirst;
  const firstRequest=new Promise(resolve=>{startFirst=resolve;});
  const pendingFirst=new Promise(resolve=>{releaseFirst=resolve;});
  const errorMessage='Sign-in is unavailable because server authentication is not configured yet.';
  try{
    await page.route('**/api/rpc',async route=>{
      const payload=route.request().postDataJSON();
      if(payload?.fnName!=='login')return route.continue();
      requests.push(payload);
      if(requests.length===1){
        startFirst();
        await pendingFirst;
      }
      await route.fulfill({
        status:503,contentType:'application/json',
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
        body:JSON.stringify({success:false,message:errorMessage})
      });
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.locator('#loginMobile').fill('01700000000');
    await page.locator('#loginPassword').fill('invalid-synthetic-pending');
    await page.locator('#loginPassword').press('Enter');
    await firstRequest;
    assert.equal(await page.locator('#loginSubmitBtn').isDisabled(),true,
      'the original login shows its existing pending UI');
    await page.locator('#loginPassword').press('Enter');
    await page.locator('#loginPassword').press('Enter');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(
      ()=>requestAnimationFrame(resolve))));
    assert.equal(requests.length,1,'pending Enter key must not dispatch duplicate login RPCs');
    releaseFirst();
    await page.locator('#loginError').getByText(errorMessage).waitFor();
    await page.locator('#loginSubmitBtn:not([disabled])').waitFor();
    assert.equal(await page.locator('#loginSubmitBtn').getAttribute('aria-busy'),'false');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    const retry=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().method()==='POST' &&
      response.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginPassword').press('Enter');
    const response=await retry;
    assert.equal(response.status(),503);
    assert.equal(requests.length,2,'after pending clears one intentional retry is allowed');
    assert.deepEqual(requests.map(request=>request.args),[
      ['01700000000','invalid-synthetic-pending'],
      ['01700000000','invalid-synthetic-pending']
    ]);
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
  }finally{
    releaseFirst?.();
    await page.close();
  }
});


test('a successful original login never exposes a partial app if shell metadata fails',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const token='d'.repeat(64);
  const requests=[];
  try{
    await page.route('**/api/rpc',async route=>{
      const request=route.request().postDataJSON();
      requests.push(request.fnName);
      if(request.fnName==='getAppShellData'){
        return route.fulfill({
          status:503,contentType:'application/json',
          body:JSON.stringify({success:false,message:'Synthetic app shell unavailable'})
        });
      }
      if(request.fnName==='login'){
        return route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({success:true,data:{
            token,user:{id:'M01-SYNTHETIC',name:'Synthetic Test User',
              mobile:'01710000999',role:'Clerk'},
            allowedModules:['dashboard'],permissions:{dashboard:{view:true}}
          }})
        });
      }
      return route.continue();
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.waitForFunction(()=>appShellDataPromise_===null,
      null,{timeout:5000});
    assert.equal(requests.filter(n=>n==='getAppShellData').length,1,
      'original pre-login branding must first fail safely');
    await page.locator('#loginMobile').fill('01710000999');
    await page.locator('#loginPassword').fill('synthetic-no-real-password');
    const loginReply=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginPassword').press('Enter');
    assert.equal((await loginReply).status(),200);
    await page.locator('#toast').getByText('Synthetic app shell unavailable').waitFor();
    assert.equal(requests.filter(n=>n==='getAppShellData').length,2,
      'original source retries app-shell metadata after login');
    assert.equal(await page.locator('#loginOverlay').isVisible(),true,
      'if app metadata is unavailable, restore locked login overlay');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),
      'hidden','never reveal partially initialized business navigation');
    assert.equal(await page.locator('#navList .nav-item').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),
      token,'transient shell failure must not orphan a valid server session');

    // Public Worker must still reject subsequent validation; the original
    // bootstrap clears its stale test token on reload.
    const validate=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().postDataJSON()?.fnName==='validateSession');
    await page.reload({waitUntil:'domcontentloaded'});
    assert.equal((await validate).status(),501);
    await page.waitForFunction(()=>
      localStorage.getItem('hwerp.session.token')===null);
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),
      'hidden');
  }finally{
    await page.close();
  }
});


test('synthetic successful login with malformed role data must not unlock original Chromium shell',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const user={id:'USR-M01-PROFILE',name:'Synthetic Clerk',
    mobile:'01710000009',role:'Clerk'};
  const token='f'.repeat(64);
  const normal={token,user,allowedModules:['dashboard'],
    permissions:{dashboard:{view:true}}};
  const candidates=[
    {...normal,allowedModules:null,permissions:null},
    {token,user,permissions:{dashboard:{view:true}}},
    {...normal,user:{...user,role:'Administrator'}},
    {...normal,token:'malformed-session'}
  ];
  const shell={
    shopName:'Synthetic Browser Shell',currencySymbol:'৳',
    navItems:[{key:'dashboard',label:'Dashboard',
      icon:'dashboard',sidebarGroup:0,sidebarOrder:1},
      {key:'bank',label:'Bank Accounts',icon:'bank',
      sidebarGroup:4,sidebarOrder:2}]
  };
  let next=normal,logins=0,shellReads=0;
  try{
    await page.route('**/api/rpc',async route=>{
      const payload=route.request().postDataJSON();
      if(payload.fnName==='login'){
        logins++;
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({success:true,data:next})});
      }
      if(payload.fnName==='getAppShellData'){
        shellReads++;
        return route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify({success:true,data:shell})});
      }
      return route.continue();
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.waitForFunction(()=>
      document.getElementById('loginShopName')?.textContent==='Synthetic Browser Shell');
    for(const [index,candidate] of candidates.entries()){
      next=candidate;
      await page.locator('#loginMobile').fill('01710000009');
      await page.locator('#loginPassword').fill('synthetic-never-real');
      const loginReply=page.waitForResponse(response=>
        response.url().endsWith('/api/rpc') &&
        response.request().postDataJSON()?.fnName==='login');
      await page.locator('#loginPassword').press('Enter');
      assert.equal((await loginReply).status(),200,'malformed response is HTTP success');
      await page.locator('#loginError').getByText(
        'Invalid authentication response').waitFor({timeout:3000});
      await page.locator('#loginSubmitBtn:not([disabled])').waitFor();
      assert.equal(await page.locator('#loginOverlay').isVisible(),true,
        'malformed login '+index+' cannot reveal private navigation');
      assert.equal(await page.locator('#app').evaluate(
        el=>getComputedStyle(el).visibility),'hidden');
      assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),
        null,'invalid profile cannot persist a token');
      assert.equal(await page.locator('#navList .nav-item').count(),0);
    }
    assert.equal(logins,candidates.length);
    assert.equal(shellReads,1,'prelogin branding is reused, not leaked on invalid login');
    next=normal;
    await page.locator('#loginPassword').fill('synthetic-never-real');
    await page.locator('#loginPassword').press('Enter');
    await page.waitForFunction(()=>document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#navList .nav-item[data-page="dashboard"]').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),token);
    assert.equal(await page.locator('#navList .nav-item[data-page="bank"]').count(),0,
      'valid Clerk role must retain source role-filtered navigation');
    assert.equal(shellReads,1);
  }finally{
    await page.close();
  }
});


test('original Chromium refuses a validateSession reply with a different bearer',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const saved='a'.repeat(64);
  const substituted='b'.repeat(64);
  const calls=[];
  try{
    await page.addInitScript(token=>{
      window.localStorage.setItem('hwerp.session.token',token);
    },saved);
    await page.route('**/api/rpc',async route=>{
      const payload=route.request().postDataJSON();
      calls.push(payload);
      if(payload.fnName==='validateSession'){
        return route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({success:true,data:{
            token:substituted,
            user:{id:'SYNTHETIC-M01',name:'Synthetic Clerk',
              mobile:'01710000001',role:'Clerk'},
            allowedModules:['dashboard'],permissions:{dashboard:{view:true}}
          }})
        });
      }
      if(payload.fnName==='getAppShellData'){
        return route.fulfill({
          status:200,contentType:'application/json',
          body:JSON.stringify({success:true,data:{
            shopName:'Synthetic Restored Shop',currencySymbol:'৳',
            navItems:[{key:'dashboard',label:'Dashboard',icon:'dashboard',
              sidebarGroup:0,sidebarOrder:10}]
          }})
        });
      }
      return route.continue();
    });
    const validation=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().postDataJSON()?.fnName==='validateSession');
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    assert.equal((await validation).status(),200,
      'the test response is HTTP success, so restore must verify its token');
    await page.waitForFunction(()=>
      window.localStorage.getItem('hwerp.session.token')===null,
      null,{timeout:5000});
    assert.deepEqual(
      calls.filter(x=>x.fnName==='validateSession').map(x=>x.args),
      [[saved]],'original browser must submit only the initially saved token');
    assert.equal(await page.locator('#loginOverlay').isVisible(),true,
      'a substituted session must not unlock protected navigation');
    assert.equal(await page.locator('#app').evaluate(
      el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.locator('#navList .nav-item').count(),0,
      'no protected sidebar is constructed after a mismatched validation');
    assert.equal(calls.filter(x=>x.fnName==='login').length,0,
      'bootstrap never invents a fresh login');
  }finally{
    await page.close();
  }
});


test('HisabIQ dashboard source-parity smoke: six cards, four panels, custom layout and safe details',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:840}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      // Browser-only synthetic fixture: bypasses no Worker auth or D1 gate.
      window.authToken='synthetic-m01-dashboard-fixture';
      window.currentUser={id:'M01-DASH-01',tenantId:'M01-DASH-SHOP',role:'Administrator'};
      window.allowedModules=null;
      document.getElementById('loginOverlay').hidden=true;
      document.getElementById('app').style.visibility='';
      document.getElementById('shopNameLabel').textContent='Synthetic M01 Store';
      window.dispatchEvent(new Event('focus'));
    });
    const count=selector=>page.locator(selector).count();
    assert.equal(await count('#hisabiq-dashboard-metrics > [data-hdb-widget]:visible'),6);
    assert.equal(await count('#hisabiq-dashboard-panels > [data-hdb-widget]:visible'),4);
    await page.locator('#dashSales').evaluate(node=>{node.textContent='৳1,234';});
    await page.waitForFunction(()=>document.querySelector('[data-hdb-value="dashSales"]').textContent==='৳1,234');
    assert.equal(await page.locator('[data-hdb-value="unavailable"]').textContent(),'—');
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('[data-hdb-widget="today-sales"] [data-hdb-action="move-next"]').click();
    const first=await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first().getAttribute('data-hdb-widget');
    assert.equal(first,'receivable','editable dashboard reorders within the metric group');
    await page.locator('[data-hdb-widget="low-stock"] [data-hdb-action="hide"]').click();
    assert.equal(await page.locator('[data-hdb-widget="low-stock"]').isVisible(),false);
    await page.locator('#hdb-all-widgets').click();
    await page.locator('[data-hdb-list="metric"] [data-hdb-id="low-stock"] [role="switch"]').click();
    assert.equal(await page.locator('[data-hdb-widget="low-stock"]').isVisible(),true);
    await page.locator('[data-hdb-action="dialog-close"]').click();
    await page.locator('[data-hdb-action="finish"]').click();
    await saveArtifact(page,'hisabiq-dashboard-1280.png');
    await page.locator('[data-hdb-widget="today-sales"] .hdb-widget').click();
    assert.equal(await page.locator('#page-sales').isVisible(),true,
      'summary card opens the existing permission-checked Sales page');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});


test('HisabIQ Dashboard Step 1: source visual layout is responsive at 320/390/768/1440',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      // Static UI-only test actor; does not grant a real Worker or D1 session.
      window.authToken='synthetic-m01-visual-actor';
      window.currentUser={id:'M01-VISUAL-1',tenantId:'M01-SYNTHETIC-SHOP',
        name:'Visual Fixture',role:'Administrator'};
      window.allowedModules=null;
      document.getElementById('loginOverlay').hidden=true;
      document.getElementById('app').style.visibility='';
      document.getElementById('shopNameLabel').textContent='Visual Fixture Store';
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(()=>
      document.querySelector('#hdb-welcome-title')?.textContent.includes('Visual Fixture'));
    assert.equal(await page.locator('#hdb-welcome-bn').isVisible(),true);
    assert.ok((await page.locator('#hdb-subtitle-bn').innerText()).length>5);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]:visible svg[data-hdb-icon]').count(),6);
    assert.equal(await page.locator('.hdb-chart-shell').count(),2);
    assert.ok(await page.locator('[data-hdb-chart="sales-trend"]').evaluate(n=>n.getBoundingClientRect().height>=220));
    assert.equal(await page.locator('.hdb-panel-head').first().evaluate(n=>getComputedStyle(n).borderBottomWidth),'1px');
    await mkdir('test-results/m01-browser',{recursive:true});
    for(const [width,height,metrics,panels] of [
      [320,760,2,1],[390,844,2,1],[768,960,3,1],[1440,900,6,3]
    ]){
      await page.setViewportSize({width,height});
      const result=await page.evaluate(()=>{
        const element=document.getElementById('hisabiq-dashboard');
        const metric=document.getElementById('hisabiq-dashboard-metrics');
        const panel=document.getElementById('hisabiq-dashboard-panels');
        const columnCount=node=>getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length;
        const rect=element.getBoundingClientRect();
        return {metricColumns:columnCount(metric),panelColumns:columnCount(panel),
          left:rect.left,right:rect.right,viewport:window.innerWidth};
      });
      assert.equal(result.metricColumns,metrics,'metric columns at '+width);
      assert.equal(result.panelColumns,panels,'panel columns at '+width);
      assert.ok(result.left>=-1 && result.right<=result.viewport+1,
        'dashboard must stay inside '+width+'px viewport: '+JSON.stringify(result));
      await saveArtifact(page,'hisabiq-dashboard-step1-'+width+'.png');
    }
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});


async function authorizeDashboardStep2_(page,user='M01-STEP2-USER-A',tenant='M01-STEP2-STORE-A'){
  await page.evaluate(({user,tenant})=>{
    // Synthetic browser UI session only; no Worker or D1 authority is granted.
    window.authToken='m01-step2-synthetic-token';
    window.currentUser={id:user,tenantId:tenant,name:'Step2 Fixture',role:'Administrator'};
    window.allowedModules=null;
    document.getElementById('loginOverlay').hidden=true;
    document.getElementById('app').style.visibility='';
    document.getElementById('shopNameLabel').textContent='Step2 Synthetic Store';
    window.dispatchEvent(new Event('focus'));
  },{user,tenant});
}

test('M01 Step 2: mouse/keyboard reorder metric and panel groups, toggle hidden, reset and focus restore',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await authorizeDashboardStep2_(page);
    await page.locator('#hisabiq-dashboard-customize').click();
    const hint=page.locator('#hdb-edit-hint [data-hdb-action="show-hidden"]');
    assert.match(await hint.innerText(),/5/,'five optional metrics start hidden');
    await page.locator('[data-hdb-widget="low-stock"] [data-hdb-action="hide"]').click();
    assert.match(await hint.innerText(),/6/,'hiding a card increments hidden count');

    await page.locator('#hdb-all-widgets').click();
    const dlg=page.locator('#hisabiq-dashboard-dialog');
    assert.equal(await dlg.isVisible(),true);
    assert.equal(await page.locator('#hdb-dialog-desc').count(),1);
    assert.equal(await page.locator('[data-hdb-list="metric"] > [data-hdb-id]').count(),11,
      'six default + five optional metric widgets');

    const from=page.locator('[data-hdb-list="metric"] [data-hdb-id="payable"]');
    const to=page.locator('[data-hdb-list="metric"] [data-hdb-id="today-sales"]');
    await from.dragTo(to);
    let ids=await page.locator('[data-hdb-list="metric"] > [data-hdb-id]')
      .evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbId));
    assert.equal(ids[0],'payable','native mouse drag reorders metric widgets');

    const panelGrip=page.locator('[data-hdb-list="panel"] [data-hdb-id="cashflow"] [data-hdb-action="drag-grip"]');
    await panelGrip.focus();
    await panelGrip.press('ArrowUp');
    ids=await page.locator('[data-hdb-list="panel"] > [data-hdb-id]')
      .evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbId));
    assert.equal(ids[0],'cashflow','keyboard grip moves panels');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.hdbAction),'drag-grip',
      'focus must remain on the moved grip');
    const switchButton=page.locator('[data-hdb-list="metric"] [data-hdb-id="low-stock"] [role="switch"]');
    await switchButton.focus();
    await switchButton.press('Space');
    assert.equal(await switchButton.getAttribute('aria-checked'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'switch',
      'focus survives the toggled switch re-render');

    await page.evaluate(()=>document.getElementById('refreshBtn').focus());
    assert.equal(await page.evaluate(()=>document.activeElement.closest('#hisabiq-dashboard-dialog')!==null),
      true,'focus cannot escape an open modal');
    await saveArtifact(page,'hisabiq-dashboard-step2-dialog-1280.png');
    await page.keyboard.press('Escape');
    assert.equal(await dlg.isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'hdb-all-widgets',
      'Escape restores focus to the launching control');
    await page.locator('[data-hdb-action="finish"]').click();
    const layout=await page.locator('#hisabiq-dashboard-panels > [data-hdb-widget]')
      .evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbWidget));
    assert.equal(layout[0],'cashflow');
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    await page.locator('[data-hdb-action="reset"]').click();
    const defaults=await page.locator('[data-hdb-list="metric"] > [data-hdb-id]')
      .evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbId));
    assert.equal(defaults[0],'today-sales','reset restores original order');
    assert.equal(await page.locator('[data-hdb-list="metric"] [data-hdb-id="low-stock"] [role="switch"]')
      .getAttribute('aria-checked'),'true');
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('M01 Step 2: same user across tenants and other actors get isolated saved layouts; malformed JSON self-heals',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try{
    await page.goto(server.url);
    await authorizeDashboardStep2_(page);
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    await page.locator('[data-hdb-list="metric"] [data-hdb-id="today-sales"] [data-hdb-action="list-next"]').click();
    assert.equal(await page.locator('[data-hdb-list="metric"] > [data-hdb-id]').first()
      .getAttribute('data-hdb-id'),'receivable');
    await page.locator('[data-hdb-action="dialog-close"]').click();
    await page.locator('[data-hdb-action="finish"]').click();
    await page.reload();
    await authorizeDashboardStep2_(page);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first()
      .getAttribute('data-hdb-widget'),'receivable','same user layout should survive reload');

    await authorizeDashboardStep2_(page,'M01-STEP2-USER-A','M01-STEP2-STORE-B');
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first()
      .getAttribute('data-hdb-widget'),'today-sales','tenant B must not inherit tenant A');
    await authorizeDashboardStep2_(page,'M01-STEP2-USER-B','M01-STEP2-STORE-A');
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first()
      .getAttribute('data-hdb-widget'),'today-sales','user B must not inherit user A');
    await authorizeDashboardStep2_(page);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first()
      .getAttribute('data-hdb-widget'),'receivable');

    await page.evaluate(()=>{
      const key=Object.keys(localStorage).find(k=>k.startsWith('shererp.hisabiq.dashboard.v1:') &&
        k.includes('M01-STEP2-STORE-A') && k.includes('M01-STEP2-USER-A'));
      if(!key)throw Error('expected scoped actor-specific key');
      localStorage.setItem(key,'{"invalid":true}');
    });
    await page.reload();await authorizeDashboardStep2_(page);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first()
      .getAttribute('data-hdb-widget'),'today-sales','malformed saved layout falls back safely');

    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    await page.evaluate(()=>{
      window.authToken='';
      window.currentUser=null;
      document.getElementById('loginOverlay').hidden=false;
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(()=>
      document.getElementById('hisabiq-dashboard-dialog').hidden===true &&
      !document.getElementById('hisabiq-dashboard').classList.contains('is-editing'));
  }finally{await page.close();}
});

test('M01 Step 2: mobile touch drag reorders widgets without horizontal overflow',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    await page.goto(server.url);
    await authorizeDashboardStep2_(page);
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    const from=page.locator('[data-hdb-list="metric"] [data-hdb-id="receivable"] [data-hdb-action="drag-grip"]');
    const to=page.locator('[data-hdb-list="metric"] [data-hdb-id="today-sales"] [data-hdb-action="drag-grip"]');
    await from.scrollIntoViewIfNeeded();
    const start=await from.boundingBox(),end=await to.boundingBox();
    assert.ok(start&&end);
    const sx=start.x+start.width/2,sy=start.y+start.height/2;
    const tx=end.x+end.width/2,ty=end.y+end.height/2;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
    for(let i=1;i<=6;i++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
        touchPoints:[{x:sx+(tx-sx)*i/6,y:sy+(ty-sy)*i/6}]});
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const ids=await page.locator('[data-hdb-list="metric"] > [data-hdb-id]')
      .evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbId));
    assert.equal(ids[0],'receivable','touch pointer drag reorders metric list');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(overflow<=2,'mobile 390px should not horizontally scroll: '+overflow);
    await saveArtifact(page,'hisabiq-dashboard-step2-touch-390.png');
  }finally{await page.close();}
});
