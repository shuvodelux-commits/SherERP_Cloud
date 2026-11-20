import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createTestHarness, unstable_splitSqlQuery } from 'wrangler';
import platform from '../../src/m03-private-platform-auth-worker.js';
import { applyLocalShopMigrations, shopMigrationPlan, ownerReadyShopMigrationPlan, loadLocalShopMigrations } from '../fixtures/port-p2-local-shop-migrations.mjs';
import { hashOpaqueSessionToken } from '../../src/auth/session-token.js';

const origin = 'https://platform.example.test';
const issuer = 'https://accounts.google.com';

async function startControlCenter(t) {
  const config = JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc', 'utf8'));
  const inventory = ['SHOP_A_DB', 'SHOP_B_DB'].map(binding => ({ binding, id: crypto.randomUUID() }));
  for (const { binding, id } of inventory) {
    config.d1_databases.push({ binding, database_id: id, database_name: binding.toLowerCase(), remote: false });
  }
  const server = createTestHarness({ workers: [{
    config: { ...config, vars: { ...config.vars,
      PLATFORM_SHOP_RESERVATION_ENABLED: 'true',
      PLATFORM_LOCAL_PROVISIONING_ENABLED: 'true', PLATFORM_LOCAL_SHOP_INVENTORY: inventory,
    } },
  }] });
  t.after(() => server.close());
  await server.listen();
  const worker = server.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  const env = await worker.getEnv();
  const db = env.CONTROL_DB;
  for (const name of ['0001_shop_reservations', '0002_shop_bindings', '0003_owner_invitations', '0004_first_shop_owner', '0007_owner_gmail_approvals',
    '0011_control_center_provisioning']) {
    const sql = await readFile(`staging-migrations/platform-onboarding/${name}.sql`, 'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
  }

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

  function request(path, body, bindings, session = token) {
    const headers = { Cookie: '__Host-shererp-platform-session=' + session };
    const url = origin + '/api/platform' + path;
    const init = body ? {
      method: 'POST',
      headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : { headers };
    return bindings ? platform.request(url, init, { ...env, ...bindings }) : worker.fetch(url, init);
  }
  return { request, db, env, inventory };
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
  const [response, concurrent] = await Promise.all([request('/shops', input), request('/shops', input)]);
  assert.ok([200, 201, 202].includes(response.status),
    `a valid business name and Gmail must start durable setup, got ${response.status}`);
  const first = await response.json();
  assert.ok(concurrent.ok);
  assert.equal((await concurrent.json()).shopId, first.shopId);
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
  await assert.rejects(db.prepare(`INSERT OR REPLACE INTO platform_shop_provisioning
    (shop_id,owner_email,database_marker,stage) VALUES (?,?,?,'reserved')`)
    .bind(first.shopId, 'other.owner@gmail.com', crypto.randomUUID()).run(), /already exists/);
});


test('Resume reconciles an interrupted create and verifies two disposable Shop databases', async t => {
  const { request, db, env, inventory } = await startControlCenter(t);
  const receipts = new Map();
  const calls = { create: 0, migrate: 0 };
  let revokeBeforeReady = false;
  const createStarted = Promise.withResolvers();
  const releaseCreate = Promise.withResolvers();
  const bindings = {
    PLATFORM_LOCAL_SHOP_INVENTORY: inventory,
    PLATFORM_LOCAL_SHOP_MIGRATIONS: shopMigrationPlan,
    PLATFORM_LOCAL_SHOP_PROVIDER: {
      async createDatabase(action) {
        const target = inventory[calls.create++];
        const first = calls.create === 1;
        if (first) {
          createStarted.resolve();
          await releaseCreate.promise;
        }
        const receipt = { ...action, id: target.id, binding: target.binding, evidenceRef: 'fixture-allocated' };
        receipts.set(action.attemptId, receipt);
        if (first) throw new Error('response lost after allocation');
        return receipt;
      },
      async findCreation(action) { return receipts.get(action.attemptId); },
      async verifyTarget(scope, candidate) {
        return inventory.some(item => item.id === scope.databaseId && item.binding === scope.binding) &&
          candidate === env[scope.binding];
      },
      async prepareShop(scope) {
        calls.migrate++;
        await applyLocalShopMigrations(env[scope.binding], scope);
        if (revokeBeforeReady) await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=?').bind(Date.now()).run();
      },
    },
  };
  const start = async (displayName, ownerEmail) => {
    const input = { operationId: crypto.randomUUID(), displayName, ownerEmail };
    const result = await request('/shops', input, bindings);
    assert.equal(result.status, 202);
    return input;
  };
  const resume = (input, envBindings = bindings, token) => request('/shops/resume',
    { operationId: input.operationId }, envBindings, token);
  const approvals = async () => (await db.prepare('SELECT * FROM platform_owner_gmail_approvals ORDER BY shop_id').all()).results;

  const bad = await request('/shops', { operationId: crypto.randomUUID(), displayName: 'Invalid',
    ownerEmail: 'fixture@example.com' }, bindings);
  assert.equal(bad.status, 400);

  const a = await start('Shop A', 'fixture.a@gmail.com');
  assert.equal((await resume(a, bindings, '0'.repeat(64))).status, 401);
  assert.deepEqual(calls, { create: 0, migrate: 0 });
  const creating = resume(a);
  await Promise.race([creating, createStarted.promise]);
  try {
    const pending = await (await resume(a)).json();
    assert.equal(pending.failedStage, 'database-creation');
    assert.equal(calls.create, 1);
  } finally {
    releaseCreate.resolve();
  }
  const interrupted = await (await creating).json();
  assert.equal(interrupted.failedStage, 'database-creation');
  const status = await (await request('/shops/setup/' + a.operationId, null, bindings)).json();
  assert.deepEqual(status, interrupted);
  assert.equal((await approvals()).length, 0);
  const swapped = { ...bindings, PLATFORM_LOCAL_SHOP_INVENTORY: inventory.map((item, index) =>
    ({ binding: item.binding, id: inventory[1 - index].id })),
    SHOP_A_DB: env.SHOP_B_DB, SHOP_B_DB: env.SHOP_A_DB };
  const mismatch = await (await resume(a, swapped)).json();
  assert.equal(mismatch.failedStage, 'binding-verification');
  assert.equal(calls.migrate, 0);
  const wrongBlank = { ...bindings, SHOP_A_DB: env.SHOP_B_DB };
  assert.equal((await (await resume(a, wrongBlank)).json()).failedStage, 'binding-verification');
  assert.equal(calls.migrate, 0, 'no DDL should run when only the actual blank binding is swapped');
  await db.prepare(`CREATE TRIGGER fixture_skip_ready BEFORE UPDATE OF stage ON platform_shop_provisioning
    WHEN NEW.stage='ready' BEGIN SELECT RAISE(IGNORE); END`).run();
  assert.equal((await (await resume(a)).json()).failedStage, 'owner-readiness');
  assert.equal((await approvals()).length, 0);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first('n'), 0);
  await db.prepare('DROP TRIGGER fixture_skip_ready').run();
  const readyA = await (await resume(a)).json();
  assert.equal(readyA.status, 'ready');
  const once = await approvals();
  assert.equal(once.length, 1);
  assert.deepEqual(await (await resume(a)).json(), readyA);
  assert.deepEqual(await approvals(), once);
  assert.deepEqual(calls, { create: 1, migrate: 2 });

  const b = await start('Shop B', 'fixture.b@gmail.com');
  revokeBeforeReady = true;
  assert.equal((await resume(b)).status, 401);
  assert.deepEqual(await approvals(), once);
  const aIdentity = await env.SHOP_A_DB.prepare('SELECT shop_id FROM shop_identity').first('shop_id');
  const bIdentity = await env.SHOP_B_DB.prepare('SELECT shop_id FROM shop_identity').first('shop_id');
  assert.equal(aIdentity, readyA.shopId);
  assert.notEqual(aIdentity, bIdentity);
});


