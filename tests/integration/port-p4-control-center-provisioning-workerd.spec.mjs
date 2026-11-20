import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createTestHarness, unstable_splitSqlQuery } from 'wrangler';
import { hashOpaqueSessionToken } from '../../src/auth/session-token.js';

const origin = 'https://platform.example.test';
const issuer = 'https://accounts.google.com';

async function startControlCenter(t) {
  const server = createTestHarness({ workers: [{
    configPath: './wrangler.m03-platform-auth-local-test.jsonc',
    vars: {
      PLATFORM_SHOP_RESERVATION_ENABLED: 'true',
      PLATFORM_LOCAL_PROVISIONING_ENABLED: 'true',
    },
  }] });
  t.after(() => server.close());
  await server.listen();
  const worker = server.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  const { CONTROL_DB: db } = await worker.getEnv();
  const sql = await readFile('staging-migrations/platform-onboarding/0001_shop_reservations.sql', 'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));

  const token = '1'.repeat(64);
  const setupHash = 'a'.repeat(64);
  const browserHash = 'c'.repeat(64);
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(setupHash, 'b'.repeat(43), issuer, 'fixture-admin', now - 1000, now + 60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind(issuer, 'fixture-admin', setupHash, now - 500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(browserHash, 'd'.repeat(43), now + 60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(browserHash, now - 200),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`).bind(await hashOpaqueSessionToken(token), browserHash, now - 100, now + 60000),
  ]);

  async function request(path, body) {
    const headers = { Cookie: '__Host-shererp-platform-session=' + token };
    return worker.fetch(origin + '/api/platform' + path, body ? {
      method: 'POST',
      headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : { headers });
  }
  return { request, db };
}

test('Create Business accepts the Owner Gmail and keeps one operation across retries', async t => {
  const { request, db } = await startControlCenter(t);
  const session = await request('/auth/session');
  assert.equal(session.status, 200);
  assert.equal((await session.json()).role, 'PlatformSuperAdmin');

  const input = {
    operationId: crypto.randomUUID(),
    displayName: 'Paper & Tools',
    ownerEmail: 'fixture.owner@gmail.com',
  };
  const response = await request('/shops', input);
  assert.ok([200, 201, 202].includes(response.status),
    `a valid business name and Gmail must start durable setup, got ${response.status}`);
  const first = await response.json();
  assert.equal(first.operationId, input.operationId);
  assert.equal(typeof first.shopId, 'string');
  assert.equal(typeof first.status, 'string');
  const replay = await request('/shops', input);
  assert.ok(replay.ok);
  assert.equal((await replay.json()).shopId, first.shopId);
  const conflict = await request('/shops', { ...input, ownerEmail: 'other.owner@gmail.com' });
  assert.equal(conflict.status, 409);
  const { count } = await db.prepare('SELECT count(*) AS count FROM platform_shop_reservations').first();
  assert.equal(count, 1);
});
