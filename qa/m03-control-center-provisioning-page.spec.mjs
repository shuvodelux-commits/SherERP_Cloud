import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {createTestHarness, unstable_splitSqlQuery} from 'wrangler';
import platform from '../src/m03-private-platform-auth-worker.js';
import {applyLocalShopMigrations, shopMigrationPlan} from '../tests/fixtures/port-p2-local-shop-migrations.mjs';
import {hashOpaqueSessionToken} from '../src/auth/session-token.js';

const origin='https://platform.example.test';
const shopIdPattern=/^[0-9a-f-]{36}$/;

test('Control Center browser resumes the same lost-response operation against disposable local D1',async t=>{
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const inventory=[{binding:'SHOP_A_DB',id:crypto.randomUUID()},{binding:'SHOP_B_DB',id:crypto.randomUUID()}];
  for(const item of inventory)config.d1_databases.push({
    binding:item.binding,database_id:item.id,database_name:item.binding.toLowerCase(),remote:false,
  });
  const harness=createTestHarness({workers:[{config:{...config,vars:{...config.vars,
    PLATFORM_SHOP_RESERVATION_ENABLED:'true',PLATFORM_LOCAL_PROVISIONING_ENABLED:'true',
    PLATFORM_LOCAL_SHOP_INVENTORY:inventory,
  }}}]});
  let browser;
  t.after(async()=>{await browser?.close();await harness.close();});
  await harness.listen();
  const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv();
  const db=env.CONTROL_DB;
  for(const name of ['0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
    '0004_first_shop_owner','0007_owner_gmail_approvals','0011_control_center_provisioning']){
    const sql=await readFile('staging-migrations/platform-onboarding/'+name+'.sql','utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  }

  const token='1'.repeat(64);
  const now=Date.now();
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),'https://accounts.google.com','fixture-admin',now-1000,now+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','fixture-admin','a'.repeat(64),now-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind('c'.repeat(64),now-200),
    db.prepare('INSERT INTO platform_admin_sessions (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms) VALUES (?,?,1,1,1,?,?)')
      .bind(await hashOpaqueSessionToken(token),'c'.repeat(64),now-100,now+60000),
  ]);

  const files={};
  for(const name of ['index.html','platform-auth.css','platform-auth.js']){
    files['/'+name]=await readFile('frontend/platform-auth/'+name,'utf8');
  }
  const receipts=new Map();
  let creates=0,prepares=0;
  const provider={
    async createDatabase(action){
      creates++;
      const selected=inventory[creates-1];
      const rec={...action,id:selected.id,binding:selected.binding,evidenceRef:'fixture-attributed-'+creates};
      receipts.set(action.attemptId,rec);
      if(creates===1)throw new Error('lost response after local allocation');
      return rec;
    },
    async findCreation(action){return receipts.get(action.attemptId);},
    async verifyTarget(scope,target){
      return inventory.some(x=>x.id===scope.databaseId&&x.binding===scope.binding&&target===env[x.binding]);
    },
    async prepareShop(scope){
      prepares++;
      await applyLocalShopMigrations(env[scope.binding],scope);
    },
  };
  const inputs=[];
  const browserEnv={...env,platformPageFiles:files,PLATFORM_LOCAL_SHOP_INVENTORY:inventory,
    PLATFORM_LOCAL_SHOP_MIGRATIONS:shopMigrationPlan,PLATFORM_LOCAL_SHOP_PROVIDER:provider,
    PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,
    PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
    PLATFORM_INGRESS:{async limit(){return {success:true};}},
    PLATFORM_SHOP_RESERVATION_ENABLED:'true',PLATFORM_LOCAL_PROVISIONING_ENABLED:'true'};
  browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.context().addCookies([{
    name:'__Host-shererp-platform-session',value:token,url:origin+'/',secure:true,httpOnly:true,sameSite:'Strict',
  }]);
  await page.route(origin+'/**',async route=>{
    const request=route.request(),method=request.method(),headers={...request.headers()};
    if(method==='POST')headers.origin=origin;
    const body=method==='POST'?request.postData():undefined;
    if(request.url().endsWith('/api/platform/shops') && body)inputs.push(JSON.parse(body));
    const response=await platform.request(request.url(),{method,headers,body},browserEnv);
    await route.fulfill({status:response.status,headers:{'Cache-Control':'no-store'},
      contentType:response.headers.get('Content-Type')||'application/json',
      body:Buffer.from(await response.arrayBuffer())});
  });

  await page.goto(origin);
  await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
  await page.getByText('No local businesses yet.').waitFor();
  const owner=page.getByRole('textbox',{name:'Owner Gmail'});
  const layout=await page.evaluate(()=>{
    const name=document.getElementById('business-name').getBoundingClientRect();
    const gmail=document.getElementById('business-owner-email').getBoundingClientRect();
    const submit=document.querySelector('#business-form button[type="submit"]').getBoundingClientRect();
    return {ordered:name.bottom<=gmail.top&&gmail.bottom<=submit.top,
      heights:[name.height,gmail.height,submit.height],
      widths:[name.width,gmail.width,submit.width]};
  });
  assert.equal(layout.ordered,true,'mobile fields and primary action stay in reading order');
  assert.ok(layout.heights.every(height=>height>=44),'mobile controls have 44px touch targets');
  assert.ok(layout.widths.every(width=>width>250&&width<=390),'controls fit the mobile card');
  await page.getByRole('textbox',{name:'Business name'}).fill('টুলস ও হার্ডওয়্যার');
  await owner.fill('owner@example.com');
  await owner.press('Enter');
  await page.getByText('Enter a valid Owner Gmail address.').waitFor();
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first()).n,0);
  await owner.fill('fixture.owner@gmail.com');
  await owner.press('Enter');
  await page.getByRole('button',{name:'Resume setup',exact:true}).waitFor();
  await mkdir('test-results/m01-browser',{recursive:true});
  await page.screenshot({path:'test-results/m01-browser/m03-local-recovery-mobile.png'});
  assert.equal(creates,1,'first allocation happened and response was lost');
  assert.equal(prepares,0,'no schema write before attributed reconciliation');
  assert.equal(inputs.length,1);
  assert.equal(inputs[0].ownerEmail,'fixture.owner@gmail.com');
  assert.match(inputs[0].operationId,shopIdPattern);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);

  await page.reload();
  await page.getByRole('button',{name:'Resume setup',exact:true}).waitFor();
  assert.equal(await owner.inputValue(),'fixture.owner@gmail.com');
  assert.equal(await page.getByRole('textbox',{name:'Business name'}).inputValue(),'টুলস ও হার্ডওয়্যার');
  await page.getByRole('button',{name:'Resume setup',exact:true}).click();
  await page.locator('#business-receipt').filter({hasText:/ready/i}).waitFor();
  assert.equal(creates,1,'Resume never creates a second D1');
  assert.equal(prepares,1);
  await page.screenshot({path:'test-results/m01-browser/m03-local-ready-mobile.png'});
  const reservation=await db.prepare('SELECT shop_id FROM platform_shop_reservations').first();
  assert.match(reservation.shop_id,shopIdPattern);
  assert.equal((await env.SHOP_A_DB.prepare('SELECT shop_id FROM shop_identity').first()).shop_id,reservation.shop_id);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,1);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  assert.equal(await page.getByRole('button',{name:'Resume setup',exact:true}).isVisible(),false);
  await page.setViewportSize({width:1440,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1440);
  await page.screenshot({path:'test-results/m01-browser/m03-local-ready-desktop.png'});
  const second={operationId:crypto.randomUUID(),displayName:'Second Tools',ownerEmail:'second.owner@gmail.com'};
  const createdSecond=await platform.request(origin+'/api/platform/shops',{
    method:'POST',
    headers:{origin,'Content-Type':'application/json',cookie:'__Host-shererp-platform-session='+token},
    body:JSON.stringify(second)
  },browserEnv);
  assert.equal(createdSecond.status,202);
  await page.evaluate(()=>sessionStorage.clear());
  await page.reload();
  await page.getByRole('textbox',{name:'Owner Gmail'}).waitFor();
  assert.equal(await owner.inputValue(),'');
  const firstRow=page.locator('#business-roster-list li').filter({hasText:'টুলস ও হার্ডওয়্যার'});
  await firstRow.getByText('Ready',{exact:false}).waitFor();
  const secondRow=page.locator('#business-roster-list li').filter({hasText:'Second Tools'});
  await secondRow.getByRole('button',{name:'Resume setup for Second Tools'}).waitFor();
  await secondRow.getByRole('button',{name:'Resume setup for Second Tools'}).click();
  await secondRow.getByText('Ready',{exact:false}).waitFor();
  assert.equal(creates,2,'restoring a second operation does not recreate the first D1');
  assert.equal(inputs.length,1,'roster Resume never submits a new Create Business operation');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first()).n,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,2);
  const secondShop=await env.SHOP_B_DB.prepare('SELECT shop_id FROM shop_identity').first();
  assert.notEqual(secondShop.shop_id,reservation.shop_id);
  assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1440);
  await page.setViewportSize({width:320,height:640});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=? WHERE revoked_at_ms IS NULL')
    .bind(Date.now()).run();
  await page.reload();
  await page.getByRole('heading',{name:'Platform sign-in'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Create business'}).isVisible(),false);
});
