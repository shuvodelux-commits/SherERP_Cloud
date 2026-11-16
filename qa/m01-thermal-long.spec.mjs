import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// The real frozen source's thermal renderer runs inside Chromium. Invoice
// fields and monetary amounts below are synthetic, not posted transactions.
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

function syntheticReceipt(receiptSize){
  const items=Array.from({length:32},(_,i)=>({
    name:'Synthetic insulated cable বাংলা testing wire '+(i+1)+' — premium grade',
    qty:1,unit:'pcs',unitPrice:25,lineTotal:25
  }));
  return {
    invoiceId:'M01-LONG-THERMAL-'+receiptSize,date:'2026-11-15',
    customerName:'Synthetic Buyer',customerPhone:'',items,
    subtotal:800,discount:50,grandTotal:750,
    paidAmount:450,customerCreditUsed:100,dueAmount:300,
    paymentMethod:'Cash',
    payments:[{method:'Cash',applied:350,tendered:400,change:50}],
    shop:{
      name:'Synthetic Hardware',nameBangla:'',address:'Synthetic Road',
      phone1:'',phone2:'',currencySymbol:'৳',receiptSize,
      showBismillah:false,showSignature:false,
      terms:'[]',paymentMethods:'[]',footer:''
    }
  };
}

test('original long thermal receipts use narrow 58mm/80mm multi-page paper',async t=>{
  for(const receiptSize of ['58mm','80mm']){
    await t.test(receiptSize+' 32-item receipt',async()=>{
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        const inv=syntheticReceipt(receiptSize);
        const structure=await page.evaluate(payload=>{
          if(typeof renderInvoiceHtmlThermal_!=='function')
            throw new Error('Pinned original thermal renderer unavailable');
          const host=document.getElementById('printHost');
          host.innerHTML='<div class="invoice-paper thermal'+
            (payload.shop.receiptSize==='58mm'?' size-58':'')+'">'+
            renderInvoiceHtmlThermal_(payload)+'</div>';
          // The source's responsive receipt width can be inspected in screen
          // media; the actual physical roll size is inspected in Chromium PDF.
          const sourceItems=[...host.querySelectorAll('.thermal-item-name')];
          const receipt=host.querySelector('.thermal-receipt');
          const nameWidths=sourceItems.map(el=>({
            width:el.clientWidth,scrollWidth:el.scrollWidth
          }));
          const source={
            itemNames:sourceItems.map(el=>el.textContent),
            itemWidths:nameWidths,
            receiptWidth:receipt.getBoundingClientRect().width,
            thermalPages:host.querySelectorAll('.thermal-page').length,
            grandCount:host.querySelectorAll('.thermal-grand').length,
            dueCount:host.querySelectorAll('.thermal-due').length,
            breakdownRows:host.querySelectorAll('.thermal-payment-breakdown .inv-payment-breakdown-row').length,
            breakdownText:host.querySelector('.thermal-payment-breakdown')?.textContent||'',
            totalsText:host.querySelector('.thermal-totals')?.textContent||'',
            a4Elements:host.querySelectorAll('.inv-table, .inv-footer-block').length
          };
          document.body.classList.add('printing-invoice');
          return source;
        },inv);
        assert.equal(structure.thermalPages,1,'original HTML is one roll-flow container');
        assert.deepEqual(structure.itemNames,inv.items.map(item=>item.name),
          'all source product rows must stay ordered and present in the print DOM');
        assert.ok(structure.receiptWidth<320,'receipt must retain compact roll layout');
        for(const dimension of structure.itemWidths){
          assert.ok(dimension.scrollWidth<=dimension.width+2,
            'long product name must wrap within receipt width');
        }
        assert.equal(structure.grandCount,1);
        assert.equal(structure.dueCount,1);
        assert.equal(structure.breakdownRows,1);
        assert.equal(structure.a4Elements,0);
        assert.match(structure.breakdownText,/Payments at Sale/);
        assert.match(structure.breakdownText,/Tendered:/);
        assert.match(structure.breakdownText,/Cash Change:/);
        assert.match(structure.totalsText,/৳|৭৫০|750/);

        await page.emulateMedia({media:'print'});
        const pdf=await page.pdf({printBackground:true,preferCSSPageSize:true});
        assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
        const raw=pdf.toString('latin1');
        const pageCount=[...raw.matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.ok(pageCount>=2,'32 items must span multiple physical 200mm sheets');
        const mediaBoxes=[...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
        assert.equal(mediaBoxes.length,pageCount,'each physical sheet must expose its MediaBox');
        const expectedWidth=(receiptSize==='58mm'?58:80)*72/25.4;
        const expectedHeight=200*72/25.4;
        for(const box of mediaBoxes){
          assert.ok(Math.abs(Number(box[1])-expectedWidth)<1.5,
            'each page must use the selected narrow thermal roll width');
          assert.ok(Math.abs(Number(box[2])-expectedHeight)<1.5,
            'each page must keep the source 200mm paper height');
        }
        const dir=join(process.cwd(),'test-results','m01-browser');
        await mkdir(dir,{recursive:true});
        await writeFile(join(dir,'original-thermal-long-'+receiptSize+'.pdf'),pdf);
        assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
      }finally{await page.close();}
    });
  }
});
