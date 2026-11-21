import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {defaultInvoiceProfile,normalizeInvoiceProfile}
  from '../src/modules/m09-owner-invoice-profile.js';

let browser,server,temp,url;
const shopId='22222222-2222-4222-8222-222222222222';
const wrongId='33333333-3333-4333-8333-333333333333';
const shell=buildSourceAppShellData({shopName:'Sample Hardware',currencySymbol:'৳'}).data;
let enabled=true,wrongShop=false,stale=false,denyPost=false,requests=[];
let profile=defaultInvoiceProfile(),revision=null;
function json(res,status,payload){
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}
before(async()=>{
  temp=await mkdtemp(join(tmpdir(),'shererp-invoice-profile-browser-'));
  await buildOwnerFrontend({outputDir:temp});
  server=createServer((req,res)=>{
    void (async()=>{
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/api/owner/auth/session'){
        json(res,200,{role:'Owner',shopId,dashboard:{displayName:'Sample Hardware',dataAvailable:false}});return;
      }
      if(path==='/api/owner/app-shell'){
        json(res,200,{success:true,data:shell});return;
      }
      if(path==='/api/owner/invoice-profile'){
        requests.push({method:req.method,origin:req.headers.origin});
        if(!enabled){json(res,404,{});return;}
        if(req.method==='GET'){
          json(res,200,{success:true,data:{shopId:wrongShop?wrongId:shopId,profile,revision}});return;
        }
        if(req.method==='POST'){
          const chunks=[];
          for await(const chunk of req)chunks.push(chunk);
          const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(denyPost){json(res,401,{error:'Denied'});return;}
          if(stale||input.expectedRevision!==revision){json(res,409,{error:'stale'});return;}
          const saved=normalizeInvoiceProfile(input.profile);
          profile=saved;revision=JSON.stringify(saved);
          json(res,200,{success:true,data:{shopId,profile:saved,revision}});return;
        }
        json(res,405,{});return;
      }
      if(path==='/app'||path==='/owner-erp.html'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        res.end(await readFile(join(temp,'owner-erp.html')));return;
      }
      json(res,404,{});
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+server.address().port+'/app';
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(temp)await rm(temp,{recursive:true,force:true});
});
async function open(width=1440){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.currentUser?.role==='Owner');
  await page.evaluate(()=>window.goToPage('invoiceDesign'));
  return page;
}
const panel='#page-invoiceDesign .hisabiq-invoice-profile-save';
const saveButton='#page-invoiceDesign .hisabiq-invoice-profile-save button';
const paper='#page-invoiceDesign select[aria-label="Paper size"]';
test('connected-only Owner preferences save and reload after authorized confirmation',async()=>{
  profile=defaultInvoiceProfile();revision=null;enabled=true;requests=[];wrongShop=false;stale=false;denyPost=false;
  const page=await open();
  try{
    await page.locator(panel).waitFor({state:'visible'});
    await page.getByText('Business preview preferences are current.').waitFor();
    assert.equal(await page.locator(saveButton).isDisabled(),true);
    await page.locator(paper).selectOption('80 mm');
    assert.equal(await page.locator(saveButton).isDisabled(),false);
    await page.locator(saveButton).click();
    await page.getByText('Business preview preferences are current.').waitFor();
    assert.equal(requests.filter(x=>x.method==='POST').length,1);
    assert.equal(profile.paper,'80 mm');
    assert.equal(await page.locator(saveButton).isDisabled(),true);
    await page.reload();
    await page.waitForFunction(()=>window.currentUser?.role==='Owner');
    await page.evaluate(()=>window.goToPage('invoiceDesign'));
    await page.getByText('Business preview preferences are current.').waitFor();
    assert.equal(await page.locator(paper).inputValue(),'80 mm');
    assert.equal(requests.filter(x=>x.method==='POST').length,1);
  }finally{await page.close();}
});
test('stale save is rejected, never displayed as confirmed',async()=>{
  stale=true;denyPost=false;wrongShop=false;enabled=true;
  const page=await open(390);
  try{
    await page.getByText('Business preview preferences are current.').waitFor();
    await page.locator(paper).selectOption('58 mm');
    await page.locator(saveButton).click();
    await page.getByText(/preferences changed elsewhere/).waitFor();
    assert.equal(profile.paper,'80 mm');
    assert.equal(await page.locator(saveButton).isVisible(),false);
  }finally{await page.close();stale=false;}
});
test('wrong-Shop response and disabled API cannot activate Save',async()=>{
  wrongShop=true;enabled=true;
  let page=await open(768);
  try{
    await page.getByText(/Save outcome not confirmed/).waitFor();
    assert.equal(await page.locator(saveButton).isVisible(),false);
  }finally{await page.close();}
  wrongShop=false;enabled=false;
  page=await open(320);
  try{
    await page.waitForTimeout(350);
    assert.equal(await page.locator(panel).isVisible(),false);
    await page.locator(paper).selectOption('58 mm');
    assert.equal(await page.locator(saveButton).isVisible(),false);
  }finally{await page.close();}
});
test('revoked Owner session on POST leaves local draft unsaved',async()=>{
  wrongShop=false;enabled=true;denyPost=true;requests=[];
  const page=await open();
  try{
    await page.getByText('Business preview preferences are current.').waitFor();
    await page.locator(paper).selectOption('58 mm');
    await page.locator(saveButton).click();
    await page.getByText(/Owner session or business access changed/).waitFor();
    assert.equal(profile.paper,'80 mm');
    assert.equal(await page.locator(saveButton).isVisible(),false);
  }finally{await page.close();denyPost=false;}
});
