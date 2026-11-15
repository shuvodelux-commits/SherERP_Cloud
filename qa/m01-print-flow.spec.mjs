import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Dedicated original-source print lifecycle regression. Do not fake successful
// authentication, actual printer output, transactional posting or Worker D1.
let server;
let browser;
before(async()=>{
  server=await serveCompiledUi();
  browser=await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
  });
});
after(async()=>{
  await browser?.close();
  await server?.close();
});

test('original printInvoice_ holds print markup only while the dialog is active',async t=>{
  for(const receiptSize of ['A4','58mm','80mm']){
    await t.test(receiptSize+' temporary print flow',async()=>{
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        const result=await page.evaluate(size=>{
          if(typeof printInvoice_!=='function')
            throw new Error('Original printInvoice_ is missing from compiled UI');
          const inv={
            invoiceId:'M01-PRINT-LIFECYCLE',date:'2026-11-15',
            customerName:'Synthetic Buyer',customerPhone:'',
            items:[{name:'Synthetic Item',qty:1,unit:'pcs',unitPrice:50,lineTotal:50}],
            subtotal:50,discount:0,grandTotal:50,paidAmount:50,dueAmount:0,
            customerCreditUsed:0,paymentMethod:'Cash',payments:[],
            shop:{
              name:'Synthetic Hardware',nameBangla:'',address:'',phone1:'',phone2:'',
              currencySymbol:'৳',receiptSize:size,
              showBismillah:false,showSignature:false,footer:'Synthetic footer',
              paymentMethods:'[]',terms:'[]'
            }
          };
          // The original guard requires an invoice preview in the modal.
          document.getElementById('invoicePaper').innerHTML='<div>synthetic preview</div>';
          const beforeHost=document.getElementById('printHost');
          beforeHost.innerHTML='';
          let captures=[];
          window.print=()=>{
            const host=document.getElementById('printHost');
            const paper=host.querySelector('.invoice-paper');
            captures.push({
              printing:document.body.classList.contains('printing-invoice'),
              className:paper?.className||'',
              hasName:host.textContent.includes('Synthetic Item'),
              a4Pages:host.querySelectorAll('.invoice-print-page').length,
              thermalPages:host.querySelectorAll('.thermal-page').length,
              thermalItems:host.querySelectorAll('.thermal-item').length
            });
          };
          printInvoice_(size!=='A4',inv);
          return {
            captures,
            emptyAfter:document.getElementById('printHost').innerHTML==='',
            printingAfter:document.body.classList.contains('printing-invoice'),
            overlayVisible:!document.getElementById('loginOverlay').hidden,
            shellHidden:getComputedStyle(document.getElementById('app')).visibility==='hidden'
          };
        },receiptSize);
        assert.equal(result.captures.length,1,'exactly one print dialog invocation');
        const snapshot=result.captures[0];
        assert.equal(snapshot.printing,true,'print mode applies only at dialog boundary');
        assert.equal(snapshot.hasName,true,'original renderer must reach print host');
        if(receiptSize==='A4'){
          assert.ok(!snapshot.className.includes('thermal'));
          assert.equal(snapshot.a4Pages,1);
          assert.equal(snapshot.thermalPages,0);
        }else{
          assert.ok(snapshot.className.includes('thermal'));
          assert.equal(snapshot.className.includes('size-58'),receiptSize==='58mm');
          assert.equal(snapshot.thermalPages,1);
          assert.equal(snapshot.thermalItems,1);
        }
        assert.equal(result.emptyAfter,true,'temporary print markup must be removed');
        assert.equal(result.printingAfter,false,'printing class must be removed');
        assert.equal(result.overlayVisible,true);
        assert.equal(result.shellHidden,true);
      }finally{await page.close();}
    });
  }
});

test('original printInvoice_ refuses empty previews and missing thermal payload',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const result=await page.evaluate(()=>{
      const paper=document.getElementById('invoicePaper');
      const host=document.getElementById('printHost');
      let calls=0;
      window.print=()=>{calls++;};
      paper.innerHTML='';
      printInvoice_(false);
      const afterEmpty={calls,host:host.innerHTML,printing:document.body.classList.contains('printing-invoice')};
      paper.innerHTML='<div>synthetic preview</div>';
      printInvoice_(true,null);
      return {
        afterEmpty,calls,
        host:host.innerHTML,
        printing:document.body.classList.contains('printing-invoice'),
        overlayVisible:!document.getElementById('loginOverlay').hidden,
        shellHidden:getComputedStyle(document.getElementById('app')).visibility==='hidden'
      };
    });
    assert.deepEqual(result.afterEmpty,{calls:0,host:'',printing:false});
    assert.equal(result.calls,0,'no browser print dialog without required invoice data');
    assert.equal(result.host,'');
    assert.equal(result.printing,false);
    assert.equal(result.overlayVisible,true);
    assert.equal(result.shellHidden,true);
  }finally{await page.close();}
});

test('original printInvoice_ finally clears temporary state if printing throws',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const result=await page.evaluate(()=>{
      const paper=document.getElementById('invoicePaper');
      paper.innerHTML='<div>synthetic preview</div>';
      const host=document.getElementById('printHost');
      host.innerHTML='';
      window.print=()=>{throw new Error('synthetic print dialog failure');};
      let error=null;
      try{printInvoice_(false);}catch(e){error=e.message;}
      return {
        error,
        emptyAfter:host.innerHTML==='',
        printingAfter:document.body.classList.contains('printing-invoice'),
        overlayVisible:!document.getElementById('loginOverlay').hidden,
        shellHidden:getComputedStyle(document.getElementById('app')).visibility==='hidden'
      };
    });
    assert.equal(result.error,'synthetic print dialog failure');
    assert.equal(result.emptyAfter,true);
    assert.equal(result.printingAfter,false);
    assert.equal(result.overlayVisible,true);
    assert.equal(result.shellHidden,true);
  }finally{await page.close();}
});
