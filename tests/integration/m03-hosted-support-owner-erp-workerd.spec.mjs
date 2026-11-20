import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {chromium} from 'playwright';
import {buildSupportOwnerErp} from '../../scripts/build-support-owner-erp.mjs';
import {generateHostedPilotMigrations} from '../../scripts/m03-hosted-pilot-migrations.mjs';
import {generateHostedSupportMigration} from '../../scripts/m03-hosted-support-migration.mjs';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const root=resolve('.');
const origin='https://admin.fixture.workers.dev';
const subject='123456789012345678901';
const uuid=()=>crypto.randomUUID();
const sha=t=>createHash('sha256').update(t).digest('hex');

test('real Owner ERP frontend is reused in support-only mode; Shop logs read, writes forbidden, no Owner identity',async t=>{
  await mkdir(join(root,'.wrangler'),{recursive:true});
  const dir=await mkdtemp(join(root,'.wrangler','hosted-erp-visit-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const pilot={shopId:uuid(),databaseId:uuid(),databaseMarker:uuid()};
  await generateHostedPilotMigrations(pilot,dir);
  await generateHostedSupportMigration(dir);
  const assetDir=join(dir,'assets');
  const compiled=await buildSupportOwnerErp({outputDir:assetDir});
  assert.ok(compiled.bytes>500000,'actual original ERP UI compiled');
  const config={
    name:'hosted-erp-support-proof',
    main:join(root,'src/auth/m04-accessless-platform-admin-worker.js'),
    compatibility_date:'2026-11-14',
    rules:[{type:'Text',globs:[
      '**/platform-auth/index.html','**/platform-auth/platform-auth.css',
      '**/platform-auth/platform-auth.js'],fallthrough:true}],
    assets:{directory:assetDir,binding:'ASSETS',run_worker_first:true,html_handling:'none'},
    vars:{
      PLATFORM_AUTH_MODE:'google-totp-without-access',
      PLATFORM_AUTH_SCOPE:'private-platform-auth',
      PLATFORM_AUTH_ORIGIN:origin,
      PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
      PLATFORM_OPERATOR_GOOGLE_SUBJECT:subject,
      PLATFORM_TOTP_SECRET:'a'.repeat(40),PLATFORM_FACTOR_VERSION:'1',
      PLATFORM_SHOP_RESERVATION_ENABLED:'true',
      PLATFORM_SHOP_DIRECTORY_ENABLED:'true',
      PLATFORM_HOSTED_PILOT_ENABLED:'true',
      PLATFORM_HOSTED_SUPPORT_ENABLED:'true',
      PLATFORM_PILOT_SHOP_ID:pilot.shopId,PLATFORM_PILOT_D1_ID:pilot.databaseId,
      PLATFORM_PILOT_MARKER:pilot.databaseMarker
    },
    d1_databases:[
      {binding:'CONTROL_DB',database_name:'proof-control',database_id:uuid(),
        migrations_dir:join(dir,'control')},
      {binding:'PLATFORM_PILOT_DB',database_name:'proof-shop',database_id:pilot.databaseId,
        migrations_dir:join(dir,'shop')}
    ],
    ratelimits:[{name:'PLATFORM_INGRESS',namespace_id:'58723',simple:{limit:100,period:60}}]
  };
  const path=join(dir,'worker.json');
  await writeFile(path,JSON.stringify(config),{mode:0o600});
  const harness=createTestHarness({workers:[{configPath:path}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  await worker.applyD1Migrations('PLATFORM_PILOT_DB');
  const env=await worker.getEnv();
  const control=env.CONTROL_DB;
  const now=Date.now();
  const session='1'.repeat(64);
  const chall='c'.repeat(64);
  await control.batch([
    control.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(sha('ticket'),'b'.repeat(43),'https://accounts.google.com',subject,now-1000,now+60000),
    control.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com',subject,sha('ticket'),now-500),
    control.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    control.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(chall,'d'.repeat(43),now+60000),
    control.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(chall,now-200),
    control.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`).bind(await hashOpaqueSessionToken(session),chall,now-100,now+60000)
  ]);
  const pathReq=(route,options={})=>worker.fetch(origin+route,{
    ...options,headers:{Cookie:'__Host-shererp-platform-session='+(options.cookie??session),
      ...(options.method==='POST'?{Origin:origin,'Content-Type':'application/json'}:{}),
      ...options.headers},
  });
  const post=(route,body,cookie)=>pathReq(route,{method:'POST',cookie,body:JSON.stringify(body)});
  // The existing shop provisioning state machine, Owner Gmail approval, D1
  // ready gate and API are reused exactly; no fake tenant-binding shortcuts.
  const operationId=uuid();
  assert.equal((await post('/api/platform/shops',{
    operationId,displayName:'MVP Hardware Shop',ownerEmail:'owner@gmail.com'
  })).status,202);
  const ready=await post('/api/platform/shops/resume',{operationId});
  assert.equal(ready.status,200);
  assert.equal((await ready.json()).status,'ready');
  assert.equal((await control.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,1);
  assert.equal((await control.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,1);
  assert.equal((await pathReq('/support/erp',{cookie:'2'.repeat(64)})).status,401);
  assert.equal((await pathReq('/api/platform/support/erp/session',{cookie:'2'.repeat(64)})).status,403);
  const supportOp=uuid();
  const support=await post('/api/platform/support/start',{
    shopId:pilot.shopId,operationId:supportOp,
    reason:'Reviewing actual Owner ERP and transaction activity'
  });
  assert.equal(support.status,201);
  const grant=await support.json();
  assert.ok(grant.supportToken);

  const page=await pathReq('/support/erp');
  assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Security-Policy')??'',/script-src 'self' 'unsafe-inline'/);
  const html=await page.text();
  assert.match(html,/Super Admin Support · READ ONLY/);
  assert.match(html,/id="page-products"/);
  assert.match(html,/id="page-dashboard"/);
  assert.match(html,/Shop Activity Log/);
  assert.ok(!html.includes('/api/owner/'),'support client must not call Owner authentication');

  const current=await pathReq('/api/platform/support/erp/session');
  assert.equal(current.status,200);
  const who=await current.json();
  assert.equal(who.role,'PlatformSupport');
  assert.equal(who.shopId,pilot.shopId);
  assert.equal(who.operationId,supportOp);
  assert.equal(who.dashboard.displayName,'MVP Hardware Shop');
  assert.equal(who.ownerSubject,undefined);
  const shell=await pathReq('/api/platform/support/erp/app-shell');
  assert.equal(shell.status,200);
  const nav=(await shell.json()).data.navItems;
  assert.ok(nav.some(x=>x.key==='pos'));
  assert.ok(nav.some(x=>x.key==='products'));
  const activity=await pathReq('/api/platform/support/erp/activity');
  assert.equal(activity.status,200);
  const events=(await activity.json()).data.items;
  assert.ok(events.some(x=>x.eventType==='Support START'));
  assert.ok(events.some(x=>x.eventType==='Support READ'));
  assert.ok(events.every(x=>x.source==='Support'||x.source==='Shop'));
  assert.equal((await pathReq('/api/platform/support/erp/catalog',{method:'POST',
    body:'{}',headers:{Origin:origin,'Content-Type':'application/json'}})).status!==200,true,
    'no read URI can be used for business POST');
  assert.equal((await post('/api/platform/support/erp/purchases',{})).status!==200,true);
  assert.equal((await pathReq('/owner-erp.html')).status,404,
    'raw static HTML must not bypass the support route');

  // A real browser renders the exact compiled ERP, including its native
  // Dashboard, Products and navigation. The data comes from the audited D1
  // read adapter—not a fake static diagnostics screen.
  const browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  t.after(()=>browser.close());
  const tab=await browser.newPage({viewport:{width:390,height:844}});
  await tab.context().addCookies([{name:'__Host-shererp-platform-session',
    value:session,url:origin+'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await tab.route(origin+'/**',async route=>{
    const req=route.request();
    const options={method:req.method(),headers:{
      Cookie:'__Host-shererp-platform-session='+session,
      ...(req.method()!=='GET'?{Origin:origin}:{}),
    }};
    const response=await worker.fetch(req.url(),options);
    await route.fulfill({status:response.status,
      contentType:response.headers.get('Content-Type')||'text/plain',
      body:Buffer.from(await response.arrayBuffer())});
  });
  await tab.goto(origin+'/support/erp');
  await tab.getByText('Super Admin Support · READ ONLY').waitFor();
  await tab.locator('#app').waitFor({state:'visible',timeout:15000});
  assert.equal(await tab.getByRole('button',{name:'Shop Activity Log'}).count(),1);
  await tab.getByRole('button',{name:'Shop Activity Log'}).click();
  await tab.getByText(/Support START/).first().waitFor();
  assert.equal(await tab.locator('#support-erp-log').isVisible(),true);
  assert.equal(await tab.evaluate(()=>document.documentElement.scrollWidth),390,
    'original ERP Support View remains usable on a narrow mobile screen');
  await tab.close();

  const ended=await post('/api/platform/support/end',{shopId:pilot.shopId,operationId:supportOp});
  assert.equal(ended.status,200);
  assert.equal((await pathReq('/support/erp')).status,401);
  assert.equal((await pathReq('/api/platform/support/erp/activity')).status,403);
  const audit=(await control.prepare(
    'SELECT event_type FROM m03_local_support_events ORDER BY rowid').all()).results;
  assert.equal(audit[0].event_type,'START');
  assert.equal(audit.at(-1).event_type,'END');
  assert.equal((await control.prepare('SELECT count(*) AS n FROM platform_first_shop_owners').first()).n,0,
    'Support never manufactures an Owner login');
});
