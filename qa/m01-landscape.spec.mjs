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


test('M01 synthetic Clerk mobile and tablet navigation keeps source role filtering',async t=>{
  // Deliberately import inside only this test: first RED is the missing
  // M01-owned browser fixture, while unrelated original browser tests run.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');

  for(const {name,width,height,phone} of [
    {name:'phone-375x812',width:375,height:812,phone:true},
    {name:'landscape-812x375',width:812,height:375,phone:true},
    {name:'tablet-768x1024',width:768,height:1024,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:true,hasTouch:true
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page);
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const loginReply=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').tap();
        assert.equal((await loginReply).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        // Phone CSS intentionally hides the desktop sidebar. Its role-filtered
        // DOM entry must exist, but only the mobile More action is visible.
        await page.locator('#navList .nav-item[data-page="reports"]')
          .waitFor({state:'attached'});
        assert.equal(await page.locator('#navList .nav-item[data-page="bank"]').count(),0,
          'Clerk cannot see Bank in desktop sidebar');
        assert.equal(await page.locator('#navList .nav-item[data-page="dashboard"]').count(),1);
        assert.equal(await page.evaluate(()=>isPhoneViewport_()),phone);
        assert.equal(calls.filter(x=>x.fnName==='login').length,1,
          'viewport parity must need only one synthetic login');

        if(phone){
          for(const key of ['pos','sales','products']){
            assert.equal(await page.locator(
              '#mobileBottomNav [data-mobile-page="'+key+'"]').isVisible(),false,
              'unauthorized '+key+' primary button must be hidden');
          }
          const more=page.locator('#mobileBottomNav [data-mobile-page="more"]');
          assert.equal(await more.isVisible(),true);
          await more.tap();
          await page.locator('#mobileMoreSheet:not([hidden])').waitFor();
          assert.equal(await page.locator(
            '#mobileMoreList [data-mobile-target="reports"]').count(),1);
          assert.equal(await page.locator(
            '#mobileMoreList [data-mobile-target="bank"]').count(),0);
          await page.locator(
            '#mobileMoreList [data-mobile-target="reports"]').tap();
          assert.equal(await page.locator('#mobileMoreSheet').isVisible(),false);
          assert.equal(await page.evaluate(()=>currentPage),'reports');
          assert.equal(await page.locator(
            '#mobileBottomNav [data-mobile-page="more"]').getAttribute('aria-current'),'page');
        }else{
          // The 768px touch tablet remains the source's desktop-mode shell.
          assert.equal(await page.locator('#navList .nav-item[data-page="reports"]').count(),1);
          await page.evaluate(()=>goToPage('reports'));
          assert.equal(await page.evaluate(()=>currentPage),'reports');
        }

        // Direct client navigation still falls back from denied Bank.
        await page.evaluate(()=>goToPage('bank'));
        assert.equal(await page.evaluate(()=>currentPage),'dashboard',
          'the browser must never navigate to an unauthorized Bank view');
        const capture=await captureM01NavEvidence(page,name);
        assert.equal(capture.viewport.width,width);
        assert.equal(capture.viewport.height,height);
        assert.ok(capture.screenshotBytes>1500,'reviewable screenshot evidence');
        assert.equal(capture.loginHidden,true);
        assert.equal(capture.appVisible,true);
        assert.equal(capture.bankNavCount,0);
      }finally{
        await page.close();
      }
    });
  }
});


