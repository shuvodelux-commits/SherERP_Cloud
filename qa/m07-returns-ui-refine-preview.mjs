/**
 * M07 — standalone Playwright visual refinement proof, not a runtime route.
 *
 * Run from a repo checkout: node qa/m07-returns-ui-refine-preview.mjs
 * Prerequisites: npm ci && npx playwright install chromium
 * Existing source-compiled UI and RPC-disabled fixture: serveCompiledUi().
 *
 * Test-only DOM reveal is not authentication, permission or backend posting.
 * We do NOT claim a successful real Return workflow, payment or source D1.
 * M01 owns the review decision and any eventual production CSS integration.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

const proposal=await readFile(new URL('../docs/reviews/m07-returns-ui-refine/proposal.css',import.meta.url),'utf8');
const evidenceDir=join(process.cwd(),'test-results','m07-returns-ui-refine');
const widths=[{width:320,height:640},{width:375,height:812},{width:1440,height:900}];
const results=[];
const server=await serveCompiledUi();
const browser=await chromium.launch({
 headless:true,
 ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})
});
await mkdir(evidenceDir,{recursive:true});
try{
 for(const viewport of widths){
  for(const mode of ['invoice','customer']){
   for(const refined of [false,true]){
    const page=await browser.newPage({viewport,deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
     await page.goto(server.url,{waitUntil:'domcontentloaded'});
     // The deployed Worker remains inert and unauthenticated. Only the
     // local Playwright page's already-compiled original DOM is revealed.
     await page.evaluate(mode=>{
      const login=document.getElementById('loginOverlay');
      if(login){login.hidden=true;login.style.display='none';}
      const app=document.getElementById('app');
      app.hidden=false;app.style.visibility='visible';
      const pages=document.querySelectorAll('section.page');
      pages.forEach(node=>{node.hidden=true;node.style.display='none';});
      const returns=document.getElementById('page-returns');
      if(!returns)throw Error('Original compiled Returns page is missing');
      returns.hidden=false;returns.style.display='block';
      const title=document.getElementById('pageTitle');
      if(title)title.textContent='Returns';
      const selected=mode==='customer';
      const invoice=document.getElementById('rtInvoiceSearchPanel');
      const customer=document.getElementById('rtCustomerSearchPanel');
      invoice.hidden=selected;customer.hidden=!selected;
      const invoiceBtn=document.getElementById('rtInvoiceSearchModeBtn');
      const customerBtn=document.getElementById('rtCustomerSearchModeBtn');
      invoiceBtn.classList.toggle('btn-primary',!selected);
      customerBtn.classList.toggle('btn-primary',selected);
      const card=document.getElementById('rtSearchCard');
      if(!card)throw Error('Original compiled Returns Search Card is missing');
     },mode);
     if(refined)await page.addStyleTag({content:proposal});
     const metrics=await page.evaluate(mode=>{
      const panel=document.getElementById(
       mode==='customer'?'rtCustomerSearchPanel':'rtInvoiceSearchPanel');
      const row=panel.querySelector('div[style*="display:flex"]');
      const input=panel.querySelector('input');
      const buttons=[...row.children].filter(el=>el.tagName==='BUTTON');
      const box=el=>{const b=el.getBoundingClientRect();return {
       x:Math.round(b.x),right:Math.round(b.right),top:Math.round(b.top),
       width:Math.round(b.width),height:Math.round(b.height)};};
      const rowBox=box(row),field=box(input),actions=buttons.map(box);
      return {mode,viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,
       row:rowBox,input:field,actions,
       horizontalClipping:field.x<rowBox.x-1||field.right>rowBox.right+1||
        actions.some(b=>b.x<rowBox.x-1||b.right>rowBox.right+1)||
        document.documentElement.scrollWidth>innerWidth+1,
       originalIdentifiersIntact:!!document.getElementById('rtCompleteBtn')&&
        !!document.getElementById('rtRefundMethod')};
     },mode);
     assert.equal(metrics.originalIdentifiersIntact,true,'never remove original Return cart, refund inputs or confirmation');
     assert.equal(metrics.actions.length,2,'exactly two original Find/Clear actions');
     if(refined){
      assert.equal(metrics.horizontalClipping,false,'refinement must not clip at '+viewport.width);
      if(viewport.width<=540){
       assert.ok(metrics.input.width>=metrics.row.width-2,'mobile search input must span the entire row');
       assert.ok(metrics.input.height>=44,'mobile input must meet touch target height');
       for(const b of metrics.actions)assert.ok(b.height>=44,'mobile actions must meet 44px touch height');
       assert.ok(Math.abs(metrics.actions[0].width-metrics.actions[1].width)<=2,
        'mobile Find/Clear controls must be equal width');
      }
     }
     const name=mode+'-'+viewport.width+(refined?'-after':'-before');
     await page.screenshot({path:join(evidenceDir,name+'.png'),fullPage:true});
     results.push({name,refined,...metrics,pageErrors:errors});
    }finally{await page.close();}
   }
  }
 }
 await writeFile(join(evidenceDir,'metrics.json'),JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify({evidenceDir,captures:results.length,
  regression:results.filter(r=>r.refined&&r.horizontalClipping).length,
  syntheticOnly:true,noPublicRpcChanges:true},null,2));
}finally{
 await browser.close();
 await server.close();
}
