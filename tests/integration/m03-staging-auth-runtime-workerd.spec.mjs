import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {chromium} from 'playwright';
import {createTestHarness} from 'wrangler';
import stagingWorker from '../../src/m03-auth-staging-worker.js';
import {rehearseAdminFirstLegacyStaffImportWithD1}
  from '../../src/auth/m04-admin-first-enrollment.js';

// Run npm run build:frontend before enabling the Chromium check.
const runBrowser=process.env.M03_STAGING_BROWSER==='1';
const configPath=runBrowser
 ? './wrangler.m03-auth-staging-browser-test.jsonc'
 : './wrangler.m03-auth-staging-local-test.jsonc';
const harness=createTestHarness({workers:[{configPath}]});
const worker=harness.getWorker('shererp-m03-staging-auth-local-test-only');
const PASSWORD='SyntheticM03StagingAdminPassword!2026';
const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update(PASSWORD+SALT).digest('hex');
const RIGHTS=JSON.stringify({products:{
 view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited',
}});
const user=(id,phone,role)=>({
 'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
 'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
 'Created By':'Synthetic source actor','Created At':'2025-01-20T12:05:06.000Z',
 'Last Login':'2025-06-30T08:09:10.000Z'
});
const snapshot=()=>({
 users:[
  user('USR-M03-ADM','1710000101','Administrator'),
  user('USR-M03-OWNER','123456','Owner'),
  user('USR-M03-SALES','01710000103','Sales')
 ],
 roles:[
  {'Role ID':'ROL-M03-OWNER','Role Name':'Owner','Allowed Modules':'products',
   'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'},
  {'Role ID':'ROL-M03-SALES','Role Name':'Sales','Allowed Modules':'products',
   'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'}
 ]
});
const target='https://example.test/api/rpc';
async function rpc(fnName,args,headers={}){
 const response=await worker.fetch(target,{
  method:'POST',
  headers:{'content-type':'application/json',...headers},
  body:JSON.stringify({fnName,args}),
 });
 return {status:response.status,body:await response.json()};
}
let DB, browserUrl;
before(async()=>{
 ({url:browserUrl}=await harness.listen());
 await worker.applyD1Migrations('DB');
 ({DB}=await worker.getEnv());
 const first=snapshot(),confirmation=snapshot();
 const r=await rehearseAdminFirstLegacyStaffImportWithD1(DB,first,confirmation);
 assert.equal(r.imported,true);
 assert.equal(r.deferredOwnerUsers,1);
});
after(async()=>{await harness.close();});

test('staging Worker identifies auth-only D1; no default public Worker config or handler change',async()=>{
 const response=await worker.fetch('https://example.test/api/health');
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{
  status:'auth-staging',service:'shererp-cloud',database:'auth-only'
 });
 const denied=await stagingWorker.fetch(new Request('https://example.test/api/rpc',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({fnName:'login',args:['01710000101',PASSWORD]})
 }),{M03_AUTH_SCOPE:'reviewed-staging-auth-only',
      M03_AUTH_D1_UUID:'aa04618e-1639-4cb9-bdf5-7b967d8b968b'});
 assert.equal(denied.status,503);
 assert.deepEqual(await denied.json(),{
  success:false,message:'Sign-in is unavailable because server authentication is not configured yet.'
 });
});
test('real local D1 first-login from historical 10 digit Administrator mobile, shell and logout',async()=>{
 const login=await rpc('login',['1710000101',PASSWORD]);
 assert.equal(login.status,200);
 assert.equal(login.body.success,true);
 assert.equal(login.body.data.user.id,'USR-M03-ADM');
 assert.equal(login.body.data.user.mobile,'01710000101');
 assert.equal(login.body.data.user.role,'Administrator');
 assert.match(login.body.data.token,/^[a-f0-9]{64}$/);
 assert.equal((await DB.prepare(
  "SELECT credential_state FROM auth_users WHERE user_id='USR-M03-ADM'"
 ).first()).credential_state,'Modern');
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='USR-M03-ADM'"
 ).first()).n,0);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM auth_users WHERE user_id='USR-M03-OWNER'"
 ).first()).n,0);
 const restored=await rpc('validateSession',[login.body.data.token]);
 assert.equal(restored.status,200);
 assert.equal(restored.body.success,true);
 assert.equal(restored.body.data.user.id,'USR-M03-ADM');
 const tokenHash=createHash('sha256').update(Buffer.from(login.body.data.token,'hex')).digest('hex');
 const sessionActivity=()=>DB.prepare(
  'SELECT last_activity_at_ms FROM auth_sessions WHERE token_hash=?'
 ).bind(tokenHash).first('last_activity_at_ms');
 const restoredAt=await sessionActivity();
 await setTimeout(20);
 const shell=await rpc('getAppShellData',[login.body.data.token]);
 assert.equal(shell.status,200);
 assert.equal(shell.body.success,true);
 assert.equal(shell.body.data.shopName,'Hardware Store ERP');
 assert.ok(Array.isArray(shell.body.data.navItems));
 assert.ok(shell.body.data.navItems.length>10);
 assert.equal(await sessionActivity(),restoredAt,'reading shell metadata leaves session activity untouched');
 assert.deepEqual(await rpc('logout',[login.body.data.token]),
  {status:200,body:{success:true,data:'logged out'}});
 assert.deepEqual(await rpc('validateSession',[login.body.data.token]),
  {status:200,body:{success:false,message:'Session expired. Please sign in again.'}});
 const afterLogout=await rpc('getAppShellData',[login.body.data.token]);
 assert.equal(afterLogout.status,503);
});
test('publicly reachable staging endpoint exposes no unsupported business RPC or unauthenticated shell',async()=>{
 const [wrong,business,withoutSession,attacker]=await Promise.all([
  rpc('login',['01710000103','wrong']),
  rpc('completeSale',['synthetic']),
  rpc('getAppShellData',['0'.repeat(64)]),
  rpc('login',['01710000103',PASSWORD],{origin:'https://evil.example'})
 ]);
 assert.deepEqual(wrong.body,{success:false,message:'Invalid mobile number or password.'});
 assert.equal(business.status,501);
 assert.equal(withoutSession.status,503);
 assert.equal(attacker.status,403);
 assert.equal(JSON.stringify(business).includes(PASSWORD),false);
});

