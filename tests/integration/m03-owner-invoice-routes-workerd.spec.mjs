import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestHarness} from 'wrangler';
import {buildOwnerFrontend} from '../../scripts/build-owner-frontend.mjs';
import ownerWorker from '../../src/m03-owner-redemption-worker.js';
import {issueOwnerSession,revokeOwnerSession}
  from '../../src/auth/platform-owner-sessions.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {defaultInvoiceProfile,INVOICE_PROFILE_KEY}
  from '../../src/modules/m09-owner-invoice-profile.js';

const ORIGIN='https://owner.example.test';
const SHOP_ID='22222222-2222-4222-8222-222222222222';
const MARKER='03b2c8f6-ea89-44a7-9032-3e4f17c8c94e';
const HEADERS={'Content-Type':'application/json',Origin:ORIGIN};
const COOKIE_NAME='__Host-shererp-owner-session=';

async function migration(db,path){
  const sql=await readFile(path,'utf8');
  const statements=sql.split('-- next statement').map(s=>s.trim()).filter(Boolean);
  const result=await db.batch(statements.map(q=>db.prepare(q)));
  assert.ok(result.every(x=>x.success),'fixture migration must fully apply');
}

test('private Owner Invoice Studio read/save is wired through live Control D1 session, exact Shop and SQL lease',async t=>{
  await buildOwnerFrontend({outputDir:'dist-owner'});
  const cfg=JSON.parse(await readFile('wrangler.m03-owner-auth-staging.jsonc','utf8'));
  const vars={
    OWNER_AUTH_ORIGIN:ORIGIN,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
    PLATFORM_PILOT_SHOP_ID:SHOP_ID,PLATFORM_PILOT_D1_ID:cfg.d1_databases[1].database_id,
    PLATFORM_PILOT_MARKER:MARKER,OWNER_LOGIN_ENABLED:'true',
    OWNER_WRITE_GRANTS_ENABLED:'true',OWNER_INVOICE_PROFILE_ENABLED:'true',
    OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true'
  };
  const harness=createTestHarness({workers:[{
    configPath:'./wrangler.m03-owner-auth-staging.jsonc',vars
  }]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(cfg.name);
  const env=await worker.getEnv();
  for(const name of [
    '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
    '0004_first_shop_owner','0005_owner_sessions','0006_owner_login_challenges'
  ])await migration(env.CONTROL_DB,'staging-migrations/platform-onboarding/'+name+'.sql');
  await migration(env.PLATFORM_PILOT_DB,'staging-migrations/shop-identity/0001_shop_identity.sql');
  const base=await readFile('migrations/0001_core_catalog.sql','utf8');
  const first=base.indexOf('CREATE TABLE settings (');
  const next=base.indexOf('CREATE TABLE product_categories (');
  assert.ok(first>=0&&next>first);
  await env.PLATFORM_PILOT_DB.prepare(base.slice(first,next).trim().replace(/;\s*$/,'')).run();
  await env.CONTROL_DB.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
    .bind(SHOP_ID,'a2ad79ce-2f78-470d-80c7-a8fe8de98480','Invoice Shop','fixture-admin',Date.now()).run();
  await env.CONTROL_DB.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
    .bind(SHOP_ID,cfg.d1_databases[1].database_id,MARKER,'fixture-admin',Date.now()).run();
  await env.PLATFORM_PILOT_DB.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
    .bind(SHOP_ID,cfg.d1_databases[1].database_id,MARKER).run();
  await env.CONTROL_DB.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)')
    .bind('c'.repeat(64),SHOP_ID,'https://accounts.google.com','invoice-owner','fixture-admin',Date.now(),Date.now()+600000).run();
  await env.CONTROL_DB.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)')
    .bind(SHOP_ID,'c'.repeat(64),'https://accounts.google.com','invoice-owner',Date.now()).run();
  // The session is real Control D1. This fixture installs the corresponding
  // active Shop lease itself; full grant publisher coverage is a separate M03 test.
  const token=await issueOwnerSession({...env,OWNER_WRITE_GRANTS_ENABLED:'false'},
    {issuer:'https://accounts.google.com',subject:'invoice-owner'});
  assert.match(token,/^[0-9a-f]{64}$/);
  await migration(env.PLATFORM_PILOT_DB,'staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql');
  await migration(env.PLATFORM_PILOT_DB,'staging-migrations/shop-owner-write/0004_owner_write_lease.sql');
  await env.PLATFORM_PILOT_DB.prepare(
    'UPDATE shop_owner_write_grant SET generation=1,enabled=1,token_hash=?,expires_at_ms=? WHERE singleton=1'
  ).bind(await hashOpaqueSessionToken(token),Date.now()+300000).run();
  const cookie=COOKIE_NAME+token;
  const get=(extra={})=>worker.fetch(ORIGIN+'/api/owner/invoice-profile',{
    headers:{Cookie:cookie,...extra}
  });
  const post=(payload,extra={})=>worker.fetch(ORIGIN+'/api/owner/invoice-profile',{
    method:'POST',headers:{...HEADERS,Cookie:cookie,...extra},body:JSON.stringify(payload)
  });
  const prior=await get();
  assert.equal(prior.status,200);
  assert.equal(prior.headers.get('Cache-Control'),'no-store');
  const original=(await prior.json()).data;
  assert.deepEqual(original,{shopId:SHOP_ID,profile:defaultInvoiceProfile(),revision:null});
  assert.equal(await env.PLATFORM_PILOT_DB.prepare('SELECT value FROM settings WHERE key=?')
    .bind(INVOICE_PROFILE_KEY).first(),null);
  const saved={...original.profile,template:'Classic',paper:'58 mm',
    checks:{...original.profile.checks,signature:false}};
  assert.equal((await post({expectedRevision:null,profile:saved},{Origin:'https://evil.example.test'})).status,403);
  assert.equal((await post({expectedRevision:null,profile:saved,shopId:SHOP_ID})).status,400);
  assert.equal((await post({expectedRevision:null,profile:{...saved,template:'Modern'}})).status,400);
  const response=await post({expectedRevision:null,profile:saved});
  assert.equal(response.status,200);
  const current=(await response.json()).data;
  assert.equal(current.shopId,SHOP_ID);
  assert.deepEqual(current.profile,saved);
  assert.equal(current.revision,JSON.stringify(saved));
  const stored=await env.PLATFORM_PILOT_DB.prepare('SELECT value FROM settings WHERE key=?')
    .bind(INVOICE_PROFILE_KEY).first();
  assert.equal(stored.value,current.revision);
  assert.equal((await post({expectedRevision:null,profile:saved})).status,409);
  assert.deepEqual((await (await get()).json()).data,current);
  assert.equal((await worker.fetch(ORIGIN+'/api/owner/invoice-profile',{method:'POST',
    headers:HEADERS,body:JSON.stringify({expectedRevision:current.revision,profile:saved})})).status,403);
  const disabledEnv={...env,...vars,OWNER_INVOICE_PROFILE_ENABLED:'false'};
  assert.equal((await ownerWorker.request(ORIGIN+'/api/owner/invoice-profile',{
    headers:{Cookie:cookie}
  },disabledEnv)).status,404);
  assert.equal((await ownerWorker.request(ORIGIN+'/api/owner/invoice-profile',{
    headers:{Cookie:cookie}
  },{...env,...vars,PLATFORM_PILOT_SHOP_ID:'11111111-1111-4111-8111-111111111111'})).status,403);
  await env.PLATFORM_PILOT_DB.prepare('UPDATE shop_owner_write_grant SET enabled=0 WHERE singleton=1').run();
  assert.equal((await get()).status,403);
  assert.equal((await post({expectedRevision:current.revision,profile:original.profile})).status,409);
  assert.equal((await env.PLATFORM_PILOT_DB.prepare('SELECT value FROM settings WHERE key=?')
    .bind(INVOICE_PROFILE_KEY).first()).value,current.revision);
  assert.equal(await revokeOwnerSession({...env,OWNER_WRITE_GRANTS_ENABLED:'false'},token),true);
  assert.equal((await get()).status,403);
});
