import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-workerd-local-only');
const NOW=1_800_200_000_000;
const SECRET='SyntheticTestOnlyPass!2026';
const SOURCE_ROLE_PERMISSIONS={
  sales:{view:true,add:false,edit:true,delete:'same',backdate:'7'},
  roles:{view:true,add:false,edit:false,delete:false,backdate:'same'},
  users:{view:false,add:false,edit:false,delete:true,backdate:'unlimited'},
  openingBalance:{view:false,add:false,edit:true,delete:'disabled',backdate:'unlimited'},
};

let db;
async function seed(id,phone,role='Administrator',status='Active'){
  const c=await createOfflinePasswordCredential(SECRET);
  await db.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id,'Fixture '+id,phone,role,status,c.passwordHash,c.passwordSalt,c.iterations).run();
}
async function rpc(fnName,args=[],nowMs=NOW){
  const response=await worker.fetch('http://m04.local/__m04_test__/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fnName,args,nowMs}),
  });
  return {status:response.status,body:await response.json()};
}
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB:db}=await worker.getEnv());
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('Cashier','Active',?,?),('Corrupt','Active','[]','sales')`)
    .bind(JSON.stringify({sales:{view:true,add:true,edit:false,delete:'7'},products:{view:true}}),'sales,products').run();
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('SourceRole','Active',?,'sales,roles'),
      ('BadManagementDelete','Active',?,''),
      ('BadBackdate','Active',?,'sales')`)
    .bind(JSON.stringify(SOURCE_ROLE_PERMISSIONS),
      JSON.stringify({users:{view:false,add:false,edit:false,delete:'7',backdate:'unlimited'}}),
      JSON.stringify({sales:{view:true,add:false,edit:false,delete:'disabled',backdate:'365'}})).run();
  await seed('USR-RPC-ADMIN','01710000101');
  await seed('USR-RPC-CASHIER','01710000102','Cashier');
  await seed('USR-RPC-BAD-ROLE','01710000103','Corrupt');
  await seed('USR-RPC-DISABLED','01710000104','Cashier','Inactive');
  await seed('USR-RPC-SOURCE','01710000105','SourceRole');
  await seed('USR-RPC-BAD-MANAGEMENT','01710000106','BadManagementDelete');
  await seed('USR-RPC-BAD-BACKDATE','01710000107','BadBackdate');
});
after(async()=>{await harness.close();});

test('original frozen GAS source defines three RPCs and expected token/role envelope',()=>{
  const src=readFileSync(new URL('../../legacy/source/Auth.gs',import.meta.url),'utf8');
  const utils=readFileSync(new URL('../../legacy/source/Utils.gs',import.meta.url),'utf8');
  assert.match(src,/function login\(mobile, password\)/);
  assert.match(src,/function validateSession\(token\)/);
  assert.match(src,/function logout\(token\)/);
  assert.match(src,/allowedModules: allowedModules/);
  assert.match(src,/permissions: permissions/);
  assert.match(utils,/return \{ success: true, data: data \}/);
});

test('internal Workerd/D1 login returns source-shaped Administrator payload, not a simulated token',async()=>{
  const r=await rpc('login',['01710000101',SECRET]);
  assert.equal(r.status,200);
  assert.equal(r.body.success,true);
  assert.match(r.body.data.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(r.body.data.user,{
    id:'USR-RPC-ADMIN',name:'Fixture USR-RPC-ADMIN',mobile:'01710000101',role:'Administrator',
  });
  assert.equal(r.body.data.allowedModules,null);
  assert.equal(r.body.data.permissions,null);
  assert.deepEqual(Object.keys(r.body.data),['token','user','allowedModules','permissions']);
  const validated=await rpc('validateSession',[r.body.data.token],NOW+1000);
  assert.deepEqual(validated,{status:200,body:r.body});
  const logout=await rpc('logout',[r.body.data.token],NOW+2000);
  assert.deepEqual(logout,{status:200,body:{success:true,data:'logged out'}});
  assert.deepEqual(await rpc('validateSession',[r.body.data.token],NOW+3000),
    {status:200,body:{success:false,message:'Session expired. Please sign in again.'}});
});

test('Cashier role payload preserves allowed modules and permission windows without granting server-side RPC access',async()=>{
  const r=await rpc('login',['+880 1710000102',SECRET],NOW+10000);
  assert.equal(r.status,200);
  assert.equal(r.body.success,true);
  assert.deepEqual(r.body.data.user,{
    id:'USR-RPC-CASHIER',name:'Fixture USR-RPC-CASHIER',mobile:'01710000102',role:'Cashier',
  });
  assert.deepEqual(r.body.data.allowedModules,['sales','products']);
  assert.deepEqual(r.body.data.permissions,{
    sales:{view:true,add:true,edit:false,delete:'7'},products:{view:true},
  });
  assert.deepEqual(await rpc('validateSession',[r.body.data.token],NOW+11000),r);
  assert.equal((await rpc('completeSale',[r.body.data.token],NOW+12000)).status,404);
});

test('wrong credential, disabled staff and invalid phone fail generically without exposing details',async()=>{
  for(const [mobile,password] of [
    ['01710000101','incorrect'],['01710000999',SECRET],
    ['01710000104',SECRET],['bad',SECRET],['01710000101',''],
  ]){
    const r=await rpc('login',[mobile,password],NOW+20000);
    assert.deepEqual(r,{status:200,body:{success:false,message:'Invalid mobile number or password.'}});
    if(password)assert.equal(JSON.stringify(r).includes(password),false);
  }
});

test('malformed role metadata fails closed and revokes any newly created token',async()=>{
  const r=await rpc('login',['01710000103',SECRET],NOW+30000);
  assert.deepEqual(r,{status:200,body:{success:false,message:'Sign-in role configuration is unavailable.'}});
  const session=await db.prepare(`SELECT s.revoked_at_ms AS at FROM auth_sessions s
    WHERE s.user_id='USR-RPC-BAD-ROLE' ORDER BY s.created_at_ms DESC LIMIT 1`).first();
  assert.equal(session.at,NOW+30000);
});

test('authority-version change prevents token restore even after role reactivation',async()=>{
  const r=await rpc('login',['01710000102',SECRET],NOW+40000);
  assert.equal(r.body.success,true);
  await db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'").run();
  await db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='Cashier'").run();
  const restored=await rpc('validateSession',[r.body.data.token],NOW+41000);
  assert.deepEqual(restored,{status:200,body:{success:false,message:'Session expired. Please sign in again.'}});
});

test('test-only RPC is explicit allowlist and cannot reach production auth or administrator helpers',async()=>{
  for(const name of ['createFirstAdmin_','getUsersBootstrap','deleteUser','getAppShellData','completeSale']){
    const response=await rpc(name,['synthetic'],NOW+50000);
    assert.equal(response.status,404,name);
  }
  const registry=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/d1-legacy-rpc|createD1LegacyAuthRpc/);
  assert.doesNotMatch(worker,/d1-legacy-rpc|createD1LegacyAuthRpc/);
});

