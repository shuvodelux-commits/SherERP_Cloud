import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

let browser,server,temp,url,posts=0;
const shopId='22222222-2222-4222-8222-222222222222';
const shell=buildSourceAppShellData({shopName:'Sample Hardware',currencySymbol:'৳'}).data;
before(async()=>{
  temp=await mkdtemp(join(tmpdir(),'shererp-settings-browser-'));
  await buildOwnerFrontend({outputDir:temp});
  server=createServer((req,res)=>{
    void (async()=>{
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method!=='GET')posts++;
      if(path==='/api/owner/auth/session'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({role:'Owner',shopId,dashboard:{displayName:'Sample Hardware',dataAvailable:false}}));return;
      }
      if(path==='/api/owner/app-shell'){
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({success:true,data:shell}));return;
      }
      if(path==='/app'||path==='/owner-erp.html'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end(await readFile(join(temp,'owner-erp.html')));return;
      }
      res.writeHead(404,{'Content-Type':'application/json'});
      res.end('{}');
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+server.address().port+'/app';
  browser=await chromium.launch({headless:true});
});
after(async()=>{
  await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(temp)await rm(temp,{recursive:true,force:true});
});
async function pageAt(width,key='invoiceDesign'){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#page-invoiceDesign .hisabiq-settings-layout',{state:'attached'});
  await page.evaluate(pageKey=>{document.querySelector('#app').style.visibility='visible';window.goToPage(pageKey);},key);
  return page;
}

test('invoice reference gallery, paper, language and content selection are functional preview-only',async()=>{
  const page=await pageAt(1440);
  try{
    assert.equal(await page.locator('#page-invoiceDesign [role=radio]:enabled').count(),3);
    assert.equal(await page.locator('#page-invoiceDesign [role=radio]:disabled').count(),3);
    assert.match(await page.locator('#page-invoiceDesign .hisabiq-settings-alert').innerText(),/Preview only/);
    await page.getByRole('radio',{name:/Classic/}).click();
    assert.match(await page.locator('.hisabiq-invoice-paper').getAttribute('class'),/classic/);
    await page.locator('#page-invoiceDesign select[aria-label="Paper size"]').selectOption('58 mm');
    assert.equal(await page.locator('.hisabiq-invoice-preview').getAttribute('data-paper'),'58mm');
    await page.locator('#page-invoiceDesign select[aria-label="Document language"]').selectOption('Bangla');
    assert.match(await page.locator('.hisabiq-invoice-paper').innerText(),/বিক্রির চালান/);
    await page.getByText('Due amount · বাকি').locator('..').locator('input').uncheck();
    assert.doesNotMatch(await page.locator('.hisabiq-invoice-totals').innerText(),/Due/);
    assert.equal(await page.locator('#page-invoiceDesign .hisabiq-settings-legacy button:enabled').count(),0);
    await page.locator('#page-invoiceDesign button[data-settings-page="users"]').click();
    assert.equal(await page.locator('#page-users').isVisible(),true);
    assert.equal(await page.locator('#page-users button[data-settings-page="users"]').getAttribute('aria-current'),'page');
    await page.locator('#page-users .hisabiq-settings-home').click();
    assert.equal(await page.locator('#page-settings').isVisible(),true);
    assert.equal(posts,0,'no preview operation may post an invoice or Settings write');
  }finally{await page.close();}
});

test('reference Settings is accessible at mobile, tablet and desktop and searchable',async()=>{
  for(const width of [320,390,768,1024,1440]){
    const page=await pageAt(width,'settings');
    try{
      assert.equal(await page.locator('#page-settings .hisabiq-settings-layout').isVisible(),true);
      assert.ok(await page.locator('#page-settings .hisabiq-settings-layout').evaluate(n=>n.getBoundingClientRect().width)<=width);
      const search=page.locator('#page-settings .hisabiq-settings-search');
      await search.fill('Invoices');
      assert.equal(await page.locator('#page-settings button[data-settings-page="invoiceDesign"]').isVisible(),true);
      assert.equal(await page.locator('#page-settings button[data-settings-page="users"]').isVisible(),false);
      await search.fill('');
      await mkdir('test-results/hisabiq-settings',{recursive:true});
      await page.screenshot({path:'test-results/hisabiq-settings/'+width+'-settings.png'});
      await page.evaluate(()=>window.goToPage('invoiceDesign'));
      await page.screenshot({path:'test-results/hisabiq-settings/'+width+'-invoice.png'});
    }finally{await page.close();}
  }
});