test('local Control Center roster lists only current Super Admin operations without D1 secrets', async t => {
  const {request, db} = await startControlCenter(t);
  const saved=[];
  for (const [name,email] of [
    ['দোকান এক','first@gmail.com'],['Second Tools','second@gmail.com']
  ]) {
    const input={operationId:crypto.randomUUID(),displayName:name,ownerEmail:email};
    const response=await request('/shops',input);
    assert.equal(response.status,202);
    saved.push({...input,shopId:(await response.json()).shopId});
  }
  // A different creator's durable records must not appear, even if they share the same D1.
  const stranger={shopId:crypto.randomUUID(),operationId:crypto.randomUUID()};
  const now=Date.now();
  const inserts=[
    db.prepare('INSERT INTO platform_shop_reservations (shop_id,operation_id,display_name,created_by_subject,created_at_ms) VALUES (?,?,?,?,?)')
      .bind(stranger.shopId,stranger.operationId,'Other operator','other-admin',now),
    db.prepare("INSERT INTO platform_shop_provisioning (shop_id,owner_email,database_marker,stage) VALUES (?,?,?,'reserved')")
      .bind(stranger.shopId,'stranger@gmail.com',crypto.randomUUID())
  ];
  for(let i=0;i<50;i++){
    const shopId=crypto.randomUUID(),operationId=crypto.randomUUID();
    inserts.push(db.prepare('INSERT INTO platform_shop_reservations (shop_id,operation_id,display_name,created_by_subject,created_at_ms) VALUES (?,?,?,?,?)')
      .bind(shopId,operationId,'Visible '+i,'fixture-admin',now+i+1));
    inserts.push(db.prepare("INSERT INTO platform_shop_provisioning (shop_id,owner_email,database_marker,stage) VALUES (?,?,?,'reserved')")
      .bind(shopId,'fixture'+i+'@gmail.com',crypto.randomUUID()));
  }
  await db.batch(inserts);

  const list=await request('/shops/list');
  assert.equal(list.status,200,'only current signed-in Super Admin can list local operations');
  const payload=await list.json();
  assert.deepEqual(Object.keys(payload),['shops']);
  assert.equal(payload.shops.length,50,'bounded local MVP avoids unbounded Control D1 response');
  assert.ok(payload.shops.some(x=>x.displayName==='Visible 49'));
  assert.ok(payload.shops.every(x=>x.displayName!=='Other operator'));
  assert.deepEqual(Object.keys(payload.shops[0]).sort(),[
    'displayName','failedStage','operationId','ownerEmail','shopId','status'
  ]);
  assert.ok(payload.shops.every(x=>x.status==='reserved'&&x.failedStage===null));
  assert.equal(payload.shops.some(x=>'databaseId' in x||'binding' in x||
    'databaseMarker' in x||'allocation_evidence' in x),false);
  assert.equal((await request('/shops/list',undefined,undefined,'0'.repeat(64))).status,401);
  assert.equal((await request('/shops/list',undefined,{PLATFORM_LOCAL_PROVISIONING_ENABLED:'false'})).status,404);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=? WHERE revoked_at_ms IS NULL')
    .bind(Date.now()).run();
  assert.equal((await request('/shops/list')).status,401,'revocation takes effect at SQL read time');
});

