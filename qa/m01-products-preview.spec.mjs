import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import {patchPosV2HiddenVisibility} from '../scripts/patch-posv2-visibility.mjs';
import {patchM01ProductsPreview,installM01ProductsPreviewAssets} from '../scripts/patch-m01-products-preview.mjs';

let dir,server,browser,url;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'shererp-m01-products-preview-'));
 const {outputPath}=await buildFrontend({
   sourceDir:new URL('../legacy/source/',import.meta.url).pathname,outputDir:dir
 });
 const html=patchM01ProductsPreview(patchPosV2HiddenVisibility(
   patchServerCall(await readFile(outputPath,'utf8'))));
 await installM01ProductsPreviewAssets(dir);
 server=createServer(async(req,res)=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(pathname==='/'){
     res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);return;
   }
   if(/^\/m05-products\/[a-z0-9-]+\.m?js$/u.test(pathname)){
     try{
       const body=await readFile(join(dir,pathname.slice(1)));
       res.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'});
       res.end(body);return;
     }catch{}
   }
   res.writeHead(404);res.end('not found');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 url='http://127.0.0.1:'+server.address().port+'/';
 browser=await chromium.launch({headless:true,
   ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
     {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});
after(async()=>{
 await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 if(dir)await rm(dir,{recursive:true,force:true});
});
async function openProductModal(width){
 const page=await browser.newPage({viewport:{width,height:820},
   isMobile:width<=390,hasTouch:width<=390});
 page.setDefaultTimeout(6500);
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#m01ProductUnitMode').waitFor({state:'attached'});
 await page.evaluate(()=>{
  const get=id=>document.getElementById(id);
  get('loginOverlay').hidden=true;
  const app=get('app');app.hidden=false;app.style.visibility='visible';app.style.display='block';
  const products=get('page-products');products.hidden=false;products.style.visibility='visible';products.style.display='block';
  const select=get('prodUnit');
  select.replaceChildren();
  for(const label of ['Pcs','Box','Carton']){
    const option=document.createElement('option');option.value=label;option.textContent=label;
    select.appendChild(option);
  }
  select.value='Pcs';
  window.prodState.units=['Pcs','Box','Carton'].map(name=>({id:name,name}));
  get('prodType').value='Standard';
  get('prodType').dispatchEvent(new Event('change',{bubbles:true}));
  get('prodPurchasePrice').value='100';
  get('prodSellingPrice').value='160';
  const modal=get('prodModal');
  // Synthetic unauthenticated fixture: promote only this fixed overlay out of
  // the protected app shell, as the original Manage Units modal already does.
  // Do not remove/change the real Worker auth boundary or expose a save route.
  document.body.appendChild(modal);
  modal.hidden=false;modal.style.display='flex';
 });
 const diagnostic=await page.locator('#m01ProductUnitMode').evaluate(node=>{
   const chain=[];let p=node;
   while(p&&chain.length<9){chain.push({id:p.id,tag:p.tagName,
     hidden:p.hidden,display:getComputedStyle(p).display,
     visibility:getComputedStyle(p).visibility,rects:p.getClientRects().length});p=p.parentElement;}
   return {chain,productType:document.getElementById('prodType').value};
 });
 console.log('M01_PRODUCTS_VISIBILITY_DIAGNOSTIC',JSON.stringify(diagnostic));
 return page;
}

test('desktop product modal previews 2 Box 5 Pcs without changing legacy Save or Bundle controls',async()=>{
 const page=await openProductModal(1440);
 try{
  assert.equal(await page.locator('#m01ProductUnitMode').count(),1);
  await page.selectOption('#m01ProductUnitMode','multi');
  await page.locator('#m01StockPreview').getByText('2 Box 5 Pcs',{exact:false}).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  assert.equal(await page.locator('#prodBundleEditor').count(),1);
  await page.selectOption('#m01ProductUnitMode','single');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),false);
 }finally{await page.close();}
});

test('Tiles 24x24 and 25 Pcs per Box project 5 Box 3 Pcs and 512.00 Sqft',async()=>{
 const page=await openProductModal(1440);
 try{
  await page.selectOption('#m01ProductUnitMode','tiles');
  await page.locator('#m01TilesPerBox').fill('25');
  await page.locator('#m01OpeningCase').fill('5');
  await page.locator('#m01OpeningBase').fill('3');
  await page.locator('#m01StockPreview').getByText('5 Box 3 Pcs · 512.00 Sqft',{exact:false}).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
 }finally{await page.close();}
});

test('Tiles requested area is rounded to actual physical Pcs and visible on 390px phone',async()=>{
 const page=await openProductModal(390);
 try{
  await page.selectOption('#m01ProductUnitMode','tiles');
  await page.locator('#m01TilesPerBox').fill('25');
  await page.selectOption('#m01OpeningMode','area');
  await page.locator('#m01RequestedSqft').fill('355.00');
  await page.locator('#m01StockPreview').getByText('3 Box 14 Pcs · 356.00 Sqft',{exact:false}).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  const metrics=await page.evaluate(()=>{
   const p=document.getElementById('m01ProductUnitPanel');
   return {doc:document.documentElement.scrollWidth,viewport:innerWidth,
     panel:p.scrollWidth,client:p.clientWidth};
  });
  assert.ok(metrics.doc<=metrics.viewport+1,'no document horizontal overflow');
  assert.ok(metrics.panel<=metrics.client+1,'no panel horizontal overflow');
 }finally{await page.close();}
});

test('manufacturer coverage requires source evidence and never posts stock',async()=>{
 const page=await openProductModal(1440);
 try{
  await page.selectOption('#m01ProductUnitMode','tiles');
  await page.selectOption('#m01CoveragePolicy','manufacturer');
  await page.locator('#m01StockPreview').getByText(/evidence|manufacturer|mismatch/i).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
 }finally{await page.close();}
});
