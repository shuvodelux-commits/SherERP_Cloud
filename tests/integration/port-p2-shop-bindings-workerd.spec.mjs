import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createTestHarness, unstable_splitSqlQuery } from 'wrangler';
import { issueOwnerSession } from '../../src/auth/platform-owner-sessions.js';
import { resolvePortP2OwnerShop } from '../../src/auth/port-p2-owner-shop-binding.js';

import {
  applyLocalShopMigrations, loadLocalShopMigrations, shopMigrationPlan
} from '../fixtures/port-p2-local-shop-migrations.mjs';

const sentinelId = 'PORT-P2-SENTINEL';

const shops = ['A', 'B'].map((name, index) => ({
  name, binding: `SHOP_${name}_DB`,
  shopId: `00000000-0000-4000-8000-00000000010${index}`,
  databaseId: `00000000-0000-4000-8000-00000000020${index}`,
  databaseMarker: `00000000-0000-4000-8000-00000000030${index}`,
  minimumGeneration: index + 1
}));

const fixture = resolve('tests/fixtures/port-p2-shop-binding-worker.mjs');
const controlMigrations = [
  '0001_shop_reservations', '0002_shop_bindings', '0003_owner_invitations',
  '0004_first_shop_owner', '0005_owner_sessions', '0006_owner_login_challenges'
];

async function applySql(db, path) {
  const sql = await readFile(path, 'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
}

async function seedOwner(control, db, shop) {
  const { shopId, databaseId, databaseMarker, name } = shop;
  const invite = (name === 'A' ? 'a' : 'b').repeat(64);
  const subject = `fixture-owner-${name}`;
  const issuer = 'https://accounts.google.com';
  const now = Date.now();
  await control.batch([
    control.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(shopId, crypto.randomUUID(), `Shop ${name}`, 'fixture-admin', now),
    control.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(shopId, databaseId, databaseMarker, 'fixture-admin', now),
    control.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)')
      .bind(invite, shopId, issuer, subject, 'fixture-admin', now, now + 60000),
    control.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)')
      .bind(shopId, invite, issuer, subject, now),
  ]);
  const token = await issueOwnerSession({
    CONTROL_DB: control, PLATFORM_PILOT_DB: db, PLATFORM_PILOT_SHOP_ID: shopId,
    PLATFORM_PILOT_D1_ID: databaseId, PLATFORM_PILOT_MARKER: databaseMarker
  }, { issuer, subject });
  assert.equal(typeof token, 'string', 'Control D1 issued an actual Owner session');
  return token;
}

async function startProof(t, { through } = {}) {
  const controlId = crypto.randomUUID();
  const makeConfig = (name, placement, databaseOrder, generation = 2) => ({
    config: {
      name: `port-p2-${name}`, main: fixture, compatibility_date: '2026-11-14',
      workers_dev: false, preview_urls: false, vars: {
        PORT_P2_FIXTURE: 'true', PORT_P2_SENTINEL_ID: sentinelId, PORT_P2_ROSTER: { generation, shops: placement, migrations: shopMigrationPlan }
      },
      d1_databases: [
        { binding: 'CONTROL_DB', database_name: 'port-p2-control', database_id: controlId, remote: false },
        ...databaseOrder.map((shop, index) => ({
          binding: shops[index].binding, database_name: `port-p2-shop-${shop.name.toLowerCase()}`,
          database_id: shop.databaseId, remote: false
        }))
      ]
    }
  });
  const server = createTestHarness({ workers: [
    makeConfig('active', shops, shops),
    makeConfig('swapped', shops, [...shops].reverse()),
    makeConfig('previous', [shops[0]], [shops[0]], 1)
  ] });
  t.after(() => server.close());
  await server.listen();
  const active = server.getWorker('port-p2-active');
  const swapped = server.getWorker('port-p2-swapped');
  const previous = server.getWorker('port-p2-previous');
  const env = await active.getEnv();
  const control = env.CONTROL_DB;
  for (const name of controlMigrations) {
    await applySql(control, `staging-migrations/platform-onboarding/${name}.sql`);
  }
  await control.prepare(`CREATE TABLE port_p2_shop_placements (
    shop_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_shop_bindings(shop_id),
    binding_key TEXT NOT NULL UNIQUE,
    minimum_generation INTEGER NOT NULL CHECK(minimum_generation>0),
    ready INTEGER NOT NULL CHECK(ready IN (0,1))
  ) STRICT`).run();
  const tokens = [];
  for (const shop of shops) {
    const db = env[shop.binding];
    await applyLocalShopMigrations(db, shop, { through });
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind(sentinelId, `Value from Shop ${shop.name}`).run();
    tokens.push(await seedOwner(control, db, shop));
    await control.prepare('INSERT INTO port_p2_shop_placements VALUES (?,?,?,?)')
      .bind(shop.shopId, shop.binding, shop.minimumGeneration, Number(through === undefined)).run();
  }
  return { active, swapped, previous, env, tokens };
}

