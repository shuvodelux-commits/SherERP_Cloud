import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {serveCompiledUi} from './serve-compiled-ui.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const server=await serveCompiledUi();
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const dir=process.cwd()+'/test-results/m09-reports-ui-refine';
await mkdir(dir,{recursive:true});
const results=[];
const proposal=process.argv.includes('--proposal');
const assertRefined=process.argv.includes('--assert-refined');
try{
  for(const [label,width,height] of [['desktop',1440,900],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(server.url,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      const login=document.getElementById('loginOverlay');
      if(login){login.hidden=true;login.style.display='none';}
      const app=document.getElementById('app');
      app.style.visibility='visible';
      app.hidden=false;
      document.querySelectorAll('section.page').forEach(p=>p.hidden=true);
      const reports=document.getElementById('page-reports');
      reports.hidden=false;
      reports.style.display='block';
      const title=document.getElementById('pageTitle');
      title.textContent='Reports';
      const nav=document.querySelector('#navList');
      if(nav && !nav.children.length)nav.innerHTML='<div class="nav-item active"><span>Reports</span></div><div class="nav-item"><span>Dashboard</span></div><div class="nav-item"><span>Settings</span></div>';
      const dates=[['rptFrom','2026-11-01'],['rptTo','2026-11-17']];
      for(const [id,value] of dates){const el=document.getElementById(id);if(el)el.value=value;}
      const metrics={rsInvoices:'48',rsGross:'৳ 3,42,850',rsReturned:'৳ 14,500',rsNet:'৳ 3,28,350',rsPaid:'৳ 2,95,250',rsDue:'৳ 33,100'};
      for(const [id,value] of Object.entries(metrics)){const el=document.getElementById(id);if(el)el.textContent=value;}
      const rows={
        rsDayBody:[['2026-11-17','12','৳ 88,000','৳ 1,500','৳ 86,500'],['2026-11-16','18','৳ 1,27,350','৳ 5,000','৳ 1,22,350']],
        rsPayBody:[['Cash','27','৳ 1,85,250','৳ 1,80,250'],['Credit','21','৳ 1,57,600','৳ 1,48,100']],
        rsCustBody:[['Sample hardware shop','14','৳ 75,200'],['Walk-in buyer','9','৳ 42,400']]
      };
      for(const [id,values] of Object.entries(rows)){
        const body=document.getElementById(id);
        if(body)body.innerHTML=values.map(row=>'<tr>'+row.map((value,i)=>'<td'+(i?' class="num"':'')+'>'+value+'</td>').join('')+'</tr>').join('');
      }
      for(const el of document.querySelectorAll('#page-reports .empty-state'))el.hidden=true;
    });
    if(proposal)await page.addStyleTag({content:await readFile(new URL('../docs/reviews/m09-reports-ui-refine/proposal.css',import.meta.url),'utf8')});
    await page.screenshot({path:dir+'/'+label+(proposal?'-after':'-before')+'.png',fullPage:true});
    const metrics=await page.evaluate(()=>{
      const root=document.querySelector('#page-reports');
      const toolbar=root.querySelector('.toolbar');
      const tabs=root.querySelector('.tabs');
      const dateInputs=[...toolbar.querySelectorAll('input[type=date]')];
      const btns=[...toolbar.querySelectorAll('button')];
      const boxes=e=>{const b=e.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height),right:Math.round(b.right)};};
      const clipping=[...root.querySelectorAll('button,input')].filter(el=>{const b=el.getBoundingClientRect();return b.right>innerWidth+1 || b.left<-1}).map(el=>({id:el.id||el.textContent.trim().slice(0,20),rect:boxes(el)}));
      return {width:innerWidth,docWidth:document.documentElement.scrollWidth,root:boxes(root),toolbar:boxes(toolbar),tabs:boxes(tabs),buttons:btns.map(el=>({label:el.textContent.trim(),...boxes(el)})),dates:dateInputs.map(el=>({value:el.value,...boxes(el)})),tabScrollWidth:tabs.scrollWidth,tabClientWidth:tabs.clientWidth,clipping};
    });
    results.push({label,...metrics,pageErrors});
    await page.close();
  }
  await writeFile(dir+(proposal?'/proposed-metrics.json':'/baseline-metrics.json'),JSON.stringify(results,null,2));
  if(assertRefined){
    const mobile=results.find(item=>item.label==='mobile');
    const desktop=results.find(item=>item.label==='desktop');
    assert.equal(mobile.docWidth,390,'mobile document must not horizontally overflow');
    assert.equal(mobile.dates[0].y,mobile.dates[1].y,'From/To date controls must share the same row');
    assert.equal(mobile.dates[0].width,mobile.dates[1].width,'date control widths must match');
    assert.equal(mobile.buttons.find(x=>x.label==='Run').y,
      mobile.buttons.find(x=>x.label==='Today').y,'action buttons must align');
    assert.ok(mobile.tabScrollWidth>mobile.tabClientWidth,'all report tabs remain horizontally reachable');
    assert.equal(desktop.toolbar.height,37,'desktop Reports toolbar must remain unchanged');
    assert.deepEqual(results.flatMap(item=>item.pageErrors),[],'no browser page errors');
  }
  console.log(JSON.stringify({screens:proposal?['desktop-after.png','mobile-after.png']:['desktop-before.png','mobile-before.png'],metrics:results},null,2));
}finally{await browser.close();await server.close();}
