import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-private-operator-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-private-operator-test-only');
const TOKEN='synthetic-m04-test-token-not-a-real-credential-2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticTestOnlyPassword!'+SALT).digest('hex');
const RIGHTS=JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'}});
function user(id,phone,role){
 return {'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,'Password Hash':HASH,
  'Password Salt':SALT,'Role':role,'Status':'Active','Created By':'Synthetic actor',
  'Created At':'2025-01-20T12:05:06.000Z','Last Login':'2025-06-30T08:09:10.000Z'};
}
function snapshot(){
 return {users:[
  user('USR-ADM','01790000701','Administrator'),user('USR-OWNER','123456','Owner'),
  user('USR-SALES','01790000703','Sales'),
 ],roles:[
  {'Role ID':'ROL-OWNER','Role Name':'Owner','Allowed Modules':'products',
   'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'},
  {'Role ID':'ROL-SALES','Role Name':'Sales','Allowed Modules':'products',
   'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'},
 ]};
}
const body=()=>({first:snapshot(),confirmation:snapshot()});
const endpoint='http://127.0.0.1:8787/_private/m04/staff-import-once';
function submit(value=body(),token=TOKEN,headers={}){
 return worker.fetch(endpoint,{method:'POST',headers:{
   authorization:'Bearer '+token,'content-type':'application/json',...headers
 },body:JSON.stringify(value)});
}
let DB;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});
const count=async t=>(await DB.prepare('SELECT COUNT(*) AS n FROM '+t).first()).n;

test('M04 private transport denies public route, non-loopback, origin and unauthenticated access',async()=>{
 assert.equal((await worker.fetch(endpoint,{method:'GET'})).status,404);
 assert.equal((await worker.fetch('http://127.0.0.1:8787/api/rpc',{method:'POST'})).status,404);
 assert.equal((await worker.fetch('http://example.com/_private/m04/staff-import-once',{method:'POST'})).status,404);
 assert.equal((await submit(body(),'incorrect')).status,404);
 assert.equal((await submit(body(),TOKEN,{origin:'https://example.com'})).status,404);
 assert.equal(await count('auth_users'),0);
});

test('malformed and altered historical source cannot partially provision D1',async()=>{
 let changed=body();
 changed.first.users[1].Status='Inactive';
 assert.equal((await submit(changed)).status,409);
 changed=body();changed.unexpected=true;
 assert.equal((await submit(changed)).status,409);
 assert.equal(await count('auth_users'),0);
 assert.equal(await count('auth_roles'),0);
 assert.equal(await count('auth_legacy_credentials'),0);
});

test('SQL-atomic genuine-shape partial enrollment is once-only and never unlocks Owner or public RPC',async()=>{
 const response=await submit();
 assert.equal(response.status,200);
 const r=await response.json();
 assert.deepEqual(r,{
  imported:true,originalUsers:3,importedUsers:2,importedRoles:2,
  pendingLegacyCredentials:2,deferredOwnerUsers:1,
  sourceTwoPassMatch:true,readbackMatch:true,
  publicAuthenticationEnabled:false,productionReady:false
 });
 assert.equal(await count('auth_users'),2);
 assert.equal(await count('auth_roles'),2);
 assert.equal(await count('auth_legacy_credentials'),2);
 assert.equal(await count('auth_sessions'),0);
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE user_id='USR-OWNER'").first()).n,0);
 const replay=await submit();
 assert.equal(replay.status,409);
 assert.equal(await count('auth_users'),2);
 assert.doesNotMatch(JSON.stringify(r)+await replay.text(),/USR-ADM|123456|Synthetic actor|01790000701|123e4567/);
 assert.equal((await worker.fetch('http://127.0.0.1:8787/api/rpc')).status,404);
});