const request = (worker, token, options = {}) => worker.fetch(
  `https://port-p2.example.test${options.path ?? '/__port_p2__/sentinel'}`,
  { headers: { Cookie: `__Host-shererp-owner-session=${token}`, ...options.headers } }
);

test('one Workerd Owner host reads the same ID from two independent Shop D1 databases', async t => {
  const { active, tokens } = await startProof(t);
  for (const [index, shop] of shops.entries()) {
    const response = await request(active, tokens[index]);
    assert.equal(response.status, 200, `Owner ${shop.name} must reach their own Shop D1`);
    assert.deepEqual(await response.json(), { value: `Value from Shop ${shop.name}` });
  }
});

test('a Worker with swapped physical D1 bindings fails closed for both Owners', async t => {
  const { swapped, tokens } = await startProof(t);
  const wrong = (await swapped.getEnv()).SHOP_A_DB;
  assert.equal((await wrong.prepare('SELECT shop_id FROM shop_identity').first()).shop_id, shops[1].shopId);
  for (const token of tokens) {
    const response = await request(swapped, token);
    assert.equal(response.status, 503, 'a current Owner must be denied on identity mismatch');
    assert.equal(await response.text(), '');
  }
});


test('a revoked session and client-supplied selectors cannot change the binding', async t => {
  const { active, env, tokens } = await startProof(t);
  assert.equal((await request(active, 'bad-token')).status, 401);
  assert.equal((await request(active, tokens[0], { headers: { 'x-shop-id': shops[1].shopId } })).status, 400);
  assert.equal((await request(active, tokens[0], { path: '/__port_p2__/sentinel?shopId=' + shops[1].shopId })).status, 400);
  assert.equal((await request(active, tokens[0], { path: '/api/rpc' })).status, 404);
  const shop = env.SHOP_A_DB;
  const interrupted = {
    prepare: shop.prepare.bind(shop),
    async batch(statements) {
      const results = await shop.batch(statements);
      await env.CONTROL_DB.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
        .bind(shops[0].shopId).run();
      return results;
    }
  };
  assert.deepEqual(await resolvePortP2OwnerShop({ ...env, SHOP_A_DB: interrupted }, tokens[0], env.PORT_P2_ROSTER),
    { status: 'denied' }, 'authority revoked after the Shop D1 checkpoint is not returned');
  assert.equal((await request(active, tokens[0])).status, 401);
  assert.deepEqual(await (await request(active, tokens[1])).json(), { value: 'Value from Shop B' });
});

test('an incompatible rollback withholds Shop B and a compatible configuration restores access', async t => {
  const { active, previous, tokens, env } = await startProof(t);
  assert.deepEqual(await (await request(previous, tokens[0])).json(), { value: 'Value from Shop A' });
  assert.equal((await request(previous, tokens[1])).status, 503);
  assert.deepEqual(await (await request(active, tokens[1])).json(), { value: 'Value from Shop B' });
  await env.CONTROL_DB.prepare('UPDATE port_p2_shop_placements SET ready=0 WHERE shop_id=?')
    .bind(shops[1].shopId).run();
  assert.equal((await request(active, tokens[1])).status, 503);
  assert.deepEqual(await (await request(active, tokens[0])).json(), { value: 'Value from Shop A' });
  await env.CONTROL_DB.prepare('UPDATE port_p2_shop_placements SET ready=1, minimum_generation=3 WHERE shop_id=?')
    .bind(shops[1].shopId).run();
  assert.equal((await request(active, tokens[1])).status, 503, 'a stale generation cannot use a present binding');
  await env.CONTROL_DB.prepare('UPDATE port_p2_shop_placements SET minimum_generation=2 WHERE shop_id=?')
    .bind(shops[1].shopId).run();
  assert.deepEqual(await (await request(active, tokens[1])).json(), { value: 'Value from Shop B' });
});

const readReceipts = async db => (await db.prepare(
  'SELECT position, name, checksum FROM port_p2_shop_migrations ORDER BY position'
).all()).results;
const readSentinel = async db => (await db.prepare('SELECT key,value FROM settings ORDER BY key').all()).results;
const readPlacements = async db => (await db.prepare(
  'SELECT * FROM port_p2_shop_placements ORDER BY shop_id'
).all()).results;