test('M01 Playwright original POS V2 navigation and workflow parity at phone tablet desktop',async t=>{
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',icon:'dashboard',
      sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',icon:'pos',
      sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
    {key:'bank',label:'Bank',icon:'bank',
      sidebarGroup:4,sidebarOrder:90}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-320x640',width:320,height:640,phone:true},
    {name:'tablet-768x1024',width:768,height:1024,phone:false},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},hasTouch:phone,isMobile:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const loginReply=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await loginReply).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        await page.locator('#navList .nav-item[data-page="pos"]')
          .waitFor({state:'attached'});
        assert.equal(await page.locator(
          '#navList .nav-item[data-page="bank"]').count(),0);
        assert.equal(await page.evaluate(()=>isPhoneViewport_()),phone);

        if(phone){
          const pos=page.locator('#mobileBottomNav [data-mobile-page="pos"]');
          assert.equal(await pos.isVisible(),true,'permitted POS must appear as a phone shortcut');
          await pos.tap();
        }else{
          // Tablets can keep the original desktop-mode navigation route
          // even where a collapsed sidebar is not directly visible.
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' && document.body.classList.contains('pos-v2-active'));
        assert.equal(await page.locator('#page-pos').isVisible(),true);
        assert.equal(await page.locator('#page-posv2').isVisible(),false,
          'V2 must use the source operational #page-pos, not a second checkout');
        await page.locator('#posSearch').waitFor({state:'visible'});
        await page.locator('#v2DraftsBtn').waitFor({state:'attached'});
        const addProductState=await page.evaluate(()=>{
          const button=document.getElementById('v2AddProductBtn');
          return {
            productAddAllowed:hasActionPermission_('products','add'),
            hiddenAttribute:button?.hasAttribute('hidden'),
            hiddenProperty:button?.hidden,
            computedDisplay:button?getComputedStyle(button).display:null
          };
        });
        assert.equal(addProductState.productAddAllowed,false,
          'the test Clerk must have no Products add grant');
        assert.equal(addProductState.hiddenProperty,true,
          'POS must set the restricted button hidden property');
        // Capture the source/CSS defect before failing, not just the passing UI.
        await captureM01NavEvidence(page,'posv2-permission-leak-'+name);
        assert.equal(await page.locator('#v2AddProductBtn').isVisible(),false,
          'restricted POS Add Product must be absent from visual UI; state='+
          JSON.stringify(addProductState));
        assert.equal(await page.locator('#posCompleteBtn').count(),1);
        assert.equal(await page.locator('#page-pos .pos-v2-workflow-tabs [data-pos-v2-tab]').count(),3);

        if(phone){
          const tabs=page.locator('#page-pos .pos-v2-workflow-tabs');
          assert.equal(await tabs.isVisible(),true);
          for(const key of ['customer','payment','cart']){
            const tab=tabs.locator('[data-pos-v2-tab="'+key+'"]');
            await tab.tap();
            assert.equal(await page.locator('#page-pos')
              .getAttribute('data-pos-v2-tab-state'),key);
            assert.equal(await tab.getAttribute('aria-selected'),'true');
          }
          const box=await page.locator('#posSearch').boundingBox();
          assert.ok(box && box.width>0 && box.x>=-1 &&
            box.x+box.width<=width+1,
            'POS product search must fit 320px without horizontal clipping');
        }
        await page.locator('#posSearch').fill('synthetic no product');
        assert.equal(await page.evaluate(()=>currentPage),'posv2');
        const evidence=await captureM01NavEvidence(page,'posv2-'+name);
        assert.equal(evidence.viewport.width,width);
        assert.equal(evidence.viewport.height,height);
        assert.ok(evidence.screenshotBytes>1500);
        assert.equal(evidence.loginHidden,true);
        assert.equal(evidence.appVisible,true);
        assert.equal(evidence.bankNavCount,0);

        await page.evaluate(()=>goToPage('bank'));
        assert.equal(await page.evaluate(()=>currentPage),'dashboard',
          'forbidden Bank remains inaccessible by direct source route');
        assert.equal(calls.filter(x=>x.fnName==='login').length,1);
        assert.equal(calls.filter(x=>
          /^(?:saveSale|createSale|completeSale|postSale|submitSale)$/i
            .test(x.fnName||'')).length,0,
          'POS navigation and tabs must never submit a financial transaction');
      }finally{
        await page.close();
      }
    });
  }
});


test('M01 Playwright POS V2 authorized Products add action stays visible',async()=>{
  // This positive control protects the original authorized feature when the
  // cross-owner compiled-CSS hidden-state repair is integrated (issue #482).
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const page=await browser.newPage({
    viewport:{width:375,height:812},isMobile:true,hasTouch:true
  });
  try{
    const {calls}=await installM01SyntheticNavigation(page,{
      allowedModules:['dashboard','pos','products'],
      permissions:{
        dashboard:{view:true},pos:{view:true},products:{view:true,add:true}
      },
      navItems:[
        {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
        {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,
          landingKey:'posv2',
          children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
        {key:'products',label:'Products',sidebarGroup:1,sidebarOrder:30}
      ]
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.locator('#loginMobile').fill('01710000001');
    await page.locator('#loginPassword').fill('m01-synthetic-only');
    const loginReply=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginSubmitBtn').tap();
    assert.equal((await loginReply).status(),200);
    await page.waitForFunction(()=>
      document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
    await page.waitForFunction(()=>
      currentPage==='posv2' && document.body.classList.contains('pos-v2-active'));
    const add=page.locator('#v2AddProductBtn');
    await add.waitFor({state:'visible'});
    const state=await page.evaluate(()=>{
      const btn=document.getElementById('v2AddProductBtn');
      return {
        allowed:hasActionPermission_('products','add'),
        hidden:btn.hidden,
        display:getComputedStyle(btn).display
      };
    });
    assert.equal(state.allowed,true);
    assert.equal(state.hidden,false);
    assert.equal(await add.isVisible(),true,
      'the authorized Add Product action must remain visible');
    const evidence=await captureM01NavEvidence(page,'posv2-authorized-product-add');
    assert.ok(evidence.screenshotBytes>1500);
    assert.equal(evidence.loginHidden,true);
    assert.equal(calls.filter(x=>
      /^(?:saveSale|createSale|completeSale|postSale|submitSale)$/i
        .test(x.fnName||'')).length,0,
      'visibility-only Playwright QA must not post a sale');
  }finally{
    await page.close();
  }
});


test('M01 original POS V2 keyboard tabs and no-match search never create a sale',async t=>{
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
    {key:'bank',label:'Bank',sidebarGroup:4,sidebarOrder:50}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-375x812',width:375,height:812,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        assert.equal(await page.evaluate(()=>posState.cart.length),0,
          'no products have been selected before keyboard search');
        if(phone){
          for(const key of ['customer','payment','cart']){
            const button=page.locator(
              '#page-pos .pos-v2-workflow-tabs [data-pos-v2-tab="'+key+'"]');
            await button.focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('#page-pos')
              .getAttribute('data-pos-v2-tab-state'),key,
              'native keyboard Enter should activate the original '+key+' tab');
            assert.equal(await button.getAttribute('aria-selected'),'true');
          }
        }
        const search=page.locator('#posSearch');
        await search.waitFor({state:'visible'});
        await search.focus();
        await search.fill('m01-no-matching-synthetic-product');
        for(const key of ['ArrowDown','ArrowUp','Enter']){
          await search.press(key);
          assert.equal(await page.evaluate(()=>posState.cart.length),0,
            'keyboard '+key+' with no local product must not change the cart');
        }
        assert.equal(await page.evaluate(()=>currentPage),'posv2');
        await search.press('Escape');
        assert.equal(await search.inputValue(),'',
          'original POS search Escape should clear the unmatched query');
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        assert.equal(await page.evaluate(()=>document.activeElement?.id),
          'posSearch','Escape must retain usable keyboard focus');
        const evidence=await captureM01NavEvidence(page,
          'posv2-keyboard-'+name);
        assert.ok(evidence.screenshotBytes>1500);
        assert.equal(evidence.loginHidden,true);
        assert.equal(evidence.appVisible,true);
        assert.equal(evidence.bankNavCount,0);
        await page.evaluate(()=>goToPage('bank'));
        assert.equal(await page.evaluate(()=>currentPage),'dashboard',
          'the POS-only Clerk still cannot navigate to Bank');
        assert.equal(calls.filter(call=>call.fnName==='login').length,1);
        assert.equal(calls.filter(call=>
          /^(?:saveSale|createSale|completeSale|postSale|submitSale)$/i
            .test(call.fnName||'')).length,0,
          'keyboard-only POS QA must not post sales, payments or stock');
      }finally{await page.close();}
    });
  }
});


