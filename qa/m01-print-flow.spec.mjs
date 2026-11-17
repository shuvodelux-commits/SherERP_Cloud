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


test('M01 original A4/58mm/80mm repeated print recovers after dialog cancellation on phone and desktop',async t=>{
  // RED test-first: this separate M01 synthetic invoice helper is not yet
  // implemented. The browser executes the real pinned original printInvoice_.
  const {makeM01PrintSequenceInvoice}=
    await import('./m01-print-sequence-fixture.mjs');
  for(const {name,width,height,phone} of [
    {name:'phone-320x640',width:320,height:640,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      const financialPosts=[];
      page.on('request',request=>{
        if(!request.url().endsWith('/api/rpc') || request.method()!=='POST')return;
        let fnName='';
        try{fnName=request.postDataJSON()?.fnName||'';}catch{}
        if(/^(?:saveSale|postSale|completeSale|submitSale|createSale)$/i.test(fnName)){
          financialPosts.push(fnName);
        }
      });
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        const inv=makeM01PrintSequenceInvoice();
        const actual=await page.evaluate(invoice=>{
          const host=document.getElementById('printHost');
          const preview=document.getElementById('invoicePaper');
          const sourcePreview='<div id="m01-original-preview">Synthetic preview only</div>';
          preview.innerHTML=sourcePreview;
          host.innerHTML='';
          const sizes=['A4','58mm','80mm','A4'];
          const snapshots=[];
          const states=[];
          for(let attempt=0;attempt<sizes.length;attempt++){
            const size=sizes[attempt];
            const data={...invoice,shop:{...invoice.shop,receiptSize:size}};
            let thrown=null;
            window.print=()=>{
              const papers=[...host.querySelectorAll('.invoice-paper')];
              const paper=papers[0];
              snapshots.push({
                attempt,size,
                printing:document.body.classList.contains('printing-invoice'),
                count:papers.length,
                thermal:paper?.classList.contains('thermal')||false,
                is58:paper?.classList.contains('size-58')||false,
                itemText:host.textContent.includes('M01 Synthetic Copper Cable'),
                a4Lines:host.querySelectorAll('.inv-table tbody tr').length,
                thermalLines:host.querySelectorAll('.thermal-item').length,
                invoiceId:host.textContent.includes('M01-PRINT-SEQUENCE')
              });
              if(attempt===1)throw new Error('M01 synthetic print dialog cancelled');
            };
            try{printInvoice_(size!=='A4',data);}
            catch(error){thrown=error.message;}
            states.push({
              attempt,size,thrown,
              hostEmpty:host.innerHTML==='',
              printing:document.body.classList.contains('printing-invoice'),
              previewPreserved:preview.innerHTML===sourcePreview,
              loginVisible:document.getElementById('loginOverlay')?.hidden===false,
              shellHidden:getComputedStyle(document.getElementById('app')).visibility==='hidden'
            });
          }
          return {snapshots,states};
        },inv);
        assert.equal(actual.snapshots.length,4);
        assert.equal(actual.states.length,4);
        for(let i=0;i<4;i++){
          const snapshot=actual.snapshots[i],state=actual.states[i];
          assert.equal(snapshot.attempt,i);
          assert.equal(snapshot.printing,true,'print mode must be set at dialog boundary');
          assert.equal(snapshot.count,1,'only current invoice should exist in temporary print host');
          assert.equal(snapshot.itemText,true,'synthetic line must render for each format');
          assert.equal(snapshot.invoiceId,true);
          assert.equal(snapshot.thermal,i===1||i===2);
          assert.equal(snapshot.is58,i===1);
          assert.equal(snapshot.a4Lines,i===0||i===3?1:0);
          assert.equal(snapshot.thermalLines,i===1||i===2?1:0);
          assert.equal(state.thrown,i===1?'M01 synthetic print dialog cancelled':null);
          assert.equal(state.hostEmpty,true,'printHost must clean up even after cancellation');
          assert.equal(state.printing,false,'print class cannot leak between attempts');
          assert.equal(state.previewPreserved,true,'original preview must not be cleared');
          assert.equal(state.loginVisible,true,'print must never unlock auth overlay');
          assert.equal(state.shellHidden,true,'print must not expose unauthenticated application');
        }
        const {mkdir}=await import('node:fs/promises');
        const {join}=await import('node:path');
        const dir=join(process.cwd(),'test-results','m01-browser');
        await mkdir(dir,{recursive:true});
        const png=await page.screenshot({
          path:join(dir,'original-print-repeat-cleanup-'+name+'.png'),fullPage:true
        });
        assert.ok(png.length>1500,'reviewable synthetic post-print screenshot required');
        assert.deepEqual(financialPosts,[],'print previews must never post a sale');
      }finally{await page.close();}
    });
  }
});