test('interrupted migrations roll back late failure and resume exactly once on the correct Shop D1', async t => {
  const { active, env, tokens } = await startProof(t, { through: 2 });
  const { CONTROL_DB: control, SHOP_A_DB: a, SHOP_B_DB: b } = env;
  await applyLocalShopMigrations(b, shops[1]);
  await control.prepare('UPDATE port_p2_shop_placements SET ready=1 WHERE shop_id=?').bind(shops[1].shopId).run();
  const aData = await readSentinel(a);
  const bState = { receipts: await readReceipts(b), records: await readSentinel(b) };
  const placements = await readPlacements(control);
  const prefix = await readReceipts(a);
  assert.equal(prefix.length, 2);
  assert.equal((await request(active, tokens[0])).status, 503);
  await a.prepare(`CREATE TRIGGER fixture_stop_receipt BEFORE UPDATE OF schema_snapshot ON port_p2_shop_migrations
    WHEN NEW.position=3 BEGIN SELECT RAISE(ABORT,'fixture late migration interruption'); END`).run();
  await assert.rejects(applyLocalShopMigrations(a, shops[0]), /fixture late migration interruption/);
  assert.deepEqual(await readReceipts(a), prefix);
  assert.equal(await a.prepare("SELECT name FROM sqlite_schema WHERE name='legacy_product_snapshots'").first(), null);
  assert.deepEqual(await readSentinel(a), aData);
  await a.prepare('DROP TRIGGER fixture_stop_receipt').run();

  await assert.rejects(applyLocalShopMigrations(a, shops[1]), /SHOP_IDENTITY_MISMATCH/);
  assert.deepEqual(await applyLocalShopMigrations(a, shops[0]), { applied: 1 });
  assert.deepEqual(await applyLocalShopMigrations(a, shops[0]), { applied: 0 });
  assert.equal((await readReceipts(a)).length, 3);
  assert.deepEqual(await readSentinel(a), aData);
  assert.deepEqual({ receipts: await readReceipts(b), records: await readSentinel(b) }, bState);
  assert.deepEqual(await readPlacements(control), placements);
  assert.equal((await request(active, tokens[0])).status, 503, 'resume alone does not publish readiness');
  await control.prepare('UPDATE port_p2_shop_placements SET ready=1 WHERE shop_id=?').bind(shops[0].shopId).run();
  assert.deepEqual(await (await request(active, tokens[0])).json(), { value: 'Value from Shop A' });
  assert.deepEqual(await (await request(active, tokens[1])).json(), { value: 'Value from Shop B' });
});

test('migration bytes and applied receipt drift stop resume without overwriting existing data', async t => {
  const { active, env, tokens } = await startProof(t);
  const db = env.SHOP_A_DB;
  const baseline = await readReceipts(db);
  const data = await readSentinel(db);
  const files = await loadLocalShopMigrations();
  files[0].sql += '\n-- changed bytes';
  await assert.rejects(applyLocalShopMigrations(db, shops[0], { files }), /MIGRATION_CHECKSUM_MISMATCH/);
  assert.deepEqual(await readReceipts(db), baseline);

  await db.prepare('CREATE TABLE fixture_unreviewed_schema (id INTEGER PRIMARY KEY)').run();
  await assert.rejects(applyLocalShopMigrations(db, shops[0]), /MIGRATION_SCHEMA_DRIFT/);
  assert.equal((await request(active, tokens[0])).status, 503);
  await db.prepare('DROP TABLE fixture_unreviewed_schema').run();
  assert.deepEqual(await applyLocalShopMigrations(db, shops[0]), { applied: 0 });

  await db.prepare("UPDATE port_p2_shop_migrations SET checksum=? WHERE position=1").bind('0'.repeat(64)).run();
  await assert.rejects(applyLocalShopMigrations(db, shops[0]), /MIGRATION_CHECKSUM_MISMATCH/);
  assert.equal((await request(active, tokens[0])).status, 503);
  assert.deepEqual(await readSentinel(db), data);
  assert.deepEqual(await (await request(active, tokens[1])).json(), { value: 'Value from Shop B' });
});


test('schema drift after the preflight cannot be sealed into the next D1 migration receipt', async t => {
  const { env } = await startProof(t, { through: 2 });
  const db = env.SHOP_A_DB;
  const baseline = await readReceipts(db);
  const sentinel = await readSentinel(db);
  let checkpoints = 0;
  const race = {
    prepare: db.prepare.bind(db),
    async batch(statements) {
      if (++checkpoints === 2) {
        await db.prepare('CREATE TABLE fixture_late_schema_drift (id INTEGER PRIMARY KEY)').run();
      }
      return db.batch(statements);
    }
  };
  await assert.rejects(applyLocalShopMigrations(race, shops[0]), /MIGRATION_SCHEMA_DRIFT/);
  assert.deepEqual(await readReceipts(db), baseline);
  assert.deepEqual(await readSentinel(db), sentinel);
  assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='legacy_product_snapshots'").first(), null);
  await db.prepare('DROP TABLE fixture_late_schema_drift').run();
  assert.deepEqual(await applyLocalShopMigrations(db, shops[0]), { applied: 1 });
});
