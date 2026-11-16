import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Original byte-preserved invoice renderer, real Chromium print layout,
// synthetic invoice rows only. No customer data, auth or financial writes.
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

const artifactDir=join(process.cwd(),'test-results','m01-browser');
async function savePdf(pdf,name){
  await mkdir(artifactDir,{recursive:true});
  await writeFile(join(artifactDir,name),pdf);
}
function invoice(itemCount){
  return {
    invoiceId:'M01-BOUNDARY-'+itemCount,date:'2026-11-15',
    customerName:'Synthetic Customer',customerPhone:'',
    items:Array.from({length:itemCount},(_,i)=>({
      name:'Synthetic cable '+(i+1),qty:1,unit:'pcs',unitPrice:10,lineTotal:10
    })),
    subtotal:itemCount*10,discount:0,grandTotal:itemCount*10,
    paidAmount:itemCount*10,dueAmount:0,paymentMethod:'Cash',payments:[],
    shop:{
      name:'Synthetic Hardware',nameBangla:'',address:'',phone1:'',phone2:'',
      currencySymbol:'৳',showBismillah:false,showSignature:false,
      footer:'Synthetic footer — not a real invoice',
      paymentMethods:'[]',terms:'[]'
    }
  };
}

test('original A4 renderer keeps 0/24/48/72 exact physical sheet boundaries',async t=>{
  for(const count of [0,24,48,72]){
    await t.test(count+' original rows',async()=>{
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        const result=await page.evaluate(inv=>{
          if(typeof renderInvoicePrintHtml_!=='function')
            throw new Error('Pinned original A4 renderer unavailable');
          const host=document.getElementById('printHost');
          host.innerHTML='<div class="invoice-paper">'+renderInvoicePrintHtml_(inv)+'</div>';
          document.body.classList.add('printing-invoice');
          const pages=[...host.querySelectorAll('.invoice-print-page')];
          return {
            pages:pages.length,
            rows:pages.map(p=>p.querySelectorAll('.inv-table tbody tr').length),
            headerCounts:pages.map(p=>p.querySelectorAll('.inv-header, .inv-table thead').length),
            customerCounts:pages.map(p=>p.querySelectorAll('.inv-customer-info-row').length),
            totalsCounts:pages.map(p=>p.querySelectorAll('.inv-bottom').length),
            footerCounts:pages.map(p=>p.querySelectorAll('.inv-footer-block').length),
            paidCounts:pages.map(p=>p.querySelectorAll('.inv-paid-badge').length),
            names:[...host.querySelectorAll('.inv-table tbody td.name')].map(x=>x.textContent),
            firstIndex:host.querySelector('.inv-table tbody tr .idx')?.textContent||null,
            lastIndex:[...host.querySelectorAll('.inv-table tbody tr .idx')].at(-1)?.textContent||null
          };
        },invoice(count));
        const expectedPages=Math.max(1,Math.ceil(count/24));
        assert.equal(result.pages,expectedPages);
        assert.deepEqual(result.rows,Array.from({length:expectedPages},(_,i)=>Math.min(24,Math.max(0,count-i*24))));
        assert.deepEqual(result.headerCounts,Array(expectedPages).fill(2));
        assert.deepEqual(result.customerCounts,Array.from({length:expectedPages},(_,i)=>i===0?1:0));
        assert.deepEqual(result.totalsCounts,Array.from({length:expectedPages},(_,i)=>i===expectedPages-1?1:0));
        assert.deepEqual(result.footerCounts,result.totalsCounts);
        assert.deepEqual(result.paidCounts,Array.from({length:expectedPages},(_,i)=>i===expectedPages-1 && count>0?1:0));
        assert.deepEqual(result.names,Array.from({length:count},(_,i)=>'Synthetic cable '+(i+1)),
          'no item should be omitted or duplicated at exact page boundaries');
        if(count>0){
          assert.equal(result.firstIndex,'১');
          assert.equal(result.lastIndex,await page.evaluate(n=>toBn_(n),count));
        }else{
          assert.equal(result.firstIndex,null);
          assert.equal(result.lastIndex,null);
        }
        await page.emulateMedia({media:'print'});
        const pdf=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});
        assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
        const physicalPages=[...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.equal(physicalPages,expectedPages,'no trailing blank sheet at exact 24-row boundary');
        await savePdf(pdf,'original-a4-boundary-'+count+'-rows.pdf');
      }finally{await page.close();}
    });
  }
});

test('original A4 and thermal invoice renderers escape markup-shaped customer/shop/product input',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(()=>{
      const injected='<span id="m01-injected">Synthetic & unsafe</span>';
      const inv={
        invoiceId:injected,date:'2026-11-15',customerName:injected,customerPhone:'',
        items:[{name:injected,qty:1,unit:'pcs',unitPrice:10,lineTotal:10}],
        subtotal:10,discount:0,grandTotal:10,paidAmount:10,dueAmount:0,
        paymentMethod:'Cash',payments:[],
        shop:{
          name:injected,nameBangla:'',address:'',phone1:'',phone2:'',
          currencySymbol:'৳',receiptSize:'58mm',showBismillah:false,showSignature:false,
          footer:'',paymentMethods:'[]',terms:'[]'
        }
      };
      const host=document.getElementById('printHost');
      const snapshot=(render,thermal)=>{
        host.innerHTML='<div class="invoice-paper">'+render(inv)+'</div>';
        const selectors=thermal
          ? ['.thermal-shop-name','.thermal-item-name','.thermal-meta']
          : ['.inv-shop-name','.inv-table tbody td.name','.inv-customer-name','.inv-info-row'];
        return {
          original:selectors.map(selector=>host.querySelector(selector)?.textContent||''),
          injectedElements:host.querySelectorAll('#m01-injected').length,
          scripts:host.querySelectorAll('script,iframe').length
        };
      };
      return {
        injected,
        a4:snapshot(renderInvoicePrintHtml_,false),
        thermal:snapshot(renderInvoiceHtmlThermal_,true)
      };
    });
    for(const [format,snapshot] of [['A4',result.a4],['thermal',result.thermal]]){
      assert.equal(snapshot.injectedElements,0,format+' must not create attacker-controlled DOM');
      assert.equal(snapshot.scripts,0);
      assert.ok(snapshot.original.every(s=>s.includes(result.injected)),
        format+' should show literal input text without losing characters');
    }
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});
