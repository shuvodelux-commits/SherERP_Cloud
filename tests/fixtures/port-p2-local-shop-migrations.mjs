// Operator rehearsal only. Imports pinned SQL from this checkout and receives
// disposable Workerd D1 bindings from the test. There is no remote adapter.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
import { pilotShopIdentityMatches } from '../../src/auth/platform-shop-binding.js';
import { OWNER_READY_SHOP_MIGRATION_PLAN, isOwnerReadyShopMigrationPlan } from '../../src/db/m03-owner-ready-shop-migrations.js';
import {
  PORT_P2_SHOP_SCHEMA, matchesPortP2MigrationPrefix, readPortP2ShopCheckpoint
} from '../../src/db/port-p2-shop-schema.js';

export const shopMigrationPlan = Object.freeze([
  ['staging-migrations/shop-identity/0001_shop_identity.sql', 'd053ae0d59ca85e2b1e0395799ef75e651161b0241792f931a3faabf4a462d2d'],
  ['migrations/0001_core_catalog.sql', 'e15280ba1bc3db2ced97415bad290bbe39fda9a6bc2735e642f6e1a52388029a'],
  ['migrations/0012_legacy_product_snapshots.sql', '4391153e107b9ea2b2b1fcc2084f359ea9c7f957510794ba12e3b27170c603c7']
].map(([name, checksum]) => Object.freeze({ name, checksum })));

export const ownerReadyShopMigrationPlan=OWNER_READY_SHOP_MIGRATION_PLAN;

export function loadLocalShopMigrations(plan=shopMigrationPlan) {
  return Promise.all(plan.map(async ({ name }) => ({
    name, sql: await readFile(new URL('../../' + name, import.meta.url), 'utf8')
  })));
}

const createLedger = `CREATE TABLE port_p2_shop_migrations (
  position INTEGER PRIMARY KEY CHECK(position>0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK(length(checksum)=64),
  schema_snapshot TEXT NOT NULL
) STRICT`;

export async function applyLocalShopMigrations(db, shop, { plan=shopMigrationPlan, through=plan.length, files } = {}) {
  if (plan!==shopMigrationPlan && !isOwnerReadyShopMigrationPlan(plan)) {
    throw new Error('UNREVIEWED_MIGRATION_PLAN');
  }
  const sources = files ?? await loadLocalShopMigrations(plan);
  if (sources.length !== plan.length || plan.some(({ name, checksum }, index) =>
    sources[index]?.name !== name || createHash('sha256').update(sources[index].sql).digest('hex') !== checksum
  )) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
  if (!Number.isSafeInteger(through) || through < 1 || through > plan.length) {
    throw new Error('INVALID_MIGRATION_TARGET');
  }

  const ledger = await db.prepare(`SELECT 1 FROM sqlite_schema
    WHERE type='table' AND name='port_p2_shop_migrations'`).first();
  let applied = 0;
  let priorSchema = '[]';
  if (ledger) {
    if (!await pilotShopIdentityMatches({ ...shop, shopDb: db })) throw new Error('SHOP_IDENTITY_MISMATCH');
    const { receipts, schema } = await readPortP2ShopCheckpoint(db);
    if (!matchesPortP2MigrationPrefix(receipts, plan)) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
    if (receipts.at(-1)?.schema !== schema) throw new Error('MIGRATION_SCHEMA_DRIFT');
    priorSchema = schema;
    applied = receipts.length;
  } else {
    const schema = await db.prepare(`SELECT ${PORT_P2_SHOP_SCHEMA} AS schema`).first('schema');
    if (schema !== priorSchema) throw new Error('MIGRATION_SCHEMA_DRIFT');
  }

  if (through < applied) throw new Error('INVALID_MIGRATION_TARGET');
  for (let index = applied; index < through; index++) {
    priorSchema = await applyMigration(db, shop, index, sources[index].sql, priorSchema, plan);
  }
  return { applied: through - applied };
}

const receiptPrefixSql = `(
  SELECT json_group_array(json_array(position,name,checksum)) FROM (
    SELECT position,name,checksum FROM port_p2_shop_migrations ORDER BY position
  )
)`;

async function applyMigration(db, shop, index, sql, priorSchema, plan) {
  const position = index + 1;
  const { name, checksum } = plan[index];
  const prefix = JSON.stringify(plan.slice(0, index).map((item, prior) =>
    [prior + 1, item.name, item.checksum]
  ));
  const identity = [shop.shopId, shop.databaseId, shop.databaseMarker];
  const priorGuard = index === 0 ? '' : `AND EXISTS(
    SELECT 1 FROM shop_identity WHERE singleton=1 AND shop_id=? AND database_id=? AND database_marker=?
  ) AND EXISTS (
    SELECT 1 FROM port_p2_shop_migrations WHERE position=? AND schema_snapshot=?
  )`;
  const priorParameters = index === 0 ? [] : [...identity, index, priorSchema];
  // The NOT NULL constraint aborts the batch on a stale preflight. The
  // resulting schema snapshot replaces the claim inside the same batch.
  const statements = [
    ...(index === 0 ? [db.prepare(createLedger)] : []),
    db.prepare(`INSERT INTO port_p2_shop_migrations (position,name,checksum,schema_snapshot)
      VALUES (?,?,?,CASE WHEN ${PORT_P2_SHOP_SCHEMA}=? AND ${receiptPrefixSql}=? ${priorGuard} THEN '' END)`)
      .bind(position, name, checksum, priorSchema, prefix, ...priorParameters),
    ...unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)),
    ...(index === 0 ? [db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').bind(...identity)] : []),
    db.prepare(`UPDATE port_p2_shop_migrations SET schema_snapshot=${PORT_P2_SHOP_SCHEMA}
      WHERE position=?`).bind(position),
    // A suppressed UPDATE has zero effects. Abort DDL and the claim in SQL
    // if the final receipt does not describe the schema now in the batch.
    db.prepare(`INSERT INTO port_p2_shop_migrations (position,name,checksum,schema_snapshot)
      SELECT 0,'invalid-receipt',?,''
      WHERE NOT EXISTS (SELECT 1 FROM port_p2_shop_migrations
        WHERE position=? AND name=? AND checksum=? AND schema_snapshot=${PORT_P2_SHOP_SCHEMA})`)
      .bind(checksum, position, name, checksum),
    db.prepare('SELECT schema_snapshot AS schema FROM port_p2_shop_migrations WHERE position=?').bind(position)
  ];
  try {
    const results = await db.batch(statements);
    return results.at(-1).results[0].schema;
  } catch (error) {
    if (String(error?.message).includes('NOT NULL constraint failed: port_p2_shop_migrations.schema_snapshot')) {
      throw new Error('MIGRATION_SCHEMA_DRIFT', { cause: error });
    }
    if (String(error?.message).includes('CHECK constraint failed: position>0')) {
      throw new Error('MIGRATION_RECEIPT_NOT_SEALED', { cause: error });
    }
    throw error;
  }
}
