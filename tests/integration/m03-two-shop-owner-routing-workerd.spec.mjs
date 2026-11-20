import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {applyLocalShopMigrations,ownerReadyShopMigrationPlan}
  from '../fixtures/port-p2-local-shop-migrations.mjs';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {resolveAuthorizedOwnerShop} from '../../src/auth/m03-owner-tenant-router.js';

const account='0123456789abcdef0123456789abcdef';
const sha='a'.repeat(40);
const uuid=()=>crypto.randomUUID();
const issuer='https://accounts.google.com';
const sessionA='1'.repeat(64);
const sessionB='2'.repeat(64);
const sql=async(db,path)=>{
  const source=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(source).map(s=>db.prepare(s)));
};

async function fixture(t){
  const shopA={shopId:uuid(),databaseId:uuid(),databaseMarker:uuid(),
    binding:'PLATFORM_PILOT_DB',email:'shopa@gmail.com'};
  const shopB={shopId:uuid(),databaseId:uuid(),databaseMarker:uuid(),
    email:'shopb@gmail.com'};
  shopB.binding='SHOP_'+shopB.shopId.replaceAll('-','').toUpperCase();
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='option-a-owner-router-fixture';
  config.d1_databases[0].database_id=uuid();
  config.d1_databases.push(...[shopA,shopB].map(s=>({
    binding:s.binding,database_name:'fixture-shop-'+s.shopId,database_id:s.databaseId
  })));
  const server=createTestHarness({workers:[{config}]});
  t.after(()=>server.close());
  await server.listen();
  const worker=server.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv(),control=env.CONTROL_DB;
  for(const migration of ['0001_shop_reservations','0002_shop_bindings',
    '0003_owner_invitations','0004_first_shop_owner','0005_owner_sessions',
    '0006_owner_login_challenges','0007_owner_gmail_approvals',
    '0011_control_center_provisioning']){
    await sql(control,'staging-migrations/platform-onboarding/'+migration+'.sql');
  }
  const now=Date.now(),receipts={};
  for(const [i,shop] of [shopA,shopB].entries()){
    await applyLocalShopMigrations(env[shop.binding],shop,{
      plan:ownerReadyShopMigrationPlan
    });
    await env[shop.binding].prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind('shared-product','price-'+(i===0?'100':'250')).run();
    const rows=(await env[shop.binding].prepare(
      'SELECT position,name,checksum FROM port_p2_shop_migrations ORDER BY position').all()).results;
    receipts[shop.binding]=createHash('sha256').update(JSON.stringify(
      rows.map(row=>[row.position,row.name,row.checksum])
    )).digest('hex');
    const invitation=(i===0?'a':'b').repeat(64);
    await control.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(shop.shopId,uuid(),'Hardware '+i,'fixture-admin',now).run();
    await control.prepare(`INSERT INTO platform_shop_provisioning
      (shop_id,owner_email,database_marker,stage,database_id,binding_key,allocation_evidence)
      VALUES (?,?,?,'allocated',?,?,?)`)
      .bind(shop.shopId,shop.email,shop.databaseMarker,shop.databaseId,
        shop.binding,'reviewed-attachment').run();
    await control.prepare(`UPDATE platform_shop_provisioning SET stage='ready'
      WHERE shop_id=?`).bind(shop.shopId).run();
    await control.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)')
      .bind(invitation,shop.shopId,issuer,'fixture-owner-'+i,'fixture-admin',now,now+60000).run();
    await control.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)')
      .bind(shop.shopId,invitation,issuer,'fixture-owner-'+i,now).run();
    await control.prepare(`INSERT INTO platform_shop_owner_sessions
      (shop_id,token_hash,issued_at_ms) VALUES (?,?,?)`)
      .bind(shop.shopId,await hashOpaqueSessionToken(i===0?sessionA:sessionB),now).run();
  }
  const versionId=uuid();
  const release={
    accountId:account,workerName:'shererp',versionId,codeSha:sha,
    bindings:[{binding:'CONTROL_DB',databaseId:config.d1_databases[0].database_id},
      ...[shopA,shopB].map(s=>({binding:s.binding,databaseId:s.databaseId}))],
    shops:[{shopId:shopA.shopId,binding:shopA.binding,
      databaseId:shopA.databaseId,databaseMarker:shopA.databaseMarker},
      {shopId:shopB.shopId,binding:shopB.binding,databaseId:shopB.databaseId,
        databaseMarker:shopB.databaseMarker,schemaRevision:'owner-ready-v1',
        receiptDigest:receipts[shopB.binding]}]
  };
  const routed={
    ...env,OWNER_MULTI_SHOP_ROUTING_ENABLED:'true',
    OWNER_RUNTIME_ACCOUNT_ID:account,OWNER_RUNTIME_CODE_SHA:sha,
    OWNER_RUNTIME_CONTROL_DB_ID:config.d1_databases[0].database_id,
    OWNER_RUNTIME_VERSION_ID:versionId,OWNER_ACTIVE_RELEASE_ROSTER:release
  };
  return {env:routed,control,shopA,shopB,release,receipts};
}