test('M01 Run 2 authenticated POS V2 stays role-safe through phone landscape tablet phone transitions',async t=>{
  // RED-first coverage: add the independent M01-only stage fixture after the
  // test-only commit has shown the expected missing-import failure in Chromium.
  const {M01_RESPONSIVE_VIEWPORT_STAGES}=
    await import('./m01-viewport-cycle-fixture.mjs');
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
    {key:'bank',label:'Bank',sidebarGroup:4,sidebarOrder:50}
  ];
  const page=await browser.newPage({
    viewport:{width:375,height:812},isMobile:true,hasTouch:true
  });
  try{
    const {calls}=await installM01SyntheticNavigation(page,{
      allowedModules:['dashboard','pos'],
      permissions:{dashboard:{view:true},pos:{view:true}},
      navItems
    });
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.locator('#loginOverlay:not([hidden])').waitFor();
    await page.locator('#loginMobile').fill('01710000001');
    await page.locator('#loginPassword').fill('m01-synthetic-only');
    const loginReply=page.waitForResponse(response=>
      response.url().endsWith('/api/rpc') &&
      response.request().postDataJSON()?.fnName==='login');
    await page.locator('#loginSubmitBtn').tap();
    assert.equal((await loginReply).status(),200);
    await page.waitForFunction(()=>
      document.getElementById('loginOverlay')?.hidden===true);
    await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
    await page.waitForFunction(()=>
      currentPage==='posv2' &&
      document.body.classList.contains('pos-v2-active'));
    assert.equal(await page.evaluate(()=>posState.cart.length),0);

    for(const stage of M01_RESPONSIVE_VIEWPORT_STAGES){
      await t.test(stage.name,async()=>{
        await page.setViewportSize({width:stage.width,height:stage.height});
        await page.waitForFunction(()=>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--app-viewport-height').trim()===
          Math.round(window.visualViewport?.height||window.innerHeight)+'px');
        const state=await page.evaluate(()=>({
          mobile:isPhoneViewport_(),
          currentPage,
          posClass:document.body.classList.contains('pos-v2-active'),
          cartLength:posState.cart.length,
          overlayHidden:document.getElementById('loginOverlay')?.hidden===true,
          appVisible:getComputedStyle(document.getElementById('app')).visibility!=='hidden',
          bankItems:document.querySelectorAll(
            '#navList .nav-item[data-page="bank"]').length,
          restrictedAddHidden:document.getElementById('v2AddProductBtn')?.hidden===true,
          viewportHeight:getComputedStyle(document.documentElement)
            .getPropertyValue('--app-viewport-height').trim()
        }));
        assert.equal(state.mobile,stage.isPhone,
          stage.name+' must follow original coarse-phone predicate');
        assert.equal(state.currentPage,'posv2');
        assert.equal(state.posClass,true);
        assert.equal(state.cartLength,0);
        assert.equal(state.overlayHidden,true);
        assert.equal(state.appVisible,true);
        assert.equal(state.bankItems,0,'forbidden Bank navigation must stay absent');
        assert.equal(state.restrictedAddHidden,true,
          'Clerk cannot reveal Products-add across viewport changes');

        if(stage.isPhone){
          const mobilePos=page.locator(
            '#mobileBottomNav [data-mobile-page="pos"]');
          assert.equal(await mobilePos.isVisible(),true);
          const workflowTabs=page.locator('#page-pos .pos-v2-workflow-tabs');
          if(stage.tab){
            assert.equal(await workflowTabs.isVisible(),true,
              'the narrow phone layout must provide workflow tabs');
            const tab=workflowTabs.locator('[data-pos-v2-tab="'+stage.tab+'"]');
            await tab.tap();
            assert.equal(await tab.getAttribute('aria-selected'),'true');
            assert.equal(await page.locator('#page-pos')
              .getAttribute('data-pos-v2-tab-state'),stage.tab);
            if(stage.tab==='cart'){
              const searchRect=await page.locator('#posSearch').boundingBox();
              assert.ok(searchRect && searchRect.width>0 &&
                searchRect.x>=-1 && searchRect.x+searchRect.width<=stage.width+1,
                stage.name+' cart search must fit phone horizontal bounds');
            }
          }else{
            assert.equal(await workflowTabs.isVisible(),false,
              'original wide coarse-landscape hides narrow-only workflow tabs');
          }
        }else{
          assert.equal(await page.evaluate(()=>isPhoneViewport_()),false);
          assert.equal(await page.locator(
            '#navList .nav-item[data-page="pos"]').count(),1,
            'tablet must retain source desktop-mode role-filtered POS group');
        }
        assert.equal(await page.locator('#v2AddProductBtn').isVisible(),false,
          'restricted Add Product must be visually hidden, not only hidden attribute');
        const evidence=await captureM01NavEvidence(page,
          'run2-viewport-'+stage.name);
        assert.deepEqual(evidence.viewport,{width:stage.width,height:stage.height});
        assert.ok(evidence.screenshotBytes>1500);
        assert.equal(evidence.loginHidden,true);
        assert.equal(evidence.appVisible,true);
        assert.equal(evidence.bankNavCount,0);
      });
    }
    await page.evaluate(()=>goToPage('bank'));
    assert.equal(await page.evaluate(()=>currentPage),'dashboard',
      'forbidden Bank direct navigation must fall back safely');
    assert.equal(calls.filter(call=>call.fnName==='login').length,1,
      'responsive transitions must not trigger a new authentication request');
    assert.equal(calls.filter(call=>
      /^(?:saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment)$/i
        .test(call.fnName||'')).length,0,
      'viewport changes and POS tabs must never post sales or payments');
  }finally{await page.close();}
});

