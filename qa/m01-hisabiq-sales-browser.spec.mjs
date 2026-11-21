import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const widths=[320,390,768,1024,1440];
const baseline=process.env.H_SALES_BASELINE==='1';
const evidence=resolve('docs/reviews/m01-hisabiq-sales-ui-refine/images');
const appShell=buildSourceAppShellData({shopName:'Sales Fixture Shop',currencySymbol:''}).data;
const sales=[
  {invoiceId:'INV-000003',date:'2026-11-20',customerId:'CUS-3',customerName:'Karim Hardware',customerPhone:'01700000003',grandTotal:2500,paidAmount:1500,dueAmount:1000,returnedAmount:0,paymentStatus:'Partial',returnStatus:'No Return',profit:350,editable:false,deletable:false},
  {invoiceId:'INV-000001',date:'2026-11-18',customerId:'CUS-1',customerName:'Ahmed Electronics',customerPhone:'01700000001',grandTotal:1200,paidAmount:1200,dueAmount:0,returnedAmount:0,paymentStatus:'Paid',returnStatus:'No Return',profit:250,editable:false,deletable:false},
  {invoiceId:'INV-000002',date:'2026-11-19',customerId:null,customerName:'Walk-in customer',customerPhone:'',grandTotal:500,paidAmount:500,dueAmount:0,returnedAmount:100,paymentStatus:'Paid',returnStatus:'Partially Returned',profit:80,editable:false,deletable:false}
];
let temp,server,browser,url;
before(async()=>{
  temp=await mkdtemp(join(tmpdir(),'shererp-sales-ui-'));
  await buildOwnerFrontend({outputDir:temp});
  if(baseline){
    const path=join(temp,'owner-erp.html');
    const html=await readFile(path,'utf8');
    const removed=html.replace(/<style id="hisabiq-sales-style">[\s\S]*?<\/style>/,'')
      .replace(/<script id="hisabiq-sales-runtime">[\s\S]*?<\/script>/,'')
      .replace('data-page="sales" hidden data-hisabiq-sales','data-page="sales" hidden');
    assert.ok(removed.length<html.length&&!removed.includes('hisabiq-sales-runtime'));
    await writeFile(path,removed);
  }
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    const file=resolve(temp,'.'+(path==='/'?'/owner-erp.html':path));
    if(!file.startsWith(resolve(temp)+'/')){res.writeHead(404);res.end();return;}
    try {
      const data=await readFile(file);
      const ext=extname(file);
      res.writeHead(200,{'Content-Type':ext==='.html'?'text/html':ext==='.css'?'text/css':ext==='.js'||ext==='.mjs'?'text/javascript':'application/octet-stream'});
      res.end(data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  await mkdir(evidence,{recursive:true});
});
after(async()=>{
  await browser?.close();
  if(server)await new Promise(done=>server.close(done));
  if(temp)await rm(temp,{force:true,recursive:true});
});

async function setup(page,items=sales){
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https:\/\/fonts\./,route=>route.abort());
  await page.route('**/api/owner/auth/session',route=>route.fulfill({json:{
    role:'Owner',shopId:'22222222-2222-4222-8222-222222222222',
    dashboard:{displayName:'Sales Fixture Shop',dataAvailable:false}
  }}));
  await page.route('**/api/owner/app-shell',route=>route.fulfill({json:{success:true,data:appShell}}));
  await page.goto(url+'/owner-erp.html',{waitUntil:'domcontentloaded'});
  await page.locator('#navList .nav-item[aria-label="Sales"]').waitFor({state:'attached'});
  await page.evaluate(items=>{
    var app=document.getElementById('app');
    app.hidden=false;app.style.visibility='';app.style.removeProperty('display');
    document.getElementById('loginOverlay').hidden=true;
    document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-sales');
    window.currentPage='sales';
    window.smState._loaded=true;
    window.smState.sales=items;
    window.smState.showProfit=items.some(item=>Object.hasOwn(item,'profit'));
    document.getElementById('smProfitHeader').style.display=smState.showProfit?'':'none';
    smRender();
  },items);
  if(!baseline)await page.locator('#h-sales-page-count').waitFor({state:'attached'});
  return errors;
}

async function chooseSelect(page,selector,optionText,optionValue){
  const select=page.locator(selector);
  if(await select.isVisible()){
    await select.selectOption(optionValue);
    return;
  }
  const trigger=page.locator(selector+' + .touch-select-trigger');
  await trigger.click();
  const option=page.locator('#touchSelectMenuGlobal .touch-select-option')
    .filter({hasText:optionText}).first();
  await option.click();
  assert.equal(await select.inputValue(),optionValue,
    'native select stays authoritative behind its original touch control');
}

for(const width of widths){
  test(`${width}px compiled Sales UI layout and source-data integrity`,async()=>{
    const page=await browser.newPage({viewport:{width,height:900},
      hasTouch:width<=390,reducedMotion:'reduce'});
    try {
      const errors=await setup(page);
      await page.screenshot({path:join(evidence,`${width}-${baseline?'before':'after'}.png`),fullPage:true,animations:'disabled'});
      if(baseline)return;
      assert.equal(await page.locator('#page-sales .h-sales-heading h1').isVisible(),true);
      assert.equal((await page.locator('#page-sales [data-summary="count"]').innerText()).trim(),'3');
      assert.match(await page.locator('#page-sales [data-summary="due"]').innerText(),/1,000/);
      assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),3);
      assert.equal(await page.locator('#smTableBody button[data-invoice-view-id]').count(),3);
      assert.equal(await page.locator('#smTableBody button[data-act="menu"]').count(),3);
      const bounds=await page.locator('#page-sales').boundingBox();
      assert.ok(bounds.x>=-2 && bounds.x+bounds.width<=width+3,
        'Sales surface should not escape screen at '+width+': '+JSON.stringify(bounds));
      assert.deepEqual(errors,[],'no JavaScript page errors');
    } finally {await page.close();}
  });
}

