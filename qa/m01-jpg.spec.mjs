import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Original source-derived, synthetic-only browser regression. No authenticated
// Worker API, live invoice, D1, extra canvas engine or physical print device.
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

function fixture(overrides={}){
  return {
    invoiceId:'M01-SYNTHETIC-JPG',
    date:'2026-11-15',
    paymentStatus:'Paid',
    customerName:'Synthetic Buyer',
    items:[{name:'Synthetic Cable',qty:1,unit:'pcs',unitPrice:125,lineTotal:125}],
    subtotal:125,discount:0,grandTotal:125,paidAmount:125,dueAmount:0,
    isDraft:false,
    shop:{
      name:'Synthetic Hardware',nameBangla:'',currencySymbol:'৳',
      logoDataUri:'',showBismillah:false,showSignature:false,
      footer:'Synthetic fixture, not a real invoice',paymentMethods:'[]',terms:'[]'
    },
    ...overrides
  };
}

test('original canvas renderer creates correctly sized, decodable 2x JPEG in real Chromium',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const result=await page.evaluate(async inv=>{
      if(typeof buildReceiptCanvas_!=='function')throw new Error('Original JPG renderer missing');
      const canvas=await buildReceiptCanvas_(inv);
      if(!(canvas instanceof HTMLCanvasElement))throw new Error('Original renderer did not return canvas');
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
      if(!blob)throw new Error('Native browser JPEG encoder produced no blob');
      const bitmap=await createImageBitmap(blob);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const details={
        width:canvas.width,height:canvas.height,blobType:blob.type,size:blob.size,
        decodedWidth:bitmap.width,decodedHeight:bitmap.height,
        prefix:[...bytes.slice(0,3)],suffix:[...bytes.slice(-2)]
      };
      bitmap.close();
      return details;
    },fixture());
    assert.equal(result.width,840,'preserved original 420px x2 receipt width');
    assert.ok(result.height>150,'receipt has real content height');
    assert.equal(result.decodedWidth,result.width);
    assert.equal(result.decodedHeight,result.height);
    assert.equal(result.blobType,'image/jpeg');
    assert.ok(result.size>1500,'encoded JPEG should be nonempty');
    assert.deepEqual(result.prefix,[255,216,255],'JPEG SOI signature');
    assert.deepEqual(result.suffix,[255,217],'JPEG EOI signature');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});

test('original canvas draws paid and draft receipt labels without showing both',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const result=await page.evaluate(async inv=>{
      const nativeFill=CanvasRenderingContext2D.prototype.fillText;
      const labels=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){
        labels.push(String(text));
        return nativeFill.apply(this,[text,...args]);
      };
      try{
        await buildReceiptCanvas_(inv);
        const paid=[...labels];
        labels.length=0;
        await buildReceiptCanvas_({...inv,isDraft:true});
        return {paid,draft:[...labels]};
      }finally{
        CanvasRenderingContext2D.prototype.fillText=nativeFill;
      }
    },fixture());
    assert.ok(result.paid.includes('PAID'),'zero-due non-draft receipt shows paid status');
    assert.equal(result.paid.includes('DRAFT / খসড়া'),false);
    assert.ok(result.draft.includes('DRAFT / খসড়া'),'draft must be visibly marked');
    assert.equal(result.draft.includes('PAID'),false,'draft cannot receive final PAID stamp');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});

test('invalid synthetic logo does not prevent original canvas JPEG generation',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const dimensions=await page.evaluate(async inv=>{
      const canvas=await buildReceiptCanvas_(inv);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
      return {width:canvas.width,height:canvas.height,type:blob?.type||'',bytes:blob?.size||0};
    },fixture({shop:{...fixture().shop,logoDataUri:'data:image/png;base64,not-a-real-logo'}}));
    assert.equal(dimensions.width,840);
    assert.ok(dimensions.height>150);
    assert.equal(dimensions.type,'image/jpeg');
    assert.ok(dimensions.bytes>1000);
  }finally{await page.close();}
});

test('original JPG download emits named native Chromium JPEG without an auth RPC',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});
  let loginRequests=0;
  try{
    page.on('request',request=>{
      if(request.url().endsWith('/api/rpc') &&
        ['login','validateSession'].includes(request.postDataJSON?.()?.fnName))loginRequests++;
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const downloadPromise=page.waitForEvent('download');
    await page.evaluate(inv=>downloadInvoiceJpg_(inv),fixture());
    const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'M01-SYNTHETIC-JPG.jpg');
    const path=await download.path();
    const bytes=await readFile(path);
    assert.ok(bytes.length>1500,'native JPG download must be nonempty');
    assert.deepEqual([...bytes.subarray(0,3)],[255,216,255],'native download encodes a JPEG');
    assert.deepEqual([...bytes.subarray(-2)],[255,217]);
    assert.equal(loginRequests,0,'JPG export is independent of public login/session RPC');
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});
