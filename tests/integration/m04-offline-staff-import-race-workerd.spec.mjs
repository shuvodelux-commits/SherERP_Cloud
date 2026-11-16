import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {importLegacyStaffSnapshotWithD1} from
  '../../src/auth/d1-offline-staff-import.js';

/**
 * Independent local D1 database for an interrupted offline import:
 * a second trusted writer commits AFTER the importer's empty-store preflight
 * and BEFORE the import batch. No Cloudflare remote or live staff data.
 */
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-offline-staff-import-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-offline-staff-import-local-only');
let DB;
const SALT='123e4567-e89b-42d3-a456-426614174000';
const source=()=>({
  users:[{
    'User ID':'USR-RACE-ADMIN','Full Name':'Synthetic Race Administrator',
    'Mobile Number':'01790000991',
    'Password Hash':createHash('sha256').update('Synthetic-Race-Only!'+SALT).digest('hex'),
    'Password Salt':SALT,'Role':'Administrator','Status':'Active',
    'Created By':'First-run bootstrap','Created At':'2025-01-20T12:05:06.000Z',
    'Last Login':'',
  }],
  roles:[],
});
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>harness.close());

test('a new unrelated staff role between preflight and batch aborts whole D1 import',async()=>{
  const db={
    prepare(sql){return DB.prepare(sql);},
    async batch(statements){
      // A second writer can commit after the first empty check.
      await DB.prepare(`INSERT INTO auth_roles
        (role_name,status,permissions_json,allowed_modules)
        VALUES ('ExternalRole','Inactive','{}','')`).run();
      return DB.batch(statements);
    },
  };
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(db,source()),err=>{
    assert.equal(err.message,'Offline staff import rejected');
    return true;
  });
  const persisted=await DB.prepare(`SELECT
    (SELECT COUNT(*) FROM auth_roles) AS roles,
    (SELECT COUNT(*) FROM auth_users) AS users,
    (SELECT COUNT(*) FROM auth_legacy_credentials) AS legacyCredentials,
    (SELECT COUNT(*) FROM auth_sessions) AS sessions`).first();
  assert.deepEqual(persisted,{roles:1,users:0,legacyCredentials:0,sessions:0});
  assert.equal((await DB.prepare(`SELECT role_name FROM auth_roles
    WHERE role_name='ExternalRole'`).first()).role_name,'ExternalRole');
});


test('post-commit caller mutation cannot invalidate original captured D1 source reconciliation',async()=>{
  // The previous regression intentionally left an unrelated role in the
  // disposable D1. Remove only that synthetic role to exercise a fresh import.
  await DB.prepare("DELETE FROM auth_roles WHERE role_name='ExternalRole'").run();
  const callerSource=source();
  const originalCreatedBy=callerSource.users[0]['Created By'];
  let committed=false;
  const db={
    prepare(sql){return DB.prepare(sql);},
    async batch(statements){
      const result=await DB.batch(statements);
      committed=true;
      // Model a caller editing the original export after the importer has
      // committed the validated captured rows but BEFORE readback executes.
      callerSource.users[0]['Created By']='Changed AFTER atomic D1 commit';
      return result;
    },
  };
  const result=await importLegacyStaffSnapshotWithD1(db,callerSource);
  assert.equal(committed,true);
  assert.deepEqual(result,{
    imported:true,
    counts:{users:1,roles:0,legacyCredentials:1},
    readbackMatch:true,
  });
  assert.equal(callerSource.users[0]['Created By'],'Changed AFTER atomic D1 commit');
  const readback=await DB.prepare(`SELECT source_created_by,source_created_at_iso,
    source_last_login_iso FROM auth_users WHERE user_id='USR-RACE-ADMIN'`).first();
  assert.deepEqual(readback,{
    source_created_by:originalCreatedBy,
    source_created_at_iso:'2025-01-20T12:05:06.000Z',
    source_last_login_iso:'',
  });
  const stats=await DB.prepare(`SELECT
    (SELECT COUNT(*) FROM auth_users) AS users,
    (SELECT COUNT(*) FROM auth_roles) AS roles,
    (SELECT COUNT(*) FROM auth_legacy_credentials) AS legacyCredentials`).first();
  assert.deepEqual(stats,{users:1,roles:0,legacyCredentials:1});
});
