import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importLegacyStaffSnapshotWithD1,reconcileLegacyStaffSnapshotWithD1,
  rehearseFrozenLegacyStaffImportWithD1} from
  '../../src/auth/d1-offline-staff-import.js';
import {loginWithD1} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-offline-staff-import-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-offline-staff-import-local-only');
const PASSWORD='SyntheticOfflineImportPassword!2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update(PASSWORD+SALT,'utf8').digest('hex');
const permissionJSON=JSON.stringify({
  products:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'},
});
const user=(id,phone,role)=>({
  'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
  'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
  'Created By':role==='Administrator'?'First-run bootstrap':'Source actor display',
  'Created At':'2025-01-20T12:05:06.000Z',
  'Last Login':role==='Administrator'?'':'2025-06-30T08:09:10.000Z',
});
const source=()=>({
  users:[
    user('USR-IMPORT-ADMIN','01790000601','Administrator'),
    user('USR-IMPORT-CASH',1790000602,'Cashier'),
  ],
  roles:[{
    'Role ID':'ROL-IMPORT-CASH','Role Name':'Cashier',
    'Allowed Modules':'products','Permissions':permissionJSON,'Status':'Active',
    'Created At':'2025-01-20T12:06:07.000Z',
  }],
});
let DB;
const counts=()=>DB.prepare(`SELECT
  (SELECT COUNT(*) FROM auth_roles) AS roles,
  (SELECT COUNT(*) FROM auth_users) AS users,
  (SELECT COUNT(*) FROM auth_legacy_credentials) AS legacyCredentials,
  (SELECT COUNT(*) FROM auth_sessions) AS sessions`).first();
const ZERO={roles:0,users:0,legacyCredentials:0,sessions:0};

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('real 0003/0004 migrations and isolated local worker contain no import HTTP/RPC route',async()=>{
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n,13);
  assert.deepEqual(await counts(),ZERO);
  assert.equal((await worker.fetch('http://m04-import.local/')).status,404);
  assert.equal((await worker.fetch('http://m04-import.local/api/rpc')).status,404);
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-offline-staff-import-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000022');
  const publicWorker=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(publicWorker,/importLegacyStaffSnapshotWithD1/);
});

test('invalid or ambiguous permissions cannot cause a single D1 operation',async()=>{
  const s=source();
  s.roles[0]['Allowed Modules']='products,users';
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,s),/Offline staff import rejected/);
  assert.deepEqual(await counts(),ZERO);
});

test('incomplete or invalid historical source metadata cannot write to real local D1',async()=>{
  const missing=source();
  delete missing.users[0]['Created By'];
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,missing),
    /Offline staff import rejected/);
  const invalid=source();
  invalid.users[1]['Last Login']='2025-06-30';
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,invalid),
    /Offline staff import rejected/);
  const wrongRole=source();
  wrongRole.roles[0]['Created At']='2025-02-30T12:06:07.000Z';
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,wrongRole),
    /Offline staff import rejected/);
  assert.deepEqual(await counts(),ZERO);
});

test('real isolated D1 importer refuses an unreviewed USERS/ROLES column without writing staff or legacy verifiers',async()=>{
  for(const patch of [
    s=>{s.users[0]['Unreviewed New Source Column']='synthetic';},
    s=>{s.roles[0]['Unreviewed Permission Column']='synthetic';},
    s=>Object.defineProperty(s.roles[0],'Hidden Sheet Column',{value:'synthetic',enumerable:false}),
    s=>Object.defineProperty(s.users[0],'Created By',{
      value:s.users[0]['Created By'],enumerable:false
    }),
  ]){
    const s=source();
    patch(s);
    await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,s),err=>{
      assert.equal(err.message,'Offline staff import rejected');
      return true;
    });
    assert.deepEqual(await counts(),ZERO,'unreviewed export shape must not write any D1 records');
  }
});

test('source freeze-gated rehearsal rejects distinct drift and aliased snapshots before real D1 calls',async()=>{
  const first=source();
  await assert.rejects(()=>rehearseFrozenLegacyStaffImportWithD1(DB,first,first),
    /Offline staff import rejected/);
  const second=structuredClone(first);
  second.roles[0]['Permissions']='{}';
  await assert.rejects(()=>rehearseFrozenLegacyStaffImportWithD1(DB,first,second),
    /Offline staff import rejected/);
  const altered=structuredClone(first);
  altered.users[0]['Last Login']='2025-01-21T12:05:06.000Z';
  await assert.rejects(()=>rehearseFrozenLegacyStaffImportWithD1(DB,first,altered),
    /Offline staff import rejected/);
  assert.deepEqual(await counts(),ZERO);
});

