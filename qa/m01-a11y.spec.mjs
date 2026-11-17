import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';
import {installM01SyntheticNavigation} from './m01-auth-nav-fixture.mjs';

// M01 original UI only: tests compiled presentation with synthetic login.
// These tests do not enable a public RPC handler or financial posting.
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

test('M01 compiled login announces page language, title, and visible field labels',async t=>{
  for(const viewport of [{width:320,height:640},{width:1440,height:900}]){
    await t.test(viewport.width+'x'+viewport.height,async()=>{
      const page=await browser.newPage({viewport});
      try {
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        const result=await page.evaluate(()=>({
          language:document.documentElement.lang,
          title:document.title,
          mobileLabels:[...(document.getElementById('loginMobile')?.labels||[])].map(l=>l.textContent.trim()),
          passwordLabels:[...(document.getElementById('loginPassword')?.labels||[])].map(l=>l.textContent.trim()),
          sourceFingerprint:document.getElementById('loginOverlay')?.className
        }));
        assert.equal(result.language,'en','English source UI must declare its primary page language');
        assert.equal(result.title,'Hardware Store ERP','original sign-in must have a descriptive browser title');
        assert.deepEqual(result.mobileLabels,['Mobile Number'],'mobile input needs its visible label');
        assert.deepEqual(result.passwordLabels,['Password'],'password input needs its visible label');
        assert.equal(result.sourceFingerprint,'login-overlay','login UI must remain original');
        assert.ok(await page.getByRole('textbox',{name:'Mobile Number'}).count(),
          'mobile accessible name must match visible label, not placeholder');
      }finally {await page.close();}
    });
  }
});

test('M01 mobile More keyboard dialog contains focus and restores it to the opener',async t=>{
  for(const viewport of [{width:375,height:812},{width:812,height:375}]){
    await t.test(viewport.width+'x'+viewport.height,async()=>{
      const page=await browser.newPage({viewport,isMobile:true,hasTouch:true});
      const {calls}=await installM01SyntheticNavigation(page);
      try{
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        await page.locator('#loginSubmitBtn').click();
        await page.waitForFunction(()=>document.getElementById('loginOverlay')?.hidden===true);
        const opener=page.locator('#mobileBottomNav [data-mobile-page="more"]');
        await opener.click();
        await page.locator('#mobileMoreSheet:not([hidden])').waitFor();
        const state=()=>page.evaluate(()=>{
          const sheet=document.getElementById('mobileMoreSheet');
          const dialog=sheet.querySelector('[role="dialog"][aria-modal="true"]');
          return {
            dialogOpen:!sheet.hidden,
            focusInDialog:dialog.contains(document.activeElement),
            backgroundInert:document.getElementById('app')?.inert===true,
            focusIsBackground:document.querySelector('#app')?.contains(document.activeElement)||false
          };
        });
        assert.equal((await state()).focusInDialog,true,
          'opening an aria-modal dialog must focus an actionable element inside it');
        assert.equal((await state()).backgroundInert,true,
          'a modal dialog must render the underlying original ERP shell inert');
        for(let i=0;i<10;i++){
          await page.keyboard.press('Tab');
          assert.equal((await state()).focusInDialog,true,
            'Tab must never escape the More dialog into the ERP shell');
        }
        for(let i=0;i<10;i++){
          await page.keyboard.press('Shift+Tab');
          assert.equal((await state()).focusInDialog,true,
            'Shift+Tab must never escape the More dialog');
        }
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#mobileMoreSheet').getAttribute('hidden'),'',
          'Escape must close original More sheet');
        assert.equal(await opener.evaluate(el=>el===document.activeElement),true,
          'focus must return to original More trigger after Escape');
        assert.equal(await page.locator('#app').evaluate(el=>el.inert),false,
          'closing More must restore original app interactivity');
        assert.equal(calls.filter(x=>/Sale|Payment|Purchase|Return|Posting/.test(x.fnName)).length,0,
          'synthetic keyboard navigation must not post any financial RPC');
      }finally{await page.close();}
    });
  }
});
