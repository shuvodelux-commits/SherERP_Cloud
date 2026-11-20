import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {before,after,test} from 'node:test';
import {chromium} from 'playwright';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';

const shopId='22222222-2222-4222-8222-222222222222';
const operationId='11111111-1111-4111-8111-111111111111';
const session={role:'Owner',shopId,dashboard:{displayName:'Fixture Hardware',dataAvailable:false}};
const sourceShell=buildSourceAppShellData({shopName:'Fixture Hardware',currencySymbol:''}).data;
const reason='<img src=x onerror="window.__audit_xss=1"> review a support request';
const events=[
  {eventType:'END',eventAtMs:Date.now()-20000,operationId,reason,actor:'Platform Super Admin'},
  {eventType:'READ',eventAtMs:Date.now()-30000,operationId,reason:'Product catalog setup review',actor:'Platform Super Admin'},
  {eventType:'START',eventAtMs:Date.now()-40000,operationId,reason:'Product catalog setup review',actor:'Platform Super Admin'},
];

let outputDir,server,browser,url;
before(async()=>{
  outputDir=await mkdtemp(join(tmpdir(),'shererp-owner-support-ui-'));
  await buildOwnerFrontend({outputDir});
  server=createServer((req,res)=>{
    void (async()=>{
      const path=new URL(req.url,'http://localhost').pathname;
      if(path.startsWith('/api/')){
        res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify({error:'Unexpected request'}));
        return;
      }
      const asset=path==='/app'?'/owner-erp.html':path==='/'?'/index.html':path;
      const file=resolve(outputDir,'.'+asset);
      if(!file.startsWith(resolve(outputDir)+'/')){res.writeHead(404);res.end();return;}
      try{
        const data=await readFile(file);
        const ext=extname(file);
        const type=ext==='.html'?'text/html; charset=utf-8':
          ext==='.js'||ext==='.mjs'?'text/javascript; charset=utf-8':
            ext==='.css'?'text/css; charset=utf-8':'application/octet-stream';
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});
        res.end(data);
      }catch{res.writeHead(404);res.end('Not found');}
    })().catch(()=>{res.writeHead(500);res.end();});
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});
after(async()=>{
  await browser?.close();
  if(server?.listening)await new Promise(ok=>server.close(ok));
  if(outputDir)await rm(outputDir,{recursive:true,force:true});
});

async function ownerPage({enabled=false,response={events},status=200,width=1280}={}){
  let auditCount=0,apiUnexpected=0,logoutCount=0;
  const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https:\/\/fonts\./,r=>r.abort());
  await page.route('**/api/owner/**',async route=>{
    const request=route.request();
    const path=new URL(request.url()).pathname;
    let code=200,body;
    if(path==='/api/owner/auth/session')body=enabled?{...session,supportAuditEnabled:true}:session;
    else if(path==='/api/owner/app-shell')body={success:true,data:sourceShell};
    else if(path==='/api/owner/catalog')body={data:[]};
    else if(path==='/api/owner/support/audit'){
      auditCount++;
      assert.equal(request.method(),'GET');
      assert.equal(new URL(request.url()).search,'');
      assert.equal(request.postData(),null);
      code=status;body=response;
    }else if(path==='/api/owner/auth/logout'){logoutCount++;body={signedOut:true};}
    else{apiUnexpected++;code=404;body={error:'Unsupported API'};}
    await route.fulfill({status:code,contentType:'application/json',
      headers:{'Cache-Control':'no-store'},body:JSON.stringify(body)});
  });
  await page.goto(url+'/app',{waitUntil:'domcontentloaded'});
  await page.locator('#owner-data-notice').waitFor();
  await page.locator('#navList .nav-item[aria-label="Sales"]').waitFor();
  return {page,errors,counts:()=>({auditCount,apiUnexpected,logoutCount})};
}

test('default-off Owner ERP keeps support history hidden and never fetches audit',async()=>{
  const {page,errors,counts}=await ownerPage();
  try{
    assert.equal(await page.locator('#owner-support-activity').isVisible(),false);
    assert.equal(await page.locator('#owner-support-refresh').isVisible(),false);
    assert.equal(counts().auditCount,0);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('enabled Owner manually loads redacted support events as inert text and stays mobile compact',async()=>{
  const {page,errors,counts}=await ownerPage({enabled:true,width:390});
  try{
    assert.equal(await page.locator('#owner-support-activity').isVisible(),true);
    assert.equal(counts().auditCount,0,'no eager support history fetch');
    await page.locator('#owner-support-refresh').click();
    const items=page.locator('#owner-support-events li');
    await items.nth(2).waitFor();
    assert.equal(await items.count(),3);
    assert.match(await items.first().innerText(),/END/);
    assert.match(await items.first().innerText(),/Platform Super Admin/);
    assert.match(await items.first().innerText(),/review a support request/);
    assert.equal(await page.evaluate(()=>window.__audit_xss??0),0,'untrusted reason did not execute');
    assert.equal(await page.locator('#owner-support-activity img').count(),0,'no HTML injection');
    assert.equal(counts().auditCount,1);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);
    assert.ok(await page.evaluate(()=>document.getElementById('owner-support-activity').getBoundingClientRect().right<=390));
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('empty history is distinct from unavailable, malformed and expired Owner session',async()=>{
  for(const [status,response,phrase] of [
    [200,{events:[]},/No support activity recorded/],
    [503,{error:'Support audit unavailable'},/temporarily unavailable/],
    [401,{error:'Owner setup denied'},/Sign in again/],
    [200,{events:[{eventType:'SCRIPT',eventAtMs:1,reason:'inject'}]},/temporarily unavailable/],
  ]){
    const {page,counts}=await ownerPage({enabled:true,status,response});
    try{
      await page.locator('#owner-support-refresh').click();
      await page.getByText(phrase).waitFor();
      assert.equal(await page.locator('#owner-support-events li').count(),0);
      assert.equal(counts().auditCount,1);
    }finally{await page.close();}
  }
});
