import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

let server,browser;
before(async()=>{
  server=await serveCompiledUi();
  browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
      {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});
after(async()=>{await browser?.close();await server?.close();});

const items=[
  {key:'dashboard',label:'Dashboard',icon:'dashboard',sidebarGroup:0,sidebarOrder:10},
  {key:'pos',label:'POS',icon:'pos',landingKey:'posv2',sidebarGroup:0,sidebarOrder:20,
    children:[{key:'posv2',label:'POS V2'}]},
  {key:'sales',label:'Sales',icon:'sales',sidebarGroup:1,sidebarOrder:30,
    children:[{key:'sales',label:'Sales Invoices'},{key:'returns',label:'New Return'}]},
  {key:'products',label:'Products',icon:'products',sidebarGroup:1,sidebarOrder:40},
  {key:'reports',label:'Reports',icon:'reports',sidebarGroup:5,sidebarOrder:60},
  {key:'settings',label:'Settings',icon:'settings',sidebarGroup:6,sidebarOrder:70,
    children:[{key:'settings',label:'General'},{key:'roles',label:'Roles'}]}
];
async function syntheticShell(page){
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.evaluate(items=>{
    window.authToken='m01-shell-synthetic-only';
    window.currentUser={id:'test',name:'Synthetic Admin',role:'Administrator'};
    window.allowedModules=null;window.userPermissions=null;
    document.getElementById('loginOverlay').hidden=true;
    document.getElementById('app').style.visibility='';
    document.getElementById('shopNameLabel').textContent='Synthetic Hardware';
    window.navItems_=items;
    buildNav_(items);
    renderSidebarFooter_(); // Original sign-out wiring follows authenticated shell setup.
    goToPage('dashboard');
  },items);
}
async function screenshot(page,label){
  // M01 GitHub workflow uploads test-results/m01-browser/, so these
  // screenshot states must land inside that retained review artifact.
  await mkdir('test-results/m01-browser/hisabiq-shell',{recursive:true});
  await page.screenshot({path:'test-results/m01-browser/hisabiq-shell/'+label+'.png'});
}

test('HisabIQ desktop shell has exact widths, current child and persisted shortcut',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await syntheticShell(page);
    // Shell width uses a 200ms CSS transition; wait for the real final
    // 256px design-system width before asserting. CI could sample 255px
    // during interpolation even though the sidebar finishes at 256px.
    await page.waitForFunction(()=>
      Math.round(document.getElementById('sidebar')?.getBoundingClientRect().width)===256);
    assert.equal(await page.locator('#sidebar').evaluate(n=>Math.round(n.getBoundingClientRect().width)),256);
    assert.equal(await page.locator('.topbar').evaluate(n=>Math.round(n.getBoundingClientRect().height)),56);
    assert.equal(await page.locator('#navList .h-shell-section-label').first().textContent(),'Workspace');
    await screenshot(page,'after-target-1440-expanded');
    await page.locator('#navList .nav-item[data-page="sales"]').click();
    assert.equal(await page.locator('#page-sales').isVisible(),true,'original goToPage remains the navigation handler');
    assert.equal(await page.locator('#navList .h-shell-child[data-nav-child="sales"]').getAttribute('aria-current'),'page');
    await page.locator('#navList .h-shell-child[data-nav-child="returns"]').click();
    assert.equal(await page.locator('#page-returns').isVisible(),true);
    await page.keyboard.press('Control+b');
    await page.waitForFunction(()=>Math.round(document.getElementById('sidebar').getBoundingClientRect().width)===64);
    assert.equal(await page.locator('#sidebar').evaluate(n=>Math.round(n.getBoundingClientRect().width)),64);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hisabiq:sidebar-collapsed')),'true');
    assert.equal(await page.locator('#navList .nav-item[data-page="sales"]').getAttribute('title'),'Sales');
    await screenshot(page,'after-target-1440-collapsed');
    await page.reload();
    await syntheticShell(page);
    await page.waitForFunction(()=>Math.round(document.getElementById('sidebar').getBoundingClientRect().width)===64);
    await page.keyboard.press('Control+b');
    await page.waitForFunction(()=>Math.round(document.getElementById('sidebar').getBoundingClientRect().width)===256);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('HisabIQ tablet and mobile nav drawer traps focus, dismisses, keeps original quick nav',async()=>{
  for(const width of [1023,768,390]){
    const page=await browser.newPage({viewport:{width,height:width===390?844:900},hasTouch:width===390});
    try{
      await syntheticShell(page);
      assert.equal(await page.locator('#sidebar').isVisible(),false);
      assert.equal(await page.locator('#menuToggle').isVisible(),true);
      await page.locator('#menuToggle').click();
      assert.equal(await page.locator('#erp-mobile-drawer').getAttribute('aria-modal'),'true');
      await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
      assert.equal(await page.locator('#hisabiqMobileDrawer').isVisible(),true);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await screenshot(page,'after-target-'+width+'-drawer');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
      assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
      assert.equal(await page.locator('#menuToggle').evaluate(n=>n===document.activeElement),true);
      await page.locator('#menuToggle').click();
      await page.locator('#h-shell-drawer-nav .nav-item[data-page="products"]').click();
      assert.equal(await page.locator('#page-products').isVisible(),true);
      await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
      assert.ok(overflow<=2,'no viewport overflow at '+width+': '+overflow);
      if(width===390)assert.equal(await page.locator('#mobileBottomNav').isVisible(),true);
    }finally{await page.close();}
  }
});

test('HisabIQ enhancement does not expose restricted modules or replace original actions',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  try{
    await syntheticShell(page);
    const prior=await page.evaluate(()=>({
      cash:document.getElementById('cashSessionToggleBtn'),
      calc:document.getElementById('calcToggleBtn'),
      refresh:document.getElementById('refreshBtn'),
      tab:document.getElementById('subNav')
    }));
    await page.evaluate(()=>{
      allowedModules=['dashboard','reports'];
      userPermissions={dashboard:{view:true},reports:{view:true}};
      buildNav_(navItems_);
    });
    assert.equal(await page.locator('#navList .nav-item[data-page="sales"]').count(),0);
    assert.equal(await page.locator('#navList .nav-item[data-page="reports"]').count(),1);
    for(const selector of ['#cashSessionToggleBtn','#calcToggleBtn','#refreshBtn','#subNav']){
      assert.equal(await page.locator(selector).count(),1,selector+' retained');
    }
  }finally{await page.close();}
});


test('HisabIQ topbar offers authorized navigation search, New Sale and existing user action',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await syntheticShell(page);
    const search=page.locator('#h-shell-search-input');
    await search.fill('report');
    const result=page.locator('#h-shell-search-results [data-target="reports"]');
    await result.click();
    assert.equal(await page.locator('#page-reports').isVisible(),true);
    await page.locator('#h-shell-new-sale').click();
    assert.equal(await page.evaluate(()=>currentPage),'posv2');
    await page.locator('#h-shell-user-trigger').click();
    assert.equal(await page.locator('#h-shell-user-popover').isVisible(),true);
    assert.match(await page.locator('#h-shell-user-popover').textContent(),/Synthetic Admin/);
    assert.equal(await page.locator('#logoutBtn').count(),1,'original confirm-based sign-out remains present');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#h-shell-user-popover').isVisible(),false);
    await page.keyboard.press('Control+k');
    assert.equal(await search.evaluate(n=>document.activeElement===n),true);
    await page.evaluate(()=>{
      allowedModules=['dashboard','reports'];
      userPermissions={dashboard:{view:true},reports:{view:true}};
      buildNav_(navItems_);
    });
    assert.equal(await page.locator('#h-shell-new-sale').isVisible(),false,
      'staff without POS access must not see a New Sale shortcut');
    await search.fill('pos');
    assert.equal(await page.locator('#h-shell-search-results [data-target="posv2"]').count(),0);
  }finally{await page.close();}
});


