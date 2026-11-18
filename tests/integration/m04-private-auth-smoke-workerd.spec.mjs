import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {rehearseAdminFirstLegacyStaffImportWithD1}
  from '../../src/auth/m04-admin-first-enrollment.js';

const harness=createTestHarness({workers:[{
 configPath:'./wrangler.m04-private-auth-smoke-test.jsonc',
}]});
const worker=harness.getWorker('shererp-m04-private-auth-smoke-local-test-only');
const KEY='synthetic-operator-key-not-for-live-staff-2026-11-18';
const PASSWORD='SyntheticAdminFirstWorkerPassword!2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update(PASSWORD+SALT,'utf8').digest('hex');
const RIGHTS=JSON.stringify({products:{
 view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited',
}});
function user(id,phone,role){
 return {'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
  'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
  'Created By':'Synthetic source actor',
  'Created At':'2025-01-20T12:05:06.000Z',
  'Last Login':'2025-06-30T08:09:10.000Z'};
}
function source(){
 return {users:[
  user('USR-ADM','1710000101','Administrator'),
  user('USR-OWNER','123456','Owner'),
  user('USR-SALES','01710000103','Sales'),
 ],roles:[
  {'Role ID':'ROL-OWNER','Role Name':'Owner',
   'Allowed Modules':'products','Permissions':RIGHTS,'Status':'Active',
   'Created At':'2025-01-20T12:06:07.000Z'},
  {'Role ID':'ROL-SALES','Role Name':'Sales',
   'Allowed Modules':'products','Permissions':RIGHTS,'Status':'Active',
   'Created At':'2025-01-20T12:06:07.000Z'},
 ]};
}
const endpoint='http://127.0.0.1:8787/_private/m04/auth-rpc';
async function rpc(fnName,args,extra={}){
 const response=await worker.fetch(endpoint,{
  method:'POST',
  headers:{
   'content-type':'application/json',
   'x-m04-operator-key':KEY,
   ...(extra.headers||{}),
  },
  body:JSON.stringify({fnName,args}),
  redirect:'error',
 });
 return {status:response.status,body:await response.json()};
}
let DB;
before(async()=>{
 await harness.listen();
 await worker.applyD1Migrations('DB');
 ({DB}=await worker.getEnv());
 const first=source(),confirmation=source();
 const result=await rehearseAdminFirstLegacyStaffImportWithD1(
  DB,first,confirmation);
 assert.equal(result.imported,true);
 assert.equal(result.deferredOwnerUsers,1);
});
after(async()=>{await harness.close();});
const count=async t=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+t).first()).n;

test('not public RPC and refuses other host, method, origin and missing operator key',async()=>{
 const requests=[
  ['http://127.0.0.1:8787/api/rpc',{method:'POST',headers:{'content-type':'application/json'}}],
  ['http://example.com/_private/m04/auth-rpc',{method:'POST'}],
  [endpoint,{method:'GET'}],
  [endpoint,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}],
  [endpoint,{method:'POST',headers:{'content-type':'application/json','origin':'https://example.com','x-m04-operator-key':KEY},body:'{}'}],
 ];
 for(const [url,opts] of requests){
  assert.equal((await worker.fetch(url,opts)).status,404);
 }
 assert.equal(await count('auth_sessions'),0);
});

test('private original-format Administrator first login upgrades legacy verifier and creates D1-backed session',async()=>{
 const result=await rpc('login',['1710000101',PASSWORD]);
 assert.equal(result.status,200);
 assert.equal(result.body.success,true);
 assert.equal(result.body.data.user.id,'USR-ADM');
 assert.equal(result.body.data.user.role,'Administrator');
 assert.equal(result.body.data.user.mobile,'01710000101');
 assert.match(result.body.data.token,/^[0-9a-f]{64}$/);
 assert.equal((await DB.prepare(
  "SELECT credential_state FROM auth_users WHERE user_id='USR-ADM'"
 ).first()).credential_state,'Modern');
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='USR-ADM'"
 ).first()).n,0);
 assert.equal(await count('auth_sessions'),1);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM auth_users WHERE user_id='USR-OWNER'"
 ).first()).n,0);
 const restored=await rpc('validateSession',[result.body.data.token]);
 assert.equal(restored.status,200);
 assert.equal(restored.body.success,true);
 assert.equal(restored.body.data.user.id,'USR-ADM');
 assert.deepEqual(await rpc('logout',[result.body.data.token]),
  {status:200,body:{success:true,data:'logged out'}});
 assert.deepEqual(await rpc('validateSession',[result.body.data.token]),
  {status:200,body:{success:false,message:'Session expired. Please sign in again.'}});
});

test('incorrect credential and unsupported method fail closed without leaking input',async()=>{
 const bad=await rpc('login',['01710000103','wrong password']);
 assert.deepEqual(bad,{status:200,body:{
  success:false,message:'Invalid mobile number or password.',
 }});
 const unauthorized=await rpc('completeSale',['synthetic']);
 assert.equal(unauthorized.status,501);
 assert.equal(unauthorized.body.success,false);
 assert.doesNotMatch(JSON.stringify(unauthorized),/Synthetic|01710000103|wrong password/);
});