test('real D1 batch rolls back roles, users and legacy secrets on a late user insert failure',async()=>{
  const ddl=`CREATE TRIGGER test_import_late_abort
    BEFORE INSERT ON auth_users WHEN NEW.user_id='USR-IMPORT-CASH'
    BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END`;
  await DB.prepare(ddl).run();
  try{
    await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,source()),e=>{
      assert.equal(e.message,'Offline staff import rejected');
      assert.doesNotMatch(e.message,/synthetic interruption|USR-|ROL-|Password|0179/);
      return true;
    });
    assert.deepEqual(await counts(),ZERO,'failed batch must not commit any role, user or secret');
  }finally{
    await DB.prepare('DROP TRIGGER test_import_late_abort').run();
  }
});

test('one-shot local import preserves exact legacy IDs, source role and separate pending verifiers',async()=>{
  const expected=source();
  const before=structuredClone(expected);
  const result=await rehearseFrozenLegacyStaffImportWithD1(DB,expected,structuredClone(expected));
  assert.deepEqual(result,{
    imported:true,
    counts:{users:2,roles:1,legacyCredentials:2},
    readbackMatch:true,
  });
  assert.deepEqual(expected,before,'import never mutates the frozen export records');
  assert.deepEqual(await counts(),{roles:1,users:2,legacyCredentials:2,sessions:0});

  const role=await DB.prepare(`SELECT role_name,source_role_id,permissions_json
    FROM auth_roles WHERE source_role_id='ROL-IMPORT-CASH'`).first();
  assert.deepEqual(role,{
    role_name:'Cashier',source_role_id:'ROL-IMPORT-CASH',permissions_json:permissionJSON,
  });
  assert.equal((await DB.prepare(`SELECT source_created_at_iso
    FROM auth_roles WHERE source_role_id='ROL-IMPORT-CASH'`).first()).source_created_at_iso,
    '2025-01-20T12:06:07.000Z');
  const stored=await DB.prepare(`SELECT user_id,phone_key,role_name,credential_state,
    password_algo,password_hash,password_salt,password_iterations
    FROM auth_users WHERE user_id='USR-IMPORT-CASH'`).first();
  assert.equal(stored.user_id,'USR-IMPORT-CASH');
  assert.equal(stored.phone_key,'01790000602','Sheets integer mobile restored with leading zero');
  assert.equal(stored.role_name,'Cashier');
  assert.equal(stored.credential_state,'LegacyPending');
  assert.deepEqual(await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-IMPORT-CASH'`).first(),{
    source_created_by:'Source actor display',
    source_created_at_iso:'2025-01-20T12:05:06.000Z',
    source_last_login_iso:'2025-06-30T08:09:10.000Z',
  });
  assert.deepEqual(await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-IMPORT-ADMIN'`).first(),{
    source_created_by:'First-run bootstrap',
    source_created_at_iso:'2025-01-20T12:05:06.000Z',
    source_last_login_iso:'',
  });
  assert.equal(stored.password_algo,'pbkdf2-sha256');
  assert.equal(stored.password_iterations,210000);
  assert.match(stored.password_hash,/^[a-f0-9]{64}$/);
  assert.match(stored.password_salt,/^[a-f0-9]{48}$/);
  assert.notEqual(stored.password_hash,HASH);
  assert.notEqual(stored.password_salt,SALT);
  assert.deepEqual(await DB.prepare(`SELECT legacy_hash,legacy_salt
    FROM auth_legacy_credentials WHERE user_id='USR-IMPORT-CASH'`).first(),
    {legacy_hash:HASH,legacy_salt:SALT});
});

test('reimport is rejected before any write, including mismatched IDs and credentials',async()=>{
  const original=await counts();
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,source()),
    /Offline staff import store not empty/);
  assert.deepEqual(await counts(),original);
});