test('drawer keeps early Tab inside modal while its opening animation frame is delayed',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  try{
    await syntheticShell(page);
    await page.evaluate(()=>{
      const realFrame=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=function(callback){
        if(String(callback).includes("drawer.classList.add('is-open')")){
          window.__heldDrawerOpenFrame=callback;
          return 999999;
        }
        return realFrame(callback);
      };
    });
    await page.locator('#menuToggle').click();
    assert.equal(await page.evaluate(()=>typeof window.__heldDrawerOpenFrame),'function',
      'the test must genuinely hold the drawer animation frame');
    assert.equal(await page.locator('#app').evaluate(node=>node.inert),true);
    // An immediate keyboard event must remain in the modal even when the
    // queued requestAnimationFrame has not run yet on a busy Chromium runner.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>
      !!document.activeElement?.closest('#hisabiqMobileDrawer')),true,
      'early Tab must not escape outside an inert ERP app');
    await page.evaluate(()=>{
      const callback=window.__heldDrawerOpenFrame;
      delete window.__heldDrawerOpenFrame;
      callback(performance.now());
    });
    await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
    assert.equal(await page.locator('#erp-mobile-drawer').getAttribute('aria-modal'),'true');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
    assert.equal(await page.locator('#app').evaluate(node=>node.inert),false);
  }finally{await page.close();}
});

