import { normalizeGoogleGmail } from './google-id-token.js';
import { CURRENT_PLATFORM_ADMIN_FROM } from './platform-superadmin-session.js';
import { hashOpaqueSessionToken } from './session-token.js';
import { pilotShopIdentityMatches } from './platform-shop-binding.js';
import { matchesPortP2MigrationPrefix, readPortP2ShopCheckpoint } from '../db/port-p2-shop-schema.js';
import {isOwnerReadyShopMigrationPlan} from '../db/m03-owner-ready-shop-migrations.js';
import { reconcileCreateAttempt, validatedReceipt } from './port-p2-create-attempt.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const now = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const allowed = `EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
  AND f.subject=(SELECT created_by_subject FROM platform_shop_reservations
    WHERE shop_id=platform_shop_provisioning.shop_id))`;

function currentSetup(db, hash, operationId) {
  return db.prepare(`WITH admin AS (SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})
    SELECT r.operation_id AS operationId,r.display_name AS displayName,r.shop_id AS shopId,
      p.owner_email AS ownerEmail,p.stage AS status,p.failed_stage AS failedStage,
      p.database_id AS databaseId,p.binding_key AS binding,p.database_marker AS databaseMarker
    FROM admin a JOIN platform_shop_reservations r ON r.created_by_subject=a.subject
    JOIN platform_shop_provisioning p ON p.shop_id=r.shop_id
    WHERE r.operation_id=?`).bind(hash, operationId);
}

function receipt(row) {
  if (!row) return { code: 401 };
  const { databaseId, databaseMarker, binding, ...body } = row;
  return { code: 200, body };
}

export async function startLocalProvisioning(db, token, { operationId, displayName, ownerEmail }, prebound=null) {
  const name = displayName.trim();
  const email = normalizeGoogleGmail(ownerEmail.trim());
  if (!uuid.test(operationId) || !name || name.length > 120 || /\p{Cc}/u.test(name) || !email) {
    return { code: 400 };
  }
  const hash = await hashOpaqueSessionToken(token);
  if (!hash) return { code: 401 };
  if(prebound && (!uuid.test(prebound.shopId)||!uuid.test(prebound.databaseMarker)))
    return {code:400};
  const shopId = prebound?.shopId ?? crypto.randomUUID();
  const marker = prebound?.databaseMarker ?? crypto.randomUUID();
  const [created,, setup] = await db.batch([
    db.prepare(`INSERT INTO platform_shop_reservations
      (shop_id,operation_id,display_name,created_by_subject,created_at_ms)
      SELECT ?,?,?,f.subject,${now} ${CURRENT_PLATFORM_ADMIN_FROM}
      AND NOT EXISTS(SELECT 1 FROM platform_shop_reservations WHERE operation_id=? OR shop_id=?)`)
      .bind(shopId, operationId, name, hash, operationId, shopId),
    db.prepare(`INSERT INTO platform_shop_provisioning (shop_id,owner_email,database_marker,stage)
      SELECT ?,?,?,'reserved' WHERE EXISTS(
        SELECT 1 FROM platform_shop_reservations r
        WHERE r.shop_id=? AND r.created_by_subject=(SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM})
      ) AND NOT EXISTS(SELECT 1 FROM platform_shop_provisioning WHERE shop_id=?)`)
      .bind(shopId, email, marker, shopId, hash, shopId),
    currentSetup(db, hash, operationId)
  ]);
  const row = setup.results[0];
  if (!row) {
    const admin = await db.prepare(`SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}`).bind(hash).first();
    return { code: admin ? 409 : 401 };
  }
  if (row.displayName !== name || row.ownerEmail !== email) return { code: 409 };
  return { ...receipt(row), code: created.meta.changes === 1 ? 202 : 200 };
}

export async function readLocalProvisioning(db, token, operationId) {
  if (!uuid.test(operationId)) return { code: 400 };
  const hash = await hashOpaqueSessionToken(token);
  return hash ? receipt(await currentSetup(db, hash, operationId).first()) : { code: 401 };
}

/** Private, current-session-only view of recent local onboarding operations. */
export async function listLocalProvisioning(db, token) {
  const hash = await hashOpaqueSessionToken(token);
  if (!hash) return { code: 401 };
  // One D1 read/snapshot covers both session validity and row scoping.
  const response = await db.prepare(`WITH admin AS (SELECT f.subject ${CURRENT_PLATFORM_ADMIN_FROM}),
    recent AS (
      SELECT r.operation_id AS operationId,r.display_name AS displayName,r.shop_id AS shopId,
        p.owner_email AS ownerEmail,p.stage AS status,p.failed_stage AS failedStage,
        r.created_at_ms AS createdAtMs
      FROM admin a
      JOIN platform_shop_reservations r ON r.created_by_subject=a.subject
      JOIN platform_shop_provisioning p ON p.shop_id=r.shop_id
      ORDER BY r.created_at_ms DESC,r.operation_id DESC LIMIT 50
    )
    SELECT (SELECT count(*) FROM admin) AS authorized,
      recent.operationId,recent.displayName,recent.shopId,recent.ownerEmail,
      recent.status,recent.failedStage,recent.createdAtMs
    FROM (SELECT 1) singleton LEFT JOIN recent ON TRUE
    ORDER BY recent.createdAtMs DESC,recent.operationId DESC`).bind(hash).all();
  const rows = response.results;
  if (rows[0]?.authorized !== 1) return { code: 401 };
  return {
    code: 200,
    body: { shops: rows.filter(row => row.operationId !== null)
      .map(({ authorized, createdAtMs, ...safe }) => safe) }
  };
}

function localScope(env, row) {
  const inventory = env.PLATFORM_LOCAL_SHOP_INVENTORY;
  if (!Array.isArray(inventory)) return null;
  const matches = inventory.filter(item => item.id === row.databaseId || item.binding === row.binding);
  if (matches.length !== 1 || matches[0].id !== row.databaseId || matches[0].binding !== row.binding ||
      !/^SHOP_[A-Z0-9_]+$/.test(row.binding) || !Object.hasOwn(env, row.binding) ||
      typeof env[row.binding]?.prepare !== 'function') return null;
  return { shopId: row.shopId, databaseId: row.databaseId, databaseMarker: row.databaseMarker, binding: row.binding };
}

async function verifyPreparedShop(env, scope) {
  const db = env[scope.binding];
  const plan = env.PLATFORM_LOCAL_SHOP_MIGRATIONS;
  if (!Array.isArray(plan) || !plan.length ||
      (env.PLATFORM_LOCAL_OWNER_READY_ENABLED==='true' && !isOwnerReadyShopMigrationPlan(plan)) ||
      !await pilotShopIdentityMatches({ ...scope, shopDb: db })) return false;
  const { receipts, schema } = await readPortP2ShopCheckpoint(db);
  if(receipts.length!==plan.length||!matchesPortP2MigrationPrefix(receipts,plan))
    return false;
  if(receipts.at(-1).schema===schema)return true;
  // Only trusted server code can inject this optional verifier. Never accept
  // a browser-provided schema revision, function name or migration receipt.
  const overlay=env.PLATFORM_LOCAL_SHOP_SCHEMA_OVERLAY_VERIFIER;
  return typeof overlay==='function' &&
    await overlay(scope,{receipts,schema})===true;
}

function finalize(db, hash, row) {
  // The SQL transition publishes the binding and local approval via its trigger.
  return db.prepare(`UPDATE platform_shop_provisioning SET stage='ready',failed_stage=NULL
    WHERE shop_id=? AND stage='allocated' AND ${allowed}
    AND NOT EXISTS(SELECT 1 FROM platform_first_shop_owners o WHERE o.shop_id=platform_shop_provisioning.shop_id)`)
    .bind(row.shopId, hash).run();
}

export async function resumeLocalProvisioning(env, token, operationId) {
  if (!uuid.test(operationId)) return { code: 400 };
  const hash = await hashOpaqueSessionToken(token);
  if (!hash) return { code: 401 };
  const db = env.CONTROL_DB;
  const load = () => currentSetup(db, hash, operationId).first();
  let row = await load();
  if (!row || row.status === 'ready') return receipt(row);
  const fail = async (stage, from) => {
    await db.prepare(`UPDATE platform_shop_provisioning SET failed_stage=?
      WHERE shop_id=? AND stage=? AND ${allowed}`).bind(stage, row.shopId, from, hash).run();
    return receipt(await load());
  };

  const provider = env.PLATFORM_LOCAL_SHOP_PROVIDER;
  if (!provider) return fail(row.databaseId ? 'schema-migrations' : 'database-creation', row.status);
  if (!row.databaseId) {
    const claimed = await db.prepare(`UPDATE platform_shop_provisioning SET stage='allocating',failed_stage=NULL
      WHERE shop_id=? AND stage='reserved' AND ${allowed} RETURNING shop_id`).bind(row.shopId, hash).first();
    row = await load();
    if (!row || row.status === 'ready') return receipt(row);
    if (!row.databaseId) {
      const action = { accountId: 'local-control-center', name: 'port-shop-' + row.shopId.replaceAll('-', ''),
        attemptId: row.operationId + ':shop-create' };
      let allocation;
      let binding;
      try {
        const raw = await reconcileCreateAttempt(provider, action, !claimed);
        allocation = validatedReceipt(raw, action);
        binding = raw.binding;
        if (typeof binding !== 'string' || !/^SHOP_[A-Z0-9_]+$/.test(binding)) throw new Error('Missing binding');
      } catch {
        return fail('database-creation', 'allocating');
      }
      if (!localScope(env, { ...row, databaseId: allocation.id, binding })) {
        return fail('binding-verification', 'allocating');
      }
      try {
        await db.prepare(`UPDATE platform_shop_provisioning
          SET stage='allocated',database_id=?,binding_key=?,allocation_evidence=?,failed_stage=NULL
          WHERE shop_id=? AND stage='allocating' AND ${allowed}`)
          .bind(allocation.id, binding, allocation.evidenceRef, row.shopId, hash).run();
      } catch {
        return fail('binding-verification', 'allocating');
      }
      row = await load();
      if (!row || row.status === 'ready') return receipt(row);
    }
  }

  const scope = localScope(env, row);
  try {
    // For blank databases the provider must attest the actual binding using
    // its operation-owned local allocation before any DDL can run.
    if (!scope || await provider.verifyTarget(scope, env[scope.binding]) !== true) {
      return fail('binding-verification', 'allocated');
    }
  } catch {
    return fail('binding-verification', 'allocated');
  }
  if (!(await load())) return { code: 401 };
  // A new Owner-ready profile is optional and local-only. Reject a three-step
  // baseline before executing DDL or publishing a Gmail Owner approval.
  if (env.PLATFORM_LOCAL_OWNER_READY_ENABLED==='true' &&
      !isOwnerReadyShopMigrationPlan(env.PLATFORM_LOCAL_SHOP_MIGRATIONS)) {
    return fail('schema-migrations', 'allocated');
  }
  try {
    await provider.prepareShop(scope);
  } catch {
    return fail('schema-migrations', 'allocated');
  }
  try {
    if (!await verifyPreparedShop(env, scope)) return fail('binding-verification', 'allocated');
  } catch {
    return fail('binding-verification', 'allocated');
  }
  try {
    await finalize(db, hash, row);
  } catch {
    return fail('owner-readiness', 'allocated');
  }
  const finished = await load();
  return !finished || finished.status === 'ready' ? receipt(finished) : fail('owner-readiness', 'allocated');
}
