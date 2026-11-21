import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const widths=[320,390,768,1024,1440];
const baseline=process.env.ADD_PRODUCT_BASELINE==='1';
const appShell=buildSourceAppShellData({shopName:'Fixture Shop',currencySymbol:''}).data;
const evidence=resolve(process.env.ADD_PRODUCT_EVIDENCE_DIR || 'docs/reviews/m01-hisabiq-add-product/images');
// Screenshots are synthetic Owner UI captures, not real D1 health evidence.
// A transient unsupported background RPC toast auto-dismisses after 3.2s;
// capture the settled form rather than advertising the synthetic error.
async function captureSettled(page,path){
 await page.locator('#toast').waitFor({state:'hidden',timeout:6500});
 await page.screenshot({path,animations:'disabled'});
}

let dir,url,server,browser;
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'hisabiq-add-unit-'));
 await buildOwnerFrontend({outputDir:dir});
 if(baseline){const target=join(dir,'owner-erp.html');const source=await readFile(target,'utf8');
  const stripped=source.replace(/<style id="hisabiq-owner-unit-editor-style">[\s\S]*?<\/style>/,'')
   .replace(/<script type="module" id="hisabiq-owner-unit-editor">[\s\S]*?<\/script>/,'');
  assert.ok(stripped.length<source.length&&!stripped.includes('hisabiq-owner-unit-editor'));await writeFile(target,stripped);
 }
 server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const filepath=resolve(dir,'.'+(pathname==='/'?'/owner-erp.html':pathname));
  if(!filepath.startsWith(resolve(dir)+'/')){res.writeHead(404);res.end();return;}
  try{const buf=await readFile(filepath);const ext=extname(filepath);
   res.writeHead(200,{'Content-Type':ext==='.html'?'text/html;charset=utf-8':ext==='.js'||ext==='.mjs'?'text/javascript;charset=utf-8':ext==='.css'?'text/css':'application/octet-stream'});res.end(buf);
  }catch{res.writeHead(404);res.end('missing');}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(done=>server.close(done));if(dir)await rm(dir,{recursive:true,force:true});});

async function setup(page){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route(/^https:\/\/fonts\./,route=>route.abort());
 await page.route('**/api/owner/auth/session',route=>route.fulfill({json:{role:'Owner',shopId:'22222222-2222-4222-8222-222222222222',dashboard:{displayName:'Fixture Shop',dataAvailable:false}}}));
 await page.route('**/api/owner/app-shell',route=>route.fulfill({json:{success:true,data:appShell}}));
 await page.goto(url+'/owner-erp.html',{waitUntil:'load'});
 await page.locator('#m01ProductUnitMode').waitFor({state:'attached'});
 if(!baseline)await page.locator('#hapu-editor').waitFor({state:'attached'});
 await page.evaluate(()=>{
   const get=id=>document.getElementById(id);
   get('loginOverlay').hidden=true;
   const app=get('app');app.hidden=false;app.style.visibility='visible';
   // Original protected shell may still be loading; the modal is a synthetic
   // nonposting fixture, not an auth bypass against a Worker.
   window.prodState.units=['Pcs','Box','Carton','Sqft'].map(name=>({name,status:'Active'}));
   window.prodState.categories=[{name:'Tiles',status:'Active'}];
   get('prodUnit').replaceChildren();
   for(const label of ['Pcs','Box','Carton']){
    const option=document.createElement('option');option.value=label;option.textContent=label;get('prodUnit').append(option);
   }
   get('prodUnit').value='Pcs';
   get('prodType').value='Standard';
   get('prodPurchasePrice').value='100';get('prodSellingPrice').value='175';
   get('prodName').value='Ceramic Floor Tile';
   // This screenshot route has no operational D1. Make the fixture explicit;
   // never change the real Owner notice or conceal real product errors.
   const notice=get('owner-data-notice');
   if(notice)notice.textContent='UI fixture — no live Shop D1 connection was tested.';
   const modal=get('prodModal');document.body.append(modal);
   modal.hidden=false;modal.style.display='flex';
   get('prodType').dispatchEvent(new Event('change',{bubbles:true}));
   get('prodUnit').dispatchEvent(new Event('change',{bubbles:true}));
 });
 return errors;
}

