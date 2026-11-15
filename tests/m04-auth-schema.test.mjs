import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const fixture=new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url);
const sql=readFileSync(fixture,'utf8');
const fakePassword='ab'.repeat(32);
const fakeSalt='cd'.repeat(24);
function setup(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql);
  return db;
}
function addUser(db,id,phone,role='Administrator',status='Active'){
  db.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id,'Synthetic Staff '+id,phone,role,status,fakePassword,fakeSalt,210000);
}

test('auth SQL fixture is isolated from production migration directory and public RPC',()=>{
  assert.match(sql,/NONDEPLOYABLE LOCAL TEST FIXTURE/);
  const realMigrations=['0001_core_catalog.sql','0002_party_identity.sql'];
  for(const name of realMigrations)
    assert.doesNotMatch(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'),/auth_users|auth_sessions/);
  const main=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/m04-auth-worker|d1-auth-core|auth_users/);
  assert.doesNotMatch(registry,/m04-auth-worker|d1-auth-core|auth_users/);
});

test('SQL creates only proposed staff and session tables and uses strict uniqueness',()=>{
  const db=setup();
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(names,['auth_legacy_credentials','auth_login_throttle','auth_roles','auth_sessions','auth_users']);
  addUser(db,'USR-1','01710000001');
  assert.throws(()=>addUser(db,'USR-2','01710000001'),/UNIQUE/);
  assert.throws(()=>addUser(db,'USR-2','not-phone'),/CHECK/);
  assert.throws(()=>addUser(db,'USR-2','01710000002','Administrator','Disabled'),/CHECK/);
  db.close();
});

test('last active Administrator can never be deleted, demoted or disabled by SQL',()=>{
  const db=setup();
  addUser(db,'USR-1','01710000001');
  assert.throws(()=>db.prepare("DELETE FROM auth_users WHERE user_id='USR-1'").run(),/last active administrator/);
  assert.throws(()=>db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-1'").run(),/last active administrator/);
  assert.throws(()=>db.prepare("UPDATE auth_users SET role_name='Cashier' WHERE user_id='USR-1'").run(),/last active administrator/);
  addUser(db,'USR-2','01710000002');
  db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-1'").run();
  assert.throws(()=>db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-2'").run(),/last active administrator/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE status='Active' AND role_name='Administrator'").get().n,1);
  db.close();
});

test('SQL blocks raw session token, malformed salts, and duplicate session fingerprints',()=>{
  const db=setup(); addUser(db,'USR-1','01710000001');
  assert.throws(()=>db.prepare(`INSERT INTO auth_sessions
   (token_hash,user_id,created_at_ms,last_activity_at_ms,expires_at_ms,user_auth_version,credential_version)
   VALUES (?,?,?,?,?,1,1)`).run('raw-session-token','USR-1',1,1,2),/CHECK/);
  const insert=db.prepare(`INSERT INTO auth_sessions
   (token_hash,user_id,created_at_ms,last_activity_at_ms,expires_at_ms,user_auth_version,credential_version)
   VALUES (?,?,?,?,?,1,1)`);
  insert.run('ef'.repeat(32),'USR-1',1,1,2);
  assert.throws(()=>insert.run('ef'.repeat(32),'USR-1',1,1,2),/UNIQUE/);
  assert.throws(()=>insert.run('ab'.repeat(32),'UNKNOWN',1,1,2),/FOREIGN KEY/);
  db.close();
});

test('legacy SHA256 credential metadata is not silently accepted as modern KDF',()=>{
  const db=setup();
  assert.throws(()=>db.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_algo,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('USR-1','Test','01710000001','Administrator','Active','legacy-sha256',fakePassword,fakeSalt,210000),/CHECK/);
  db.close();
});

test('legacy import is isolated to pending staff and source verifier is erased atomically on upgrade',()=>{
  const db=setup();
  addUser(db,'MODERN','01710000001');
  const legacyHash='ef'.repeat(32);
  const salt='synthetic-legacy-uuid-only';
  const importLegacy=db.prepare('INSERT INTO auth_legacy_credentials(user_id,legacy_hash,legacy_salt) VALUES (?,?,?)');
  assert.throws(()=>importLegacy.run('MODERN',legacyHash,salt),/pending staff identity/);
  assert.throws(()=>db.prepare("UPDATE auth_users SET credential_state='LegacyPending' WHERE user_id='MODERN'").run(),/downgrade forbidden/);
  db.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,credential_state,password_hash,password_salt,password_iterations)
    VALUES ('PENDING','Synthetic Pending','01710000002','Administrator','Active','LegacyPending',?,?,210000)`)
    .run('ab'.repeat(32),'cd'.repeat(24));
  importLegacy.run('PENDING',legacyHash,salt);
  assert.equal(db.prepare("SELECT auth_version AS n FROM auth_users WHERE user_id='PENDING'").get().n,1);
  db.prepare(`UPDATE auth_users SET credential_state='Modern',password_hash=?,password_salt=?,
    credential_version=credential_version+1 WHERE user_id='PENDING'`)
    .run('89'.repeat(32),'00'.repeat(24));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='PENDING'").get().n,0);
  assert.equal(db.prepare("SELECT auth_version AS n FROM auth_users WHERE user_id='PENDING'").get().n,2);
  assert.equal(db.prepare("SELECT credential_version AS n FROM auth_users WHERE user_id='PENDING'").get().n,2);
  db.close();
});
