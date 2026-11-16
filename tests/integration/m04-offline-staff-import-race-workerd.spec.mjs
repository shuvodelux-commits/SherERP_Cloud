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
