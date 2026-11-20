import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {composeCandidateBindingRoster,verifyCompleteBindingRoster}
  from '../../src/provisioning/verified-binding-roster.js';

const account='0123456789abcdef0123456789abcdef';
const controlId='33333333-3333-4333-8333-333333333333';
const pilotShop='11111111-1111-4111-8111-111111111111';
const nextShop='22222222-2222-4222-8222-222222222222';
const pilotDb='44444444-4444-4444-8444-444444444444';
const nextDb='55555555-5555-4555-8555-555555555555';
const pilotMarker='66666666-6666-4666-8666-666666666666';
const nextMarker='77777777-7777-4777-8777-777777777777';
const binding='SHOP_22222222222242228222222222222222';
const codeSha='a'.repeat(40);

test('two real Workerd D1s remain distinct after a verified append-only Owner binding release',async t=>{
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='option-a-release-d1-proof';
  config.d1_databases[0].database_id=controlId;
  config.d1_databases.push(
    {binding:'PLATFORM_PILOT_DB',database_name:'pilot-for-test',database_id:pilotDb},
    {binding,database_name:'next-for-test',database_id:nextDb}
  );
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  const env=await worker.getEnv();
  const identitySql=await readFile(
    'staging-migrations/shop-identity/0001_shop_identity.sql','utf8');
  for(const [db,shop,dbId,marker,price] of [
    [env.PLATFORM_PILOT_DB,pilotShop,pilotDb,pilotMarker,100],
    [env[binding],nextShop,nextDb,nextMarker,250]
  ]){
    await db.batch(unstable_splitSqlQuery(identitySql).map(sql=>db.prepare(sql)));
    await db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(shop,dbId,marker).run();
    await db.prepare('CREATE TABLE local_price(product_id TEXT PRIMARY KEY,price INTEGER NOT NULL)').run();
    await db.prepare('INSERT INTO local_price(product_id,price) VALUES (?,?)')
      .bind('identical-product',price).run();
  }
  const active={
    accountId:account,workerName:'shererp',
    versionId:'88888888-8888-4888-8888-888888888888',codeSha,
    bindings:[
      {binding:'CONTROL_DB',databaseId:controlId},
      {binding:'PLATFORM_PILOT_DB',databaseId:pilotDb}
    ],
    shops:[{shopId:pilotShop,binding:'PLATFORM_PILOT_DB',
      databaseId:pilotDb,databaseMarker:pilotMarker}]
  };
  const candidate=composeCandidateBindingRoster({
    activeRelease:active,
    placement:{accountId:account,shopId:nextShop,databaseId:nextDb,
      databaseMarker:nextMarker,receiptDigest:'c'.repeat(64),
      schemaRevision:'owner-ready-v1',verifiedIdentity:true,verifiedMigrations:13},
    approvedCodeSha:codeSha
  });
  assert.equal(verifyCompleteBindingRoster(active,candidate),true);
  assert.equal(candidate.bindings[0].databaseId,controlId);
  assert.equal(candidate.bindings[1].databaseId,pilotDb);
  assert.equal(candidate.bindings[2].databaseId,nextDb);
  for(const shop of candidate.shops){
    const actual=env[shop.binding];
    assert.ok(actual?.prepare,'each published Shop binding must physically exist');
    const id=await actual.prepare('SELECT * FROM shop_identity WHERE singleton=1').first();
    assert.equal(id.shop_id,shop.shopId);
    assert.equal(id.database_id,shop.databaseId);
    assert.equal(id.database_marker,shop.databaseMarker);
  }
  assert.equal(await env.PLATFORM_PILOT_DB.prepare(
    'SELECT price FROM local_price WHERE product_id=?').bind('identical-product').first('price'),100);
  assert.equal(await env[binding].prepare(
    'SELECT price FROM local_price WHERE product_id=?').bind('identical-product').first('price'),250);
  await assert.rejects(env[binding].prepare('UPDATE shop_identity SET shop_id=? WHERE singleton=1')
    .bind(pilotShop).run(),/immutable/);
  assert.equal(await env.PLATFORM_PILOT_DB.prepare(
    'SELECT shop_id FROM shop_identity').first('shop_id'),pilotShop);
});