test('M01 canonical six-width POS V2 keeps source keyboard and responsive presentation',async t=>{
  // Follow-up #733: no new RPC/auth business implementation; local browser only.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]},
    {key:'bank',label:'Bank',sidebarGroup:4,sidebarOrder:50}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-320x640',width:320,height:640,phone:true},
    {name:'phone-360x780',width:360,height:780,phone:true},
    {name:'phone-390x844',width:390,height:844,phone:true},
    {name:'tablet-768x1024',width:768,height:1024,phone:false},
    {name:'desktop-1024x768',width:1024,height:768,phone:false},
    {name:'desktop-1440x900',width:1440,height:900,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        assert.equal(await page.evaluate(()=>isPhoneViewport_()),phone,
          name+' must retain the source mobile/desktop breakpoint');
        assert.equal(await page.locator('#page-pos').isVisible(),true);
        assert.equal(await page.locator('#page-posv2').isVisible(),false,
          'POS V2 must use the original operational page, not a second cart');
        assert.equal(await page.locator('#v2AddProductBtn').isVisible(),false,
          'Products-add denied means visually hidden on '+name);
        assert.equal(await page.locator('#navList .nav-item[data-page="bank"]').count(),0);
        if(phone){
          const tabs=page.locator('#page-pos .pos-v2-workflow-tabs');
          assert.equal(await tabs.isVisible(),true);
          for(const key of ['customer','payment','cart']){
            const tab=tabs.locator('[data-pos-v2-tab="'+key+'"]');
            await tab.focus();
            await page.keyboard.press('Enter');
            assert.equal(await tab.getAttribute('aria-selected'),'true',
              name+' keyboard Enter must select '+key);
            assert.equal(await page.locator('#page-pos')
              .getAttribute('data-pos-v2-tab-state'),key);
          }
        }
        const search=page.locator('#posSearch');
        await search.waitFor({state:'visible'});
        const rect=await search.boundingBox();
        assert.ok(rect && rect.width>0 && rect.x>=-1 &&
          rect.x+rect.width<=width+1,
          name+' POS search must remain within horizontal viewport');
        await search.fill('m01-unmatched-product-six-viewport');
        for(const key of ['ArrowDown','ArrowUp','Enter']){
          await search.press(key);
          assert.equal(await page.evaluate(()=>posState.cart.length),0,
            name+' no-match '+key+' must never add product lines');
        }
        await search.press('Escape');
        assert.equal(await search.inputValue(),'',
          name+' Escape clears unmatched search');
        assert.equal(await page.evaluate(()=>document.activeElement?.id),'posSearch',
          name+' Escape retains keyboard focus');
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        const shot=await captureM01NavEvidence(page,'six-width-posv2-'+name);
        assert.deepEqual(shot.viewport,{width,height});
        assert.ok(shot.screenshotBytes>1500,'PNG screenshot captured for '+name);
        assert.equal(shot.loginHidden,true);
        assert.equal(shot.appVisible,true);
        assert.equal(shot.bankNavCount,0);
        assert.equal(calls.filter(x=>x.fnName==='login').length,1);
        assert.equal(calls.some(x=>
          /^(?:saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment)$/i
            .test(x.fnName||'')),false,
          'browser parity must never post financial writes');
      }finally{await page.close();}
    });
  }
});

