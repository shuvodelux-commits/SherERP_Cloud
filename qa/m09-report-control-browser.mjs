/**
 * M09 Reports original-UI control regression and nondeployable proposal.
 *
 * This QA-only script uses the compiled original frontend with synthetic
 * state and inert local RPC; it never logs in or calls an external D1/Worker.
 *
 * Default --assert-fixed is deliberately RED on original source.
 * --proposal --assert-fixed checks the isolated owner-handoff preview.
 */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

const proposal=process.argv.includes('--proposal');
const assertFixed=process.argv.includes('--assert-fixed');
const root=resolve('test-results/m09-report-print-control');
await mkdir(root,{recursive:true});
const server=await serveCompiledUi();
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try {
  for(const [label,width,height] of [['mobile',390,844],['desktop',1440,900]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      // Same local-only reveal pattern as the merged M09 screenshot QA.
      document.getElementById('loginOverlay').style.display='none';
      const app=document.getElementById('app');
      app.hidden=false;
      app.style.visibility='visible';
      for(const section of document.querySelectorAll('section.page'))section.hidden=true;
      const reports=document.getElementById('page-reports');
      reports.hidden=false;
      reports.style.display='block';
      document.getElementById('rptFrom').value='2026-11-01';
      document.getElementById('rptTo').value='2026-11-17';
      window.__m09PrintCalls=0;
      window.print=()=>{window.__m09PrintCalls++};
      rptState.activeTab='rptSales';
      rptState.loaded={};
      // Local synthetic completed promises; no financial RPC or customer data.
      for(const key of Object.keys(RPT_LOADERS)){
        RPT_LOADERS[key]=()=>Promise.resolve();
      }
    });

    if(proposal){
      const inspector=await readFile(new URL('../src/modules/m09-report-control-state.js',import.meta.url),'utf8');
      await page.addScriptTag({content:inspector.replace('export function inspectM09ReportControlState','function inspectM09ReportControlState')+
        '\nwindow.__m09Inspect=inspectM09ReportControlState;'});
      await page.addScriptTag({content:await readFile(new URL('./m09-report-print-preview.js',import.meta.url),'utf8')});
    }

    // A newly opened, unsuccessful Sales report must not print.
    await page.locator('#rptPrintBtn').click();
    const emptyPrint=await page.evaluate(()=>window.__m09PrintCalls);
    const emptyBlocked=emptyPrint===0;

    // Synthetic successful active Sales load: date changes must stale it.
    await page.evaluate(()=>{
      rptState.loaded.rptSales=true;
      if(window.__m09PreviewMarkLoaded)window.__m09PreviewMarkLoaded('rptSales');
    });
    // The preserved mobile UI hides the native date input behind its touch
    // wrapper. Dispatch real bubbling DOM events without altering source.
    await page.evaluate(()=>{
      const el=document.getElementById('rptTo');
      el.value='2026-11-16';
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    });
    const cacheAfterEdit=await page.evaluate(()=>rptState.loaded.rptSales);
    const cacheInvalidated=cacheAfterEdit===false;
    const beforeStalePrint=await page.evaluate(()=>window.__m09PrintCalls);
    await page.locator('#rptPrintBtn').click();
    const stalePrinted=await page.evaluate((old)=>window.__m09PrintCalls>old,beforeStalePrint);
    const stalePrintBlocked=!stalePrinted;

    // Confirm normal original tab and keyboard interactions were preserved.
    const tabs=['rptSales','rptPurchase','rptStock','rptCashBank','rptProfit','rptBalanceSheet'];
    const tabChecks=[];
    for(const id of tabs){
      await page.locator('#page-reports .tab-btn[data-tab="'+id+'"]').click();
      await page.waitForTimeout(0);
      tabChecks.push(await page.evaluate((key)=>({
        selected:rptState.activeTab===key,
        active:document.querySelectorAll('#page-reports .tab-btn.active').length===1,
        visible:!document.getElementById(key).hidden
      }),id));
    }
    const profit=page.locator('#page-reports .tab-btn[data-tab="rptProfit"]');
    await profit.focus();
    await page.keyboard.press('Enter');
    const keyboard=await page.evaluate(()=>rptState.activeTab==='rptProfit');

    // A genuinely completed current-tab result must still be printable.
    await page.evaluate(()=>{
      rptState.loaded.rptProfit=true;
      if(window.__m09PreviewMarkLoaded)window.__m09PreviewMarkLoaded('rptProfit');
    });
    const priorValid=await page.evaluate(()=>window.__m09PrintCalls);
    await page.locator('#rptPrintBtn').click();
    const validPrintAllowed=await page.evaluate(n=>window.__m09PrintCalls===n+1,priorValid);

    // Date-independent snapshot reports must print when their own result
    // is loaded, even if period selector fields are blank.
    await page.locator('#page-reports .tab-btn[data-tab="rptStock"]').click();
    await page.evaluate(()=>{
      for(const id of ['rptFrom','rptTo']){
        const input=document.getElementById(id);
        input.value='';
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      rptState.loaded.rptStock=true;
      if(window.__m09PreviewMarkLoaded)window.__m09PreviewMarkLoaded('rptStock');
    });
    const priorSnapshot=await page.evaluate(()=>window.__m09PrintCalls);
    await page.locator('#rptPrintBtn').click();
    const snapshotPrintAllowed=await page.evaluate(n=>window.__m09PrintCalls===n+1,priorSnapshot);

    let pendingPrintBlocked=true;
    if(proposal){
      await page.evaluate(()=>window.__m09PreviewSetPending('rptStock',true));
      const priorPending=await page.evaluate(()=>window.__m09PrintCalls);
      await page.locator('#rptPrintBtn').click();
      pendingPrintBlocked=await page.evaluate(n=>window.__m09PrintCalls===n,priorPending);
      await page.evaluate(()=>window.__m09PreviewSetPending('rptStock',false));
    }

    await page.screenshot({path:root+'/'+label+(proposal?'-preview':'-baseline')+'.png',fullPage:true});
    const result={
      viewport:label,emptyBlocked,cacheInvalidated,stalePrintBlocked,
      allTabs:tabChecks.every(item=>item.selected&&item.active&&item.visible),
      keyboard,validPrintAllowed,snapshotPrintAllowed,pendingPrintBlocked,errors
    };
    results.push(result);
    await page.close();
  }
  await writeFile(root+(proposal?'/preview-evidence.json':'/baseline-evidence.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({mode:proposal?'proposal':'original',results},null,2));

  assert.equal(results.length,2);
  for(const row of results){
    assert.equal(row.allTabs,true,'all six Reports tabs must remain reachable');
    assert.equal(row.keyboard,true,'keyboard Enter must select a report tab');
    assert.equal(row.validPrintAllowed,true,'successfully loaded period report must print');
    assert.equal(row.snapshotPrintAllowed,true,'loaded Stock snapshot must ignore period selectors');
    assert.equal(row.pendingPrintBlocked,true,'in-flight snapshot must not print');
    assert.deepEqual(row.errors,[],'no uncaught browser page errors');
    if(assertFixed){
      assert.equal(row.emptyBlocked,true,'Print before successful report load must be blocked');
      assert.equal(row.cacheInvalidated,true,'changing dates must invalidate cached period results');
      assert.equal(row.stalePrintBlocked,true,'stale period report must not print');
    }
  }
} finally {
  await browser.close();
  await server.close();
}