test('two current Owner sessions read the same key from separate verified Shop D1s',async t=>{
  const {env,shopA,shopB}=await fixture(t);
  for(const [session,shop,price] of [[sessionA,shopA,'price-100'],
    [sessionB,shopB,'price-250']]){
    const scope=await resolveAuthorizedOwnerShop(env,session);
    assert.equal(scope.status,'ready');
    assert.equal(scope.shopId,shop.shopId);
    assert.equal(scope.schemaRevision,'owner-ready-v1');
    const value=await scope.shopDb.prepare('SELECT value FROM settings WHERE key=?')
      .bind('shared-product').first('value');
    assert.equal(value,price);
  }
  assert.equal((await resolveAuthorizedOwnerShop(env,'not-a-token')).status,'denied');
});

test('missing, stale, changed or invalid Worker publication and wrong physical D1 fail closed',async t=>{
  const {env,shopA,shopB,release}=await fixture(t);
  for(const patch of [
    {OWNER_MULTI_SHOP_ROUTING_ENABLED:'false'},
    {OWNER_RUNTIME_CODE_SHA:'b'.repeat(40)},
    {OWNER_RUNTIME_VERSION_ID:uuid()},
    {OWNER_RUNTIME_ACCOUNT_ID:'f'.repeat(32)},
    {OWNER_ACTIVE_RELEASE_ROSTER:{...release,shops:release.shops.slice(0,1),
      bindings:release.bindings.slice(0,2)}},
    {[shopB.binding]:env[shopA.binding]},
    {[shopB.binding]:undefined}
  ]){
    assert.equal((await resolveAuthorizedOwnerShop({...env,...patch},sessionB)).status,
      'unavailable');
  }
  const wrong={...release,shops:[
    release.shops[0],{...release.shops[1],databaseMarker:shopA.databaseMarker}
  ]};
  assert.equal((await resolveAuthorizedOwnerShop({
    ...env,OWNER_ACTIVE_RELEASE_ROSTER:wrong
  },sessionB)).status,'unavailable');
});

test('disabled owner access, not-Ready Shop and unexpected schema revision deny each request',async t=>{
  const {env,control,shopA,shopB}=await fixture(t);
  await control.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
    .bind(shopA.shopId).run();
  assert.equal((await resolveAuthorizedOwnerShop(env,sessionA)).status,'denied');
  assert.equal((await resolveAuthorizedOwnerShop(env,sessionB)).status,'ready');
  await env[shopB.binding].prepare('CREATE TABLE unreviewed_schema(id INTEGER)').run();
  assert.equal((await resolveAuthorizedOwnerShop(env,sessionB)).status,'unavailable');
});

test('revocation after Shop D1 read but before current Control D1 check fails closed',async t=>{
  const {env,control,shopA}=await fixture(t);
  const original=env[shopA.binding];let changed=false;
  const race={
    prepare:original.prepare.bind(original),
    async batch(statements){
      const outcome=await original.batch(statements);
      if(!changed){
        changed=true;
        await control.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
          .bind(shopA.shopId).run();
      }
      return outcome;
    }
  };
  const result=await resolveAuthorizedOwnerShop({...env,[shopA.binding]:race},sessionA);
  assert.equal(result.status,'denied');
  assert.equal(changed,true);
});
