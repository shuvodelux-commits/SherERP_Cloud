// Operator rehearsal only. Imports pinned SQL from this checkout and receives
// disposable Workerd D1 bindings from the test. There is no remote adapter.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { pilotShopIdentityMatches } from '../../src/auth/platform-shop-binding.js';
import {
  PORT_P2_SHOP_SCHEMA, matchesPortP2MigrationPrefix, readPortP2ShopCheckpoint
} from '../../src/db/port-p2-shop-schema.js';

export const shopMigrationPlan = Object.freeze([
  ['staging-migrations/shop-identity/0001_shop_identity.sql', 'd053ae0d59ca85e2b1e0395799ef75e651161b0241792f931a3faabf4a462d2d'],
  ['migrations/0001_core_catalog.sql', 'e15280ba1bc3db2ced97415bad290bbe39fda9a6bc2735e642f6e1a52388029a'],
  ['migrations/0012_legacy_product_snapshots.sql', '4391153e107b9ea2b2b1fcc2084f359ea9c7f957510794ba12e3b27170c603c7']
].map(([name, checksum]) => Object.freeze({ name, checksum })));

export function loadLocalShopMigrations() {
  return Promise.all(shopMigrationPlan.map(async ({ name }) => ({
    name, sql: await readFile(new URL('../../' + name, import.meta.url), 'utf8')
  })));
}

const createLedger = `CREATE TABLE port_p2_shop_migrations (
  position INTEGER PRIMARY KEY CHECK(position>0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK(length(checksum)=64),
  schema_snapshot TEXT NOT NULL
) STRICT`;

export async function applyLocalShopMigrations(db, shop, { through = shopMigrationPlan.length, files } = {}) {
  const sources = files ?? await loadLocalShopMigrations();
  if (sources.length !== shopMigrationPlan.length || shopMigrationPlan.some(({ name, checksum }, index) =>
    sources[index]?.name !== name || createHash('sha256').update(sources[index].sql).digest('hex') !== checksum
  )) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
  if (!Number.isSafeInteger(through) || through < 1 || through > shopMigrationPlan.length) {
    throw new Error('INVALID_MIGRATION_TARGET');
  }

  const ledger = await db.prepare(`SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='port_p2_shop_migrations'`).first();
  let applied = 0;
  if (ledger) {
    if (!await pilotShopIdentityMatches({ ...shop, shopDb: db })) throw new Error('SHOP_IDENTITY_MISMATCH');
    const { receipts, schema } = await readPortP2ShopCheckpoint(db);
    if (!matchesPortP2MigrationPrefix(receipts, shopMigrationPlan)) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
    if (receipts.at(-1)?.schema !== schema) throw new Error('MIGRATION_SCHEMA_DRIFT');
    applied = receipts.length;
  } else {
    const schema = await db.prepare(`SELECT ${PORT_P2_SHOP_SCHEMA} AS schema`).first('schema');
    if (schema !== '[]') throw new Error('MIGRATION_SCHEMA_DRIFT');
  }

  if (through < applied) throw new Error('INVALID_MIGRATION_TARGET');
  for (let index = applied; index < through; index++) {
    const statements = unstable_splitSqlQuery(sources[index].sql).map(sql => db.prepare(sql));
    if (index === 0) {
      statements.unshift(db.prepare(createLedger));
      statements.push(db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
        .bind(shop.shopId, shop.databaseId, shop.databaseMarker));
    }
    const { name, checksum } = shopMigrationPlan[index];
    statements.push(db.prepare(`INSERT INTO port_p2_shop_migrations (position,name,checksum,schema_snapshot)
      VALUES (?,?,?,${PORT_P2_SHOP_SCHEMA})`).bind(index + 1, name, checksum));
    await db.batch(statements);
  }
  return { applied: through - applied };
}
