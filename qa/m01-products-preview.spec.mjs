import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import {patchPosV2HiddenVisibility} from '../scripts/patch-posv2-visibility.mjs';
import {patchM01ProductsPreview,installM01ProductsPreviewAssets} from '../scripts/patch-m01-products-preview.mjs';
import {patchM01ReportPrintSafety} from '../scripts/patch-m01-report-print-safety.mjs';

const EVIDENCE_DIR=new URL('../test-results/m01-browser/',import.meta.url).pathname;
async function captureProductPreview(page,name){
 await mkdir(EVIDENCE_DIR,{recursive:true});
 await page.screenshot({path:join(EVIDENCE_DIR,name+'.png'),animations:'disabled'});
}
let dir,server,browser,url;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'shererp-m01-products-preview-'));
 const {outputPath}=await buildFrontend({
   sourceDir:new URL('../legacy/source/',import.meta.url).pathname,outputDir:dir
 });
 const compiled=patchM01ProductsPreview(patchPosV2HiddenVisibility(
   patchServerCall(await readFile(outputPath,'utf8'))));
 // Isolated M01 integration candidate: intentionally NOT yet in production build.
 const controller=await readFile(new URL('../src/ui/m01-report-print-controller.js',import.meta.url),'utf8');
 const html=patchM01ReportPrintSafety(compiled,controller);
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

async function chooseProductPreviewOption(page,id,value){
 const native=page.locator('#'+id);
 // The frozen original ERP enhances selects with a visible touch-picker and
 // hides the native select. Exercise that real control in Chromium instead of
 // waiting on a deliberately invisible native input.
 if(await native.isVisible()){
  await native.selectOption(value);
 }else{
  const index=await native.locator('option').evaluateAll((options,wanted)=>
    options.findIndex(option=>option.value===wanted),value);
  assert.ok(index>=0,'expected source-backed option '+value);
  const trigger=page.locator('#'+id+' + .touch-select-trigger');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const option=page.locator('#touchSelectMenuGlobal button[data-touch-option-index="'+index+'"]');
  assert.equal(await option.isVisible(),true,'visible original touch-picker option');
  // The frozen ERP closes open pickers on window scroll. Playwright's
  // automatic scroll-before-click can detach a valid option; dispatch the
  // same original button click while it is already visible instead.
  await option.evaluate(button=>button.click());
 }
 assert.equal(await native.inputValue(),value);
}

test('desktop product modal previews 2 Box 5 Pcs without changing legacy Save or Bundle controls',async()=>{
 const page=await openProductModal(1440);
 try{
  assert.equal(await page.locator('#m01ProductUnitMode').count(),1);
  await captureProductPreview(page,'products-desktop-before-single');
  await chooseProductPreviewOption(page,'m01ProductUnitMode','multi');
  await page.locator('#m01StockPreview').getByText('2 Box 5 Pcs',{exact:false}).waitFor();
  await captureProductPreview(page,'products-desktop-after-multiunit');
  await page.locator('#m01StockPreview').scrollIntoViewIfNeeded();
  await captureProductPreview(page,'products-desktop-after-multiunit-preview');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  assert.equal(await page.locator('#prodStock').locator('xpath=..').isHidden(),true,'legacy single-stock field hidden in advanced mode');
  assert.equal((await page.locator('#prodSaveBtn').textContent()).trim(),'Save unavailable');
  assert.equal(await page.locator('#prodSaveBtn').evaluate(el=>getComputedStyle(el).cursor),'not-allowed');
  assert.equal(await page.locator('#prodBundleEditor').count(),1);
  await chooseProductPreviewOption(page,'m01ProductUnitMode','single');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),false);
  assert.equal(await page.locator('#prodStock').locator('xpath=..').isVisible(),true,'legacy stock restored in single-unit mode');
  assert.equal((await page.locator('#prodSaveBtn').textContent()).trim(),'Save Product');
 }finally{await page.close();}
});

