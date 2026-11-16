import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';

// Ephemeral, nondeployable Workerd D1: never a remote/staging/production DB.
const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-m04-integrated-auth-test.jsonc',
}]});
const worker=harness.getWorker('shererp-m02-m04-integrated-auth-local-test');
const NOW='2026-11-16T04:00:00.000Z';
const PREV='2026-11-15T22:00:00.000Z';
let DB;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,source_role_id,status) VALUES ('Cashier','ROL-PROV-01','Active')`).run();
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES ('USR-PROV-01','Synthetic Staff','01790000921','Cashier','Active',?,?,210000)`)
    .bind('a'.repeat(64),'b'.repeat(48)).run();
});
after(async()=>harness.close());

test('versioned D1 0004 contains exactly two source-only immutable provenance tables',async()=>{
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n,4);
  const rows=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('auth_user_source_provenance','auth_role_source_provenance')
    ORDER BY name`).all();
  assert.deepEqual(rows.results.map(x=>x.name),[
    'auth_role_source_provenance','auth_user_source_provenance',
  ]);
  const guards=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'
    AND name LIKE 'trg_auth_%_provenance_%'`).all();
  assert.equal(guards.results.length,6);
});

test('source Created By and UTC dates round-trip without inventing a Party identity',async()=>{
  await DB.prepare(`INSERT INTO auth_role_source_provenance
    (source_role_id,source_created_at_iso) VALUES (?,?)`)
    .bind('ROL-PROV-01',PREV).run();
  await DB.prepare(`INSERT INTO auth_user_source_provenance
    (user_id,source_created_by,source_created_at_iso,source_last_login_at_iso)
    VALUES (?,?,?,?)`)
    .bind('USR-PROV-01','First-run bootstrap',PREV,null).run();
  assert.deepEqual(await DB.prepare(`SELECT user_id,source_created_by,
      source_created_at_iso,source_last_login_at_iso
    FROM auth_user_source_provenance WHERE user_id='USR-PROV-01'`).first(),{
    user_id:'USR-PROV-01',
    source_created_by:'First-run bootstrap',
    source_created_at_iso:PREV,
    source_last_login_at_iso:null,
  });
  assert.deepEqual(await DB.prepare(`SELECT * FROM auth_role_source_provenance
    WHERE source_role_id='ROL-PROV-01'`).first(),{
    source_role_id:'ROL-PROV-01',
    source_created_at_iso:PREV,
  });
});

test('invalid, ambiguous and offset timestamps cannot enter source-history tables',async()=>{
  for(const invalid of [
    '2026-11-16T10:00:00+06:00',
    '2026-99-16T04:00:00.000Z',
    '2026-11-16T04:00:00Z',
    '2026-11-16T04:00:00.000+00:00',
    '2026-11-16T04:00:00.000z',
  ]){
    await assert.rejects(()=>DB.prepare(`INSERT INTO auth_user_source_provenance
      (user_id,source_created_by,source_created_at_iso)
      VALUES ('USR-PROV-BAD','Synthetic',?)`).bind(invalid).run(),/constraint|check|NOT NULL/i);
    await assert.rejects(()=>DB.prepare(`INSERT INTO auth_role_source_provenance
      (source_role_id,source_created_at_iso) VALUES ('ROL-PROV-BAD',?)`)
      .bind(invalid).run(),/constraint|check|NOT NULL/i);
  }
});

test('orphaned provenance rows cannot be imported without original staff/role identity',async()=>{
  await assert.rejects(()=>DB.prepare(`INSERT INTO auth_user_source_provenance
    (user_id,source_created_by,source_created_at_iso)
    VALUES ('USR-UNKNOWN','Unknown',?)`).bind(NOW).run(),/foreign|constraint/i);
  await assert.rejects(()=>DB.prepare(`INSERT INTO auth_role_source_provenance
    (source_role_id,source_created_at_iso) VALUES ('ROL-UNKNOWN',?)`)
    .bind(NOW).run(),/foreign|constraint/i);
});

test('SQL forbids update, delete and REPLACE of original staff and role source history',async()=>{
  await assert.rejects(()=>DB.prepare(`UPDATE auth_user_source_provenance
    SET source_created_by='Changed' WHERE user_id='USR-PROV-01'`).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM auth_user_source_provenance
    WHERE user_id='USR-PROV-01'`).run(),/deletion|forbidden/i);
  await assert.rejects(()=>DB.prepare(`INSERT OR REPLACE INTO auth_user_source_provenance
    (user_id,source_created_by,source_created_at_iso)
    VALUES ('USR-PROV-01','Changed',?)`).bind(NOW).run(),/replacement|forbidden/i);
  await assert.rejects(()=>DB.prepare(`UPDATE auth_role_source_provenance
    SET source_created_at_iso=? WHERE source_role_id='ROL-PROV-01'`)
    .bind(NOW).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM auth_role_source_provenance
    WHERE source_role_id='ROL-PROV-01'`).run(),/deletion|forbidden/i);
  await assert.rejects(()=>DB.prepare(`INSERT OR REPLACE INTO auth_role_source_provenance
    (source_role_id,source_created_at_iso) VALUES ('ROL-PROV-01',?)`)
    .bind(NOW).run(),/replacement|forbidden/i);
  assert.equal((await DB.prepare(`SELECT source_created_at_iso AS created
    FROM auth_role_source_provenance WHERE source_role_id='ROL-PROV-01'`).first()).created,PREV);
});

test('provenance protects original linked IDs but does not create a session or financial schema',async()=>{
  const sessions=await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first();
  assert.equal(sessions.n,0);
  const finance=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('party_accounts','journal_entries','cash_book','bank_book')`).all();
  assert.equal(finance.results.length,0);
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m02-m04-integrated-auth-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
});
