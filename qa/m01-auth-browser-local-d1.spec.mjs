import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../src/auth/d1-auth-core.js';
import {createD1LegacyAuthRpc} from '../src/auth/d1-legacy-rpc.js';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Nondeployable original Chromium -> source M04 auth HTTP -> isolated actual D1.
// The shop shell metadata is a synthetic test stub, NOT a migrated RPC.
const NOW=1_800_400_000_000;
const MOBILE='01710000802',PASSWORD='Synthetic!M01-Auth#2026',USER_ID='USR-M01-BROWSER';
const shell={
  shopName:'Synthetic SherERP',currencySymbol:'৳',
  navItems:[{key:'dashboard',label:'Dashboard',bn:'',icon:'dashboard',
    sidebarGroup:1,sidebarOrder:1}]
};
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const rpcMatch=name=>response=>response.url().endsWith('/api/rpc') &&
  response.request().method()==='POST' &&
  response.request().postDataJSON()?.fnName===name;

test('original Chromium login/restore/logout use real isolated M04 auth D1, not public login',async()=>{
  const harness=createTestHarness({workers:[{
    configPath:'./wrangler.m04-auth-http-test.jsonc'
  }]});
  let site,browser,page;
  try{
    await harness.listen();
    const worker=harness.getWorker('shererp-m04-auth-http-local-only');
    await worker.applyD1Migrations('DB');
    const {DB}=await worker.getEnv();
    const cred=await createOfflinePasswordCredential(PASSWORD);
    await DB.prepare(
      "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) "+
      "VALUES('M01Clerk','Active',?,?)"
    ).bind(JSON.stringify({dashboard:{view:true}}),'dashboard').run();
    await DB.prepare(
      'INSERT INTO auth_users '+
      '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
      "VALUES(?,?,?,?,'Active',?,?,?)"
    ).bind(USER_ID,'Synthetic Browser Clerk',MOBILE,'M01Clerk',
      cred.passwordHash,cred.passwordSalt,cred.iterations).run();

    const adapter=createD1LegacyAuthRpc(DB,{
      now:()=>NOW,normalizeMobile:value=>typeof value==='string'?value.trim():''
    });
    // The option must ONLY exist in the loopback QA server, never src/index.js.
    site=await serveCompiledUi({internalAuthAdapter:adapter});
    browser=await chromium.launch({
      headless:true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
    });
    page=await browser.newPage({viewport:{width:1280,height:800}});
    let shellCalls=0;
    const requests=[];
    let logoutRpcResult;
    await page.route('**/api/rpc',async route=>{
      const payload=route.request().postDataJSON();
      requests.push({fnName:payload?.fnName,arity:payload?.args?.length});
      if(payload?.fnName==='logout'){
        // Capture the real local D1 response before the original UI navigates
        // away; Chromium may discard its body after logout redirects.
        const reply=await route.fetch();
        logoutRpcResult={status:reply.status(),body:await reply.json()};
        return route.fulfill({response:reply});
      }
      if(payload?.fnName!=='getAppShellData')return route.continue();
      shellCalls++;
      await route.fulfill({
        status:200,contentType:'application/json',
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
        body:JSON.stringify({success:true,data:shell})
      });
    });
    await page.goto(site.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.waitForFunction(()=>
      document.getElementById('loginShopName')?.textContent==='Synthetic SherERP');
    assert.equal(shellCalls,1,'original login branding requests one app-shell payload');
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');

    await page.locator('#loginMobile').fill(MOBILE);
    await page.locator('#loginPassword').fill('invalid-synthetic');
    const wrongResponse=page.waitForResponse(rpcMatch('login'));
    await page.locator('#loginPassword').press('Enter');
    const bad=await wrongResponse;
    assert.equal(bad.status(),200,'M04 source failure envelope has HTTP 200');
    assert.deepEqual(await bad.json(),{
      success:false,message:'Invalid mobile number or password.'
    });
    await page.locator('#loginError')
      .getByText('Invalid mobile number or password.').waitFor();
    assert.equal(await page.locator('#loginOverlay').isVisible(),true);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),null);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first()).n,0);

    await page.locator('#loginPassword').fill(PASSWORD);
    const successResponse=page.waitForResponse(rpcMatch('login'));
    await page.locator('#loginPassword').press('Enter');
    const success=await successResponse;
    assert.equal(success.status(),200,
      'reviewed local M04 reader is required; inert public login would return 503');
    const login=await success.json();
    assert.equal(login.success,true);
    assert.match(login.data.token,/^[0-9a-f]{64}$/);
    assert.deepEqual(login.data.user,{
      id:USER_ID,name:'Synthetic Browser Clerk',mobile:MOBILE,role:'M01Clerk'
    });
    assert.deepEqual(login.data.allowedModules,['dashboard']);
    assert.deepEqual(login.data.permissions,{dashboard:{view:true}});
    await page.waitForFunction(()=>document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#navList .nav-item[data-page="dashboard"]').waitFor();
    assert.equal(await page.locator('#shopNameLabel').textContent(),'Synthetic SherERP');
    assert.equal(await page.locator('#loginPassword').inputValue(),'');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),login.data.token);
    assert.equal(shellCalls,1,'source app-shell metadata promise is reused after login');
    assert.equal((await DB.prepare(
      'SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=?'
    ).bind(digest(login.data.token)).first()).n,1);
    assert.equal((await DB.prepare(
      'SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=?'
    ).bind(login.data.token).first()).n,0,'raw session must not be D1 key');

    const restore=page.waitForResponse(rpcMatch('validateSession'));
    await page.reload({waitUntil:'domcontentloaded'});
    const restored=await restore;
    assert.equal(restored.status(),200);
    assert.equal((await restored.json()).data.token,login.data.token);
    await page.waitForFunction(()=>document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#navList .nav-item[data-page="dashboard"]').waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),login.data.token);

    const logoutResponse=page.waitForResponse(rpcMatch('logout'));
    await page.evaluate(()=>{void doLogout_();});
    const logout=await logoutResponse;
    assert.equal(logout.status(),200);
    assert.deepEqual(logoutRpcResult,{status:200,body:{success:true,data:'logged out'}});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.waitForFunction(()=>localStorage.getItem('hwerp.session.token')===null);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
    assert.equal((await DB.prepare(
      'SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=? AND revoked_at_ms IS NOT NULL'
    ).bind(digest(login.data.token)).first()).n,1);

    const other=await page.request.post(site.url+'api/rpc',{
      headers:{'Content-Type':'application/json'},
      data:JSON.stringify({fnName:'getDayBookTransactions',args:[login.data.token,{}]})
    });
    assert.equal(other.status(),501,'internal auth does not activate business methods');
    assert.deepEqual(await other.json(),{
      success:false,message:'RPC method not migrated'
    });
    const wrongOrigin=await page.request.post(site.url+'api/rpc',{
      headers:{Origin:'https://foreign.invalid','Content-Type':'application/json'},
      data:JSON.stringify({fnName:'login',args:[MOBILE,PASSWORD]})
    });
    assert.equal(wrongOrigin.status(),403);
    assert.deepEqual(await wrongOrigin.json(),{
      success:false,message:'Cross-origin RPC forbidden'
    });
    assert.ok(requests.some(x=>x.fnName==='login'&&x.arity===2));
    assert.ok(requests.some(x=>x.fnName==='validateSession'&&x.arity===1));
    assert.ok(requests.some(x=>x.fnName==='logout'&&x.arity===1));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_users').first()).n,1);
  }finally{
    await page?.close();
    await browser?.close();
    await site?.close();
    await harness.close();
  }
});