test('M01 POS V2 Drafts dialog preserves keyboard, empty state and failed-load safety',async t=>{
  // #743: synthetic readonly getSalesDraftList only. Public Worker stays inert.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-390x844',width:390,height:844,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      const draftCalls=[];
      let rejectDraftList=false;
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        // Most recent route handles only synthetic reads; fallback keeps
        // existing test-local login/shell interception and inert public Worker.
        await page.route('**/api/rpc',async route=>{
          const request=route.request().postDataJSON();
          if(request?.fnName!=='getSalesDraftList')return route.fallback();
          draftCalls.push(request.fnName);
          if(rejectDraftList){
            return route.fulfill({
              status:503,contentType:'application/json',
              body:JSON.stringify({
                success:false,error:'Synthetic draft read unavailable'
              })
            });
          }
          return route.fulfill({
            status:200,contentType:'application/json',
            body:JSON.stringify({success:true,data:[]})
          });
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        const drafts=page.locator('#v2DraftsBtn');
        await drafts.waitFor({state:'visible'});
        await drafts.focus();
        await page.keyboard.press('Enter');
        const modal=page.locator('#v2DraftsModal');
        await modal.waitFor({state:'visible'});
        assert.equal(draftCalls.length,1,'keyboard must load draft list once');
        assert.equal(await modal.locator('#v2DraftsBody tr').count(),0);
        assert.equal(await modal.locator('#v2DraftsEmpty').isVisible(),true,
          'empty synthetic list uses original no-drafts UI');
        assert.equal(await page.evaluate(()=>document.activeElement?.id),
          'v2DraftSearch','original Drafts search receives keyboard focus');
        const search=page.locator('#v2DraftSearch');
        const rect=await search.boundingBox();
        assert.ok(rect && rect.width>0 && rect.x>=-1 &&
          rect.x+rect.width<=width+1,
          'Drafts search must fit '+name+' horizontally');
        const capture=await captureM01NavEvidence(page,'posv2-drafts-empty-'+name);
        assert.ok(capture.screenshotBytes>1500);
        await page.locator('#v2DraftsCloseTop').click();
        assert.equal(await modal.isVisible(),false,'top close dismisses Drafts');

        await drafts.click();
        await modal.waitFor({state:'visible'});
        assert.equal(draftCalls.length,2,'reopening reloads list once');
        await page.locator('#v2DraftRefreshBtn').click();
        assert.equal(draftCalls.length,3,'Refresh fetches the list once');
        assert.equal(await modal.locator('#v2DraftsBody tr').count(),0);
        assert.equal(await page.locator('#v2DraftsModal').count(),1,
          'reopen must reuse the same original modal');
        await page.locator('#v2DraftsCloseBottom').click();
        assert.equal(await modal.isVisible(),false,'footer close dismisses Drafts');

        rejectDraftList=true;
        const failedRead=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='getSalesDraftList');
        await drafts.click();
        assert.equal((await failedRead).status(),503);
        assert.equal(draftCalls.length,4);
        assert.equal(await modal.isVisible(),false,
          'failed draft-list load must not open stale Drafts modal');
        assert.equal(await page.evaluate(()=>currentPage),'posv2');
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        assert.equal(await page.evaluate(()=>
          document.getElementById('loginOverlay')?.hidden===true),true);
        const failures=await captureM01NavEvidence(page,
          'posv2-drafts-read-denied-'+name);
        assert.ok(failures.screenshotBytes>1500);
        assert.equal(calls.filter(x=>x.fnName==='login').length,1);
        assert.equal(calls.some(x=>
          /^(?:saveSalesDraft|deleteSalesDraft|saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment)$/i
            .test(x.fnName||'')),false,
          'Drafts QA must never issue sale or draft write RPC');
      }finally{
        await page.close();
      }
    });
  }
});

