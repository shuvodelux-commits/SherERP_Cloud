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