for(const width of widths){
 test(`Add Product ${width}px joined unit equations, Save guard and responsive geometry`,async()=>{
  const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<=390,reducedMotion:'reduce'});
  page.setDefaultTimeout(7000);
  try{
   const errors=await setup(page);
   if(baseline){await captureSettled(page,join(evidence,`${width}-before.png`));return;}
   const toggle=page.locator('#hapu-enable');
   assert.equal(await toggle.getAttribute('role'),'switch');
   assert.equal(await toggle.isChecked(),false);
   await page.locator('.hapu-switch-wrap').click();
   assert.equal(await toggle.isChecked(),true);
   await page.locator('#hapu-size').fill('15');
   await page.locator('#hapu-area-enable').check();
   await page.locator('#hapu-area-size').fill('0.65');
   await page.locator('#hapu-opening-packs').fill('2');
   await page.locator('#hapu-opening-pieces').fill('5');
   await page.locator('#hapu-result').getByText('1 Box = 15 Pcs',{exact:false}).waitFor();
   const summary=await page.locator('#hapu-result').innerText();
   assert.match(summary,/1 Pcs = 0\.65 Sqft/);
   assert.match(summary,/1 Box = 9\.75 Sqft/);
   assert.match(summary,/35 Pcs physical stock/);
   assert.match(summary,/22\.75 Sqft coverage/);
   assert.equal(await page.locator('#m01CaseSize').inputValue(),'15');
   assert.equal(await page.locator('#m01ProductUnitMode').inputValue(),'multi');
   assert.equal(await page.locator('#m01ProductUnitPanel').isHidden(),true,'do not show duplicate legacy conversion controls');
   assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true,'backend cannot save advanced Product');
   const geom=await page.evaluate(()=>{
    const editor=document.getElementById('hapu-editor');
    return {windowWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,
      editorWidth:editor.clientWidth,editorScroll:editor.scrollWidth,
      editorLeft:editor.getBoundingClientRect().left,editorRight:editor.getBoundingClientRect().right};
   });
   assert.ok(geom.editorScroll<=geom.editorWidth+2,`editor does not horizontally overflow: ${JSON.stringify(geom)}`);
   assert.ok(geom.editorLeft>=-2&&geom.editorRight<=geom.windowWidth+2,`Add Product panel stays inside viewport at ${width}: ${JSON.stringify(geom)}`);
   // The merged Shell topbar has an independently observed 21px overflow at 1024px.
   // Keep the Add Product editor bounded; do not modify parallel-owned Shell CSS.
   if(width!==1024)assert.ok(geom.documentWidth<=geom.windowWidth+2,`body does not overflow at ${width}: ${JSON.stringify(geom)}`);
   await captureSettled(page,join(evidence,`${width}-after.png`));
   await page.locator('#hapu-result').scrollIntoViewIfNeeded();
   const visible=await page.evaluate(()=>{
    const result=document.getElementById('hapu-result').getBoundingClientRect();
    const footer=document.querySelector('#prodModal .modal-footer').getBoundingClientRect();
    const body=document.querySelector('#prodModal .modal-body').getBoundingClientRect();
    return {resultTop:result.top,resultBottom:result.bottom,footerTop:footer.top,bodyBottom:body.bottom};
   });
   assert.ok(visible.resultTop>=0&&visible.resultBottom<=visible.footerTop+1,`preview must be scrollable above footer: ${JSON.stringify(visible)}`);
   await captureSettled(page,join(evidence,`${width}-preview.png`));
   await page.locator('#hapu-editor').screenshot({path:join(evidence,`${width}-editor.png`),animations:'disabled'});
   assert.deepEqual(errors,[]);
  }finally{await page.close();}
 });
}

test('unit chain uses active master units, supports outer Carton and updating a stock unit',async()=>{
 const page=await browser.newPage({viewport:{width:1024,height:860}});
 try{await setup(page);if(baseline)return;
  await page.locator('.hapu-switch-wrap').click();
  await page.locator('#hapu-outer-toggle').click();
  assert.equal(await page.locator('#hapu-outer-row').isVisible(),true);
  await page.locator('#hapu-outer-size').fill('12');
  await page.locator('#hapu-opening-outer').fill('1');
  await page.locator('#hapu-size').fill('15');
  await page.locator('#hapu-opening-packs').fill('2');
  await page.locator('#hapu-opening-pieces').fill('5');
  await page.locator('#hapu-area-enable').check();
  const result=await page.locator('#hapu-result').innerText();
  assert.match(result,/1 Carton = 12 Box/);
  assert.match(result,/215 Pcs physical stock/);
  assert.match(result,/139\.75 Sqft coverage/);
  assert.equal(await page.locator('#m01UseCarton').isChecked(),true);
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
  await page.locator('#hapu-remove-outer').click();
  assert.equal(await page.locator('#hapu-outer-row').isHidden(),true);
  assert.equal(await page.locator('#m01UseCarton').isChecked(),false);
  await page.locator('#hapu-enable').evaluate(node=>node.click());
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),false,'single unit Save remains unchanged');
 }finally{await page.close();}
});