test('local D1 RPC fixture uses the reviewed pinned-GAS staff-phone helper without a duplicate parser',()=>{
  const fixture=readFileSync(new URL('../fixtures/m04-auth-worker.mjs',import.meta.url),'utf8');
  assert.match(fixture,/import\s+\{normalizeLegacyStaffPhoneSearch\}\s+from\s+['"]\.\.\/\.\.\/src\/auth\/staff-phone-identity\.js['"]/);
  assert.match(fixture,/normalizeMobile:\s*normalizeLegacyStaffPhoneSearch/);
  assert.doesNotMatch(fixture,/const\s+testPhone\s*=/);
});

test('real local D1 login accepts all source-equivalent Bangladesh staff phone forms',async()=>{
  const canonical='01710000101';
  for(const input of [
    '০১৭১০০০০১০১',
    '১৭১০০০০১০১',
    1710000101,
    '+880 (171) 000-0101',
    '017 100 00101',
  ]){
    const result=await rpc('login',[input,SECRET],NOW+60_000);
    assert.equal(result.status,200);
    assert.equal(result.body.success,true,'source-equivalent login input');
    assert.equal(result.body.data.user.mobile,canonical);
    assert.equal(result.body.data.user.id,'USR-RPC-ADMIN');
  }
  const invalid=await rpc('login',['0171000010',SECRET],NOW+61_000);
  assert.deepEqual(invalid,{status:200,body:{success:false,message:'Invalid mobile number or password.'}});
});


test('native GAS custom roles with same-day delete, backdate, edit-only and boolean management rights can log in',async()=>{
  const result=await rpc('login',['০১৭১০০০০১০৫',SECRET],NOW+70000);
  assert.equal(result.status,200);
  assert.equal(result.body.success,true);
  assert.equal(result.body.data.user.id,'USR-RPC-SOURCE');
  assert.deepEqual(result.body.data.allowedModules,['sales','roles']);
  assert.deepEqual(result.body.data.permissions,SOURCE_ROLE_PERMISSIONS);
  assert.match(result.body.data.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(await rpc('validateSession',[result.body.data.token],NOW+71000),result);
});

test('invalid management delete and unknown backdate still fail closed with stored session revocation',async()=>{
  for(const [phone,id] of [
    ['01710000106','USR-RPC-BAD-MANAGEMENT'],
    ['01710000107','USR-RPC-BAD-BACKDATE'],
  ]){
    const result=await rpc('login',[phone,SECRET],NOW+72000);
    assert.deepEqual(result,{
      status:200,body:{success:false,message:'Sign-in role configuration is unavailable.'}
    });
    const row=await db.prepare(`SELECT revoked_at_ms AS revoked FROM auth_sessions
      WHERE user_id=? ORDER BY created_at_ms DESC LIMIT 1`).bind(id).first();
    assert.equal(row.revoked,NOW+72000);
  }
});

test('changing only role allowed_modules invalidates old sessions; no-op update does not bump authority',async()=>{
  const login=await rpc('login',['01710000105',SECRET],NOW+80000);
  assert.equal(login.body.success,true);
  const token=login.body.data.token;
  const before=await db.prepare(`SELECT auth_version FROM auth_roles
    WHERE role_name='SourceRole'`).first();
  await db.prepare(`UPDATE auth_roles SET allowed_modules=allowed_modules
    WHERE role_name='SourceRole'`).run();
  const same=await db.prepare(`SELECT auth_version FROM auth_roles
    WHERE role_name='SourceRole'`).first();
  assert.equal(same.auth_version,before.auth_version);
  assert.equal((await rpc('validateSession',[token],NOW+81000)).body.success,true);
  await db.prepare(`UPDATE auth_roles SET allowed_modules='sales'
    WHERE role_name='SourceRole'`).run();
  const changed=await db.prepare(`SELECT auth_version FROM auth_roles
    WHERE role_name='SourceRole'`).first();
  assert.equal(changed.auth_version,before.auth_version+1);
  assert.deepEqual(await rpc('validateSession',[token],NOW+82000),{
    status:200,body:{success:false,message:'Session expired. Please sign in again.'}
  });
});
