import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

let browser,server;
before(async()=>{
  server=await serveCompiledUi();
  browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?
      {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
});
after(async()=>{await browser?.close();await server?.close();});

async function authorizedFixture(page,user='m01-user-1',tenant='m01-shop-1'){
  await page.evaluate(({user,tenant})=>{
    // Fixture-only authenticated DOM harness: no real server token, D1 or writes.
    window.authToken='m01-synthetic-browser-fixture';
    window.currentUser={id:user,tenantId:tenant,name:'Fixture User',role:'Administrator'};
    window.allowedModules=null;
    document.getElementById('loginOverlay').hidden=true;
    document.getElementById('app').style.visibility='';
    document.getElementById('shopNameLabel').textContent='M01 Synthetic Store';
    window.dispatchEvent(new Event('focus'));
  },{user,tenant});
}

test('M01 HisabIQ desktop cards, panels and click-through preserve existing navigation',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(server.url);
    await authorizedFixture(page);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]:visible').count(),6);
    assert.equal(await page.locator('#hisabiq-dashboard-panels > [data-hdb-widget]:visible').count(),4);
    await page.locator('#dashSales').evaluate(el=>{el.textContent='৳4,250';});
    await page.waitForFunction(()=>document.querySelector('[data-hdb-value="dashSales"]').textContent==='৳4,250');
    assert.equal(await page.locator('[data-hdb-value="unavailable"]').textContent(),'—',
      'gross profit must not invent a number from unrelated sales totals');
    await mkdir('test-results/m01-browser',{recursive:true});
    await page.screenshot({path:'test-results/m01-browser/hisabiq-dashboard-desktop.png',fullPage:true});
    await page.locator('[data-hdb-widget="today-sales"] .hdb-widget').click();
    assert.equal(await page.locator('#page-sales').isVisible(),true);
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});

test('M01 customize: hide, show, move, reset and reload user-scoped saved layout',async()=>{
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  try{
    await page.goto(server.url);
    await authorizedFixture(page);
    await page.locator('#hisabiq-dashboard-customize').click();
    assert.equal(await page.locator('#hisabiq-dashboard').evaluate(n=>n.classList.contains('is-editing')),true);
    await page.locator('[data-hdb-widget="low-stock"] [data-hdb-action="hide"]').click();
    assert.equal(await page.locator('[data-hdb-widget="low-stock"]').isVisible(),false);
    await page.locator('[data-hdb-widget="today-sales"] [data-hdb-action="move-next"]').click();
    const order=await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbWidget));
    assert.equal(order[0],'receivable');
    assert.equal(order[1],'today-sales');
    await page.locator('#hdb-all-widgets').click();
    assert.equal(await page.locator('#hisabiq-dashboard-dialog').isVisible(),true);
    await page.locator('[data-hdb-list="metric"] [data-hdb-id="low-stock"] [role="switch"]').click();
    assert.equal(await page.locator('[data-hdb-widget="low-stock"]').isVisible(),true);
    await page.locator('[data-hdb-action="dialog-close"]').click();
    await page.locator('[data-hdb-action="finish"]').click();
    await page.reload();
    await authorizedFixture(page);
    const after=await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').evaluateAll(nodes=>nodes.map(n=>n.dataset.hdbWidget));
    assert.equal(after[0],'receivable','order persists across reload for the same actor');
    await authorizedFixture(page,'m01-user-2');
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first().getAttribute('data-hdb-widget'),'today-sales',
      'another actor cannot inherit this user layout');
    await authorizedFixture(page,'m01-user-1');
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    await page.locator('[data-hdb-action="reset"]').click();
    assert.equal(await page.locator('#hisabiq-dashboard-metrics > [data-hdb-widget]').first().getAttribute('data-hdb-widget'),'today-sales');
    assert.equal(await page.locator('[data-hdb-widget="today-collection"]').isVisible(),false);
  }finally{await page.close();}
});

test('M01 responsive 390px and keyboard dialog have no horizontal overflow',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    await page.goto(server.url);
    await authorizedFixture(page);
    assert.equal(await page.locator('#hisabiq-dashboard-metrics').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    assert.ok(overflow<=2,'dashboard must not overflow the mobile viewport: '+overflow);
    await mkdir('test-results/m01-browser',{recursive:true});
    await page.screenshot({path:'test-results/m01-browser/hisabiq-dashboard-mobile.png',fullPage:true});
    await page.locator('#hisabiq-dashboard-customize').click();
    await page.locator('#hdb-all-widgets').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#hisabiq-dashboard-dialog').isVisible(),false);
  }finally{await page.close();}
});