test('invalid coverage never shows a stale quantity and Bundle does not offer multi-unit',async()=>{
 const page=await browser.newPage({viewport:{width:390,height:850},hasTouch:true});
 try{await setup(page);if(baseline)return;
  await page.locator('.hapu-switch-wrap').click();
  await page.locator('#hapu-area-enable').check();
  await page.locator('#hapu-area-size').fill('0.00001');
  assert.match(await page.locator('#hapu-result').innerText(),/Coverage must be a positive decimal/);
  assert.doesNotMatch(await page.locator('#hapu-result').innerText(),/Sqft coverage/);
  await page.locator('#hapu-area-size').fill('.65');
  assert.match(await page.locator('#hapu-result').innerText(),/1 Pcs = 0\.65 Sqft/);
  await page.locator('#prodType').evaluate(el=>{el.value='Bundle';el.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('#hapu-editor').isHidden(),true);
 }finally{await page.close();}
});


test('an existing edited product cannot enable a new multi-unit conversion',async()=>{
 const page=await browser.newPage({viewport:{width:390,height:820},hasTouch:true});
 try{await setup(page);if(baseline)return;
  await page.evaluate(()=>{prodState.editingId='SAVED-PRODUCT';document.getElementById('prodUnit').dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('#hapu-enable').isDisabled(),true);
  assert.equal(await page.locator('#hapu-details').isHidden(),true);
  assert.equal(await page.locator('#m01ProductUnitMode').inputValue(),'single');
 }finally{await page.close();}
});

test('changing base stock unit preserves a natural larger-unit choice and never uses Sqft as a pack',async()=>{
 const page=await browser.newPage({viewport:{width:768,height:850}});
 try{await setup(page);if(baseline)return;
  await page.locator('.hapu-switch-wrap').click();
  assert.equal(await page.locator('#hapu-pack').inputValue(),'Box');
  assert.equal(await page.locator('#hapu-pack option[value="Sqft"]').count(),0,'area is a measurement, not a physical pack');
  await page.locator('#prodUnit').evaluate(control=>{control.value='Box';control.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('#hapu-pack').inputValue(),'Carton');
  assert.match(await page.locator('#hapu-result').innerText(),/1 Carton = 15 Box/);
  assert.equal(await page.locator('#prodSaveBtn').isDisabled(),true);
 }finally{await page.close();}
});


test('visible Add Product dropdowns and quantity fields share 36px geometry at phone and desktop widths',async()=>{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<=390});
  try{
   await setup(page);
   await page.locator('.hapu-switch-wrap').click();
   await page.locator('#hapu-outer-toggle').click();
   await page.locator('#hapu-area-enable').check();
   await page.locator('#hapu-outer-row').waitFor({state:'visible'});
   await page.locator('#hapu-pack + .touch-select-trigger').waitFor({state:'visible'});
   await page.locator('#hapu-buy-anchor + .touch-select-trigger').waitFor({state:'visible'});
   const geometry=await page.evaluate(()=>{
    const rect=id=>{
      const source=document.getElementById(id);
      const target=source?.tagName==='SELECT'&&source.nextElementSibling?.classList.contains('touch-select-trigger')
        ?source.nextElementSibling:source;
      const r=target.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};
    };
    return Object.fromEntries(['prodName','prodBrand','prodType','prodPurchasePrice','prodSellingPrice','prodUnit','prodCategory',
      'prodManageUnitsBtn','prodManageCategoriesBtn',
      'hapu-pack','hapu-size','hapu-outer','hapu-outer-size','hapu-area-size',
      'hapu-opening-packs','hapu-opening-pieces','hapu-buy-anchor','hapu-sell-anchor']
      .map(id=>[id,rect(id)]));
   });
   for(const [id,r] of Object.entries(geometry)){
     assert.ok(Math.abs(r.height-36)<=1,`${width}px ${id}: 36px visible control required; found ${r.height}`);
   }
   for(const [select,input] of [['hapu-pack','hapu-size'],['hapu-outer','hapu-outer-size']]){
     const a=geometry[select],b=geometry[input];
     assert.ok(Math.abs(a.y-b.y)<=1,`${width}px ${select}/${input}: top edges must align: ${JSON.stringify({a,b})}`);
     assert.ok(Math.abs(a.width-b.width)<=2,`${width}px ${select}/${input}: equal field widths required: ${JSON.stringify({a,b})}`);
   }
   assert.ok(Math.abs(geometry['hapu-buy-anchor'].width-geometry['hapu-sell-anchor'].width)<=2,
     `${width}px price unit dropdown widths must match`);
  }finally{await page.close();}
 }
});

test('unsupported Owner RPC does not falsely claim all Shop data is disconnected; visible errors never cover Save/Cancel',async()=>{
 const page=await browser.newPage({viewport:{width:390,height:850},hasTouch:true});
 try{
  await setup(page);
  await page.locator('.hapu-switch-wrap').click();
  const message=await page.evaluate(async()=>{
    try{await serverCall('unimplementedProductAction');return 'Unexpected success';}
    catch(error){return error.message;}
  });
  assert.match(message,/feature|action|function/i,'unknown RPC must be described as unavailable functionality');
  assert.doesNotMatch(message,/Shop business data is not connected/i);
  await page.evaluate(text=>showToast(text,'error'),message);
  const rects=await page.evaluate(()=>{
    const toast=document.getElementById('toast').getBoundingClientRect();
    const footer=document.querySelector('#prodModal .modal-footer').getBoundingClientRect();
    return {toastBottom:toast.bottom,footerTop:footer.top};
  });
  assert.ok(rects.toastBottom<=rects.footerTop-4,`error toast must sit above fixed modal footer: ${JSON.stringify(rects)}`);
 }finally{await page.close();}
});