test('Owner-ready local setup refuses baseline-only migrations before publishing Owner approval',async t=>{
  const {request,db,env,inventory}=await startControlCenter(t);
  const input={operationId:crypto.randomUUID(),displayName:'Owner Ready Guard',ownerEmail:'guard@gmail.com'};
  assert.equal((await request('/shops',input)).status,202);
  const receipt={id:inventory[0].id,binding:inventory[0].binding,evidenceRef:'baseline-only'};
  const provider={
    async createDatabase(action){return {...action,...receipt};},
    async findCreation(action){return {...action,...receipt};},
    async verifyTarget(scope,candidate){
      return scope.databaseId===inventory[0].id&&scope.binding===inventory[0].binding&&candidate===env.SHOP_A_DB;
    },
    async prepareShop(scope){await applyLocalShopMigrations(env.SHOP_A_DB,scope);}
  };
  const result=await request('/shops/resume',{operationId:input.operationId},{
    PLATFORM_LOCAL_OWNER_READY_ENABLED:'true',
    PLATFORM_LOCAL_SHOP_PROVIDER:provider,
    PLATFORM_LOCAL_SHOP_MIGRATIONS:shopMigrationPlan
  });
  assert.equal(result.status,200);
  const setup=await result.json();
  assert.notEqual(setup.status,'ready',
    'three baseline SQL migrations cannot attest operational Owner-ready Product schema');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,0);
  assert.equal((await env.SHOP_A_DB.prepare(
    "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='products'"
  ).first()).n,0);
});

