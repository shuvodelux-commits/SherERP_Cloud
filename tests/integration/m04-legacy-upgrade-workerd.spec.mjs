import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential,loginWithD1} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-workerd-local-only');
const BASE=1_801_000_000_000;
const SALT='123e4567-e89b-12d3-a456-426614174000';
const PASS='SyntheticLegacyOnly!2026';
let DB;

async function seedLegacy(id,phone,{password=PASS,role='Administrator',status='Active'}={}){
  const placeholder=await createOfflinePasswordCredential('UNKNOWABLE-PLACEHOLDER-SYNTHETIC-TEST');
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,credential_state,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,'LegacyPending',?,?,?)`)
    .bind(id,'Legacy Fixture '+id,phone,role,status,
      placeholder.passwordHash,placeholder.passwordSalt,placeholder.iterations).run();
  const digest=createHash('sha256').update(password+SALT,'utf8').digest('hex');
  await DB.prepare(`INSERT INTO auth_legacy_credentials(user_id,legacy_hash,legacy_salt)
    VALUES (?,?,?)`).bind(id,digest,SALT).run();
  return {digest,placeholder};
}

async function rpc(path,raw){
  const r=await worker.fetch('http://m04.local/__m04_test__/'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw),
  });
  return {status:r.status,body:await r.json()};
}
const login=(phone,password=PASS,time=BASE)=>rpc('login',{phoneKey:phone,password,nowMs:time});
const deny={status:200,body:{authenticated:false}};

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  // Frozen RoleManagement.gs derives Allowed Modules from view-true rights.
  await DB.prepare("INSERT INTO auth_roles (role_name,status,permissions_json,allowed_modules) VALUES ('Cashier','Active',?,'sales'),('Suspended','Inactive','{}','')")
    .bind(JSON.stringify({sales:{view:true}})).run();
  await seedLegacy('L-ADMIN','01710000201');
  await seedLegacy('L-BAD','01710000202');
  await seedLegacy('L-SHORT','01710000203',{password:'short'});
  await seedLegacy('L-INACTIVE','01710000204',{status:'Inactive'});
  await seedLegacy('L-ROLEOFF','01710000205',{role:'Suspended'});
  await seedLegacy('L-CONCURRENT','01710000206',{role:'Cashier'});
  await seedLegacy('L-LOCK','01710000207',{role:'Cashier'});
  await seedLegacy('L-CAS','01710000208',{role:'Cashier'});
  await seedLegacy('L-ADAPTER','01710000209',{role:'Cashier'});
  await seedLegacy('L-PLACEHOLDER','01710000210',{role:'Cashier'});
});
after(async()=>{await harness.close();});

test('source-verified first login converts hash to modern PBKDF2, deletes legacy material and issues real D1 session',async()=>{
  const pre=await DB.prepare("SELECT auth_version,credential_version,password_hash FROM auth_users WHERE user_id='L-ADMIN'").first();
  const result=await login('01710000201');
  assert.equal(result.status,200);
  assert.equal(result.body.authenticated,true);
  assert.match(result.body.token,/^[0-9a-f]{64}$/);
  const row=await DB.prepare("SELECT credential_state,password_algo,password_hash,password_salt,password_iterations,auth_version,credential_version FROM auth_users WHERE user_id='L-ADMIN'").first();
  assert.equal(row.credential_state,'Modern');
  assert.equal(row.password_algo,'pbkdf2-sha256');
  assert.match(row.password_hash,/^[0-9a-f]{64}$/);
  assert.match(row.password_salt,/^[0-9a-f]{48}$/);
  assert.notEqual(row.password_hash,pre.password_hash);
  assert.equal(row.auth_version,pre.auth_version+1);
  assert.equal(row.credential_version,pre.credential_version+1);
  assert.equal(row.password_iterations,210000);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-ADMIN'").first().then(x=>x.n),0);
  const restored=await rpc('validate',{token:result.body.token,nowMs:BASE+1000});
  assert.equal(restored.body.authenticated,true);
  assert.equal((await login('01710000201',PASS,BASE+2000)).body.authenticated,true);
});

test('wrong legacy password is throttled, cannot upgrade and never leaks a credential',async()=>{
  const out=await login('01710000202','wrong',BASE+3000);
  assert.deepEqual(out,deny);
  const row=await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='L-BAD'").first();
  assert.equal(row.credential_state,'LegacyPending');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-BAD'").first()).n,1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='L-BAD'").first()).n,0);
  const success=await login('01710000202',PASS,BASE+4000);
  assert.equal(success.body.authenticated,true);
});

test('unmigratable short source password stays pending and requires controlled reset',async()=>{
  assert.deepEqual(await login('01710000203','short',BASE+5000),deny);
  assert.equal((await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='L-SHORT'").first()).credential_state,'LegacyPending');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-SHORT'").first()).n,1);
});

test('inactive user or inactive staff role cannot upgrade or issue a session',async()=>{
  assert.deepEqual(await login('01710000204',PASS,BASE+6000),deny);
  assert.deepEqual(await login('01710000205',PASS,BASE+6000),deny);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id IN ('L-INACTIVE','L-ROLEOFF')").first()).n,2);
});

test('two simultaneous correct first logins can commit only one legacy credential upgrade',async()=>{
  const result=await Promise.all([login('01710000206',PASS,BASE+7000),login('01710000206',PASS,BASE+7000)]);
  assert.ok(result.filter(x=>x.body.authenticated===true).length>=1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-CONCURRENT'").first()).n,0);
  assert.equal((await DB.prepare("SELECT credential_version AS v FROM auth_users WHERE user_id='L-CONCURRENT'").first()).v,2);
  assert.ok((await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='L-CONCURRENT'").first()).n>=1);
  assert.equal((await login('01710000206',PASS,BASE+8000)).body.authenticated,true);
});

test('five failed attempts lock pending legacy identity before password verification or upgrade',async()=>{
  const failures=await Promise.all(Array.from({length:5},()=>login('01710000207','bad',BASE+10000)));
  assert.ok(failures.every(x=>!x.body.authenticated));
  assert.deepEqual(await login('01710000207',PASS,BASE+11000),deny);
  assert.equal((await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='L-LOCK'").first()).credential_state,'LegacyPending');
  assert.equal((await login('01710000207',PASS,BASE+10000+15*60*1000)).body.authenticated,true);
});

test('account role update at upgrade write boundary fails CAS and retains import for reconciliation',async()=>{
  const wrapper={prepare(sql){
    const statement=DB.prepare(sql);
    if(!/UPDATE auth_users[\s\S]*credential_state='Modern'/.test(sql))return statement;
    return {bind(...args){const bound=statement.bind(...args);
      return {async first(){
        await DB.prepare("UPDATE auth_users SET role_name='Administrator' WHERE user_id='L-CAS'").run();
        return bound.first();
      }};
    }};
  }};
  const out=await loginWithD1(wrapper,{phoneKey:'01710000208',password:PASS,nowMs:BASE+12000});
  assert.deepEqual(out,{authenticated:false});
  assert.equal((await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='L-CAS'").first()).credential_state,'LegacyPending');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-CAS'").first()).n,1);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='L-CAS'").first()).n,0);
});


test('native login adapter upgrades an imported legacy Cashier on first real session and preserves the GAS envelope',async()=>{
  const request={fnName:'login',args:['+8801710000209',PASS],nowMs:BASE+15000};
  const out=await rpc('rpc',request);
  assert.equal(out.status,200);
  assert.equal(out.body.success,true);
  assert.deepEqual(out.body.data.user,{
    id:'L-ADAPTER',name:'Legacy Fixture L-ADAPTER',mobile:'01710000209',role:'Cashier',
  });
  assert.deepEqual(out.body.data.allowedModules,['sales']);
  assert.deepEqual(out.body.data.permissions,{sales:{view:true}});
  assert.match(out.body.data.token,/^[0-9a-f]{64}$/);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_legacy_credentials WHERE user_id='L-ADAPTER'").first()).n,0);
  const restore=await rpc('rpc',{fnName:'validateSession',args:[out.body.data.token],nowMs:BASE+16000});
  assert.deepEqual(restore,{status:200,body:out.body});
  const logout=await rpc('rpc',{fnName:'logout',args:[out.body.data.token],nowMs:BASE+17000});
  assert.deepEqual(logout,{status:200,body:{success:true,data:'logged out'}});
});

test('a pending legacy identity never authenticates via a known synthetic placeholder password',async()=>{
  assert.deepEqual(await login('01710000210','UNKNOWABLE-PLACEHOLDER-SYNTHETIC-TEST',BASE+18000),deny);
  assert.equal((await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='L-PLACEHOLDER'").first()).credential_state,'LegacyPending');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='L-PLACEHOLDER'").first()).n,0);
});
