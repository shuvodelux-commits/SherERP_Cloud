import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createSyntheticAuthorizedD1Mutation} from '../fixtures/m04-atomic-authority.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-atomic-authority-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-atomic-authority-local-test');
let DB;
const sha=text=>createHash('sha256').update(text).digest('hex');
const tokenHash=sha('trusted-token-synthetic-only');
const params=(more={})=>({tokenHash,tenantId:'TENANT-A',itemId:'PIPE-1',quantity:1,now:1000,...more});

before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const ddl of [
    `CREATE TABLE synthetic_auth_roles (
      tenant_id TEXT NOT NULL, role_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
      auth_version INTEGER NOT NULL CHECK(auth_version>=1),
      can_edit INTEGER NOT NULL CHECK(can_edit IN (0,1)),
      PRIMARY KEY(tenant_id,role_id)
    ) STRICT`,
    `CREATE TABLE synthetic_auth_users (
      tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
      auth_version INTEGER NOT NULL CHECK(auth_version>=1),
      PRIMARY KEY(tenant_id,user_id),
      FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_auth_roles(tenant_id,role_id)
    ) STRICT`,
    `CREATE TABLE synthetic_auth_sessions (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
      tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
      user_version INTEGER NOT NULL, role_version INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, revoked_at INTEGER,
      FOREIGN KEY(tenant_id,user_id) REFERENCES synthetic_auth_users(tenant_id,user_id),
      FOREIGN KEY(tenant_id,role_id) REFERENCES synthetic_auth_roles(tenant_id,role_id)
    ) STRICT`,
    `CREATE TABLE synthetic_auth_resources (
      tenant_id TEXT NOT NULL, item_id TEXT NOT NULL,
      available INTEGER NOT NULL CHECK(available>=0),
      PRIMARY KEY(tenant_id,item_id)
    ) STRICT`,
  ]) await DB.prepare(ddl).run();
  // Strictly synthetic schema enforcement: role grant/status changes and
  // user status/role changes must invalidate earlier authority snapshots
  // even if an administrative writer forgets to increment auth_version.
  for(const trigger of [
    `CREATE TRIGGER synthetic_role_auth_generation
      AFTER UPDATE OF status,can_edit ON synthetic_auth_roles
      WHEN NEW.status<>OLD.status OR NEW.can_edit<>OLD.can_edit
      BEGIN
        UPDATE synthetic_auth_roles
        SET auth_version=MAX(auth_version,OLD.auth_version+1)
        WHERE tenant_id=NEW.tenant_id AND role_id=NEW.role_id;
      END`,
    `CREATE TRIGGER synthetic_user_auth_generation
      AFTER UPDATE OF status,role_id ON synthetic_auth_users
      WHEN NEW.status<>OLD.status OR NEW.role_id<>OLD.role_id
      BEGIN
        UPDATE synthetic_auth_users
        SET auth_version=MAX(auth_version,OLD.auth_version+1)
        WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id;
      END`
  ]) await DB.prepare(trigger).run();
});
beforeEach(async()=>{
  for(const table of ['synthetic_auth_sessions','synthetic_auth_users','synthetic_auth_roles','synthetic_auth_resources'])
    await DB.prepare('DELETE FROM '+table).run();
  await DB.prepare(`INSERT INTO synthetic_auth_roles(tenant_id,role_id,status,auth_version,can_edit)
    VALUES ('TENANT-A','ROLE-A','Active',1,1),('TENANT-B','ROLE-B','Active',1,1)`).run();
  await DB.prepare(`INSERT INTO synthetic_auth_users(tenant_id,user_id,role_id,status,auth_version)
    VALUES ('TENANT-A','USER-A','ROLE-A','Active',1),('TENANT-B','USER-B','ROLE-B','Active',1)`).run();
  await DB.prepare(`INSERT INTO synthetic_auth_sessions(token_hash,tenant_id,user_id,role_id,user_version,role_version,expires_at,revoked_at)
    VALUES (?,'TENANT-A','USER-A','ROLE-A',1,1,2000,NULL)`).bind(tokenHash).run();
  await DB.prepare(`INSERT INTO synthetic_auth_resources(tenant_id,item_id,available)
    VALUES ('TENANT-A','PIPE-1',4),('TENANT-B','PIPE-1',4)`).run();
});
after(async()=>{await harness.close();});

async function stock(){
  const r=await DB.prepare('SELECT tenant_id,item_id,available FROM synthetic_auth_resources ORDER BY tenant_id').all();
  return r.results.map(x=>({...x}));
}
const original=[
  {tenant_id:'TENANT-A',item_id:'PIPE-1',available:4},
  {tenant_id:'TENANT-B',item_id:'PIPE-1',available:4}
];

test('same SQL statement permits current active session and touches only its own tenant',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  assert.deepEqual(await writer.decrement_(params({quantity:2})),{available:2});
  assert.deepEqual(await stock(),[{...original[0],available:2},original[1]]);
});

test('wrong tenant, nonexistent item and cross-tenant replay are refused with no changes',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  for(const bad of [params({tenantId:'TENANT-B'}),params({tenantId:'TENANT-C'}),params({itemId:'OTHER'})]){
    await assert.rejects(()=>writer.decrement_(bad),/refus|denied|unavailable|unsafe/i);
  }
  assert.deepEqual(await stock(),original);
});