test('Owner-ready recovery seals seven D1 migrations after partial failure without second database allocation',async t=>{
  const {request,db,env,inventory}=await startControlCenter(t);
  const operationId=crypto.randomUUID();
  const input={operationId,displayName:'Safe Recovery',ownerEmail:'safe.recovery@gmail.com'};
  assert.equal((await request('/shops',input)).status,202);
  let allocations=0,preparations=0;
  const allocationsByAttempt=new Map();
  const provider={
    async createDatabase(action){
      allocations++;
      const receipt={...action,id:inventory[0].id,binding:inventory[0].binding,evidenceRef:'fixture-ownerready'};
      allocationsByAttempt.set(action.attemptId,receipt);
      return receipt;
    },
    async findCreation(action){return allocationsByAttempt.get(action.attemptId);},
    async verifyTarget(scope,candidate){
      return scope.databaseId===inventory[0].id&&scope.binding===inventory[0].binding&&candidate===env.SHOP_A_DB;
    },
    async prepareShop(scope){
      preparations++;
      if(preparations===1){
        assert.deepEqual(await applyLocalShopMigrations(env.SHOP_A_DB,scope,{
          plan:ownerReadyShopMigrationPlan,through:3
        }),{applied:3});
        throw new Error('synthetic interruption after three sealed Shop migrations');
      }
      assert.deepEqual(await applyLocalShopMigrations(env.SHOP_A_DB,scope,{
        plan:ownerReadyShopMigrationPlan
      }),{applied:4},'retry must apply exactly the missing four SQL files');
    }
  };
  const bindings={
    PLATFORM_LOCAL_OWNER_READY_ENABLED:'true',PLATFORM_LOCAL_SHOP_MIGRATIONS:ownerReadyShopMigrationPlan,
    PLATFORM_LOCAL_SHOP_PROVIDER:provider
  };
  const first=await request('/shops/resume',{operationId},bindings);
  assert.equal(first.status,200);
  assert.deepEqual(
    (({status,failedStage})=>({status,failedStage}))(await first.json()),
    {status:'allocated',failedStage:'schema-migrations'}
  );
  const shop=env.SHOP_A_DB;
  const list=()=>shop.prepare('SELECT position,name,checksum FROM port_p2_shop_migrations ORDER BY position').all();
  assert.equal((await list()).results.length,3);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,0);
  const scope={shopId:(await db.prepare('SELECT shop_id FROM platform_shop_reservations').first()).shop_id,
    databaseId:inventory[0].id,databaseMarker:(await db.prepare(
      'SELECT database_marker FROM platform_shop_provisioning'
    ).first()).database_marker};
  const mutatedFiles=await loadLocalShopMigrations(ownerReadyShopMigrationPlan);
  mutatedFiles[3].sql+='\n-- modified Owner Product DDL';
  await assert.rejects(applyLocalShopMigrations(shop,scope,{
    plan:ownerReadyShopMigrationPlan,files:mutatedFiles
  }),/MIGRATION_CHECKSUM_MISMATCH/);
  assert.equal((await list()).results.length,3,'unreviewed DDL changes no receipts');
  const again=await request('/shops/resume',{operationId},bindings);
  assert.equal(again.status,200);
  assert.equal((await again.json()).status,'ready');
  assert.deepEqual((await list()).results,ownerReadyShopMigrationPlan.map(({name,checksum},i)=>({
    position:i+1,name,checksum
  })));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,1);
  assert.deepEqual([allocations,preparations],[1,2]);
  assert.equal((await (await request('/shops/resume',{operationId},bindings)).json()).status,'ready');
  assert.deepEqual([allocations,preparations],[1,2],'ready replay never reallocates or remigrates');
});