test('M01 original POS V2 keyboard product picker creates, edits and clears synthetic cart without posting',async t=>{
  // #747: use original compiled UI and original picker handlers, not a mock cart.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-390x844',width:390,height:844,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        assert.equal(await page.locator('#page-pos').isVisible(),true);
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        // Without a real getPosBootstrap, source posLoad() intentionally cannot
        // initialize empty-state button flags; render the synthetic empty cart.
        await page.evaluate(()=>posRenderCart_());
        assert.equal(await page.locator('#posClearCartBtn').isDisabled(),true);
        assert.equal(await page.locator('#posSaveDraftBtn').isDisabled(),true);

        // The Worker is deliberately not authorized to provide POS data.
        // These records exist ONLY in this isolated Chromium tab's memory.
        await page.evaluate(()=>{
          posState.products=[
            {id:'M01-SYNTH-HAMMER',name:'M01 Synthetic Hammer',productType:'Standard',
              unit:'Pcs',category:'Tools',brand:'M01',sellingPrice:20,
              fallbackSellPrice:20,stock:240,lotPricing:[]},
            {id:'M01-SYNTH-WIRE',name:'M01 Synthetic Wire',productType:'Standard',
              unit:'Feet',category:'Electrical',brand:'M01',sellingPrice:15,
              fallbackSellPrice:15,stock:150,lotPricing:[]}
          ];
          posState.productStockById={
            'M01-SYNTH-HAMMER':240,'M01-SYNTH-WIRE':150
          };
          smartIndexProducts_(posState.products);
          posRenderProductGrid_();
          posRenderCart_();
        });
        const search=page.locator('#posSearch');
        await search.waitFor({state:'visible'});
        await search.fill('M01 Synthetic Hammer');
        const hammer=page.locator(
          '#posCartProductPopup [data-cart-product-pick="M01-SYNTH-HAMMER"]');
        await hammer.waitFor({state:'visible'});
        assert.equal(await search.getAttribute('aria-expanded'),'true');
        assert.equal(await hammer.getAttribute('aria-selected'),'true');
        await search.press('Enter');
        const quantity=page.locator('#posCartList input[data-cart-entry-qty]');
        await quantity.waitFor({state:'visible'});
        assert.equal(await page.evaluate(()=>posState.cart.length),1);
        assert.equal(await page.evaluate(()=>posState.cart[0].productId),'M01-SYNTH-HAMMER');
        await quantity.fill('3');
        assert.equal(await page.evaluate(()=>posState.cart[0].qty),3);
        assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-cart-entry-qty')),true,
          'quantity updates should preserve keyboard focus');
        await quantity.press('Enter');
        assert.equal(await page.evaluate(()=>posState.cartEntryIndex),null);
        assert.equal(await page.locator('#posCartCount').innerText(),'1');
        assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').count(),1);
        assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row) .c-unit').first().innerText(),'Pcs');
        assert.equal(await page.locator('#posCartList input[data-f="qty"][data-i="0"]').inputValue(),'3');
        assert.equal(await page.locator('#posSaveDraftBtn').isDisabled(),false,
          'original nonempty cart enables draft button, not an actual save');

        // The original V2 picker must not create a second line for one Product.
        await search.fill('M01 Synthetic Hammer');
        await hammer.waitFor({state:'visible'});
        await search.press('Enter');
        assert.equal(await page.evaluate(()=>posState.cart.length),1);
        assert.equal(await page.evaluate(()=>posState.cart[0].qty),3);
        assert.equal(await page.evaluate(()=>posState.cartEntryIndex),null);

        await search.fill('M01 Synthetic Wire');
        const wire=page.locator(
          '#posCartProductPopup [data-cart-product-pick="M01-SYNTH-WIRE"]');
        await wire.waitFor({state:'visible'});
        await search.press('Enter');
        const wireQty=page.locator('#posCartList input[data-cart-entry-qty]');
        await wireQty.waitFor({state:'visible'});
        assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),[
          'M01-SYNTH-HAMMER','M01-SYNTH-WIRE'
        ]);
        await wireQty.fill('2');
        await wireQty.press('Enter');
        assert.equal(await page.locator('#posCartCount').innerText(),'2');
        assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').count(),2);
        assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row) .c-unit').last().innerText(),'Feet');
        const populated=await captureM01NavEvidence(page,'posv2-cart-populated-'+name);
        assert.ok(populated.screenshotBytes>1500);

        await page.locator('#posCartList .cart-remove[data-i="0"]').click();
        assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),[
          'M01-SYNTH-WIRE'
        ]);
        assert.equal(await page.locator('#posCartCount').innerText(),'1');
        await page.locator('#posClearCartBtn').click();
        assert.equal(await page.evaluate(()=>posState.cart.length),0);
        assert.equal(await page.locator('#posCartCount').innerText(),'0');
        assert.equal(await page.locator('#posCartList .cart-row:not(.pos-cart-entry-row)').count(),0);
        assert.equal(await page.locator('#posClearCartBtn').isDisabled(),true);
        assert.equal(await page.locator('#posSaveDraftBtn').isDisabled(),true);
        const cleared=await captureM01NavEvidence(page,'posv2-cart-cleared-'+name);
        assert.ok(cleared.screenshotBytes>1500);
        assert.equal(calls.filter(x=>x.fnName==='login').length,1);
        assert.equal(calls.some(x=>
          /^(?:saveSalesDraft|deleteSalesDraft|saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment)$/i
            .test(x.fnName||'')),false,
          'synthetic cart editing must never send draft, sale or payment writes');
      }finally{
        await page.close();
      }
    });
  }
});