test('preserved Chromium UI signs in, restores the D1 session and signs out',
 {skip:!runBrowser},async()=>{
 await DB.prepare("INSERT INTO settings(key,value) VALUES ('Shop Name','Synthetic Staging Browser')").run();
 const browser=await chromium.launch({
  executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
 });
 try{
  const page=await browser.newPage();
  page.setDefaultTimeout(10000);
  const waitRpc=name=>page.waitForResponse(response=>
   response.url()===new URL('/api/rpc',browserUrl).href &&
   response.request().method()==='POST' && response.request().postDataJSON().fnName===name);
  await page.goto(browserUrl.href,{waitUntil:'domcontentloaded'});
  await page.locator('#loginOverlay').waitFor();
  await page.locator('#loginMobile').fill('01710000101');
  await page.locator('#loginPassword').fill('wrong-synthetic');
  await page.getByRole('button',{name:'Login',exact:true}).click();
  await page.locator('#loginError').getByText('Invalid mobile number or password.').waitFor();

  await page.locator('#loginPassword').fill(PASSWORD);
  const [login,shell,dashboard]=await Promise.all([
   waitRpc('login'),waitRpc('getAppShellData'),waitRpc('getDashboardStats'),
   page.getByRole('button',{name:'Login',exact:true}).click(),
  ]);
  const authenticated=await login.json();
  assert.equal(authenticated.success,true);
  assert.equal((await shell.json()).data.shopName,'Synthetic Staging Browser');
  // This release candidate only activates the shell and session RPCs.
  assert.equal(dashboard.status(),501);
  await page.locator('#page-dashboard').waitFor();

  const [restored,restoredShell]=await Promise.all([
   waitRpc('validateSession'),waitRpc('getAppShellData'),
   page.reload({waitUntil:'domcontentloaded'}),
  ]);
  assert.equal((await restored.json()).success,true);
  assert.equal((await restoredShell.json()).data.shopName,'Synthetic Staging Browser');
  await page.locator('#page-dashboard').waitFor();

  const [logout]=await Promise.all([
   waitRpc('logout'),page.evaluate(()=>{void doLogout_();}),
  ]);
  assert.equal(logout.status(),200);
  await page.locator('#loginOverlay').waitFor();
  assert.equal((await rpc('validateSession',[authenticated.data.token])).body.success,false);
 }finally{
  await browser.close();
 }
});

test('staging config is distinct from public Worker and binds only operational D1',()=>{
 const stage=JSON.parse(readFileSync(new URL(
  '../../wrangler.m03-auth-staging.jsonc',import.meta.url),'utf8'));
 const normal=JSON.parse(readFileSync(new URL(
  '../../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(normal.main,'src/index.js');
 assert.equal(normal.d1_databases,undefined);
 assert.equal(stage.name,'shererp-cloud-auth-staging-candidate');
 assert.equal(stage.account_id,'ac66126a5dc7c2f21ae5c146341a5dfb');
 assert.equal(stage.main,'src/m03-auth-staging-worker.js');
 assert.equal(stage.workers_dev,false);
 assert.equal(stage.preview_urls,false);
 assert.equal(stage.routes,undefined);
 assert.equal(stage.d1_databases.length,1);
 assert.deepEqual(stage.d1_databases[0],{
  binding:'DB',
  database_name:'shererp-staging-db',
  database_id:'aa04618e-1639-4cb9-bdf5-7b967d8b968b'
 });
 assert.equal(stage.vars.M03_AUTH_SCOPE,'reviewed-staging-auth-only');
 assert.equal(stage.vars.M03_AUTH_D1_UUID,stage.d1_databases[0].database_id);
 assert.ok(!JSON.stringify(stage).includes('3328e5c8-7695-4d6c-8bcf-9725437ebdd5'));
});
