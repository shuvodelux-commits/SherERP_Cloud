import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// The live browser uses the actual compiled original UI and actual public
// inert Worker route; no mock handler, trusted auth adapter, D1, or business
// data is supplied. The cross-Origin probe uses Playwright's HTTP client
// because browsers do not let JavaScript manually set an Origin header.
let server;
let browser;
before(async()=>{
  server=await serveCompiledUi();
  browser=await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
  });
});
after(async()=>{
  await browser?.close();
  await server?.close();
});

async function pageWithOriginalLogin(){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.locator('#loginOverlay:not([hidden])').waitFor();
  return page;
}

async function assertLocked(page){
  assert.equal(await page.locator('#loginOverlay').isVisible(),true);
  assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
}

test('public health endpoint reports inert foundation and no database',async()=>{
  const page=await pageWithOriginalLogin();
  try{
    const result=await page.evaluate(async()=>{
      const reply=await fetch('/api/health',{cache:'no-store'});
      return {
        status:reply.status,
        body:await reply.json(),
        cache:reply.headers.get('cache-control'),
        nosniff:reply.headers.get('x-content-type-options')
      };
    });
    assert.equal(result.status,200);
    assert.deepEqual(result.body,{
      status:'foundation',service:'shererp-cloud',database:'not-connected'
    });
    assert.equal(result.cache,'no-store');
    assert.equal(result.nosniff,'nosniff');
    await assertLocked(page);
  }finally{await page.close();}
});

test('public Worker rejects malformed, unsupported and overlarge RPC in Chromium',async()=>{
  const page=await pageWithOriginalLogin();
  try{
    const results=await page.evaluate(async()=>{
      const probes=[
        {name:'wrong-method',method:'GET',status:405,message:'POST required'},
        {name:'wrong-content-type',method:'POST',headers:{'Content-Type':'text/plain'},
         body:'{}',status:415,message:'JSON request required'},
        {name:'malformed-json',method:'POST',headers:{'Content-Type':'application/json'},
         body:'{bad-json',status:400,message:'Invalid JSON'},
        {name:'invalid-method-name',method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({fnName:'__proto__',args:[]}),
         status:400,message:'Invalid RPC payload'},
        {name:'unapproved-method',method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({fnName:'eraseProductionData',args:[]}),
         status:501,message:'RPC method not migrated'},
        {name:'unmigrated-products',method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({fnName:'getProducts',args:[]}),
         status:501,message:'RPC method not migrated'},
        {name:'login-no-backend',method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({fnName:'login',args:['01700000000','invalid-fixture']}),
         status:503,message:'Sign-in is unavailable because server authentication is not configured yet.'},
        {name:'oversize',method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({fnName:'getProducts',args:['x'.repeat(66_000)]}),
         status:413,message:'RPC request too large'}
      ];
      const out=[];
      for(const probe of probes){
        const response=await fetch('/api/rpc',{
          method:probe.method,
          headers:probe.headers,
          body:probe.body,
          credentials:'same-origin'
        });
        const payload=await response.json();
        out.push({
          name:probe.name,status:response.status,success:payload.success,
          message:payload.message,cache:response.headers.get('cache-control'),
          nosniff:response.headers.get('x-content-type-options'),
          allow:response.headers.get('allow'),
          expectedStatus:probe.status,expectedMessage:probe.message
        });
      }
      return out;
    });
    assert.equal(results.length,8);
    for(const row of results){
      assert.equal(row.status,row.expectedStatus,row.name+' HTTP status');
      assert.equal(row.success,false,row.name+' must not report success');
      assert.equal(row.message,row.expectedMessage,row.name+' controlled error');
      assert.equal(row.cache,'no-store',row.name+' cannot be cached');
      assert.equal(row.nosniff,'nosniff',row.name+' must block MIME sniffing');
      if(row.name==='wrong-method')assert.equal(row.allow,'POST');
    }
    const evidence=results.map(({name,status,message,cache,nosniff})=>({
      name,status,message,cache,nosniff
    }));
    const dir=join(process.cwd(),'test-results','m01-browser');
    await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'public-rpc-negative-contract.json'),
      JSON.stringify(evidence,null,2)+'\n');
    await assertLocked(page);
  }finally{await page.close();}
});

test('public RPC rejects explicit foreign Origin before dispatch',async()=>{
  const page=await pageWithOriginalLogin();
  try{
    const response=await page.request.post(server.url+'api/rpc',{
      headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},
      data:JSON.stringify({fnName:'getProducts',args:[]})
    });
    assert.equal(response.status(),403);
    assert.deepEqual(await response.json(),{
      success:false,message:'Cross-origin RPC forbidden'
    });
    assert.equal(response.headers()['cache-control'],'no-store');
    assert.equal(response.headers()['x-content-type-options'],'nosniff');
    await assertLocked(page);
  }finally{await page.close();}
});

test('compiled original serverCall propagates the inert Worker failure without opening the shell',async()=>{
  const page=await pageWithOriginalLogin();
  const calls=[];
  page.on('request',request=>{
    if(request.url().endsWith('/api/rpc') && request.method()==='POST')
      calls.push(request.postDataJSON());
  });
  try{
    const result=await page.evaluate(async()=>{
      try{
        await serverCall('getProducts','synthetic-argument');
        return {resolved:true};
      }catch(error){
        return {resolved:false,name:error.name,message:error.message};
      }
    });
    assert.deepEqual(result,{
      resolved:false,name:'Error',message:'RPC method not migrated'
    });
    assert.deepEqual(calls,[{fnName:'getProducts',args:['synthetic-argument']}],
      'original source adapter must call only one same-origin RPC');
    await assertLocked(page);
  }finally{await page.close();}
});


test('compiled original Chromium RPC rejects malformed explicit success on synthetic HTTP 200',async()=>{
  const page=await pageWithOriginalLogin();
  let syntheticReply={success:'false',data:{privateSuccess:'UNAUTHORIZED'}};
  const calls=[];
  try{
    await page.route('**/api/rpc',async route=>{
      calls.push(route.request().postDataJSON());
      await route.fulfill({
        status:200,contentType:'application/json',
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
        body:JSON.stringify(syntheticReply)
      });
    });
    const browserCall=()=>page.evaluate(async()=>{
      try{
        return {resolved:true,value:await serverCall('getProducts')};
      }catch(error){
        return {resolved:false,name:error.name,message:error.message};
      }
    });
    for(const invalid of ['false',0,1,null,[]]){
      syntheticReply={success:invalid,data:{privateSuccess:'UNAUTHORIZED'}};
      assert.deepEqual(await browserCall(),{
        resolved:false,name:'Error',message:'Server error'
      },'malformed explicit success='+JSON.stringify(invalid)+' must reject in Chromium');
    }
    syntheticReply={success:true,data:{value:'VALID_SYNTHETIC'}};
    assert.deepEqual(await browserCall(),{
      resolved:true,value:{value:'VALID_SYNTHETIC'}
    },'Boolean success still unwraps data');
    syntheticReply={legacyValue:'RAW_SOURCE_COMPATIBLE'};
    assert.deepEqual(await browserCall(),{
      resolved:true,value:{legacyValue:'RAW_SOURCE_COMPATIBLE'}
    },'original source may omit success for raw return values');
    syntheticReply={success:false,message:'Denied'};
    assert.deepEqual(await browserCall(),{
      resolved:false,name:'Error',message:'Denied'
    });
    assert.equal(calls.length,8);
    assert.ok(calls.every(c=>c.fnName==='getProducts'&&Array.isArray(c.args)&&c.args.length===0));
    await assertLocked(page);
  }finally{
    await page.close();
  }
});