test('reconciliation compares every D1 row and returns only redacted codes and counts',async()=>{
  const exact=await reconcileLegacyStaffSnapshotWithD1(DB,source());
  assert.deepEqual(exact,{
    match:true,counts:{users:2,roles:1,legacyCredentials:2},issues:[],
  });
  const serialized=JSON.stringify(exact);
  for(const item of ['USR-IMPORT','ROL-IMPORT','017900006',HASH,SALT,PASSWORD,permissionJSON]){
    assert.equal(serialized.includes(item),false);
  }
});

test('post-import role and password-verifier drift is detected without leaking source fields',async()=>{
  await DB.prepare(`UPDATE auth_roles SET permissions_json='{}' WHERE role_name='Cashier'`).run();
  const r=await reconcileLegacyStaffSnapshotWithD1(DB,source());
  assert.equal(r.match,false);
  assert.ok(r.issues.some(x=>x.code==='ROLE_READBACK_MISMATCH'));
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind(permissionJSON,'Cashier').run();

  await DB.prepare(`UPDATE auth_legacy_credentials SET legacy_hash=?
    WHERE user_id='USR-IMPORT-CASH'`).bind('ab'.repeat(32)).run();
  const secretDrift=await reconcileLegacyStaffSnapshotWithD1(DB,source());
  assert.equal(secretDrift.match,false);
  assert.ok(secretDrift.issues.some(x=>x.code==='LEGACY_VERIFIER_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(secretDrift),/USR-IMPORT|ab{12}|017900|Password/);
  await DB.prepare(`UPDATE auth_legacy_credentials SET legacy_hash=?
    WHERE user_id='USR-IMPORT-CASH'`).bind(HASH).run();
  assert.equal((await reconcileLegacyStaffSnapshotWithD1(DB,source())).match,true);
});

test('readback denies altered source history without disclosing actor or timestamp',async()=>{
  const actorChanged=source();
  actorChanged.users[1]['Created By']='Alternate source actor';
  const actorReport=await reconcileLegacyStaffSnapshotWithD1(DB,actorChanged);
  assert.equal(actorReport.match,false);
  assert.ok(actorReport.issues.some(x=>x.code==='USER_PROVENANCE_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(actorReport),/Alternate source actor|USR-IMPORT|017900|Password/);

  const timeChanged=source();
  timeChanged.users[0]['Last Login']='2025-07-01T08:09:10.000Z';
  const timeReport=await reconcileLegacyStaffSnapshotWithD1(DB,timeChanged);
  assert.equal(timeReport.match,false);
  assert.ok(timeReport.issues.some(x=>x.code==='USER_PROVENANCE_MISMATCH'));

  const roleChanged=source();
  roleChanged.roles[0]['Created At']='2025-01-21T12:06:07.000Z';
  const roleReport=await reconcileLegacyStaffSnapshotWithD1(DB,roleChanged);
  assert.equal(roleReport.match,false);
  assert.ok(roleReport.issues.some(x=>x.code==='ROLE_PROVENANCE_MISMATCH'));
  assert.equal((await reconcileLegacyStaffSnapshotWithD1(DB,source())).match,true);
});

test('legacy first-login upgrade is guarded by existing auth core, not by the importer',async()=>{
  const first=await loginWithD1(DB,{
    phoneKey:'01790000602',password:'bad password',nowMs:1_801_200_000_000,
  });
  assert.deepEqual(first,{authenticated:false});
  assert.equal((await DB.prepare(`SELECT credential_state FROM auth_users
    WHERE user_id='USR-IMPORT-CASH'`).first()).credential_state,'LegacyPending');
  const valid=await loginWithD1(DB,{
    phoneKey:'01790000602',password:PASSWORD,nowMs:1_801_200_001_000,
  });
  assert.equal(valid.authenticated,true);
  assert.equal(valid.user.id,'USR-IMPORT-CASH');
  const modern=await DB.prepare(`SELECT credential_state,credential_version,
    password_hash FROM auth_users WHERE user_id='USR-IMPORT-CASH'`).first();
  assert.equal(modern.credential_state,'Modern');
  assert.equal(modern.credential_version,2);
  assert.notEqual(modern.password_hash,HASH);
  assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_legacy_credentials
    WHERE user_id='USR-IMPORT-CASH'`).first()).n,0);
  assert.deepEqual(await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-IMPORT-CASH'`).first(),{
    source_created_by:'Source actor display',
    source_created_at_iso:'2025-01-20T12:05:06.000Z',
    source_last_login_iso:'2025-06-30T08:09:10.000Z',
  });
});
