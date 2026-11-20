/** M03 Run 4: real Chromium with two disposable Shop D1s, private Hono and SQL-current support. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import platform from '../src/m03-private-platform-auth-worker.js';
import {hashOpaqueSessionToken} from '../src/auth/session-token.js';
import {LOCAL_SUPPORT_READ_DDL} from '../src/modules/m03-local-support-read-grants.js';

const origin='https://platform.example.test';
const cookieName='__Host-shererp-platform-session';
const adminToken='1'.repeat(64);
const reason='Check catalog setup safely before Owner onboarding';
async function fixture(t){
  const cfg=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SHOP_A_DB','SHOP_B_DB'].map((binding,i)=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),databaseMarker:crypto.randomUUID(),
    name:i===0?'অঙ্কন হার্ডওয়্যার':'Second Tools',
    ownerEmail:i===0?'ankon.owner@gmail.com':'second.owner@gmail.com',
    status:i===0?'ready':'reserved',
  }));
  cfg.d1_databases.push(...shops.map(s=>({
    binding:s.binding,database_id:s.databaseId,database_name:s.binding.toLowerCase(),remote:false,
  })));
  const harness=createTestHarness({workers:[{config:cfg}]});
  let browser;
  t.after(async()=>{await browser?.close();await harness.close();});
  await harness.listen();
  const worker=harness.getWorker(cfg.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv();
  const db=env.CONTROL_DB;
  async function apply(target,path){
    const sql=await readFile(path,'utf8');
    await target.batch(unstable_splitSqlQuery(sql).map(stmt=>target.prepare(stmt)));
  }
  for(const m of ['0001_shop_reservations','0002_shop_bindings','0011_control_center_provisioning'])
    await apply(db,'staging-migrations/platform-onboarding/'+m+'.sql');
  const now=Date.now();
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),'https://accounts.google.com','fixture-admin',now-1000,now+599000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','fixture-admin','a'.repeat(64),now-800),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind('c'.repeat(64),now-300),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?)`)
      .bind(await hashOpaqueSessionToken(adminToken),'c'.repeat(64),now-200,now+60000),
  ]);
  for(const [i,s] of shops.entries()){
    const shopDb=env[s.binding];
    await apply(shopDb,'staging-migrations/shop-identity/0001_shop_identity.sql');
    await shopDb.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker).run();
    await apply(shopDb,'migrations/0001_core_catalog.sql');
    for(let n=0;n<i+1;n++){
      await shopDb.prepare('INSERT INTO product_categories(category_id,category_name) VALUES (?,?)')
        .bind('CAT-'+n,'Private category '+n).run();
    }
    for(let n=0;n<i+2;n++){
      await shopDb.prepare('INSERT INTO product_units(unit_id,unit_name) VALUES (?,?)')
        .bind('UNIT-'+n,'Private unit '+n).run();
    }
    await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(s.shopId,crypto.randomUUID(),s.name,'fixture-admin',now-200+i).run();
    await db.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker,'fixture-admin',now-100).run();
    await db.prepare(`INSERT INTO platform_shop_provisioning
      (shop_id,owner_email,database_marker,stage,database_id,binding_key,allocation_evidence)
      VALUES (?,?,?,?,?,?,?)`)
      .bind(s.shopId,s.ownerEmail,s.databaseMarker,s.status,
        s.status==='ready'?s.databaseId:null,s.status==='ready'?s.binding:null,
        s.status==='ready'?'fixture-provisioning':null).run();
  }
  for(const sql of LOCAL_SUPPORT_READ_DDL)await db.prepare(sql).run();
  const files={};
  for(const name of ['index.html','platform-auth.css','platform-auth.js'])
    files['/'+name]=await readFile('frontend/platform-auth/'+name,'utf8');
  const baseEnv={...env,platformPageFiles:files,
    PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,
    PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
    PLATFORM_INGRESS:{async limit(){return {success:true};}},
    PLATFORM_SHOP_RESERVATION_ENABLED:'true',PLATFORM_LOCAL_PROVISIONING_ENABLED:'true',
    PLATFORM_LOCAL_SHOP_INVENTORY:shops.map(s=>({binding:s.binding,id:s.databaseId})),
  };
  const enabledEnv={...baseEnv,PLATFORM_SUPPORT_LOCAL_GATE:{
    testOnly:true,supportOrigin:origin,
    resolveShops(current){
      return shops.map(s=>({
        shopId:s.shopId,databaseId:s.databaseId,databaseMarker:s.databaseMarker,
        binding:s.binding,shopDb:current[s.binding],
      }));
    },
  }};
  async function call(path,body,chosen=enabledEnv,opts={}){
    const method=opts.method||'POST';
    const res=await platform.request(origin+path,{method,
      headers:{origin:opts.origin||origin,'Content-Type':'application/json',
        cookie:cookieName+'='+(opts.token||adminToken)},
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),
    },chosen);
    const responseText=await res.text();
    let responseBody;
    try{responseBody=JSON.parse(responseText);}catch{responseBody={error:'Not found'};}
    return {status:res.status,body:responseBody};
  }
  browser=await chromium.launch({headless:true});
  async function pageFor(chosen=enabledEnv){
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.context().addCookies([{
      name:cookieName,value:adminToken,url:origin+'/',secure:true,httpOnly:true,sameSite:'Strict',
    }]);
    await page.route(origin+'/**',async route=>{
      const req=route.request();
      const headers={...req.headers()};
      if(req.method()==='POST')headers.origin=origin;
      const response=await platform.request(req.url(),{
        method:req.method(),headers,
        ...(req.method()==='POST'?{body:req.postData()}:{}),
      },chosen);
      await route.fulfill({status:response.status,headers:{'Cache-Control':'no-store'},
        contentType:response.headers.get('Content-Type')||'application/json',
        body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(origin);
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    return page;
  }
  const audit=async()=>(await db.prepare('SELECT event_type,shop_id FROM m03_local_support_events ORDER BY rowid').all()).results;
  return {env,db,shops,baseEnv,enabledEnv,call,pageFor,audit};
}

test('default deployed-style Worker leaves private Support Mode completely unavailable',async t=>{
  const x=await fixture(t);
  const session=await x.call('/api/platform/auth/session',null,x.baseEnv,{method:'GET'});
  assert.equal(session.status,200);
  assert.equal(Object.hasOwn(session.body,'supportDiagnosticsEnabled'),false);
  assert.equal((await x.call('/api/platform/support/start',{
    shopId:x.shops[0].shopId,operationId:crypto.randomUUID(),reason,
  },x.baseEnv)).status,404);
  const stringOnly={...x.baseEnv,PLATFORM_SUPPORT_LOCAL_GATE:'true',PLATFORM_SUPPORT_ENABLED:'true'};
  assert.equal((await x.call('/api/platform/support/start',{
    shopId:x.shops[0].shopId,operationId:crypto.randomUUID(),reason,
  },stringOnly)).status,404);
  const page=await x.pageFor(x.baseEnv);
  await page.locator('#business-roster-list li').first().waitFor();
  assert.equal(await page.locator('#support-mode').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:/Inspect setup for/}).count(),0);
  assert.deepEqual(await x.audit(),[]);
});

test('trusted local Worker exposes read-only Support Mode, two-Shop denial and revocation',async t=>{
  const x=await fixture(t);
  const session=await x.call('/api/platform/auth/session',null,x.enabledEnv,{method:'GET'});
  assert.equal(session.body.supportDiagnosticsEnabled,true);
  const page=await x.pageFor(x.enabledEnv);
  const ready=page.locator('#business-roster-list li').filter({hasText:x.shops[0].name});
  const pending=page.locator('#business-roster-list li').filter({hasText:x.shops[1].name});
  await ready.getByRole('button',{name:'Inspect setup for '+x.shops[0].name}).waitFor();
  assert.equal(await pending.getByRole('button',{name:/Inspect setup/}).count(),0);
  await ready.getByRole('button',{name:'Inspect setup for '+x.shops[0].name}).click();
  await page.getByRole('heading',{name:'Read-only Support Mode'}).waitFor();
  await page.getByLabel('Reason for read-only support').fill(reason);
  await page.getByRole('button',{name:'Start read-only support'}).click();
  await page.getByText('Categories: 1').waitFor();
  await page.getByText('Units: 2').waitFor();
  const audit=await x.audit();
  assert.deepEqual(audit.map(y=>y.event_type),['START','READ']);
  assert.equal(audit[0].shop_id,x.shops[0].shopId);
  const bad=await x.call('/api/platform/support/diagnostics',{
    shopId:x.shops[1].shopId,eventId:crypto.randomUUID(),supportToken:'f'.repeat(64),
  });
  assert.equal(bad.status,403);
  assert.equal((await x.call('/api/platform/support/start',{
    shopId:x.shops[0].shopId,operationId:crypto.randomUUID(),reason,
  },x.enabledEnv,{origin:'https://other.example.test'})).status,403);
  await page.getByRole('button',{name:'End support'}).click();
  await page.getByText('Support session ended.').waitFor();
  assert.deepEqual((await x.audit()).map(y=>y.event_type),['START','READ','END']);
  await page.getByRole('button',{name:'Sign out'}).click();
  await page.getByRole('heading',{name:'Platform sign-in'}).waitFor();
  assert.equal(await page.locator('#support-mode').isVisible(),false);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).length),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
});

test('session revocation fences local support route and UI never pretends support is operational',async t=>{
  const x=await fixture(t);
  const page=await x.pageFor(x.enabledEnv);
  const ready=page.locator('#business-roster-list li').filter({hasText:x.shops[0].name});
  await ready.getByRole('button',{name:'Inspect setup for '+x.shops[0].name}).click();
  await x.db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=? WHERE revoked_at_ms IS NULL')
    .bind(Date.now()).run();
  await page.getByLabel('Reason for read-only support').fill(reason);
  await page.getByRole('button',{name:'Start read-only support'}).click();
  await page.getByText('Sign in again to use Support Mode.').waitFor();
  assert.deepEqual(await x.audit(),[]);
});