test('M01 original POS V2 pointer reorder keeps product quantity, unit, pricing and totals',async t=>{
  // #754: real Chromium pointer dispatch to existing drag handle, no mock writer.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-390x844',width:390,height:844,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        if(phone){
          await page.locator('#page-pos [data-pos-v2-tab="cart"]').tap();
        }
        await page.evaluate(()=>{
          // Product data exists ONLY in this Chromium tab; getPosBootstrap is
          // deliberately not served by the inert production Worker.
          posState.products=[
            {id:'M01-DRAG-HAMMER',name:'M01 Drag Hammer',productType:'Standard',
              unit:'Pcs',brand:'M01',category:'Tools',sellingPrice:20,
              fallbackSellPrice:20,stock:50,lotPricing:[]},
            {id:'M01-DRAG-WIRE',name:'M01 Drag Wire',productType:'Standard',
              unit:'Feet',brand:'M01',category:'Electrical',sellingPrice:15,
              fallbackSellPrice:15,stock:50,lotPricing:[]}
          ];
          posState.productStockById={
            'M01-DRAG-HAMMER':50,'M01-DRAG-WIRE':50
          };
          smartIndexProducts_(posState.products);
          posState.cart=posState.products.map((p,i)=>{
            const line=posCreateCartLine_(p);
            line.qty=i===0?2:3;
            return line;
          });
          posState.cartEntryIndex=null;
          posState.cartEditIndex=null;
          posRenderCart_();
          posV2EnhanceCartRows_();
        });
        const rows=page.locator('#posCartList .cart-row.pos-v2-reorderable');
        const handles=rows.locator('.pos-v2-reorder-handle');
        await handles.first().waitFor({state:'visible'});
        assert.equal(await rows.count(),2);
        assert.equal(await handles.count(),2,
          'each populated row gets exactly one original drag handle');
        assert.equal(await handles.first().getAttribute('aria-label'),'Reorder product line');
        assert.deepEqual(await rows.locator('.pos-v2-line-no').allTextContents(),['1','2']);
        const before=await page.evaluate(()=>({
          items:posState.cart.map(x=>({
            productId:x.productId,qty:x.qty,unit:x.unit,
            unitPrice:x.unitPrice,lineTotal:x.lineTotal,priceMode:x.priceMode
          })),
          subtotal:document.getElementById('posSubtotal').textContent,
          total:document.getElementById('posGrandTotal').textContent
        }));
        assert.deepEqual(before.items.map(x=>[x.productId,x.qty,x.unitPrice,x.lineTotal]),[
          ['M01-DRAG-HAMMER',2,20,40],
          ['M01-DRAG-WIRE',3,15,45]
        ]);
        assert.equal(await page.locator('#posCartCount').innerText(),'2');

        const first=handles.first();
        const secondRow=rows.last();
        await secondRow.scrollIntoViewIfNeeded();
        await first.scrollIntoViewIfNeeded();
        const from=await first.boundingBox();
        const to=await secondRow.boundingBox();
        assert.ok(from&&to&&from.width>0&&to.height>0,'both source drag rows are laid out');
        assert.ok(from.y+from.height/2>=0&&from.y+from.height/2<=height,
          'source drag handle must be within '+name+' viewport');
        assert.ok(to.y+to.height*.75>=0&&to.y+to.height*.75<=height,
          'source drop target must be within '+name+' viewport');
        await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
        await page.mouse.down();
        await page.mouse.move(
          to.x+Math.min(to.width*.4,65),to.y+to.height*.75,{steps:8});
        await page.mouse.up();
        await page.waitForFunction(()=>
          posState.cart[0]?.productId==='M01-DRAG-WIRE' &&
          posState.cart[1]?.productId==='M01-DRAG-HAMMER');
        const after=await page.evaluate(()=>({
          items:posState.cart.map(x=>({
            productId:x.productId,qty:x.qty,unit:x.unit,
            unitPrice:x.unitPrice,lineTotal:x.lineTotal,priceMode:x.priceMode
          })),
          subtotal:document.getElementById('posSubtotal').textContent,
          total:document.getElementById('posGrandTotal').textContent
        }));
        assert.deepEqual(after.items,[before.items[1],before.items[0]],
          'pointer reorder must only move rows, not reprice or change quantities');
        assert.equal(after.subtotal,before.subtotal,'reorder cannot change subtotal');
        assert.equal(after.total,before.total,'reorder cannot change grand total');
        assert.equal(await page.locator('#posCartCount').innerText(),'2');
        assert.deepEqual(await rows.locator('.pos-v2-line-no').allTextContents(),['1','2']);
        assert.deepEqual(await rows.locator('.c-unit').allTextContents(),['Feet','Pcs']);
        assert.equal(await handles.count(),2,'reorder does not duplicate handles');
        const evidence=await captureM01NavEvidence(page,'posv2-pointer-reordered-'+name);
        assert.ok(evidence.screenshotBytes>1500);

        // The original mutation observer must not accumulate controls on rerender.
        await page.evaluate(()=>{
          posRenderCart_();
          posV2EnhanceCartRows_();
        });
        assert.equal(await handles.count(),2,'rerender retains one handle per row');
        assert.deepEqual(await page.evaluate(()=>posState.cart.map(x=>x.productId)),[
          'M01-DRAG-WIRE','M01-DRAG-HAMMER'
        ]);
        assert.equal(calls.some(x=>
          /^(?:saveSalesDraft|deleteSalesDraft|saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment|postLedger|createPayment)$/i
            .test(x.fnName||'')),false,
          'pointer reorder is strictly client-side and must not post finances');
      }finally{
        await page.close();
      }
    });
  }
});