test('modal navigation isolates background and restores it at 320,390,768px',async()=>{
  for(const width of [320,390,768]){
    const page=await browser.newPage({viewport:{width,height:width===320?640:844},hasTouch:width<400});
    try{
      await syntheticShell(page);
      const app=page.locator('#app');
      assert.equal(await app.evaluate(n=>n.inert),false);
      await page.locator('#menuToggle').click();
      assert.equal(await app.evaluate(n=>n.inert),true,'modal must isolate ERP from pointer and keyboard access at '+width);
      assert.equal(await page.locator('#erp-mobile-drawer').getAttribute('aria-modal'),'true');
      // The merged shell transfers focus in requestAnimationFrame after the
      // CSS drawer becomes displayable. Do not press Tab while its controls
      // are still hidden during that entry frame (CI can outrun the frame).
      // The assertion below still fails if focus never enters the modal.
      await page.waitForFunction(()=>
        document.getElementById('hisabiqMobileDrawer')?.classList.contains('is-open') &&
        !!document.activeElement?.closest('#erp-mobile-drawer'));
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('#hisabiqMobileDrawer')),true);
      await screenshot(page,'after-hardening-'+width+'-drawer');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
      assert.equal(await app.evaluate(n=>n.inert),false,'modal must restore app after dismiss at '+width);
      assert.equal(await page.locator('#menuToggle').evaluate(n=>n===document.activeElement),true);
    }finally{await page.close();}
  }
});


test('mobile drawer transfers keyboard focus after its visible animation frame',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  try{
    await syntheticShell(page);
    // Make the normally fast CSS entry frame explicitly late. Focusing an
    // element while its ancestor is display:none is ignored by Chromium.
    await page.evaluate(()=>{
      const original=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=callback=>
        original(time=>window.setTimeout(()=>callback(time),35));
    });
    await page.locator('#menuToggle').click();
    await page.waitForFunction(()=>
      document.getElementById('hisabiqMobileDrawer')?.classList.contains('is-open'));
    assert.equal(await page.evaluate(()=>
      !!document.activeElement?.closest('#erp-mobile-drawer')),true,
      'visible modal must have focus, not the inert ERP or page body');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>
      !!document.activeElement?.closest('#erp-mobile-drawer')),true,
      'Tab must stay within the open modal');
  }finally{await page.close();}
});

test('drawer closes on loss of authenticated app visibility without route exposure',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  try{
    await syntheticShell(page);
    await page.locator('#menuToggle').click();
    await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
    assert.equal(await page.locator('#hisabiqMobileDrawer').isVisible(),true);
    await page.evaluate(()=>{
      document.getElementById('app').style.visibility='hidden';
      document.getElementById('loginOverlay').hidden=false;
    });
    await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden,null,{timeout:1600});
    assert.equal(await page.locator('#h-shell-drawer-nav .nav-item').isVisible().catch(()=>false),false);
    assert.equal(await page.locator('#app').evaluate(n=>n.inert),false);
  }finally{await page.close();}
});

test('user menu keyboard navigation follows ARIA menu focus and returns to trigger',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  try{
    await syntheticShell(page);
    const trigger=page.locator('#h-shell-user-trigger');
    await trigger.click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'h-shell-menu-settings',
      'menu must focus first visible enabled item');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'h-shell-menu-signout');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'h-shell-menu-settings');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'h-shell-menu-signout');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'h-shell-menu-settings');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#h-shell-user-popover').isVisible(),false);
    assert.equal(await trigger.evaluate(n=>document.activeElement===n),true);
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  }finally{await page.close();}
});

