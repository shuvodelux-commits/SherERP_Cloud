import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SessionRepository} from '../fixtures/m04-session-repository.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-session-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-session-workerd-test');
let DB;
const hash=(token)=>createHash('sha256').update(token).digest('hex');
const issue=(token,userId='USR-1',now=1000,expiresAt=2000)=>({tokenHash:hash(token),userId,now,expiresAt});
const lookup=(token,now=1000)=>({tokenHash:hash(token),now});

before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const ddl of [
    `CREATE TABLE synthetic_roles(
      role_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
      auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>=1)
    ) STRICT`,
    `CREATE TABLE synthetic_users(
      user_id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES synthetic_roles(role_id),
      status TEXT NOT NULL CHECK(status IN ('Active','Inactive')),
      auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version>=1)
    ) STRICT`,
    `CREATE TABLE synthetic_sessions(
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
      user_id TEXT NOT NULL REFERENCES synthetic_users(user_id),
      user_version INTEGER NOT NULL CHECK(user_version>=1),
      role_id TEXT NOT NULL REFERENCES synthetic_roles(role_id),
      role_version INTEGER NOT NULL CHECK(role_version>=1),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
      revoked_at INTEGER
    ) STRICT`,
  ])await DB.prepare(ddl).run();
});

beforeEach(async()=>{
  await DB.prepare('DELETE FROM synthetic_sessions').run();
  await DB.prepare('DELETE FROM synthetic_users').run();
  await DB.prepare('DELETE FROM synthetic_roles').run();
  await DB.prepare("INSERT INTO synthetic_roles(role_id,status,auth_version) VALUES ('ROL-1','Active',1)").run();
  await DB.prepare("INSERT INTO synthetic_users(user_id,role_id,status,auth_version) VALUES ('USR-1','ROL-1','Active',1)").run();
});
after(async()=>{await harness.close();});
const state=async()=> (await DB.prepare('SELECT * FROM synthetic_sessions ORDER BY token_hash').all()).results;

test('issues only opaque token digest; live D1 lookup restores active source user and role',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  const raw='session-bearer-example-only';
  assert.deepEqual(await repo.issue(issue(raw)),{created:true});
  assert.deepEqual(await repo.resolve(lookup(raw)),{userId:'USR-1',roleId:'ROL-1'});
  const records=await state();
  assert.equal(records.length,1);
  assert.equal(records[0].token_hash,hash(raw));
  assert.equal(JSON.stringify(records).includes(raw),false);
  assert.equal(records[0].user_version,1);
  assert.equal(records[0].role_version,1);
});

test('logout revokes the digest immediately; repeat revocation cannot restore authority',async()=>{
  const repo=createSyntheticD1SessionRepository(DB), token='revoke-case';
  await repo.issue(issue(token));
  assert.equal(await repo.revoke(lookup(token,1100)),true);
  assert.equal(await repo.resolve(lookup(token,1100)),null);
  assert.equal(await repo.revoke(lookup(token,1150)),false);
  assert.equal(await repo.resolve(lookup(token,1150)),null);
  assert.equal((await state())[0].revoked_at,1100);
});

test('finite expiration is exclusive at its boundary and never upgrades old Never sessions',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  await repo.issue(issue('expiry', 'USR-1', 1000, 1001));
  assert.deepEqual(await repo.resolve(lookup('expiry',1000)),{userId:'USR-1',roleId:'ROL-1'});
  assert.equal(await repo.resolve(lookup('expiry',1001)),null);
  assert.equal(await repo.resolve(lookup('expiry',2000)),null);
  await assert.rejects(()=>repo.issue({...issue('never'),expiresAt:'Never'}),/invalid|time|expir/i);
  await assert.rejects(()=>repo.issue({...issue('same'),expiresAt:1000}),/invalid|time|expir/i);
});

test('disable and re-enable staff cannot resurrect a session from an earlier authority version',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  await repo.issue(issue('user-disable'));
  await DB.prepare("UPDATE synthetic_users SET status='Inactive',auth_version=auth_version+1 WHERE user_id='USR-1'").run();
  assert.equal(await repo.resolve(lookup('user-disable')),null);
  await assert.rejects(()=>repo.issue(issue('blocked-user')),/inactive|missing|refus|cannot|unavailable/i);
  await DB.prepare("UPDATE synthetic_users SET status='Active',auth_version=auth_version+1 WHERE user_id='USR-1'").run();
  assert.equal(await repo.resolve(lookup('user-disable')),null);
  assert.deepEqual(await repo.issue(issue('fresh-after-enable')),{created:true});
  assert.deepEqual(await repo.resolve(lookup('fresh-after-enable')),{userId:'USR-1',roleId:'ROL-1'});
});