test('Sales instant search, native filters, reset, sort and column choice preserve native invoice IDs',async()=>{
  if(baseline)return;
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try {
    await setup(page);
    await page.locator('#smSearch').fill('Ahmed');
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),1);
    assert.match(await page.locator('#smTableBody tr:not([hidden])').innerText(),/INV-000001/);
    await page.locator('#h-sales-clear').click();
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),3);
    await chooseSelect(page,'#smPaymentStatus','Partial','Partial');
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),1);
    await page.locator('#h-sales-clear').click();
    await page.locator('button[data-h-sales-sort="total"]').click();
    const first=await page.locator('#smTableBody tr:not([hidden])').first().innerText();
    assert.match(first,/INV-000003/);
    await page.locator('#h-sales-columns-button').click();
    assert.equal(await page.locator('#h-sales-column-menu').isVisible(),true);
    const phone=page.locator('#h-sales-column-menu label').filter({hasText:'Phone'}).locator('input');
    await phone.check();
    assert.equal(await page.locator('#smTableBody tr:first-child td[data-h-sales-col="phone"]').isVisible(),true);
    await phone.uncheck();
    assert.equal(await page.locator('#smTableBody tr:first-child td[data-h-sales-col="phone"]').isVisible(),false);
    await page.locator('#h-sales-columns-button').click();
    assert.equal(await page.locator('#smTableBody button[data-invoice-view-id]').count(),3);
  }finally{await page.close();}
});

test('Sales pagination, original row action and keyboard access remain bound',async()=>{
  if(baseline)return;
  const many=Array.from({length:26},(_,index)=>({...sales[index%3],invoiceId:'INV-'+String(index+1).padStart(6,'0')}));
  const page=await browser.newPage({viewport:{width:1024,height:900}});
  try {
    await setup(page,many);
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),10);
    await page.locator('#h-sales-next').click();
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),10);
    assert.equal((await page.locator('#h-sales-page-count').innerText()).trim(),'2 / 3');
    await chooseSelect(page,'#h-sales-size','All','all');
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),26);
    assert.equal(await page.locator('#smViewModal').count(),1);
    assert.equal(await page.locator('#smPayModal').count(),1);
    const called=await page.evaluate(()=>{
      var n=0;
      window.smOpenView_=function(id){window.__salesOpened=id;n++;};
      var first=document.querySelector('#smTableBody tr');
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return {n,id:window.__salesOpened};
    });
    assert.equal(called.n,1);
    assert.ok(called.id.startsWith('INV-'));
  }finally{await page.close();}
});

test('Mobile filters, visibility, empty and unloaded states stay truthful',async()=>{
  if(baseline)return;
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  try{
    await setup(page);
    await page.locator('#h-sales-filters-toggle').click();
    assert.equal(await page.locator('#smPaymentStatus + .touch-select-trigger').isVisible(),true);
    await chooseSelect(page,'#smPaymentStatus','Due','Due');
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),0);
    await page.locator('#h-sales-clear').click();
    assert.equal(await page.locator('#smTableBody tr:not([hidden])').count(),3);
    await page.evaluate(()=>{window.smState.sales=[];window.smState._loaded=false;smRender();});
    assert.equal((await page.locator('#page-sales [data-summary="billed"]').innerText()).trim(),'—');
  }finally{await page.close();}
});