test('M01 original POS V2 FIFO lot sum survives manual price override, Qty and reset',async t=>{
  // #760: original source arithmetic and DOM controls; synthetic in-tab data only.
  const {installM01SyntheticNavigation,captureM01NavEvidence}=
    await import('./m01-auth-nav-fixture.mjs');
  const navItems=[
    {key:'dashboard',label:'Dashboard',sidebarGroup:0,sidebarOrder:10},
    {key:'pos',label:'POS',sidebarGroup:0,sidebarOrder:20,landingKey:'posv2',
      children:[{key:'posv2',label:'POS V2',permKey:'pos'}]}
  ];
  for(const {name,width,height,phone} of [
    {name:'phone-390x844',width:390,height:844,phone:true},
    {name:'desktop-1280x800',width:1280,height:800,phone:false}
  ]){
    await t.test(name,async()=>{
      const page=await browser.newPage({
        viewport:{width,height},isMobile:phone,hasTouch:phone
      });
      try{
        const {calls}=await installM01SyntheticNavigation(page,{
          allowedModules:['dashboard','pos'],
          permissions:{dashboard:{view:true},pos:{view:true}},
          navItems
        });
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.locator('#loginOverlay:not([hidden])').waitFor();
        await page.locator('#loginMobile').fill('01710000001');
        await page.locator('#loginPassword').fill('m01-synthetic-only');
        const login=page.waitForResponse(response=>
          response.url().endsWith('/api/rpc') &&
          response.request().postDataJSON()?.fnName==='login');
        await page.locator('#loginSubmitBtn').click();
        assert.equal((await login).status(),200);
        await page.waitForFunction(()=>
          document.getElementById('loginOverlay')?.hidden===true);
        if(phone){
          await page.locator('#mobileBottomNav [data-mobile-page="pos"]').tap();
        }else{
          await page.evaluate(()=>goToPage('pos'));
        }
        await page.waitForFunction(()=>
          currentPage==='posv2' &&
          document.body.classList.contains('pos-v2-active'));
        if(phone){
          await page.locator('#page-pos [data-pos-v2-tab="cart"]').tap();
        }

        // The public Worker does not bootstrap real POS data. Use exact
        // deterministic source-shaped records in browser memory only.
        await page.evaluate(()=>{
          const product={
            id:'M01-FIFO-PRICE',name:'M01 Synthetic FIFO Fastener',
            productType:'Standard',unit:'Pcs',category:'Fasteners',
            brand:'M01',sellingPrice:30,fallbackSellPrice:30,stock:100,
            lotPricing:[
              {qty:2,sellPrice:19.99},
              {qty:3,sellPrice:24.99}
            ]
          };
          posState.products=[product];
          posState.productStockById={[product.id]:100};
          smartIndexProducts_(posState.products);
          posState.cart=[posCreateCartLine_(product)];
          posState.cartEntryIndex=null;
          posState.cartEditIndex=null;
          posRenderCart_();
          posV2EnhanceCartRows_();
        });
        const qty=page.locator('#posCartList input[data-f="qty"][data-i="0"]');
        await qty.waitFor({state:'visible'});
        await qty.fill('4');
        const read=()=>page.evaluate(()=>{
          const line=posState.cart[0];
          return {
            count:posState.cart.length,productId:line.productId,
            qty:line.qty,unitPrice:line.unitPrice,
            lineTotal:line.lineTotal,priceMode:line.priceMode,
            subtotal:document.getElementById('posSubtotal').textContent,
            total:document.getElementById('posGrandTotal').textContent,
            visibleLine:document.querySelector('#posCartList .cart-row:not(.pos-cart-entry-row) .c-line-total')?.textContent,
            resetControls:document.querySelectorAll('#posCartList .c-reset-lot-price').length
          };
        });
        const auto=await read();
        assert.deepEqual([auto.count,auto.productId,auto.qty,auto.unitPrice,auto.lineTotal,auto.priceMode],[
          1,'M01-FIFO-PRICE',4,22.49,89.96,'auto'
        ],'auto line sum is FIFO lot cents, not 4 × rounded average');
        assert.match(auto.subtotal,/89\.96/);
        assert.match(auto.total,/89\.96/);
        assert.match(auto.visibleLine,/89\.96/);
        assert.equal(auto.resetControls,0);
        assert.equal(await page.evaluate(()=>
          document.activeElement?.matches('#posCartList input[data-f="qty"][data-i="0"]')),true,
          'Qty input retains focus while auto FIFO total changes');

        const price=page.locator('#posCartList input[data-f="price"][data-i="0"]');
        await price.fill('22.50');
        const manual=await read();
        assert.deepEqual([manual.qty,manual.unitPrice,manual.lineTotal,manual.priceMode],[
          4,22.5,90,'manual'
        ]);
        assert.match(manual.total,/90\.00/);
        assert.match(manual.visibleLine,/90\.00/);
        await price.press('Tab'); // source change handler re-renders Reset control
        const reset=page.locator('#posCartList .c-reset-lot-price[data-i="0"]');
        await reset.waitFor({state:'visible'});
        assert.equal(await reset.count(),1);
        assert.equal((await read()).resetControls,1);
        assert.equal(await page.locator('#posCartList input[data-f="price"][data-i="0"]').inputValue(),'22.5');

        const manualQty=page.locator('#posCartList input[data-f="qty"][data-i="0"]');
        await manualQty.fill('5');
        const updated=await read();
        assert.deepEqual([updated.qty,updated.unitPrice,updated.lineTotal,updated.priceMode],[
          5,22.5,112.5,'manual'
        ]);
        assert.match(updated.subtotal,/112\.50/);
        assert.match(updated.total,/112\.50/);
        assert.equal(updated.resetControls,1);
        const manualShot=await captureM01NavEvidence(page,'posv2-manual-unit-price-'+name);
        assert.ok(manualShot.screenshotBytes>1500);

        await reset.click();
        const restored=await read();
        assert.deepEqual([restored.qty,restored.unitPrice,restored.lineTotal,restored.priceMode],[
          5,22.99,114.95,'auto'
        ],'reset restores 2×19.99 + 3×24.99 with no cent loss');
        assert.match(restored.subtotal,/114\.95/);
        assert.match(restored.total,/114\.95/);
        assert.equal(restored.resetControls,0,'reset button removed after auto mode');
        assert.equal(await page.locator('#posCartCount').innerText(),'1');
        await page.evaluate(()=>{
          posRenderCart_();
          posV2EnhanceCartRows_();
        });
        assert.deepEqual(await read(),restored,
          'original rerender cannot silently change unit price or grand total');

        await page.locator('#posCartList input[data-f="qty"][data-i="0"]').fill('6');
        const fallback=await read();
        assert.deepEqual([fallback.qty,fallback.lineTotal,fallback.priceMode],[
          6,144.95,'auto'
        ],'sixth item must use the explicit ৳30 fallback, without altering previous lots');
        assert.match(fallback.subtotal,/144\.95/);
        const restoredShot=await captureM01NavEvidence(page,'posv2-fifo-lot-restored-'+name);
        assert.ok(restoredShot.screenshotBytes>1500);
        assert.equal(calls.filter(x=>x.fnName==='login').length,1);
        assert.equal(calls.some(x=>
          /^(?:saveSalesDraft|deleteSalesDraft|saveSale|createSale|completeSale|postSale|submitSale|saveSalePayment|postLedger|createPayment|postCash)$/i
            .test(x.fnName||'')),false,
          'display-only price test must never post finance or stock');
      }finally{
        await page.close();
      }
    });
  }
});
