import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {after,before,test} from 'node:test';
import {chromium} from 'playwright';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

let outputDir,server,browser,url,logoutCount=0,rpcCount=0;
const shopId='22222222-2222-4222-8222-222222222222';
const session={role:'Owner',shopId,dashboard:{displayName:'Fixture Machinery',dataAvailable:false}};
const appShell=buildSourceAppShellData({shopName:'Fixture Machinery',currencySymbol:''}).data;

before(async()=>{
  outputDir=await mkdtemp(join(tmpdir(),'shererp-owner-browser-'));
  await buildOwnerFrontend({outputDir});
  server=createServer((request,response)=>{
    void (async()=>{
      const path=new URL(request.url,'http://localhost').pathname;
      response.setHeader('Cache-Control','no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      if(path==='/api/owner/auth/session'){
        response.writeHead(logoutCount?401:200,{'Content-Type':'application/json'});
        response.end(JSON.stringify(logoutCount?{error:'Owner setup denied'}:session));
        return;
      }
      if(path==='/api/owner/app-shell'){
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({success:true,data:appShell}));
        return;
      }
      if(path==='/api/owner/catalog'){
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({data:[{productId:'P1',name:'Fixture Drill',category:'Tools',brand:'Maker',unit:'Each',listedPrice:'12.50',savedPurchasePrice:'8.25',stockAtBackup:'19.125'}]}));
        return;
      }
      if(path==='/api/owner/auth/logout'&&request.method==='POST'){
        logoutCount++;
        response.writeHead(200,{'Content-Type':'application/json'});
        response.end(JSON.stringify({signedOut:true}));
        return;
      }
      if(path==='/api/rpc'){
        rpcCount++;
        response.writeHead(501,{'Content-Type':'application/json'});
        response.end(JSON.stringify({error:'RPC method not migrated'}));
        return;
      }
      const assetPath=path==='/'?'/index.html':path==='/app'?'/owner-erp.html':path;
      const file=resolve(outputDir,'.'+assetPath);
      if(!file.startsWith(resolve(outputDir)+'/')){
        response.writeHead(404);response.end();return;
      }
      try{
        const content=await readFile(file);
        const extension=extname(file);
        const type=extension==='.html'?'text/html; charset=utf-8':
          extension==='.js'||extension==='.mjs'?'text/javascript; charset=utf-8':
          extension==='.css'?'text/css; charset=utf-8':'application/octet-stream';
        response.writeHead(200,{'Content-Type':type});
        response.end(path==='/'?content.toString('utf8').replace('<body>','<body data-owner-erp="enabled">'):content);
      }catch{response.writeHead(404);response.end('Not found');}
    })().catch(()=>{if(!response.headersSent)response.writeHead(500);response.end();});
  });
  await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolvePromise);});
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});

after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(resolvePromise=>server.close(resolvePromise));
  if(outputDir)await rm(outputDir,{recursive:true,force:true});
});

test('Owner session restore opens ERP modules, blocks RPC, and signs out through Owner auth',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route(/^https:\/\/fonts\./,route=>route.abort());
    await page.goto(url+'/',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url+'/app');
    await page.locator('#owner-data-notice').waitFor();
    assert.equal(await page.locator('#app').evaluate(element=>getComputedStyle(element).visibility),'visible');
    await page.locator('#navList .nav-item[aria-label="Sales"]').waitFor();
    assert.equal(await page.locator('#shopNameLabel').textContent(),'Fixture Machinery');
    await page.locator('#navList .nav-item[aria-label="Products"]').waitFor();
    await page.locator('#logoutBtn').waitFor();
    assert.match(await page.locator('#owner-data-notice').innerText(),/reads and saves are unavailable/);
    assert.equal(await page.locator('#loginMobile, #loginPassword').count(),0);
    await page.waitForLoadState('networkidle');
    assert.equal(rpcCount,0,'the Owner UI must not send business RPCs');

    await page.locator('#navList .nav-item[aria-label="Products"]').click();
    const product=page.locator('#prodTableBody tr').filter({hasText:'Fixture Drill'});
    await product.waitFor({timeout:5000});
    assert.match(await product.innerText(),/12\.50/);
    assert.match(await product.innerText(),/8\.25/);
    assert.match(await product.innerText(),/19\.125/);
    assert.equal(await product.getByText('Unavailable',{exact:true}).count(),1);
    assert.equal(await page.locator('#prodAddBtn').isVisible(),false);
    await page.locator('#prodSearch').fill('not in the catalog');
    await product.waitFor({state:'hidden'});

    await page.locator('#logoutBtn').click();
    await page.locator('#confirmActionModal:not([hidden])').waitFor();
    await page.locator('#confirmActionConfirm').click();
    await page.waitForURL(url+'/');
    await page.locator('#login:not([hidden])').waitFor();
    assert.equal(logoutCount,1);
    assert.equal(rpcCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
