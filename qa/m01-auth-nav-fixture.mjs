import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * M01 browser-only synthetic Clerk. The actual public Worker stays inert.
 * This is presentation/role-navigation QA, not server authorization or D1.
 */
export async function installM01SyntheticNavigation(page,overrides={}) {
  const calls=[];
  const payload={
    token:'c'.repeat(64),
    user:{id:'M01-SYNTHETIC-CLERK',name:'Synthetic Clerk',
      mobile:'01710000001',role:'Clerk'},
    allowedModules:overrides.allowedModules ?? ['dashboard','reports'],
    permissions:overrides.permissions ?? {dashboard:{view:true},reports:{view:true}}
  };
  const shell={
    shopName:'Synthetic Hardware',
    currencySymbol:'৳',
    navItems:overrides.navItems ?? [
      {key:'dashboard',label:'Dashboard',icon:'dashboard',
        sidebarGroup:0,sidebarOrder:1},
      {key:'reports',label:'Reports',icon:'reports',
        sidebarGroup:4,sidebarOrder:10},
      {key:'bank',label:'Bank',icon:'bank',
        sidebarGroup:4,sidebarOrder:11}
    ]
  };
  await page.route('**/api/rpc',async route=>{
    const data=route.request().postDataJSON();
    calls.push({fnName:data?.fnName,args:data?.args});
    if(data?.fnName!=='login' && data?.fnName!=='getAppShellData')
      return route.continue();
    await route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{'Cache-Control':'no-store'},
      body:JSON.stringify({
        success:true,
        data:data.fnName==='login'?payload:shell
      })
    });
  });
  return {calls};
}

/**
 * Gather reviewable, synthetic screenshots and responsive facts only.
 * Keep artifacts inside CI's preexisting M01 browser-evidence directory.
 */
export async function captureM01NavEvidence(page,name) {
  if(typeof name!=='string' || !/^[a-z0-9-]+$/.test(name))
    throw new Error('Invalid synthetic M01 screenshot identifier');
  await page.evaluate(()=>document.fonts?.ready);
  const state=await page.evaluate(()=>({
    loginHidden:document.getElementById('loginOverlay')?.hidden===true,
    appVisible:getComputedStyle(document.getElementById('app')).visibility!=='hidden',
    bankNavCount:document.querySelectorAll(
      '#navList .nav-item[data-page="bank"]').length
  }));
  const dir=join(process.cwd(),'test-results','m01-browser');
  await mkdir(dir,{recursive:true});
  const screenshot=await page.screenshot({
    path:join(dir,'original-auth-nav-'+name+'.png'),
    fullPage:true
  });
  return {...state,viewport:page.viewportSize(),screenshotBytes:screenshot.length};
}
