import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  prepareAdminFirstLegacyStaffEnrollment,
  rehearseAdminFirstLegacyStaffImportWithD1,
} from '../src/auth/m04-admin-first-enrollment.js';
import {auditLegacyStaffProvenance} from '../src/auth/staff-provenance-preflight.js';

const PASSWORD='SyntheticAdminFirstValidPassword!2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update(PASSWORD+SALT).digest('hex');
const PERMISSIONS=JSON.stringify({products:{
  view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited',
}});
const user=(id,phone,role)=>({
 'User ID':id,'Full Name':'Synthetic Name '+id,
 'Mobile Number':phone,'Password Hash':HASH,'Password Salt':SALT,
 'Role':role,'Status':'Active','Created By':'Source actor',
 'Created At':'2025-01-20T12:05:06.000Z',
 'Last Login':'2025-06-30T08:09:10.000Z',
});
const roles=()=>[
 { 'Role ID':'ROL-OWNER','Role Name':'Owner','Allowed Modules':'products',
   'Permissions':PERMISSIONS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z' },
 { 'Role ID':'ROL-SALES','Role Name':'Sales','Allowed Modules':'products',
   'Permissions':PERMISSIONS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z' },
];
const complete=()=>({
 users:[
  user('USR-ADMIN','01790000501','Administrator'),
  user('USR-OWNER','123456','Owner'),
  user('USR-SALES','01790000503','Sales'),
 ],
 roles:roles(),
});
const two=()=>[complete(),complete()];

test('complete authentic roster is explicitly NOT importable before the approved exception',()=>{
 const s=complete(),report=auditLegacyStaffProvenance(s);
 assert.equal(report.preflightPass,false);
 assert.deepEqual(report.issues,[{scope:'user',row:1,code:'USER_MOBILE_UNSUPPORTED'}]);
});
test('two source-faithful captures prepare real Administrator and valid Sales, never alter original Active Owner',()=>{
 const [first,second]=two(),original=structuredClone(first);
 const {snapshot,report}=prepareAdminFirstLegacyStaffEnrollment(first,second);
 assert.deepEqual(first,original);
 assert.deepEqual(snapshot.users.map(x=>x['User ID']),['USR-ADMIN','USR-SALES']);
 assert.equal(snapshot.roles.length,2);
 assert.equal(snapshot.users[0]['Password Hash'],HASH);
 assert.equal(snapshot.users[0]['Password Salt'],SALT);
 assert.equal(snapshot.users[0]['Mobile Number'],original.users[0]['Mobile Number']);
 assert.equal(snapshot.users[1]['Mobile Number'],original.users[2]['Mobile Number']);
 assert.equal(snapshot.roles[0]['Role ID'],original.roles[0]['Role ID']);
 assert.equal(snapshot.roles[1].Permissions,original.roles[1].Permissions);
 assert.equal(first.users[1].Role,'Owner');
 assert.equal(first.users[1].Status,'Active');
 assert.equal(first.users[1]['Mobile Number'],'123456');
 assert.equal(report.originalUsers,3);
 assert.equal(report.importableUsers,2);
 assert.equal(report.sourceRoles,2);
 assert.equal(report.deferredOwnerUsers,1);
 assert.equal(report.originalActiveAdministrators,1);
 assert.equal(report.originalSourceChanged,false);
 assert.equal(report.ownerSourceStatusChanged,false);
 assert.equal(report.ownerMobileRewritten,false);
 assert.equal(report.ownerEnrollmentDeferred,true);
 assert.equal(report.ownerAccountLocked,false);
 assert.equal(report.loginAvailableForDeferredOwner,false);
 assert.equal(report.publicAuthenticationEnabled,false);
 assert.equal(report.remoteD1ImportAuthorized,false);
 assert.equal(report.fullHistoricalStaffImportComplete,false);
 assert.deepEqual(auditLegacyStaffProvenance(snapshot).issues,[]);
 assert.doesNotMatch(JSON.stringify(report),/USR-|0179|123456|Synthetic|Password|123e4567/);
});
test('owner exception cannot become a generic invalid-phone bypass',()=>{
 for(const change of [
  s=>{s.users[0]['Mobile Number']='123456';},
  s=>{s.users[2]['Mobile Number']='123456';},
  s=>{s.users[1].Role='Sales';},
  s=>{s.users[1].Status='Inactive';},
  s=>{s.users[1]['Mobile Number']='not-six-digit';},
  s=>{s.users.push(user('USR-OWNER2','123456','Owner'));},
  s=>{s.roles[1].Permissions='{}';},
  s=>{s.users[1]['Password Hash']='bad';},
  s=>{s.users[1]['Created At']='not-a-date';},
  s=>{s.users[1]['Created By']='';},
  s=>{s.users[0].Role='Owner';},
  s=>{s.users[0]['Unreviewed Field']='unexpected';},
 ]){
  const [a,b]=two();change(a);change(b);
  assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,b),
    /M04 administrator-first offline preparation rejected/);
 }
});
test('two-pass source freeze refuses aliases, cross-capture object sharing and changed original Owner values',()=>{
 const a=complete();
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,a),/rejected/);
 const b=structuredClone(a);
 b.users[1]['Mobile Number']='654321';
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,b),/rejected/);
 b.users[1]['Mobile Number']='123456';
 b.roles[0].Permissions='{}';
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,b),/rejected/);
 const c=structuredClone(a);
 c.users[1]=a.users[1];
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,c),/rejected/);
 const d=structuredClone(a);
 d.users=a.users;
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,d),/rejected/);
});
test('untrusted array and row getters never execute and their private error messages never leak',()=>{
 const a=complete(),b=complete();
 let calls=0;
 Object.defineProperty(a.users,'1',{configurable:true,enumerable:true,
  get(){calls++;throw Error('PRIVATE_SECRET_FROM_GETTER');}});
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(a,b),e=>{
  assert.equal(e.message,'M04 administrator-first offline preparation rejected');return true;
 });
 assert.equal(calls,0);
 const c=complete();
 Object.defineProperty(c.users[1],'Status',{configurable:true,enumerable:true,
  get(){calls++;throw Error('PRIVATE_SECRET_FROM_GETTER');}});
 assert.throws(()=>prepareAdminFirstLegacyStaffEnrollment(c,b),/rejected/);
 assert.equal(calls,0);
});
test('rehearsal rejects unsafe roster without issuing any D1 queries',async()=>{
 const [a,b]=two();b.users[1]['Mobile Number']='999999';
 let queried=0;
 const db={prepare(){queried++;throw Error('DB_PROBE_PRIVATE_SECRET');},
   batch(){queried++;throw Error('DB_PROBE_PRIVATE_SECRET');}};
 await assert.rejects(()=>rehearseAdminFirstLegacyStaffImportWithD1(db,a,b),e=>{
  assert.equal(e.message,'M04 administrator-first offline preparation rejected');
  return true;
 });
 assert.equal(queried,0);
});
test('M04 source preparation has no public route, no hidden status lock or leaked staff data',()=>{
 const src=readFileSync(new URL('../src/auth/m04-admin-first-enrollment.js',import.meta.url),'utf8');
 const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
  readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/console\.|\bfetch\(|\bUPDATE auth_users\b|\bINSERT INTO\b/);
 assert.doesNotMatch(live,/m04-admin-first-enrollment|prepareAdminFirstLegacyStaffEnrollment/);
});