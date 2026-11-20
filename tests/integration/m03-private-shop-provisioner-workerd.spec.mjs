import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {createPrivateShopProvisioner}
  from '../../src/m03-private-shop-provisioner-worker.js';

const ORIGIN='https://provisioner.internal';
const ALLOWED_ACCOUNT='0123456789abcdef0123456789abcdef';
const SECRET='s'.repeat(64);
const SESSION='1'.repeat(64);
const NOW=()=>Date.now();
const uuid=()=>crypto.randomUUID();
const body=()=>({operationId:uuid(),displayName:'Natore Tiles',
  ownerEmail:'shopowner@gmail.com'});

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='option-a-internal-provisioner';
  config.d1_databases[0].database_id=uuid();
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const db=(await worker.getEnv()).CONTROL_DB;
  for(const name of [
    '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
    '0004_first_shop_owner','0007_owner_gmail_approvals',
    '0011_control_center_provisioning','0012_hosted_shop_provisioning_journal'
  ]){
    const sql=await readFile('staging-migrations/platform-onboarding/'+name+'.sql','utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
  const ts=NOW(),setup='a'.repeat(64),challenge='c'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(setup,'b'.repeat(43),'https://accounts.google.com','fixture-admin',ts-1000,ts+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','fixture-admin',setup,ts-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(challenge,'d'.repeat(43),ts+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(challenge,ts-200),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`).bind(await hashOpaqueSessionToken(SESSION),
      challenge,ts-100,ts+60000)
  ]);
  const env={
    CONTROL_DB:db,PROVISIONER_RELEASE_ENABLED:'true',
    PROVISIONER_INTERNAL_KEY:SECRET,PROVISIONER_ALLOWED_ACCOUNT_ID:ALLOWED_ACCOUNT,
    CLOUDFLARE_API_TOKEN:'cf_dummy_for_tests_do_not_use_abcdefghijklmnopqrstuvwxyz',
    PROVISIONER_MAX_DATABASES:'10'
  };
  const sent=(app,path,payload,patch={})=>app.fetch(
    new Request((patch.origin||ORIGIN)+path,{
      method:patch.method||'POST',
      headers:{
        'Content-Type':'application/json',
        'x-provisioner-key':patch.key===undefined?SECRET:patch.key,
        'x-platform-admin-session':patch.token===undefined?SESSION:patch.token,
        ...(patch.headers||{})
      },
      body:JSON.stringify(payload)
    }),{...env,...patch.env});
  return {env,db,sent};
}

test('private provisioner denies public origin, wrong secret and unauthorized MFA before D1 calls',async t=>{
  const {db,sent}=await fixture(t);
  let calls=0;
  const app=createPrivateShopProvisioner({providerFactory:()=>{
    calls++;return {inspectAccount:async()=>{throw Error('not allowed');}};
  }});
  const shop=body();
  assert.equal((await sent(app,'/internal/shops/reserve',shop,{origin:'https://public.example.com'})).status,404);
  assert.equal((await sent(app,'/internal/shops/reserve',shop,{key:'wrong-secret'})).status,403);
  assert.equal((await sent(app,'/internal/shops/reserve',shop,{token:'invalid-owner-token'})).status,401);
  assert.equal((await sent(app,'/internal/shops/reserve',shop,{env:{PROVISIONER_RELEASE_ENABLED:'false'}})).status,404);
  assert.equal((await sent(app,'/internal/shops/reserve',{...shop,databaseId:uuid()})).status,400);
  assert.equal((await sent(app,'/internal/shops/delete',shop)).status,404);
  assert.equal(calls,0);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first('n'),0);
});

test('approved internal Admin can reserve, resume and read its immutable creation journal',async t=>{
  const {db,sent}=await fixture(t);
  let creates=0;
  const receipt='66666666-6666-4666-8666-666666666666';
  const app=createPrivateShopProvisioner({providerFactory:()=>({
    inspectAccount:async()=>({accountId:ALLOWED_ACCOUNT,usedDatabases:1,maximumDatabases:10}),
    async createDatabase(action){creates++;
      return {...action,id:receipt,evidenceRef:'cf-d1:fixture'};
    },
    findCreation:async()=>null,
  })});
  const shop=body();
  const first=await sent(app,'/internal/shops/reserve',shop);
  assert.equal(first.status,202);
  const created=await first.json();
  assert.equal(created.state,'reserved');
  assert.equal(created.databaseId,undefined);
  assert.equal((await sent(app,'/internal/shops/reserve',shop)).status,200);
  assert.equal((await sent(app,'/internal/shops/reserve',{...shop,ownerEmail:'other@gmail.com'})).status,409);
  const advance=await sent(app,'/internal/shops/advance',{operationId:shop.operationId});
  assert.equal(advance.status,200);
  assert.equal((await advance.json()).state,'database-created');
  assert.equal(creates,1);
  assert.equal((await sent(app,'/internal/shops/advance',{operationId:shop.operationId})).status,200);
  assert.equal(creates,1);
  const status=await sent(app,'/internal/shops/status',{operationId:shop.operationId});
  assert.equal((await status.json()).state,'database-created');
  assert.equal(await db.prepare('SELECT count(*) FROM platform_owner_gmail_approvals').first('count(*)'),0);
});

test('revoked MFA after reservation cannot advance and public Worker has no route to create',async t=>{
  const {db,sent}=await fixture(t);
  let creates=0;
  const app=createPrivateShopProvisioner({providerFactory:()=>({
    inspectAccount:async()=>({accountId:ALLOWED_ACCOUNT,usedDatabases:1,maximumDatabases:10}),
    createDatabase:async()=>{creates++;throw Error('never');},
    findCreation:async()=>null,
  })});
  const shop=body();
  assert.equal((await sent(app,'/internal/shops/reserve',shop)).status,202);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=?')
    .bind(NOW()).run();
  assert.equal((await sent(app,'/internal/shops/advance',{operationId:shop.operationId})).status,401);
  assert.equal(creates,0);
  assert.equal((await sent(app,'/internal/shops/status',{operationId:shop.operationId})).status,401);
});
