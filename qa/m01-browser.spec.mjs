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