test('modal drawer exits cleanly when tablet becomes desktop',async()=>{
  const page=await browser.newPage({viewport:{width:768,height:1024}});
  try{
    await syntheticShell(page);
    await page.locator('#menuToggle').click();
    // Drawer opens on requestAnimationFrame; CI must observe the actual
    // visible modal before simulating the 768px-to-desktop resize.
    await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
    assert.equal(await page.locator('#hisabiqMobileDrawer').isVisible(),true);
    await page.setViewportSize({width:1024,height:768});
    await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
    assert.equal(await page.locator('#app').evaluate(n=>n.inert),false);
    assert.equal(await page.locator('#sidebar').isVisible(),true);
    await screenshot(page,'after-hardening-1024-desktop');
  }finally{await page.close();}
});

test('desktop split 1024px retains readable topbar module title and operable search',async()=>{
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  try{
    await syntheticShell(page);
    const state=await page.locator('#pageTitle').evaluate(node=>({
      text:node.textContent,
      scroll:(node.querySelector('.topbar-module-name')||node).scrollWidth,
      client:(node.querySelector('.topbar-module-name')||node).clientWidth,
      searchVisible:!!document.querySelector('#h-shell-search-input')?.getClientRects().length,
      barOverflow:Math.round(document.querySelector('.topbar').scrollWidth-document.querySelector('.topbar').clientWidth)
    }));
    await screenshot(page,'after-hardening-1024-topbar');
    assert.match(state.text,/Dashboard/);
    assert.equal(state.searchVisible,true,'reference split desktop still exposes module search');
    assert.ok(state.scroll<=state.client+2,'module title should not truncate at 1024: '+JSON.stringify(state));
    assert.ok(state.barOverflow<=2,'topbar must not horizontally overflow: '+JSON.stringify(state));
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#h-shell-search-input').evaluate(n=>document.activeElement===n),true);
  }finally{await page.close();}
});

test('320px drawer footer wraps long English and Bangla business name without clipping',async()=>{
  const page=await browser.newPage({viewport:{width:320,height:640},hasTouch:true});
  try{
    await syntheticShell(page);
    const name='নবাবীহার্ডওয়্যারএন্ডইলেকট্রিক্যালসুপারস্টোর2026NawabiganjElectricalWarehouse';
    await page.evaluate(name=>document.getElementById('shopNameLabel').textContent=name,name);
    await page.locator('#menuToggle').click();
    await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
    const overflow=await page.locator('.h-shell-drawer-panel').evaluate(n=>({
      scroll:n.scrollWidth,client:n.clientWidth,
      footer:n.querySelector('#h-shell-drawer-business').textContent
    }));
    await screenshot(page,'after-hardening-320-long-business');
    assert.equal(overflow.footer,name);
    assert.ok(overflow.scroll<=overflow.client+2,'drawer overflow with long bilingual business: '+JSON.stringify(overflow));
  }finally{await page.close();}
});

test('reduced motion keeps accessible drawer interactions without animation',async()=>{
  const page=await browser.newPage({
    viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'
  });
  try{
    await syntheticShell(page);
    await page.locator('#menuToggle').click();
    const css=await page.locator('.h-shell-drawer-panel').evaluate(n=>({
      duration:getComputedStyle(n).transitionDuration,
      transform:getComputedStyle(n).transform
    }));
    assert.equal(css.duration,'0s','reduced motion disables slide transition');
    assert.equal(await page.locator('#app').evaluate(n=>n.inert),true);
    await screenshot(page,'after-hardening-390-reduced-motion');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.getElementById('hisabiqMobileDrawer').hidden);
    assert.equal(await page.locator('#app').evaluate(n=>n.inert),false);
  }finally{await page.close();}
});


test('mobile drawer explicitly owns every Tab/Shift+Tab key while modal is open',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  try{
    await syntheticShell(page);
    await page.locator('#menuToggle').click();
    await page.locator('#hisabiqMobileDrawer').waitFor({state:'visible'});
    await page.locator('#h-shell-drawer-close').focus();
    const prevented=await page.evaluate(()=>{
      const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(prevented,true,
      'the modal must not depend on browser default focus order past its backdrop');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(()=>
      document.activeElement?.closest('#hisabiqMobileDrawer')!==null),true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>
      document.activeElement?.closest('#hisabiqMobileDrawer')!==null),true);
  }finally{await page.close();}
});
