import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const shopId='22222222-2222-4222-8222-222222222222';
const session={role:'Owner',shopId,
  dashboard:{displayName:'HisabIQ Connected Fixture Shop',dataAvailable:false}};
const shell=buildSourceAppShellData({
  shopName:'HisabIQ Connected Fixture Shop',currencySymbol:'৳'
}).data;
let server,browser,outputDir,url,sessionDenied=false,financialWrites=0;
const send=(res,status,data)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
};

before(async()=>{
  outputDir=await mkdtemp(join(tmpdir(),'shererp-m09-owner-dashboard-'));
  await buildOwnerFrontend({outputDir});
  server=createServer((req,res)=>{
    void(async()=>{
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='POST'){financialWrites++;send(res,403,{success:false});return;}
      if(path==='/api/owner/auth/session'){
        send(res,sessionDenied?401:200,sessionDenied?{success:false}:session);return;
      }
      if(path==='/api/owner/app-shell'){
        send(res,200,{success:true,data:shell});return;
      }
      if(path.startsWith('/api/')){send(res,404,{success:false,message:'Not enabled in fixture'});return;}
      const target=path==='/'?'index.html':path==='/app'?'owner-erp.html':path.slice(1);
      const filePath=resolve(outputDir,target);
      if(!filePath.startsWith(resolve(outputDir)+'/')){res.writeHead(404);res.end();return;}
      try{
        const file=await readFile(filePath);
        const ext=extname(filePath);
        res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':
          ext==='.css'?'text/css; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':
          'application/octet-stream'});
        res.end(file);
      }catch{res.writeHead(404);res.end('Not found');}
    })().catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise((yes,no)=>{
    server.once('error',no);server.listen(0,'127.0.0.1',yes);
  });
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
    {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});
after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(done=>server.close(done));
  if(outputDir)await rm(outputDir,{recursive:true,force:true});
});

async function authenticatedDashboard(page){
  await page.route(/^https:\/\/fonts\./,route=>route.abort());
  await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#app') &&
    document.getElementById('app').style.visibility!=='hidden' &&
    typeof window.dashLoad==='function',{timeout:12000});
  await page.evaluate(()=>{goToPage('dashboard');return dashLoad();});
  await page.locator('#hdb-data-readiness').waitFor({state:'visible'});
}

for(const width of [320,390,768,1024,1440]){
  test('authenticated Owner Dashboard source-readiness is precise at '+width+'px',async()=>{
    const page=await browser.newPage({viewport:{width,height:width===320?720:900}});
    try{
      await authenticatedDashboard(page);
      const message=await page.locator('#hdb-data-readiness').innerText();
      assert.match(message,/Full Dashboard totals are not connected/);
      assert.match(message,/individual modules/i);
      assert.match(message,/11-field/);
      assert.doesNotMatch(await page.locator('body').innerText(),
        /Shop business data is not connected yet\./);
      assert.match(await page.locator('#owner-data-notice').innerText(),
        /Shop D1 is connected for enabled modules/);
      assert.doesNotMatch(await page.locator('#owner-data-notice').innerText(),
        /ERP screens are visible, but reads and saves are unavailable/);
      assert.equal(await page.locator('#dashSales').textContent(),'--',
        'Do not fabricate a 0 sales total');
      assert.equal(await page.locator('[data-hdb-value="dashSales"]').textContent(),'—');
      const size=await page.evaluate(()=>({
        bodyScroll:document.documentElement.scrollWidth,
        viewport:window.innerWidth
      }));
      assert.ok(size.bodyScroll<=size.viewport+2,
        'Dashboard horizontal overflow at '+width+'px '+JSON.stringify(size));
      if(width===390||width===1440){
        await mkdir('docs/reviews/m09-owner-dashboard-readiness/images',{recursive:true});
        await page.screenshot({path:
          'docs/reviews/m09-owner-dashboard-readiness/images/'+width+'-after.png',fullPage:true});
      }
      assert.equal(financialWrites,0);
    }finally{await page.close();}
  });
}

test('unexpected Dashboard read failure still displays an error and clears stale inline note',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await authenticatedDashboard(page);
    await page.evaluate(async()=>{
      window.serverCall=()=>Promise.reject(new Error('Verified test error: upstream failed'));
      await dashLoad();
    });
    assert.equal(await page.locator('#hdb-data-readiness').isVisible(),false);
    assert.match(await page.locator('body').innerText(),/Verified test error: upstream failed/);
    assert.equal(financialWrites,0);
  }finally{await page.close();}
});

test('denied Owner session does not reveal Dashboard state or call private finance API',async()=>{
  sessionDenied=true;
  const page=await browser.newPage({viewport:{width:390,height:844}});
  try{
    await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
    await page.waitForURL(url+'/',{timeout:12000});
    assert.equal(await page.locator('#hdb-data-readiness').count(),0);
    assert.equal(financialWrites,0);
  }finally{sessionDenied=false;await page.close();}
});
