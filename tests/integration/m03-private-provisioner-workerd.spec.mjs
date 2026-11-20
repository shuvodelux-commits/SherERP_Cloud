import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {prepareVerifiedShop}
  from '../../src/provisioning/shop-schema-initializer.js';
import {applyLocalShopMigrations,ownerReadyShopMigrationPlan}
  from '../fixtures/port-p2-local-shop-migrations.mjs';

const ID='11111111-1111-4111-8111-111111111111';
const DB_ID='22222222-2222-4222-8222-222222222222';
const MARKER='33333333-3333-4333-8333-333333333333';
const shop={shopId:ID,databaseId:DB_ID,databaseMarker:MARKER};
const checkedProvider=(db,calls=[])=>({
  async verifyTarget(scope,actual){
    calls.push('verify');
    return scope.shopId===ID&&scope.databaseId===DB_ID&&
      scope.databaseMarker===MARKER&&actual===db;
  },
  async prepareShop(scope){
    calls.push('prepare');
    return applyLocalShopMigrations(db,scope,{plan:ownerReadyShopMigrationPlan});
  }
});

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='option-a-schema-check';
  config.d1_databases.push({binding:'SHOP_PROVISIONING_TEST',
    database_name:'owner-ready-new-shop-test',database_id:DB_ID});
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  const db=(await worker.getEnv()).SHOP_PROVISIONING_TEST;
  return db;
}

test('new D1 is prepared with the existing 13 reviewed migrations, exact ID and durable receipt digest',async t=>{
  const db=await fixture(t);
  const calls=[];
  const out=await prepareVerifiedShop({
    shopDb:db,scope:shop,provider:checkedProvider(db,calls)
  });
  assert.equal(out.shopId,ID);
  assert.equal(out.databaseId,DB_ID);
  assert.equal(out.marker,MARKER);
  assert.equal(out.schemaRevision,'owner-ready-v1');
  assert.match(out.receiptDigest,/^[a-f0-9]{64}$/);
  assert.deepEqual(calls,['verify','prepare','verify']);
  assert.equal(await db.prepare('SELECT count(*) FROM port_p2_shop_migrations').first('count(*)'),13);
  const repeated=await prepareVerifiedShop({
    shopDb:db,scope:shop,provider:checkedProvider(db)
  });
  assert.deepEqual(repeated,out,'resume uses the identical receipt and never reinitializes a new Shop');
  const rows=(await db.prepare('SELECT shop_id,database_id,database_marker FROM shop_identity').all()).results;
  assert.deepEqual(rows,[{shop_id:ID,database_id:DB_ID,database_marker:MARKER}]);
});

test('wrong bound DB or wrong Shop identity denies before any schema migration',async t=>{
  const db=await fixture(t);
  const calls=[];
  await assert.rejects(prepareVerifiedShop({
    shopDb:db,scope:{...shop,shopId:crypto.randomUUID()},
    provider:checkedProvider(db,calls)
  }),/SHOP_SCHEMA_NOT_READY/);
  assert.deepEqual(calls,['verify']);
  const table=await db.prepare(
    'SELECT count(*) AS n FROM sqlite_schema WHERE name=?').bind('port_p2_shop_migrations').first();
  assert.equal(table.n,0,'wrong Shop must not create tables');
});

test('partial receipts, schema drift and swapped marker never become Ready',async t=>{
  const db=await fixture(t);
  await applyLocalShopMigrations(db,shop,{plan:ownerReadyShopMigrationPlan,through:4});
  await assert.rejects(prepareVerifiedShop({
    shopDb:db,scope:shop,provider:{
      verifyTarget:async()=>true,prepareShop:async()=>undefined
    }
  }),/SHOP_SCHEMA_NOT_READY/);
  await applyLocalShopMigrations(db,shop,{plan:ownerReadyShopMigrationPlan});
  await assert.rejects(prepareVerifiedShop({
    shopDb:db,scope:{...shop,databaseMarker:crypto.randomUUID()},
    provider:{verifyTarget:async()=>true,prepareShop:async()=>undefined}
  }),/SHOP_SCHEMA_NOT_READY/);
  await db.prepare('CREATE TABLE unreviewed_schema_change (id INTEGER PRIMARY KEY)').run();
  await assert.rejects(prepareVerifiedShop({
    shopDb:db,scope:shop,provider:{verifyTarget:async()=>true,prepareShop:async()=>undefined}
  }),/SHOP_SCHEMA_NOT_READY/);
});

test('provider unavailable, bad pinned plan or malformed identity denies with no D1 writes',async t=>{
  const db=await fixture(t);
  const fake={verifyTarget:async()=>true,prepareShop:async()=>undefined};
  for(const bad of [
    {shopDb:db,scope:shop,provider:null},
    {shopDb:db,scope:shop,provider:fake,plan:[]},
    {shopDb:db,scope:{...shop,databaseId:'invalid'},provider:fake},
    {shopDb:db,scope:shop,provider:{verifyTarget:async()=>false,prepareShop:async()=>{throw Error('should not migrate');}}}
  ])await assert.rejects(prepareVerifiedShop(bad),/SHOP_SCHEMA_NOT_READY/);
  assert.equal(await db.prepare('SELECT count(*) FROM sqlite_schema WHERE name=?')
    .bind('port_p2_shop_migrations').first('count(*)'),0);
});