test('Tiles 24x24 and 25 Pcs per Box project 5 Box 3 Pcs and 512.00 Sqft',async()=>{
 const page=await openProductModal(1440);
 try{
  await chooseProductPreviewOption(page,'m01ProductUnitMode','tiles');
  await page.locator('#m01TilesPerBox').fill('25');
  await page.locator('#m01OpeningCase').fill('5');
  await page.locator('#m01OpeningBase').fill('3');
  await page.locator('#m01StockPreview').getByText('5 Box 3 Pcs · 512.00 Sqft',{exact:false}).waitFor();
  await captureProductPreview(page,'products-desktop-after-tiles');
  await page.locator('#m01StockPreview').scrollIntoViewIfNeeded();
  await captureProductPreview(page,'products-desktop-after-tiles-preview');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
 }finally{await page.close();}
});

test('Tiles requested area is rounded to actual physical Pcs and visible on 390px phone',async()=>{
 const page=await openProductModal(390);
 try{
  await chooseProductPreviewOption(page,'m01ProductUnitMode','tiles');
  await page.locator('#m01TilesPerBox').fill('25');
  await chooseProductPreviewOption(page,'m01OpeningMode','area');
  await page.locator('#m01RequestedSqft').fill('355.00');
  await page.locator('#m01StockPreview').getByText('3 Box 14 Pcs · 356.00 Sqft',{exact:false}).waitFor();
  await captureProductPreview(page,'products-mobile-after-tiles');
  await page.locator('#m01StockPreview').scrollIntoViewIfNeeded();
  await captureProductPreview(page,'products-mobile-after-tiles-preview');
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

test('inactive managed Product Unit is not silently promoted in compiled Product preview',async()=>{
 const page=await openProductModal(1440);
 try{
  await chooseProductPreviewOption(page,'m01ProductUnitMode','multi');
  await page.locator('#m01StockPreview').getByText('2 Box 5 Pcs',{exact:false}).waitFor();
  for(const invalidStatus of ['Inactive','Archived']){
   await page.evaluate(status=>{
    globalThis.prodState.units=globalThis.prodState.units.map(item=>({
      ...item,status:item.name==='Box'?status:'Active'
    }));
    document.getElementById('m01CaseSize').dispatchEvent(new Event('input',{bubbles:true}));
   },invalidStatus);
   await page.waitForFunction(()=>{
    const node=document.getElementById('m01StockPreview');
    return node.classList.contains('m01-error')&&/Box|inactive|active Product Unit/i.test(node.textContent);
   });
   assert.doesNotMatch(await page.locator('#m01StockPreview').innerText(),/2 Box 5 Pcs/,
     'inactive or unknown unit must never show a validated stock breakdown');
   assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  }
  await page.evaluate(()=>{
   globalThis.prodState.units=globalThis.prodState.units.map(item=>({
     ...item,status:'Active'
   }));
   document.getElementById('m01CaseSize').dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.locator('#m01StockPreview').getByText('2 Box 5 Pcs',{exact:false}).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true,
    'a restored valid preview is still not a server-authorized Save');
 }finally{await page.close();}
});

test('manufacturer coverage requires source evidence and never posts stock',async()=>{
 const page=await openProductModal(1440);
 try{
  await chooseProductPreviewOption(page,'m01ProductUnitMode','tiles');
  await chooseProductPreviewOption(page,'m01CoveragePolicy','manufacturer');
  await page.locator('#m01StockPreview').getByText(/evidence|manufacturer|mismatch/i).waitFor();
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
 }finally{await page.close();}
});


test('Products table uses M05 source metadata when available and preserves fallback for unknown rows',async()=>{
 const page=await openProductModal(1440);
 try{
  await page.evaluate(()=>{
   const state=globalThis.prodState;
   const original={productId:'P-BOX',unitMasters:[
     {'Unit Name':'Pcs',Status:'Active'},
     {'Unit Name':'Box',Status:'Active'}
   ],unitRelations:[{leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}]};
   state.products=[
     {'Product ID':'P-BOX','Current Stock':45,'M05 Stock Preview':original},
     {'Product ID':'P-UNKNOWN','Current Stock':45}
   ];
   const body=document.getElementById('prodTableBody');
   body.innerHTML='<tr><td>Box Product</td><td></td><td></td><td></td>'+
     '<td><div class="prod-cell-main">45 Pcs</div></td><td></td><td></td>'+
     '<td><button data-id="P-BOX"></button></td></tr>'+
     '<tr><td>Unknown</td><td></td><td></td><td></td>'+
     '<td><div class="prod-cell-main">45 Pcs</div></td><td></td><td></td>'+
     '<td><button data-id="P-UNKNOWN"></button></td></tr>';
  });
  await page.waitForFunction(()=>document.querySelector('#prodTableBody tr:first-child td:nth-child(5)')?.textContent==='2 Box 5 Pcs');
  assert.equal(await page.locator('#prodTableBody tr:nth-child(2) td:nth-child(5)').textContent(),'45 Pcs');
  await mkdir(EVIDENCE_DIR,{recursive:true});
  await page.evaluate(()=>{
   const modal=document.getElementById('prodModal');
   modal.hidden=true;modal.style.display='none'; // synthetic fixture originally used inline display:flex
  });
  await page.locator('#prodTable').screenshot({path:join(EVIDENCE_DIR,'products-desktop-after-stock-table.png'),animations:'disabled'});
 }finally{await page.close();}
});


test('existing source-verified multi-unit Product Edit never enables the legacy Save path',async()=>{
 const page=await openProductModal(1440);
 try{
  await page.evaluate(()=>{
   globalThis.prodState.products=[{
     'Product ID':'P-ADV-EDIT','Product Type':'Standard',
     'Current Stock':45,
     'M05 Stock Preview':{
       productId:'P-ADV-EDIT',
       unitMasters:[{'Unit Name':'Box',Status:'Active'},{'Unit Name':'Pcs',Status:'Active'}],
       unitRelations:[{leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}]
     }
   }];
   globalThis.prodState.editingId='P-ADV-EDIT';
   const modal=document.getElementById('prodModal');
   modal.hidden=true;modal.hidden=false;
  });
  await page.waitForFunction(()=>document.getElementById('prodSaveBtn').disabled===true);
  assert.equal((await page.locator('#prodSaveBtn').textContent()).trim(),'Save unavailable');
  assert.match(await page.locator('#m01PreviewReadOnly').textContent(),/existing.*(multi-unit|Tiles)|revision-aware.*edit/i);
  assert.equal(await page.locator('#m01PreviewReadOnly').isVisible(),true);
  assert.equal(await page.locator('#prodStock').isVisible(),true,'read-only legacy stock remains inspectable');
  await chooseProductPreviewOption(page,'m01ProductUnitMode','multi');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  await chooseProductPreviewOption(page,'m01ProductUnitMode','single');
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true,'switching selector cannot bypass edit guard');
 }finally{await page.close();}
});

test('stale or malformed M05 metadata also blocks legacy editing while plain Products stay editable',async()=>{
 const page=await openProductModal(1440);
 try{
  await page.evaluate(()=>{
   globalThis.prodState.products=[
     {'Product ID':'P-STALE','M05 Stock Preview':null,'Current Stock':20},
     {'Product ID':'P-PLAIN','Current Stock':20}
   ];
   globalThis.prodState.editingId='P-STALE';
   document.getElementById('m01ProductUnitMode').dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.getElementById('prodSaveBtn').disabled);
  assert.equal(await page.locator('#m01PreviewReadOnly').isVisible(),true);
  await page.evaluate(()=>{
   globalThis.prodState.editingId='P-PLAIN';
   const modal=document.getElementById('prodModal');
   modal.hidden=true;modal.hidden=false;
  });
  await page.waitForFunction(()=>!document.getElementById('prodSaveBtn').disabled);
  assert.equal((await page.locator('#prodSaveBtn').textContent()).trim(),'Save Product');
  assert.equal(await page.locator('#m01PreviewReadOnly').isVisible(),false);
 }finally{await page.close();}
});


test('M01 Reports compiled Print rejects unloaded, stale and failed synthetic reports at desktop',async()=>{
 const page=await openProductModal(1440);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const data=await page.evaluate(async()=>{
   const el=id=>document.getElementById(id);
   el('prodModal').hidden=true;el('prodModal').style.display='none';
   el('page-products').hidden=true;el('page-products').style.display='none';
   el('page-reports').hidden=false;el('page-reports').style.display='block';
   el('shopNameLabel').textContent='Synthetic Shop';
   authToken='SYNTHETIC-REPORT-SESSION';
   currentUser={id:'SYNTH-REPORT-ACTOR',tenantId:'SYNTH-REPORT-TENANT'};
   el('rptFrom').value='2026-11-01';el('rptTo').value='2026-11-17';
   rptState.activeTab='rptSales';rptState.loaded={};
   let prints=0;
   window.print=()=>{prints++;};
   const button=el('rptPrintBtn');
   const initiallyDisabled=button.disabled;
   button.click();
   const emptyBlocked=prints===0;
   RPT_LOADERS.rptSales=()=>Promise.resolve();
   await rptRunActive_(true);
   const loaded=button.disabled===false;
   button.click();
   const successfulPrinted=prints===1;
   el('rptTo').value='2026-11-16';
   el('rptTo').dispatchEvent(new Event('input',{bubbles:true}));
   button.click();
   const staleBlocked=button.disabled && prints===1 && rptState.loaded.rptSales===false;
   RPT_LOADERS.rptSales=()=>Promise.reject(new Error('Synthetic report failure'));
   await rptRunActive_(true);
   button.click();
   const failureBlocked=button.disabled && prints===1;
   return {initiallyDisabled,emptyBlocked,loaded,successfulPrinted,staleBlocked,failureBlocked};
  });
  assert.deepEqual(data,{
   initiallyDisabled:true,emptyBlocked:true,loaded:true,
   successfulPrinted:true,staleBlocked:true,failureBlocked:true
  });
  await captureProductPreview(page,'m01-reports-print-safety-desktop-1440');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});

test('M01 Reports mobile stale response, snapshot and session turnover never print old data',async()=>{
 const page=await openProductModal(390);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const data=await page.evaluate(async()=>{
   const el=id=>document.getElementById(id);
   el('prodModal').hidden=true;el('prodModal').style.display='none';
   el('page-products').hidden=true;el('page-products').style.display='none';
   el('page-reports').hidden=false;el('page-reports').style.display='block';
   el('shopNameLabel').textContent='Synthetic Shop';
   authToken='SYNTHETIC-REPORT-SESSION';
   currentUser={id:'SYNTH-ACTOR',tenantId:'SYNTH-TENANT'};
   el('rptFrom').value='2026-11-01';el('rptTo').value='2026-11-17';
   rptState.activeTab='rptSales';rptState.loaded={};
   let prints=0;window.print=()=>{prints++;};
   let finishOld;
   RPT_LOADERS.rptSales=()=>new Promise(resolve=>{finishOld=resolve;});
   const older=rptRunActive_(true);
   // The guarded loader starts in a Promise microtask. Let its original
   // synthetic request actually begin before replacing the test stub.
   await Promise.resolve();
   if(typeof finishOld!=='function')throw Error('Synthetic old report did not start');
   const pendingBlocked=el('rptPrintBtn').disabled;
   RPT_LOADERS.rptSales=()=>Promise.resolve();
   await rptRunActive_(true);
   const newerReady=!el('rptPrintBtn').disabled;
   finishOld();await older;
   const lateBlocked=el('rptPrintBtn').disabled &&
     rptState.loaded.rptSales===false;
   rptState.activeTab='rptStock';
   RPT_LOADERS.rptStock=()=>Promise.resolve();
   await rptRunActive_(true);
   el('rptTo').value='2026-11-16';
   el('rptTo').dispatchEvent(new Event('change',{bubbles:true}));
   const snapshotReady=!el('rptPrintBtn').disabled;
   authToken='SYNTHETIC-ROTATED-SESSION';
   el('rptPrintBtn').click();
   const sessionBlocked=prints===0 && el('rptPrintBtn').disabled;
   return {pendingBlocked,newerReady,lateBlocked,snapshotReady,sessionBlocked};
  });
  assert.deepEqual(data,{
   pendingBlocked:true,newerReady:true,lateBlocked:true,
   snapshotReady:true,sessionBlocked:true
  });
  await captureProductPreview(page,'m01-reports-print-safety-mobile-390');
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
});
