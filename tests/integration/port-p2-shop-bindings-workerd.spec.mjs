import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createTestHarness, unstable_splitSqlQuery } from 'wrangler';
import { issueOwnerSession } from '../../src/auth/platform-owner-sessions.js';

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

async function startProof(t) {
  const controlId = crypto.randomUUID();
  const makeConfig = (name, placement, databaseOrder) => ({
    config: {
      name: `port-p2-${name}`, main: fixture, compatibility_date: '2026-11-14',
      workers_dev: false, preview_urls: false, vars: {
        PORT_P2_FIXTURE: 'true', PORT_P2_SENTINEL_ID: sentinelId, PORT_P2_ROSTER: { generation: 2, shops: placement }
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
    makeConfig('swapped', shops, [...shops].reverse())
  ] });
  t.after(() => server.close());
  await server.listen();
  const active = server.getWorker('port-p2-active');
  const swapped = server.getWorker('port-p2-swapped');
  const env = await active.getEnv();
  const control = env.CONTROL_DB;
  for (const name of controlMigrations) {
    await applySql(control, `staging-migrations/platform-onboarding/${name}.sql`);
  }
  const tokens = [];
  for (const shop of shops) {
    const db = env[shop.binding];
    await applySql(db, 'staging-migrations/shop-identity/0001_shop_identity.sql');
    await applySql(db, 'migrations/0001_core_catalog.sql');
    await db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(shop.shopId, shop.databaseId, shop.databaseMarker).run();
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind(sentinelId, `Value from Shop ${shop.name}`).run();
    tokens.push(await seedOwner(control, db, shop));
  }
  return { active, swapped, env, tokens };
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
  for (const token of tokens) {
    const response = await request(swapped, token);
    assert.equal(response.status, 503, 'a current Owner must be denied on identity mismatch');
    assert.equal(await response.text(), '');
  }
});
