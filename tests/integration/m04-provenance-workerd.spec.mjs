import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-provenance-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-source-provenance-local-only');
let DB;
const created='2025-01-20T12:05:06.000Z';
const roleCreated='2025-01-20T12:06:07.000Z';
const loginCreated='2025-06-30T08:09:10.000Z';

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>harness.close());

test('real versioned D1 migrates 0001–0011: four nullable source columns and two immutability guards',async()=>{
  const migration=(await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n;
  assert.equal(migration,11);
  const users=await DB.prepare("SELECT name FROM pragma_table_info('auth_users') WHERE name IN ('source_created_by','source_created_at_iso','source_last_login_iso')").all();
  const roles=await DB.prepare("SELECT name FROM pragma_table_info('auth_roles') WHERE name='source_created_at_iso'").all();
  assert.equal(users.results.length,3);
  assert.equal(roles.results.length,1);
  const triggers=await DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_auth_user_provenance_immutable','trg_auth_role_provenance_immutable')").all();
  assert.equal(triggers.results.length,2);
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-provenance-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000023');
  assert.equal((await worker.fetch('http://m04-provenance.local/api/rpc')).status,404);
});

test('original source actor and exact UTC history preserve blank never-logged-in value',async()=>{
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,source_role_id,status,permissions_json,allowed_modules,source_created_at_iso)
    VALUES ('Cashier','ROL-PROV-1','Active','{}','',?)`).bind(roleCreated).run();
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations,
     source_created_by,source_created_at_iso,source_last_login_iso)
    VALUES ('USR-PROV-ADMIN','Synthetic Admin','01790000988','Administrator','Active',?,?,210000,?,?,?)`)
    .bind('ab'.repeat(32),'cd'.repeat(24),'First-run bootstrap',created,'').run();
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations,
     source_created_by,source_created_at_iso,source_last_login_iso)
    VALUES ('USR-PROV-CASH','Synthetic Cashier','01790000989','Cashier','Active',?,?,210000,?,?,?)`)
    .bind('bc'.repeat(32),'de'.repeat(24),'Source actor text',created,loginCreated).run();
  assert.deepEqual(await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-PROV-ADMIN'`).first(),{
    source_created_by:'First-run bootstrap',
    source_created_at_iso:created,
    source_last_login_iso:'',
  });
  assert.equal((await DB.prepare(`SELECT source_created_at_iso
    FROM auth_roles WHERE role_name='Cashier'`).first()).source_created_at_iso,roleCreated);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES ('USR-NATIVE','Native User','01790000990','Cashier','Active',?,?,210000)`)
    .bind('ef'.repeat(32),'12'.repeat(24)).run();
  assert.deepEqual(await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-NATIVE'`).first(),{
      source_created_by:null,source_created_at_iso:null,source_last_login_iso:null,
    });
});

test('source fields are SQL-immutable when populated, including clearing blank Last Login',async()=>{
  for(const column of ['source_created_by','source_created_at_iso','source_last_login_iso']){
    await assert.rejects(()=>DB.prepare(`UPDATE auth_users SET ${column}=?
      WHERE user_id='USR-PROV-ADMIN'`).bind(null).run(),/staff source provenance immutable/i);
  }
  await assert.rejects(()=>DB.prepare(`UPDATE auth_users SET source_last_login_iso=?
    WHERE user_id='USR-PROV-CASH'`).bind('2025-07-01T10:00:00.000Z').run(),/staff source provenance immutable/i);
  await assert.rejects(()=>DB.prepare(`UPDATE auth_roles SET source_created_at_iso=NULL
    WHERE source_role_id='ROL-PROV-1'`).run(),/role source provenance immutable/i);
  await DB.prepare(`UPDATE auth_users SET full_name='Native User Updated'
    WHERE user_id='USR-NATIVE'`).run();
  await DB.prepare(`UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'`).run();
  assert.equal((await DB.prepare(`SELECT source_created_at_iso FROM auth_roles
    WHERE role_name='Cashier'`).first()).source_created_at_iso,roleCreated);
});

test('noncanonical source timestamp formats fail DB constraints while NULL history stays valid',async()=>{
  await assert.rejects(()=>DB.prepare(`UPDATE auth_users SET source_created_at_iso=?
    WHERE user_id='USR-NATIVE'`).bind('2025-01-20T12:05:06Z').run(),/constraint|check/i);
  await assert.rejects(()=>DB.prepare(`UPDATE auth_users SET source_last_login_iso=?
    WHERE user_id='USR-NATIVE'`).bind('2025-01-20T18:05:06.000+06:00').run(),/constraint|check/i);
  await assert.rejects(()=>DB.prepare(`INSERT INTO auth_roles
    (role_name,status,source_created_at_iso) VALUES ('InvalidRole','Active',?)`)
    .bind('2025-01-20').run(),/constraint|check/i);
  assert.equal((await DB.prepare("SELECT source_created_at_iso FROM auth_users WHERE user_id='USR-NATIVE'").first()).source_created_at_iso,null);
});

