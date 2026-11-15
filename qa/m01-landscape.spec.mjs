import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Independent M01 source-parity tests: actual compiled original HTML and
// original responsive CSS, actual inert Worker login denial, synthetic only.
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

async function currentViewportState(page){
  return page.evaluate(()=>{
    const root=document.documentElement;
    return {
      mobile:isPhoneViewport_(),
      width:window.innerWidth,
      visualHeight:Math.round(window.visualViewport?.height || window.innerHeight),
      heightVar:getComputedStyle(root).getPropertyValue('--app-viewport-height').trim(),
      navClearance:getComputedStyle(root).getPropertyValue('--mobile-nav-clearance').trim(),
      sidebarDisplay:getComputedStyle(document.querySelector('.sidebar')).display,
      landscapeCoarse:matchMedia('(orientation: landscape) and (max-height: 540px) and (pointer: coarse)').matches,
      shellHidden:getComputedStyle(document.getElementById('app')).visibility==='hidden',
      loginVisible:!document.getElementById('loginOverlay').hidden
    };
  });
}

async function assertViewportMetrics(page){
  await page.waitForFunction(()=>{
    const measured=Math.round(window.visualViewport?.height || window.innerHeight)+'px';
    return getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height').trim()===measured;
  });
  const state=await currentViewportState(page);
  assert.equal(state.heightVar,state.visualHeight+'px');
  assert.ok(Number.parseFloat(state.navClearance)>=72,'mobile nav clearance should stay available');
  assert.equal(state.shellHidden,true,'unverified login must never reveal the protected app');
  assert.equal(state.loginVisible,true);
  return state;
}

test('original responsive viewport metrics survive portrait to coarse landscape and back',async()=>{
  const page=await browser.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const portrait=await assertViewportMetrics(page);
    assert.equal(portrait.mobile,true);
    assert.equal(portrait.sidebarDisplay,'none');
    assert.equal(portrait.landscapeCoarse,false);

    await page.setViewportSize({width:812,height:375});
    const landscape=await assertViewportMetrics(page);
    assert.equal(landscape.mobile,true,'coarse landscape must stay phone-mode above 540px');
    assert.equal(landscape.landscapeCoarse,true);
    assert.equal(landscape.sidebarDisplay,'none');

    await page.setViewportSize({width:375,height:812});
    const restored=await assertViewportMetrics(page);
    assert.equal(restored.mobile,true);
    assert.equal(restored.landscapeCoarse,false);
    assert.equal(restored.sidebarDisplay,'none');
    assert.equal(restored.width,375);
    assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
  }finally{await page.close();}
});

test('original wide short landscape uses desktop layout on a fine-pointer browser',async()=>{
  const page=await browser.newPage({viewport:{width:812,height:375}});
  try{
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    const state=await assertViewportMetrics(page);
    assert.equal(state.mobile,false,'original predicate requires coarse pointer in wide landscape');
    assert.equal(state.landscapeCoarse,false);
    assert.notEqual(state.sidebarDisplay,'none','fine-pointer landscape must retain desktop shell styling');
  }finally{await page.close();}
});

test('original landscape login stays touch-operable at wide and compact phone sizes',async t=>{
  for(const {width,height} of [{width:812,height:375},{width:568,height:320}]){
    await t.test(width+'x'+height+' touch landscape',async()=>{
      const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
      let loginRequests=0;
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        const state=await assertViewportMetrics(page);
        assert.equal(state.mobile,true);
        assert.equal(state.landscapeCoarse,true);
        assert.equal(state.sidebarDisplay,'none');
        const artifactDir=join(process.cwd(),'test-results','m01-browser');
        await mkdir(artifactDir,{recursive:true});
        await page.screenshot({path:join(artifactDir,'original-login-landscape-'+width+'x'+height+'.png'),fullPage:true});
        for(const selector of ['.login-card','#loginMobile','#loginPassword','#loginTogglePassword','#loginSubmitBtn']){
          const box=await page.locator(selector).boundingBox();
          assert.ok(box && box.width>0,selector+' must have a width');
          assert.ok(box.x>=-1 && box.x+box.width<=width+1,selector+' must fit horizontally');
        }
        page.on('request',req=>{
          if(req.url().endsWith('/api/rpc') && req.method()==='POST' &&
            req.postDataJSON()?.fnName==='login')loginRequests++;
        });
        await page.locator('#loginMobile').fill('01700000000');
        await page.locator('#loginPassword').fill('synthetic-landscape-invalid');
        const toggle=page.locator('#loginTogglePassword');
        await toggle.tap();
        assert.equal(await page.locator('#loginPassword').getAttribute('type'),'text');
        await toggle.tap();
        assert.equal(await page.locator('#loginPassword').getAttribute('type'),'password');
        assert.equal(loginRequests,0,'visibility toggles must not submit');
        const response=page.waitForResponse(res=>res.url().endsWith('/api/rpc') &&
          res.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').tap();
        assert.equal((await response).status(),503,'inert Worker cannot authenticate');
        await page.locator('#loginError').getByText(
          'Sign-in is unavailable because server authentication is not configured yet.').waitFor();
        await page.locator('#loginSubmitBtn:not([disabled])').waitFor();
        assert.equal(loginRequests,1);
        assert.equal(await page.locator('#app').evaluate(el=>getComputedStyle(el).visibility),'hidden');
      }finally{await page.close();}
    });
  }
});
