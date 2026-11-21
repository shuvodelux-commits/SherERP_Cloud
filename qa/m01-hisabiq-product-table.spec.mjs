import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const widths=[320,390,768,1024,1440];
const evidence=resolve('docs/reviews/m01-hisabiq-product-table/images');
const baseline=process.env.PRODUCT_TABLE_BASELINE==='1';
const appShell=buildSourceAppShellData({shopName:'Fixture Shop',currencySymbol:''}).data;
let dir,server,browser,url;
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'hpt-browser-'));
  await buildOwnerFrontend({outputDir:dir});
  server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const target=resolve(dir,'.'+(pathname==='/'?'/owner-erp.html':pathname));
    if(!target.startsWith(resolve(dir)+'/')){res.writeHead(404);res.end();return;}
    try {const data=await readFile(target);const ext=extname(target);
      res.writeHead(200,{'Content-Type':ext==='.html'?'text/html':ext==='.js'||ext==='.mjs'?'text/javascript':ext==='.css'?'text/css':'application/octet-stream'});res.end(data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  await mkdir(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));if(dir)await rm(dir,{force:true,recursive:true});});

const products=[
  {'Product ID':'P1','Product Name':'PVC Pipe 20 Feet','Category':'Plumbing','Brand':'Best Pipe','Unit':'Feet','Barcode':'PIPE-20','Current Stock':26,'Minimum Stock':5,'Stock Value':'3900','Purchase Price':'150','Selling Price':'200',Status:'Active'},
  {'Product ID':'P2','Product Name':'LED Switch','Category':'Electrical','Brand':'Sharp','Unit':'Pcs','Barcode':'SW-100','Current Stock':3,'Minimum Stock':5,'Stock Value':'60','Purchase Price':'20','Selling Price':'35',Status:'Active'},
  {'Product ID':'P3','Product Name':'Submersible Motor 2 HP','Category':'Electrical','Brand':'Motor Max','Unit':'Pcs','Barcode':'MT-20','Current Stock':0,'Minimum Stock':2,'Stock Value':'0','Purchase Price':'5000','Selling Price':'6500',Status:'Active'},
  {'Product ID':'P4','Product Name':'Old Steel Gate','Category':'Steel','Brand':'Workshop','Unit':'Pcs','Current Stock':0,'Minimum Stock':1,'Purchase Price':'500','Selling Price':'650',Status:'Inactive'},
];

async function setup(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(/^https:\/\/fonts\./,route=>route.abort());
  await page.route('**/api/owner/auth/session',route=>route.fulfill({json:{role:'Owner',shopId:'22222222-2222-4222-8222-222222222222',dashboard:{displayName:'Fixture Shop',dataAvailable:false}}}));
  await page.route('**/api/owner/app-shell',route=>route.fulfill({json:{success:true,data:appShell}}));
  await page.goto(url+'/owner-erp.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(products=>{
    const app=document.getElementById('app');app.hidden=false;app.style.visibility='visible';app.style.display='block';
    const overlay=document.getElementById('loginOverlay');if(overlay){overlay.hidden=true;overlay.style.display='none';}
    document.querySelectorAll('.page').forEach(node=>{node.hidden=true;node.style.display='none';});
    const page=document.getElementById('page-products');page.hidden=false;page.style.display='block';
    window.prodState.products=products;
    window.prodState.categories=[{name:'Electrical'},{name:'Plumbing'},{name:'Steel'}];
    window.prodState.units=[{name:'Feet'},{name:'Pcs'}];
    window.prodFillCategoryAndUnitSelects_();window.prodRender();
  },products);
  return errors;
}

for(const width of widths){
  test(`${width}px Product Table visual and responsive behavior`,async()=>{
    const page=await browser.newPage({viewport:{width,height:850},hasTouch:width<=390,reducedMotion:'reduce'});
    try{
      const errors=await setup(page);
      await page.screenshot({path:join(evidence,`${width}-${baseline?'before':'after'}.png`),fullPage:true,animations:'disabled'});
      if(baseline)return;
      await page.locator('#hpt-column-button').waitFor();
      assert.deepEqual(await page.locator('#prodTable thead th[data-hpt-column]').evaluateAll(nodes=>nodes.map(n=>n.dataset.hptColumn)),['index','product','category','stock','stockValue','unit','purchase','selling','status']);
      assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),4);
      const dims=await page.evaluate(()=>({view:window.innerWidth,page:document.documentElement.scrollWidth,scroll:document.getElementById('prodTableScroll').scrollWidth,client:document.getElementById('prodTableScroll').clientWidth}));
      assert.ok(dims.page<=dims.view+2,`body overflow at ${width}: ${JSON.stringify(dims)}`);
      if(width<=390)assert.ok(dims.scroll>dims.client,'mobile table must scroll horizontally');
      assert.equal(await page.locator('#prodTableBody tr:first-child [data-hpt-column="unit"]').innerText(),'Feet');
      assert.equal(await page.locator('#prodTableBody button[data-act]').count(),0,'Owner disabled original actions stay disabled');
      assert.deepEqual(errors,[],'no page errors');
    }finally{await page.close();}
  });
}

test('Stock tabs, category chips, search, source sorting and clear filters operate together',async()=>{
 const page=await browser.newPage({viewport:{width:1024,height:850}});
 page.setDefaultTimeout(6500);
 try{await setup(page);if(baseline)return;
  await page.getByRole('radio',{name:/Low/}).click();
  assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),1);
  assert.match(await page.locator('#prodTableBody tr:not([hidden])').innerText(),/LED Switch/);
  await page.getByRole('radio',{name:/Out/}).click();
  assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),1);
  await page.getByRole('radio',{name:/All stock/}).click();
  await page.getByRole('button',{name:'Plumbing',exact:true}).click();
  assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),1);
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.locator('#prodSearch').fill('motor');
  assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),1);
  await page.locator('#prodSearchClear').click();
  assert.equal(await page.locator('#prodTableBody tr:not([hidden])').count(),4);
  await page.locator('#prodTable [data-sort-key="sellingPrice"]').click();
  assert.match(await page.locator('#prodTableBody tr:first-child').innerText(),/LED Switch/);
 }finally{await page.close();}
});

test('Column visibility persists, required columns are locked and keyboard menu supports escape',async()=>{
 const page=await browser.newPage({viewport:{width:390,height:780}});
 try{await setup(page);if(baseline)return;
  await page.locator('#hpt-column-button').click();
  const pop=page.getByRole('menu',{name:'Choose product table columns'});
  await pop.getByRole('menuitemcheckbox',{name:'Category'}).click();
  assert.equal(await page.locator('#prodTable thead [data-hpt-column="category"]').isVisible(),false);
  assert.equal(await pop.getByRole('menuitemcheckbox',{name:'Product'}).isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await pop.isVisible(),false);
  await page.reload({waitUntil:'domcontentloaded'});await page.evaluate(products=>{
    const app=document.getElementById('app');app.style.visibility='visible';app.style.display='block';
    const overlay=document.getElementById('loginOverlay');if(overlay)overlay.style.display='none';
    document.querySelectorAll('.page').forEach(node=>{node.hidden=true;node.style.display='none';});
    const productPage=document.getElementById('page-products');productPage.hidden=false;productPage.style.display='block';
    prodState.products=products;prodState.categories=[{name:'Electrical'}];prodFillCategoryAndUnitSelects_();prodRender();
  },products);
  assert.equal(await page.locator('#prodTable thead [data-hpt-column="category"]').isVisible(),false);
 }finally{await page.close();}
});