test('disabled and re-enabled role or reassigned user cannot retain a stale session',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  await repo.issue(issue('role-disable'));
  await DB.prepare("UPDATE synthetic_roles SET status='Inactive',auth_version=auth_version+1 WHERE role_id='ROL-1'").run();
  assert.equal(await repo.resolve(lookup('role-disable')),null);
  await assert.rejects(()=>repo.issue(issue('blocked-role')),/inactive|missing|refus|cannot|unavailable/i);
  await DB.prepare("UPDATE synthetic_roles SET status='Active',auth_version=auth_version+1 WHERE role_id='ROL-1'").run();
  assert.equal(await repo.resolve(lookup('role-disable')),null);
  await DB.prepare("INSERT INTO synthetic_roles(role_id,status,auth_version) VALUES ('ROL-2','Active',1)").run();
  await DB.prepare("UPDATE synthetic_users SET role_id='ROL-2',auth_version=auth_version+1 WHERE user_id='USR-1'").run();
  assert.equal(await repo.resolve(lookup('role-disable')),null);
  assert.deepEqual(await repo.issue(issue('new-role')),{created:true});
  assert.deepEqual(await repo.resolve(lookup('new-role')),{userId:'USR-1',roleId:'ROL-2'});
});

test('unknown users, duplicate token digests and missing tokens never silently create valid sessions',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  assert.equal(await repo.resolve(lookup('absent')),null);
  assert.equal(await repo.revoke(lookup('absent')),false);
  await assert.rejects(()=>repo.issue(issue('missing','USR-UNKNOWN')),/inactive|missing|refus|cannot|unavailable/i);
  assert.equal((await state()).length,0);
  await repo.issue(issue('duplicate'));
  await assert.rejects(()=>repo.issue(issue('duplicate')),/UNIQUE|constraint|already|D1/i);
  assert.equal((await state()).length,1);
  assert.deepEqual(await repo.resolve(lookup('duplicate')),{userId:'USR-1',roleId:'ROL-1'});
});

test('concurrent identical session issue cannot persist duplicate digests',async()=>{
  const repo=createSyntheticD1SessionRepository(DB);
  const out=await Promise.allSettled([repo.issue(issue('race')),repo.issue(issue('race'))]);
  assert.equal(out.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(out.filter(r=>r.status==='rejected').length,1);
  assert.equal((await state()).length,1);
});

test('invalid digest, untrusted time, unexpected properties and missing D1 fail before DB queries',async()=>{
  assert.throws(()=>createSyntheticD1SessionRepository({}),/binding|D1/i);
  const broken={prepare(){throw new Error('MUST_NOT_QUERY');}};
  const repo=createSyntheticD1SessionRepository(broken);
  for(const bad of [null,[],{}, {...lookup('x'),tokenHash:'invalid'}, {...lookup('x'),now:-1},
    {...lookup('x'),now:1.5},{...lookup('x'),unexpected:'evil'}]){
    await assert.rejects(()=>repo.resolve(bad),/invalid|digest|time/i);
    await assert.rejects(()=>repo.revoke(bad),/invalid|digest|time/i);
  }
  for(const bad of [null,{},[],{...issue('x'),userId:''},
    {...issue('x'),userId:' OTHER '},{...issue('x'),now:'1000'},
    {...issue('x'),expiresAt:Infinity},{...issue('x'),extra:'attacker'}]){
    await assert.rejects(()=>repo.issue(bad),/invalid|digest|time|user|expir/i);
  }
});

test('dedicated D1 harness remains test-only with no deployed session RPC route',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-session-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m04-session-worker.mjs');
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),['00000000-0000-0000-0000-000000000005']);
  const response=await worker.fetch('http://test-only/__m04_session__/login',{method:'POST'});
  assert.equal(response.status,404);
  const publicEntry=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(publicEntry.includes('m04-session-repository'),false);
});
