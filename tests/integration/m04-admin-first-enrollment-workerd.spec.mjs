import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {
  prepareAdminFirstLegacyStaffEnrollment,
  rehearseAdminFirstLegacyStaffImportWithD1,
} from '../../src/auth/m04-admin-first-enrollment.js';
import {loginWithD1} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-offline-staff-import-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-offline-staff-import-local-only');
const PASSWORD='SyntheticAdminFirstWorkerPassword!2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update(PASSWORD+SALT,'utf8').digest('hex');
const RIGHTS=JSON.stringify({products:{
 view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited',
}});
const user=(id,phone,role)=>({
 'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
 'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
 'Created By':'Synthetic source actor',
 'Created At':'2025-01-20T12:05:06.000Z',
 'Last Login':'2025-06-30T08:09:10.000Z',
});
const source=()=>({users:[
 user('USR-M04-ADM','01790000701','Administrator'),
 user('USR-M04-OWNER','123456','Owner'),
 user('USR-M04-SALES','01790000703','Sales'),
],roles:[
 {'Role ID':'ROL-M04-OWNER','Role Name':'Owner',
  'Allowed Modules':'products','Permissions':RIGHTS,'Status':'Active',
  'Created At':'2025-01-20T12:06:07.000Z'},
 {'Role ID':'ROL-M04-SALES','Role Name':'Sales',
  'Allowed Modules':'products','Permissions':RIGHTS,'Status':'Active',
  'Created At':'2025-01-20T12:06:07.000Z'},
]});
let DB;
before(async()=>{
 await harness.listen();
 await worker.applyD1Migrations('DB');
 ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});
const count=async t=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+t).first()).n;
test('full historical snapshot with original Owner phone cannot be imported directly',async()=>{
 const {importLegacyStaffSnapshotWithD1}=await import('../../src/auth/d1-offline-staff-import.js');
 await assert.rejects(()=>importLegacyStaffSnapshotWithD1(DB,source()),
   /Offline staff import rejected/);
 assert.equal(await count('auth_users'),0);
 assert.equal(await count('auth_legacy_credentials'),0);
});
test('real isolated Workerd/D1 imports valid original staff only and never inserts or disables original Owner',async()=>{
 const first=source(),confirmation=source();
 const prep=prepareAdminFirstLegacyStaffEnrollment(first,confirmation);
 assert.equal(prep.report.deferredOwnerUsers,1);
 assert.equal(first.users[1].Status,'Active');
 const result=await rehearseAdminFirstLegacyStaffImportWithD1(DB,first,confirmation);
 assert.equal(result.imported,true);
 assert.equal(result.readbackMatch,true);
 assert.equal(result.deferredOwnerUsers,1);
 assert.equal(await count('auth_users'),2);
 assert.equal(await count('auth_roles'),2);
 assert.equal(await count('auth_legacy_credentials'),2);
 assert.equal(await count('auth_sessions'),0);
 assert.equal(await DB.prepare("SELECT 1 FROM auth_users WHERE user_id='USR-M04-OWNER'").first(),null);
 assert.equal(first.users[1].Status,'Active');
 assert.equal(first.users[1]['Mobile Number'],'123456');
 const loginOwner=await loginWithD1(DB,{phoneKey:'123456',password:PASSWORD,nowMs:1_801_200_000_000});
 assert.deepEqual(loginOwner,{authenticated:false});
 assert.equal(await count('auth_sessions'),0);
});
test('genuine source Administrator first-login password upgrade and session work only inside private D1',async()=>{
 const wrong=await loginWithD1(DB,{phoneKey:'01790000701',password:'wrong',nowMs:1_801_200_010_000});
 assert.deepEqual(wrong,{authenticated:false});
 const valid=await loginWithD1(DB,{phoneKey:'01790000701',password:PASSWORD,nowMs:1_801_200_020_000});
 assert.equal(valid.authenticated,true);
 assert.equal(valid.user.id,'USR-M04-ADM');
 assert.equal(valid.user.role,'Administrator');
 assert.equal((await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='USR-M04-ADM'").first()).credential_state,'Modern');
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='USR-M04-ADM'").first()).n,0);
 assert.equal(await count('auth_sessions'),1);
 assert.equal((await worker.fetch('http://localhost/api/rpc')).status,404);
});