test('real isolated M04 D1 Clerk session preserves source mobile More nav, restore and logout',async()=>{
  // This test is committed before the M01-owned D1 bootstrap helper (RED).
  // Login/validateSession/logout MUST reach reviewed M04 + local actual D1,
  // never a Playwright synthetic authentication response.
  const {createM01PhoneD1AuthFixture}=
    await import('./m01-mobile-d1-fixture.mjs');
  const fixture=await createM01PhoneD1AuthFixture({now:NOW});
  let browser,page;
  const requests=[];
  try{
    browser=await chromium.launch({
      headless:true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
    });
    page=await browser.newPage({
      viewport:{width:375,height:812},isMobile:true,hasTouch:true
    });
    const shell={
      shopName:'Synthetic M01 Local D1 Phone',
      currencySymbol:'৳',
      navItems:[
        {key:'dashboard',label:'Dashboard',icon:'dashboard',
          sidebarGroup:0,sidebarOrder:1},
        {key:'reports',label:'Reports',icon:'reports',
          sidebarGroup:3,sidebarOrder:2},
        {key:'bank',label:'Bank',icon:'bank',
          sidebarGroup:3,sidebarOrder:3}
      ]
    };
    await page.route('**/api/rpc',async route=>{
      const body=route.request().postDataJSON();
      requests.push(body?.fnName);
      if(body?.fnName!=='getAppShellData')return route.continue();
      await route.fulfill({
        status:200,contentType:'application/json',
        body:JSON.stringify({success:true,data:shell})
      });
    });

    await page.goto(fixture.site.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.locator('#loginMobile').fill(fixture.mobile);
    await page.locator('#loginPassword').fill(fixture.password);
    const loginReply=page.waitForResponse(rpcMatch('login'));
    await page.locator('#loginSubmitBtn').tap();
    const response=await loginReply;
    assert.equal(response.status(),200,'actual M04 authenticated local-D1 RPC');
    const login=await response.json();
    assert.equal(login.success,true);
    assert.match(login.data.token,/^[0-9a-f]{64}$/);
    assert.equal(login.data.user.id,fixture.userId);
    assert.deepEqual(login.data.allowedModules,['dashboard','reports']);
    assert.equal(login.data.permissions?.reports?.view,true);
    await page.waitForFunction(()=>
      document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#navList [data-page="reports"]')
      .waitFor({state:'attached'});
    assert.equal(await page.locator('#navList [data-page="bank"]').count(),0);
    for(const key of ['pos','sales','products']){
      assert.equal(await page.locator(
        '#mobileBottomNav [data-mobile-page="'+key+'"]').isVisible(),false,
        'D1-authenticated Clerk must not get '+key+' on phone');
    }
    const more=page.locator('#mobileBottomNav [data-mobile-page="more"]');
    await more.tap();
    await page.locator('#mobileMoreSheet:not([hidden])').waitFor();
    assert.equal(await page.locator(
      '#mobileMoreList [data-mobile-target="reports"]').count(),1);
    assert.equal(await page.locator(
      '#mobileMoreList [data-mobile-target="bank"]').count(),0);
    await page.locator(
      '#mobileMoreList [data-mobile-target="reports"]').tap();
    assert.equal(await page.evaluate(()=>currentPage),'reports');
    assert.equal(await page.locator('#mobileMoreSheet').isVisible(),false);
    assert.equal(await more.getAttribute('aria-current'),'page');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hwerp.session.token')),
      login.data.token);

    const validateReply=page.waitForResponse(rpcMatch('validateSession'));
    await page.reload({waitUntil:'domcontentloaded'});
    const validated=await validateReply;
    assert.equal(validated.status(),200);
    assert.equal((await validated.json()).data.token,login.data.token);
    await page.waitForFunction(()=>
      document.getElementById('loginOverlay')?.hidden===true);
    assert.equal(await page.locator('#navList [data-page="bank"]').count(),0);
    assert.equal(await page.evaluate(()=>isPhoneViewport_()),true);

    await page.setViewportSize({width:812,height:375});
    assert.equal(await page.evaluate(()=>isPhoneViewport_()),true,
      'coarse pointer landscape must retain phone layout');
    await more.tap();
    await page.locator('#mobileMoreSheet:not([hidden])').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mobileMoreSheet').isVisible(),false,
      'original global Escape closes mobile More on authenticated landscape');
    assert.equal(await page.evaluate(()=>
      document.body.classList.contains('mobile-sheet-open')),false);
    await page.evaluate(()=>goToPage('bank'));
    assert.equal(await page.evaluate(()=>currentPage),'dashboard',
      'D1 Clerk must never navigate to Bank through a direct browser call');

    const logoutReply=page.waitForResponse(rpcMatch('logout'));
    await page.evaluate(()=>{void doLogout_();});
    assert.equal((await logoutReply).status(),200);
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.waitForFunction(()=>localStorage.getItem('hwerp.session.token')===null);
    const session=await fixture.db.prepare(
      'SELECT revoked_at_ms FROM auth_sessions WHERE token_hash=?'
    ).bind(digest(login.data.token)).first();
    assert.ok(session && session.revoked_at_ms!==null,
      'actual local D1 session must be revoked by original logout');
    assert.equal(await page.locator('#app').evaluate(
      el=>getComputedStyle(el).visibility),'hidden');
    assert.equal(requests.filter(name=>name==='login').length,1);
    assert.equal(requests.filter(name=>name==='validateSession').length,1);
    assert.equal(requests.filter(name=>name==='logout').length,1);
  }finally{
    await page?.close();
    await browser?.close();
    await fixture.close();
  }
});