test('revocation and exact expiration boundary are rejected in the write itself',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  await assert.rejects(()=>writer.decrement_(params({now:2000})),/refus|denied/i);
  await DB.prepare('UPDATE synthetic_auth_sessions SET revoked_at=1100 WHERE token_hash=?').bind(tokenHash).run();
  await assert.rejects(()=>writer.decrement_(params({now:1200})),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('disabled and re-enabled user version never resurrects old session grant',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  await DB.prepare("UPDATE synthetic_auth_users SET status='Inactive',auth_version=auth_version+1 WHERE user_id='USER-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  await DB.prepare("UPDATE synthetic_auth_users SET status='Active',auth_version=auth_version+1 WHERE user_id='USER-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('downgraded, disabled, re-enabled and version-bumped role denies an old session',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  await DB.prepare("UPDATE synthetic_auth_roles SET can_edit=0 WHERE role_id='ROLE-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  await DB.prepare("UPDATE synthetic_auth_roles SET status='Inactive',can_edit=1,auth_version=auth_version+1 WHERE role_id='ROLE-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  await DB.prepare("UPDATE synthetic_auth_roles SET status='Active',auth_version=auth_version+1 WHERE role_id='ROLE-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('role reassignment refuses prior session even when both roles can edit',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  await DB.prepare("INSERT INTO synthetic_auth_roles(tenant_id,role_id,status,auth_version,can_edit) VALUES ('TENANT-A','ROLE-A2','Active',1,1)").run();
  await DB.prepare("UPDATE synthetic_auth_users SET role_id='ROLE-A2',auth_version=auth_version+1 WHERE user_id='USER-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('insufficient units refuse even an authorized call and remain nonnegative',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  await assert.rejects(()=>writer.decrement_(params({quantity:5})),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('concurrent last-three-unit claims cannot both execute authorized writes',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  const results=await Promise.allSettled([
    writer.decrement_(params({quantity:3})),
    writer.decrement_(params({quantity:3}))
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.deepEqual(await stock(),[{...original[0],available:1},original[1]]);
});

test('concurrent revoke and mutation serialize; later calls cannot use revoked session',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  const outcomes=await Promise.allSettled([
    writer.decrement_(params({quantity:1,now:1200})),
    DB.prepare('UPDATE synthetic_auth_sessions SET revoked_at=1100 WHERE token_hash=?').bind(tokenHash).run()
  ]);
  assert.equal(outcomes[1].status,'fulfilled');
  assert.equal(outcomes[0].status==='fulfilled'||outcomes[0].status==='rejected',true);
  assert.equal((await DB.prepare('SELECT revoked_at FROM synthetic_auth_sessions WHERE token_hash=?').bind(tokenHash).first()).revoked_at,1100);
  await assert.rejects(()=>writer.decrement_(params({now:1200})),/refus|denied/i);
  const balances=await stock();
  assert.ok([3,4].includes(balances[0].available));
  assert.equal(balances[1].available,4);
});

test('invalid shape, token digest, quantity and identifiers refuse before querying D1',async()=>{
  assert.throws(()=>createSyntheticAuthorizedD1Mutation({}),/D1|binding/i);
  const writer=createSyntheticAuthorizedD1Mutation({prepare(){throw new Error('MUST_NOT_QUERY')}});
  for(const bad of [null,[],{},params({tokenHash:'bad'}),params({tenantId:''}),
    params({tenantId:'x;DROP TABLE'}),params({itemId:'bad id'}),params({quantity:0}),
    params({quantity:1.25}),params({quantity:'1'}),params({now:-1}),
    params({now:1.5}),{...params(),userId:'USER-A'}]){
    await assert.rejects(()=>writer.decrement_(bad),/invalid|unsupported|quantity|digest|time/i);
  }
});

test('dedicated local-only Worker exposes no login, permissions or posting route',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-atomic-authority-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.name,'shererp-m04-atomic-authority-local-test');
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.main,'tests/fixtures/m04-atomic-authority-worker.mjs');
  assert.equal(cfg.routes,undefined);
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),['00000000-0000-0000-0000-000000000006']);
  const r=await worker.fetch('http://synthetic.local/api/rpc',{method:'POST'});
  assert.equal(r.status,404);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m04-atomic-authority'),false);
});

test('role grant removed then restored must not resurrect prior session without caller version bump',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  const originalVersion=(await DB.prepare("SELECT auth_version FROM synthetic_auth_roles WHERE tenant_id='TENANT-A' AND role_id='ROLE-A'").first()).auth_version;
  await DB.prepare("UPDATE synthetic_auth_roles SET can_edit=0 WHERE tenant_id='TENANT-A' AND role_id='ROLE-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  await DB.prepare("UPDATE synthetic_auth_roles SET can_edit=1 WHERE tenant_id='TENANT-A' AND role_id='ROLE-A'").run();
  const newVersion=(await DB.prepare("SELECT auth_version FROM synthetic_auth_roles WHERE tenant_id='TENANT-A' AND role_id='ROLE-A'").first()).auth_version;
  assert.ok(newVersion>originalVersion,'D1 trigger must invalidate prior permission version on both edits');
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});

test('user status disabled then restored cannot revive an earlier session if writer omits version bump',async()=>{
  const writer=createSyntheticAuthorizedD1Mutation(DB);
  const originalVersion=(await DB.prepare("SELECT auth_version FROM synthetic_auth_users WHERE tenant_id='TENANT-A' AND user_id='USER-A'").first()).auth_version;
  await DB.prepare("UPDATE synthetic_auth_users SET status='Inactive' WHERE tenant_id='TENANT-A' AND user_id='USER-A'").run();
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  await DB.prepare("UPDATE synthetic_auth_users SET status='Active' WHERE tenant_id='TENANT-A' AND user_id='USER-A'").run();
  const newVersion=(await DB.prepare("SELECT auth_version FROM synthetic_auth_users WHERE tenant_id='TENANT-A' AND user_id='USER-A'").first()).auth_version;
  assert.ok(newVersion>originalVersion,'D1 trigger must invalidate previous user authority version on status changes');
  await assert.rejects(()=>writer.decrement_(params()),/refus|denied/i);
  assert.deepEqual(await stock(),original);
});