test('verified source role directory retains role ID and history without inventing native metadata',async()=>{
  const {createOfflinePasswordCredential,loginWithD1}=await import('../../src/auth/d1-auth-core.js');
  const {readRoleDirectoryPreviewWithD1}=await import('../../src/auth/d1-role-directory.js');
  const time=1_800_300_000_000;
  const password='SyntheticProvRoleTest!2026';
  const cred=await createOfflinePasswordCredential(password);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES ('USR-PROV-ROLE-VIEW','Synthetic Role Viewer','01790000991','Administrator',
      'Active',?,?,?)`)
    .bind(cred.passwordHash,cred.passwordSalt,cred.iterations).run();
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,source_role_id,source_created_at_iso)
    VALUES ('M04IncompleteRole','Inactive','{}','ROL-M04-INCOMPLETE',NULL),
      ('M04NativeRole','Active','{}',NULL,NULL)`).run();

  const admin=await loginWithD1(DB,{
    phoneKey:'01790000991',password,nowMs:time,
  });
  assert.equal(admin.authenticated,true);
  assert.deepEqual(await readRoleDirectoryPreviewWithD1(DB,{
    token:'forged',nowMs:time+1000,
  }),{authorized:false},'valid current D1 roles.view remains mandatory');

  const result=await readRoleDirectoryPreviewWithD1(DB,{
    token:admin.token,nowMs:time+1000,
  });
  assert.equal(result.authorized,true);
  assert.equal(result.partial,true,'still not a public full source Roles bootstrap');
  const byName=name=>result.roles.find(row=>row.name===name);
  assert.deepEqual(byName('Cashier'),{
    name:'Cashier',status:'Inactive',
    sourceRoleId:'ROL-PROV-1',sourceCreatedAt:roleCreated,
  },'both original Role ID and Created At are preserved exactly');
  assert.deepEqual(byName('M04IncompleteRole'),{
    name:'M04IncompleteRole',status:'Inactive',
  },'an incomplete provenance pair must not be invented');
  assert.deepEqual(byName('M04NativeRole'),{
    name:'M04NativeRole',status:'Active',
  },'a D1-native role is not given fabricated source history');
  assert.equal(result.roles.some(r=>Object.hasOwn(r,'permissions')),false);
  assert.equal(result.roles.some(r=>Object.hasOwn(r,'authVersion')),false);
});


test('staff directory projects verified Created By, Created At and blank or present Last Login from real D1',async()=>{
  const {createOfflinePasswordCredential,loginWithD1}=await import('../../src/auth/d1-auth-core.js');
  const {readStaffDirectoryPreviewWithD1}=await import('../../src/auth/d1-staff-directory.js');
  const nowMs=1_800_320_000_000;
  const password='SyntheticStaffProvenanceOnly!2026';
  const credential=await createOfflinePasswordCredential(password);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES ('USR-DIR-ACTOR','Synthetic Directory Actor','01790000992','Administrator',
      'Active',?,?,?)`).bind(credential.passwordHash,credential.passwordSalt,credential.iterations).run();

  // Source-created staff with Last Login='' is NOT the same as null.
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations,
      source_created_by,source_created_at_iso,source_last_login_iso)
    VALUES ('USR-DIR-NEVER','Source Never Logged In','01790000993','Administrator',
      'Active',?,?,?,'First-run bootstrap',?,''),
      ('USR-DIR-LOGGED','Source Previously Logged In','01790000994','Administrator',
      'Inactive',?,?,?,'Original shop owner',?,?),
      ('USR-DIR-INCOMPLETE','Incomplete Source','01790000995','Administrator',
      'Inactive',?,?,?,'Original shop owner',?,NULL),
      ('USR-DIR-NATIVE','D1 Native','01790000996','Administrator',
      'Active',?,?,?,NULL,NULL,NULL)`)
    .bind(
      credential.passwordHash,credential.passwordSalt,credential.iterations,created,
      credential.passwordHash,credential.passwordSalt,credential.iterations,created,loginCreated,
      credential.passwordHash,credential.passwordSalt,credential.iterations,created,
      credential.passwordHash,credential.passwordSalt,credential.iterations,
    ).run();

  const session=await loginWithD1(DB,{phoneKey:'01790000992',password,nowMs});
  assert.equal(session.authenticated,true);
  assert.deepEqual(await readStaffDirectoryPreviewWithD1(DB,{
    token:'forged',nowMs:nowMs+1000,
  }),{authorized:false},'untrusted caller never sees the staff directory');

  const preview=await readStaffDirectoryPreviewWithD1(DB,{
    token:session.token,nowMs:nowMs+1000,
  });
  assert.equal(preview.authorized,true);
  assert.equal(preview.partial,true,'this remains an internal partial Users bootstrap');
  const person=id=>preview.users.find(user=>user.id===id);
  assert.deepEqual(person('USR-DIR-NEVER'),{
    id:'USR-DIR-NEVER',name:'Source Never Logged In',mobile:'01790000993',
    role:'Administrator',status:'Active',
    createdBy:'First-run bootstrap',createdAt:created,lastLogin:'',
  },'blank original Last Login is preserved instead of fabricated');
  assert.deepEqual(person('USR-DIR-LOGGED'),{
    id:'USR-DIR-LOGGED',name:'Source Previously Logged In',mobile:'01790000994',
    role:'Administrator',status:'Inactive',
    createdBy:'Original shop owner',createdAt:created,lastLogin:loginCreated,
  },'an inactive original staff member retains immutable login history');
  assert.deepEqual(person('USR-DIR-INCOMPLETE'),{
    id:'USR-DIR-INCOMPLETE',name:'Incomplete Source',mobile:'01790000995',
    role:'Administrator',status:'Inactive',
  },'incomplete source history must not be presented as verified');
  assert.deepEqual(person('USR-DIR-NATIVE'),{
    id:'USR-DIR-NATIVE',name:'D1 Native',mobile:'01790000996',
    role:'Administrator',status:'Active',
  },'no source history is ever invented for native D1 staff');
  const serialized=JSON.stringify(preview);
  for(const secret of ['password_hash','password_salt','auth_version',
    'credential_version','token_hash','permissions_json',password]){
    assert.equal(serialized.includes(secret),false,'private field escaped: '+secret);
  }
});
