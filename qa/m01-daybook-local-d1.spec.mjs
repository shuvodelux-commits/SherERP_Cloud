import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createTestHarness} from 'wrangler';
import {serveCompiledUi} from './serve-compiled-ui.mjs';
import {createM03DayBookRpcBridge} from '../src/rpc/internal-daybook-bootstrap.js';

// This is a local-only browser-to-real-Workerd/D1 acceptance fixture.
// The public Worker never imports or exposes this internal adapter.
const NOW=1_800_000_000_000;
const ALLOWED='b'.repeat(64),DENIED='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');

test('original Chromium frontend reads authorized Day Book from isolated D1 and denies revocation',async()=>{
  const harness=createTestHarness({workers:[{
    configPath:'./wrangler.m09-daybook-authorized-test.jsonc'
  }]});
  let site,browser,page;
  try {
    await harness.listen();
    const worker=harness.getWorker('shererp-m09-daybook-authorized-local');
    await worker.applyD1Migrations('DB');
    const {DB}=await worker.getEnv();
    const sql=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
    const start=sql.indexOf('CREATE TABLE settings (');
    const end=sql.indexOf('CREATE TABLE product_categories (');
    assert.ok(start>=0&&end>start,'existing source-shaped Settings DDL');
    await DB.prepare(sql.slice(start,end).trim().replace(/;\s*$/,'')).run();
    for(const [key,value] of [
      ['Currency Symbol','৳'],['Day Book Editable Days','3'],
      ['Delete Confirmation Key','PRIVATE_SYNTHETIC_NEVER_EXPOSE']
    ]){
      await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
        .bind(key,value).run();
    }
    for(const [name,canView] of [['Clerk',true],['Blocked',false]]){
      const permissions=JSON.stringify({daybook:{view:canView}});
      await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'daybook')")
        .bind(name,permissions).run();
    }
    for(const [id,role,phone,token] of [
      ['CLERK','Clerk','01710000602',ALLOWED],
      ['BLOCKED','Blocked','01710000603',DENIED]
    ]){
      await DB.prepare('INSERT INTO auth_users '+
        '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
        "VALUES(?,?,?,?,'Active',?,?,210000)")
        .bind(id,id,phone,role,'a'.repeat(64),'b'.repeat(48)).run();
      await DB.prepare('INSERT INTO auth_sessions '+
        '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
        'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES(?,?,1,1,1,?,?,?)')
        .bind(digest(token),id,NOW-300000,NOW-60000,NOW+1200000).run();
    }

    const daybook=createM03DayBookRpcBridge({DB},{now:()=>NOW});
    let bridgeCalls=0;
    // QA only: spy on the internal read and never give the public Worker this bridge.
    site=await serveCompiledUi({internalDayBookRpc:payload=>{
      bridgeCalls++;
      return daybook.invoke(payload);
    }});
    browser=await chromium.launch({
      headless:true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
    });
    page=await browser.newPage({viewport:{width:1280,height:800}});
    const requests=[];
    page.on('request',req=>{
      if(req.url().endsWith('/api/rpc') && req.method()==='POST' &&
        req.postDataJSON()?.fnName==='getDayBookBootstrap')
        requests.push(req.postDataJSON());
    });
    await page.goto(site.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const success=await page.evaluate(token=>serverCall('getDayBookBootstrap',token),ALLOWED);
    assert.deepEqual(success,{
      currencySymbol:'৳',
      editableDays:3,
      modules:[
        'Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
        'Customer Advance Refund','Supplier Payment','Expense','Finance',
        'Bank','Bank Transfer','Stock Adjustment'
      ],
      isAdmin:false
    },'browser must receive exactly the original awaited Day Book data');
    assert.equal(requests.length,1);
    assert.deepEqual(requests[0],{fnName:'getDayBookBootstrap',args:[ALLOWED]});
    assert.doesNotMatch(JSON.stringify(success),/PRIVATE_SYNTHETIC|auth_sessions/);
    assert.equal(bridgeCalls,1,'one authorized original browser RPC must reach the internal D1 bridge');

    // Exercise the actual HTTP security boundary, not only an in-page mock.
    // These requests carry exclusively synthetic credentials to loopback.
    const safeBody=JSON.stringify({fnName:'getDayBookBootstrap',args:[ALLOWED]});
    const probes=[
      {
        name:'foreign-origin',
        headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'},
        data:safeBody,status:403,message:'Cross-origin RPC forbidden'
      },
      {
        name:'wrong-content-type',
        headers:{'Content-Type':'text/plain'},
        data:safeBody,status:415,message:'JSON request required'
      },
      {
        name:'extra-client-actor',
        headers:{'Content-Type':'application/json'},
        data:JSON.stringify({fnName:'getDayBookBootstrap',args:[ALLOWED],role:'Administrator'}),
        status:400,message:'Invalid RPC arguments'
      },
      {
        name:'extra-argument',
        headers:{'Content-Type':'application/json'},
        data:JSON.stringify({fnName:'getDayBookBootstrap',args:[ALLOWED,'extra']}),
        status:400,message:'Invalid RPC arguments'
      },
      {
        name:'oversized-body',
        headers:{'Content-Type':'application/json'},
        data:JSON.stringify({fnName:'getDayBookBootstrap',args:[ALLOWED,'x'.repeat(66_000)]}),
        status:413,message:'RPC request too large'
      },
      {
        name:'malformed-json',
        headers:{'Content-Type':'application/json'},
        data:'{bad-json',status:400,message:'Invalid JSON'
      }
    ];
    for(const probe of probes){
      const reply=await page.request.post(site.url+'api/rpc',{
        headers:probe.headers,data:probe.data
      });
      assert.equal(reply.status(),probe.status,probe.name+' HTTP status');
      assert.deepEqual(await reply.json(),{
        success:false,message:probe.message
      },probe.name+' controlled payload');
      assert.equal(reply.headers()['cache-control'],'no-store',probe.name+' no caching');
      assert.equal(reply.headers()['x-content-type-options'],'nosniff',probe.name+' MIME protection');
    }
    assert.equal(bridgeCalls,1,
      'invalid HTTP requests must not reach the internal D1 authorization reader');
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);

    async function browserError(fnName,token) {
      return page.evaluate(async ({name,bearer})=>{
        try {await serverCall(name,bearer);return {resolved:true};}
        catch(e){return {resolved:false,message:e.message};}
      },{name:fnName,bearer:token});
    }
    assert.deepEqual(await browserError('getDayBookBootstrap',DENIED),{
      resolved:false,message:'Day Book is unavailable or access denied.'
    });
    assert.deepEqual(await browserError('getProducts',ALLOWED),{
      resolved:false,message:'RPC method not migrated'
    },'unrelated methods must still use the real inert public Worker');

    await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .bind(NOW+1000,digest(ALLOWED)).run();
    assert.deepEqual(await browserError('getDayBookBootstrap',ALLOWED),{
      resolved:false,message:'Day Book is unavailable or access denied.'
    },'revoked session cannot be replayed through the browser');

    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,3);
  }finally{
    await page?.close();
    await browser?.close();
    await site?.close();
    await harness.close();
  }
});
