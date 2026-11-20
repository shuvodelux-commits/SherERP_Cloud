import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const origin='https://platform.example.test';
const cookieName='__Host-shererp-platform-session';
const onboarding=[
  '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
  '0004_first_shop_owner','0007_owner_gmail_approvals','0011_control_center_provisioning',
];

test('hosted Control D1 directory is read-only, session-scoped and independent of local shop provisioning',async t=>{
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.vars={
    ...config.vars,PLATFORM_SHOP_DIRECTORY_ENABLED:'true',
    PLATFORM_SHOP_RESERVATION_ENABLED:'false',
    PLATFORM_LOCAL_PROVISIONING_ENABLED:'false',
  };
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  const {CONTROL_DB:db}=await worker.getEnv();
  for(const name of onboarding){
    const sql=await readFile('staging-migrations/platform-onboarding/'+name+'.sql','utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  }

  const token='1'.repeat(64);
  const now=Date.now();
  const shopId=crypto.randomUUID(),operationId=crypto.randomUUID();
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
    db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(shopId,operationId,'Test Hardware Shop','fixture-admin',now),
    db.prepare('INSERT INTO platform_shop_provisioning (shop_id,owner_email,database_marker,stage) VALUES (?,?,?,?)')
      .bind(shopId,'owner@gmail.com',crypto.randomUUID(),'reserved'),
  ]);
  const get=(path,secret=token)=>worker.fetch(origin+'/api/platform'+path,{
    headers:{Cookie:cookieName+'='+secret},
  });
  const post=(path,data)=>worker.fetch(origin+'/api/platform'+path,{
    method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookieName+'='+token},
    body:JSON.stringify(data),
  });
  const session=await get('/auth/session');
  assert.equal(session.status,200);
  const profile=await session.json();
  assert.equal(profile.shopDirectoryEnabled,true,'hosted directory feature is visible');
  assert.equal(profile.localProvisioningEnabled,undefined,'hosted mode must not expose test-only provisioning');
  const directory=await get('/shops/list');
  assert.equal(directory.status,200);
  assert.deepEqual((await directory.json()).shops,[{
    operationId,displayName:'Test Hardware Shop',shopId,ownerEmail:'owner@gmail.com',
    status:'reserved',failedStage:null,
  }]);
  assert.equal((await get('/shops/list','0'.repeat(64))).status,401);
  assert.equal((await get('/shops/setup/'+operationId)).status,404);
  assert.equal((await post('/shops/resume',{operationId})).status,404);
  assert.equal((await post('/shops',{operationId,displayName:'Unauthorized'})).status,404);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=?').bind(Date.now()).run();
  assert.equal((await get('/shops/list')).status,401);
});
