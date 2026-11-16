import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential,loginWithD1} from '../../src/auth/d1-auth-core.js';
import {createD1LegacyAuthRpc,tokenFingerprint} from '../../src/auth/d1-legacy-rpc.js';
import {normalizeLegacyStaffPhoneSearch} from '../../src/auth/staff-phone-identity.js';

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
async function rpc(fnName,args=[],nowMs=NOW,throughHttpBoundary=false){
  const response=await worker.fetch('http://m04.local/__m04_test__/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fnName,args,nowMs,throughHttpBoundary}),
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
  await db.prepare(`INSERT INTO auth_roles (role_name,status,permissions_json,allowed_modules)
    VALUES ('GuardReader','Active',?,'roles')`)
    .bind(JSON.stringify({roles:{view:true},users:{view:false}})).run();
  await seed('USR-RPC-GUARD','01710000108','GuardReader');
  await db.prepare(`INSERT INTO auth_roles (role_name,status,permissions_json,allowed_modules)
    VALUES ('DirectoryReader','Active',?,'users')`)
    .bind(JSON.stringify({users:{view:true}})).run();
  await seed('USR-RPC-DIRECTORY','01710000109','DirectoryReader');
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('ManagementDeleteRolesOnly','Active',?,'users')`)
    .bind(JSON.stringify({
      users:{view:true,delete:false},
      roles:{view:false,add:false,edit:false,delete:true,backdate:'unlimited'},
    })).run();
  await seed('USR-RPC-ROLE-DELETE','01710000110','ManagementDeleteRolesOnly');
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('UsersAdder','Active',?,''),('RolesAdder','Active',?,'')`)
    .bind(JSON.stringify({users:{add:true,view:false,edit:false,delete:false}}),
      JSON.stringify({roles:{add:true,view:false,edit:false,delete:false}})).run();
  await seed('USR-RPC-USER-ADD','01710000111','UsersAdder');
  await seed('USR-RPC-ROLE-ADD','01710000112','RolesAdder');
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('UsersEditor','Active',?,'')`)
    .bind(JSON.stringify({users:{view:false,add:false,edit:true,delete:false}})).run();
  await seed('USR-RPC-USER-EDIT','01710000113','UsersEditor');
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

  // End-to-end local D1 SourceRole -> internal legacy RPC -> trusted HTTP
  // response validator. The public Worker still has no auth adapter.
  const viaHttp=await rpc('login',['01710000105',SECRET],NOW+70000,true);
  assert.equal(viaHttp.status,200);
  assert.equal(viaHttp.body.success,true);
  assert.deepEqual(viaHttp.body.data.permissions,SOURCE_ROLE_PERMISSIONS);
  assert.deepEqual(viaHttp.body.data.allowedModules,['sales','roles']);
  assert.deepEqual(await rpc('validateSession',[viaHttp.body.data.token],NOW+71000,true),viaHttp);
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
  // Restore synthetic source-canonical navigation before subsequent
  // legitimate role sign-ins. The original stale token stays revoked.
  await db.prepare("UPDATE auth_roles SET allowed_modules='sales,roles' WHERE role_name='SourceRole'").run();
});


async function authorizeRead(methodName,token,nowMs=NOW+101_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/authorize',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({methodName,token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('internal D1 staff read gate derives users/roles view from the session, not browser claims',async()=>{
  const usersSource=readFileSync(new URL('../../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  const rolesSource=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(usersSource,/function getUsersBootstrap\(token\)[\s\S]*?requirePermission_\(token, 'users', 'view'\)/);
  assert.match(rolesSource,/function getRolesBootstrap\(token\)[\s\S]*?requirePermission_\(token, 'roles', 'view'\)/);
  const a=await rpc('login',['01710000101',SECRET],NOW+100_000);
  const staff=await rpc('login',['01710000108',SECRET],NOW+100_000);
  assert.equal(a.body.success,true);
  assert.equal(staff.body.success,true);
  const adminToken=a.body.data.token;
  const readerToken=staff.body.data.token;
  const deny={status:200,body:{authorized:false}};
  assert.deepEqual(await authorizeRead('getRolesBootstrap',readerToken),{
    status:200,body:{authorized:true,actor:{id:'USR-RPC-GUARD',role:'GuardReader'}},
  });
  assert.deepEqual(await authorizeRead('getUsersBootstrap',readerToken),deny);
  assert.deepEqual(await authorizeRead('getUsersBootstrap',readerToken,NOW+102_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{users:{view:true}},allowedModules:['users'],
  }),deny,'browser claims cannot escalate staff permissions');
  assert.deepEqual(await authorizeRead('getUsersBootstrap',adminToken),{
    status:200,body:{authorized:true,actor:{id:'USR-RPC-ADMIN',role:'Administrator'}},
  });
  for(const methodName of ['deleteUser','createUser','completeSale','getAppShellData',
    'constructor','__proto__','getUsersBootstrap ']){
    assert.deepEqual(await authorizeRead(methodName,adminToken),deny,methodName);
  }
  assert.deepEqual(await authorizeRead('getRolesBootstrap','invalid'),deny);
  await rpc('logout',[adminToken],NOW+103_000);
  assert.deepEqual(await authorizeRead('getRolesBootstrap',adminToken,NOW+104_000),deny);

  // Stored role mutation revokes the already-issued authority snapshot,
  // including if the old permission is later restored.
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='' WHERE role_name='GuardReader'")
    .bind(JSON.stringify({roles:{view:false},users:{view:false}})).run();
  assert.deepEqual(await authorizeRead('getRolesBootstrap',readerToken,NOW+105_000),deny);
  const downgraded=await rpc('login',['01710000108',SECRET],NOW+106_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await authorizeRead('getRolesBootstrap',downgraded.body.data.token,NOW+107_000),deny);
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='roles' WHERE role_name='GuardReader'")
    .bind(JSON.stringify({roles:{view:true},users:{view:false}})).run();
  assert.deepEqual(await authorizeRead('getRolesBootstrap',readerToken,NOW+108_000),deny);
  const reissued=await rpc('login',['01710000108',SECRET],NOW+109_000);
  assert.equal(reissued.body.success,true);
  assert.equal((await authorizeRead('getRolesBootstrap',reissued.body.data.token,NOW+110_000)).body.authorized,true);
  await db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-RPC-GUARD'").run();
  assert.deepEqual(await authorizeRead('getRolesBootstrap',reissued.body.data.token,NOW+111_000),deny);
});


async function staffDirectory(token,nowMs=NOW+121_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/staff-directory',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('read-only partial staff directory uses current D1 users.view and never projects credentials',async()=>{
  const source=readFileSync(new URL('../../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  assert.match(source,/function getUsersBootstrap\(token\)/);
  assert.match(source,/requirePermission_\(token, 'users', 'view'\)/);
  const admin=await rpc('login',['01710000101',SECRET],NOW+120_000);
  const cashier=await rpc('login',['01710000105',SECRET],NOW+120_000);
  const reader=await rpc('login',['01710000109',SECRET],NOW+120_000);
  assert.equal(admin.body.success,true);
  assert.equal(cashier.body.success,true);
  assert.equal(reader.body.success,true);
  const denied={status:200,body:{authorized:false}};
  assert.deepEqual(await staffDirectory(cashier.body.data.token),denied);
  assert.deepEqual(await staffDirectory(cashier.body.data.token,NOW+122_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{users:{view:true}},allowedModules:['users'],
  }),denied);
  const valid=await staffDirectory(reader.body.data.token);
  assert.equal(valid.status,200);
  assert.equal(valid.body.authorized,true);
  assert.equal(valid.body.partial,true,'schema is missing createdBy/createdAt/lastLogin');
  assert.deepEqual(Object.keys(valid.body),['authorized','partial','users','roles']);
  const user=valid.body.users.find(u=>u.id==='USR-RPC-DIRECTORY');
  assert.deepEqual(user,{
    id:'USR-RPC-DIRECTORY',name:'Fixture USR-RPC-DIRECTORY',
    mobile:'01710000109',role:'DirectoryReader',status:'Active',
  });
  assert.equal(valid.body.users.length>=8,true);
  assert.deepEqual(valid.body.users.map(u=>u.id),[...valid.body.users.map(u=>u.id)].sort());
  assert.deepEqual(valid.body.roles.map(r=>r.name),[...valid.body.roles.map(r=>r.name)].sort());
  assert.equal(valid.body.roles.some(r=>r.name==='DirectoryReader'),true);
  assert.equal(valid.body.roles.some(r=>r.name==='Administrator'),false,'built-in admin is not a role row');
  assert.deepEqual(valid.body.users.map(u=>Object.keys(u)).every(k=>
    JSON.stringify(k)===JSON.stringify(['id','name','mobile','role','status'])),true);
  assert.deepEqual(valid.body.roles.every(r=>Object.keys(r).join(',')==='name'),true);
  const output=JSON.stringify(valid.body);
  for(const secret of [SECRET,'password_hash','password_salt','legacy_hash',
    'password_iterations','credential_version','auth_version','token_hash']){
    assert.equal(output.includes(secret),false,'private value escaped: '+secret);
  }
  assert.deepEqual(await staffDirectory(admin.body.data.token),valid);
  assert.deepEqual(await staffDirectory('not-a-token'),denied);

  await rpc('logout',[reader.body.data.token],NOW+123_000);
  assert.deepEqual(await staffDirectory(reader.body.data.token,NOW+124_000),denied);
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='' WHERE role_name='DirectoryReader'")
    .bind(JSON.stringify({users:{view:false}})).run();
  const downgraded=await rpc('login',['01710000109',SECRET],NOW+125_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await staffDirectory(downgraded.body.data.token,NOW+126_000),denied);
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='users' WHERE role_name='DirectoryReader'")
    .bind(JSON.stringify({users:{view:true}})).run();
  assert.deepEqual(await staffDirectory(downgraded.body.data.token,NOW+127_000),denied);
  const restored=await rpc('login',['01710000109',SECRET],NOW+128_000);
  assert.equal(restored.body.success,true);
  assert.equal((await staffDirectory(restored.body.data.token,NOW+129_000)).body.authorized,true);
  await db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-RPC-DIRECTORY'").run();
  assert.deepEqual(await staffDirectory(restored.body.data.token,NOW+130_000),denied);
});

async function roleDirectory(token,nowMs=NOW+141_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/role-directory',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('partial roles directory honors stored D1 roles.view, revocation and exact safe projection',async()=>{
  // Frozen original guards the full ROLES bootstrap with roles.view. Current
  // test fixture lacks Role ID and Created At, so this read is PARTIAL only.
  const source=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(source,/function getRolesBootstrap\(token\)[\s\S]*?requirePermission_\(token, 'roles', 'view'\)/);
  const admin=await rpc('login',['01710000101',SECRET],NOW+140_000);
  const viewer=await rpc('login',['01710000105',SECRET],NOW+140_000);
  const cashier=await rpc('login',['01710000102',SECRET],NOW+140_000);
  assert.equal(admin.body.success,true);
  assert.equal(viewer.body.success,true);
  assert.equal(cashier.body.success,true);
  const denied={status:200,body:{authorized:false}};
  assert.deepEqual(await roleDirectory(cashier.body.data.token),denied);
  assert.deepEqual(await roleDirectory(cashier.body.data.token,NOW+142_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{roles:{view:true}},allowedModules:['roles'],
  }),denied);

  await db.prepare("INSERT INTO auth_roles (role_name,status) VALUES ('InactiveListingTest','Inactive')").run();
  const authorized=await roleDirectory(viewer.body.data.token);
  assert.equal(authorized.status,200);

  // Full source role IDs/creation dates are still unavailable, but both
  // static Roles bootstrap option arrays must now match frozen GAS exactly.
  assert.deepEqual(Object.keys(authorized.body),
    ['authorized','partial','roles','moduleOptions','deleteWindowOptions']);
  assert.equal(authorized.body.moduleOptions.length,21);
  assert.equal(authorized.body.deleteWindowOptions.length,8);
  assert.deepEqual(authorized.body.moduleOptions.find(m=>m.key==='returns'),
    {key:'returns',label:'Sales Return',permissionMode:''});
  assert.deepEqual(authorized.body.moduleOptions.find(m=>m.key==='posCost'),
    {key:'posCost',label:'POS Purchase Price',permissionMode:''});
  for(const name of ['openingBalance','settlementDiscount']){
    const module=authorized.body.moduleOptions.find(m=>m.key===name);
    assert.equal(module.permissionMode,'editOnly');
  }
  assert.deepEqual(authorized.body.deleteWindowOptions,[
    {key:'disabled',label:'Disabled'}, {key:'same',label:'Same Day'},
    {key:'1',label:'1 Day'}, {key:'3',label:'3 Days'},
    {key:'7',label:'7 Days'}, {key:'15',label:'15 Days'},
    {key:'30',label:'30 Days'}, {key:'unlimited',label:'Unlimited'},
  ]);

  assert.equal(authorized.body.authorized,true);
  assert.equal(authorized.body.partial,true,'missing source Role ID/Created At and UI options');
  assert.deepEqual(authorized.body.roles.map(x=>x.name),
    [...authorized.body.roles.map(x=>x.name)].sort());
  assert.deepEqual(authorized.body.roles.find(x=>x.name==='InactiveListingTest'),
    {name:'InactiveListingTest',status:'Inactive'});
  assert.deepEqual(authorized.body.roles.find(x=>x.name==='Corrupt'),
    {name:'Corrupt',status:'Active'},'listing does not reflect raw malformed Permissions JSON');
  assert.equal(authorized.body.roles.every(x=>
    Object.keys(x).join(',')==='name,status'),true);
  assert.equal(authorized.body.roles.some(x=>x.name==='Administrator'),false,
    'built-in Administrator is not an auth_roles record');
  assert.deepEqual(await roleDirectory(admin.body.data.token),authorized);
  const serialized=JSON.stringify(authorized.body);
  for(const privateValue of [
    SECRET,'permissions_json','allowed_modules','auth_version','password_hash',
    'legacy_hash','token_hash','role_auth_version','credential_version',
  ])assert.equal(serialized.includes(privateValue),false,privateValue);
  assert.deepEqual(await roleDirectory('not-a-valid-session'),denied);
  assert.deepEqual(await roleDirectory(viewer.body.data.token,NOW+140_000+31*60*1000),denied,
    'expired idle window denies even a formerly valid role viewer');

  // Disable / reactivate a role without resurrecting the old authority.
  await db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='SourceRole'").run();
  assert.deepEqual(await roleDirectory(viewer.body.data.token,NOW+143_000),denied);
  await db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='SourceRole'").run();
  assert.deepEqual(await roleDirectory(viewer.body.data.token,NOW+144_000),denied);
  const fresh=await rpc('login',['01710000105',SECRET],NOW+145_000);
  assert.equal(fresh.body.success,true);
  assert.equal((await roleDirectory(fresh.body.data.token,NOW+146_000)).body.authorized,true);
  await rpc('logout',[fresh.body.data.token],NOW+147_000);
  assert.deepEqual(await roleDirectory(fresh.body.data.token,NOW+148_000),denied);
});


async function deletePreflight(methodName,token,nowMs=NOW+171_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/delete-preflight',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({methodName,token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('management-delete preflight grants only matching persisted D1 rights without ever deleting records',async()=>{
  const usersSource=readFileSync(new URL('../../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  const rolesSource=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  const authSource=readFileSync(new URL('../../legacy/source/Auth.gs',import.meta.url),'utf8');
  assert.match(usersSource,/function deleteUser\(token, userId\)[\s\S]*?requireManagementDeletePermission_\(token, 'users'\)/);
  assert.match(rolesSource,/function deleteRole\(token, roleId\)[\s\S]*?requireManagementDeletePermission_\(token, 'roles'\)/);
  assert.match(authSource,/function requireManagementDeletePermission_\(token, moduleKey\)/);
  const countBefore=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  const admin=await rpc('login',['01710000101',SECRET],NOW+170_000);
  const source=await rpc('login',['01710000105',SECRET],NOW+170_000);
  const rolesOnly=await rpc('login',['01710000110',SECRET],NOW+170_000);
  assert.equal(admin.body.success,true);
  assert.equal(source.body.success,true);
  assert.equal(rolesOnly.body.success,true);
  const adminToken=admin.body.data.token;
  const sourceToken=source.body.data.token;
  const roleToken=rolesOnly.body.data.token;
  const deny={status:200,body:{eligible:false}};
  const ok=(id,role)=>({status:200,body:{eligible:true,actor:{id,role}}});
  assert.deepEqual(await deletePreflight('deleteUser',adminToken),
    ok('USR-RPC-ADMIN','Administrator'));
  assert.deepEqual(await deletePreflight('deleteRole',adminToken),
    ok('USR-RPC-ADMIN','Administrator'));
  assert.deepEqual(await deletePreflight('deleteUser',sourceToken),
    ok('USR-RPC-SOURCE','SourceRole'));
  assert.deepEqual(await deletePreflight('deleteRole',sourceToken),deny,
    'roles.view does not grant roles.delete');
  assert.deepEqual(await deletePreflight('deleteRole',roleToken),
    ok('USR-RPC-ROLE-DELETE','ManagementDeleteRolesOnly'));
  assert.deepEqual(await deletePreflight('deleteUser',roleToken),deny,
    'users.view does not grant users.delete');
  assert.deepEqual(await deletePreflight('deleteUser',roleToken,NOW+172_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{users:{delete:true}},allowedModules:['users'],
    target:{id:'USR-RPC-SOURCE'},
  }),deny,'client identity, permissions, and target claims are never trusted');

  for(const methodName of ['deleteCustomer','deleteRoles','deleteUser ',
    'resetPassword','createUser','constructor','toString','__proto__',null]){
    assert.deepEqual(await deletePreflight(methodName,adminToken),deny,String(methodName));
  }
  assert.deepEqual(await deletePreflight('deleteRole','not-a-token'),deny);
  assert.deepEqual(await deletePreflight('deleteRole',roleToken,NOW+170_000+31*60*1000),deny,
    'idle session cannot authorize a later write');
  await rpc('logout',[adminToken],NOW+173_000);
  assert.deepEqual(await deletePreflight('deleteRole',adminToken,NOW+174_000),deny);

  // Role authority changes must invalidate the OLD token even if restored.
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='ManagementDeleteRolesOnly'")
    .bind(JSON.stringify({users:{view:true,delete:false},roles:{delete:false}})).run();
  assert.deepEqual(await deletePreflight('deleteRole',roleToken,NOW+175_000),deny);
  const downgraded=await rpc('login',['01710000110',SECRET],NOW+176_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await deletePreflight('deleteRole',downgraded.body.data.token,NOW+177_000),deny);
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='ManagementDeleteRolesOnly'")
    .bind(JSON.stringify({users:{view:true,delete:false},roles:{delete:true}})).run();
  assert.deepEqual(await deletePreflight('deleteRole',roleToken,NOW+178_000),deny);
  assert.deepEqual(await deletePreflight('deleteRole',downgraded.body.data.token,NOW+178_000),deny);
  const renewed=await rpc('login',['01710000110',SECRET],NOW+179_000);
  assert.equal(renewed.body.success,true);
  assert.equal((await deletePreflight('deleteRole',renewed.body.data.token,NOW+180_000)).body.eligible,true);
  await db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='ManagementDeleteRolesOnly'").run();
  assert.deepEqual(await deletePreflight('deleteRole',renewed.body.data.token,NOW+181_000),deny);
  await db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='ManagementDeleteRolesOnly'").run();
  assert.deepEqual(await deletePreflight('deleteRole',renewed.body.data.token,NOW+182_000),deny);
  const countAfter=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  assert.deepEqual(countAfter,countBefore,'the authorization preview performs no delete');
});


async function addPreflight(methodName,token,nowMs=NOW+191_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/add-preflight',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({methodName,token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('management add preflight checks independent stored D1 users.add and roles.add without creating records',async()=>{
  const usersSource=readFileSync(new URL('../../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  const rolesSource=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(usersSource,/function createUser\(token, payload\)[\s\S]*?requirePermission_\(token, 'users', 'add'\)/);
  assert.match(rolesSource,/function addRole\(token, payload\)[\s\S]*?requirePermission_\(token, 'roles', 'add'\)/);

  const beforeUsers=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  const beforeRoles=await db.prepare('SELECT COUNT(*) AS n FROM auth_roles').first();
  const admin=await rpc('login',['01710000101',SECRET],NOW+190_000);
  const userAdder=await rpc('login',['01710000111',SECRET],NOW+190_000);
  const roleAdder=await rpc('login',['01710000112',SECRET],NOW+190_000);
  // GuardReader was deliberately deactivated by an earlier RBAC regression.
  // Reuse the still-active SourceRole viewer so this checks the missing
  // add-preflight route, rather than failing during synthetic login setup.
  const viewer=await rpc('login',['01710000105',SECRET],NOW+190_000);
  const roleDeleter=await rpc('login',['01710000110',SECRET],NOW+190_000);
  for(const result of [admin,userAdder,roleAdder,viewer,roleDeleter])
    assert.equal(result.body.success,true);

  const tokenAdmin=admin.body.data.token;
  const tokenUser=userAdder.body.data.token;
  const tokenRole=roleAdder.body.data.token;
  const deny={status:200,body:{eligible:false}};
  const ok=(id,role)=>({status:200,body:{eligible:true,actor:{id,role}}});
  assert.deepEqual(await addPreflight('createUser',tokenAdmin),
    ok('USR-RPC-ADMIN','Administrator'));
  assert.deepEqual(await addPreflight('addRole',tokenAdmin),
    ok('USR-RPC-ADMIN','Administrator'));
  assert.deepEqual(await addPreflight('createUser',tokenUser),
    ok('USR-RPC-USER-ADD','UsersAdder'));
  assert.deepEqual(await addPreflight('addRole',tokenUser),deny);
  assert.deepEqual(await addPreflight('addRole',tokenRole),
    ok('USR-RPC-ROLE-ADD','RolesAdder'));
  assert.deepEqual(await addPreflight('createUser',tokenRole),deny);
  assert.deepEqual(await addPreflight('addRole',viewer.body.data.token),deny,
    'roles.view is not roles.add');
  assert.deepEqual(await addPreflight('addRole',roleDeleter.body.data.token),deny,
    'roles.delete is not roles.add');
  assert.deepEqual(await addPreflight('createUser',roleDeleter.body.data.token),deny,
    'users.view is not users.add');

  // No client claims may substitute for the server's D1 role snapshot.
  assert.deepEqual(await addPreflight('createUser',tokenRole,NOW+192_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{users:{add:true}},allowedModules:['users'],
    payload:{role:'Administrator',password:SECRET},
  }),deny);
  for(const methodName of ['deleteUser','deleteRole','updateUser','resetPassword',
    'addRole ','createUsers','constructor','toString','__proto__',null]){
    assert.deepEqual(await addPreflight(methodName,tokenAdmin),deny,String(methodName));
  }
  assert.deepEqual(await addPreflight('createUser','bad-token'),deny);
  assert.deepEqual(await addPreflight('addRole',tokenRole,NOW+190_000+31*60*1000),deny,
    'idle token cannot pass a fresh action check');
  await rpc('logout',[tokenAdmin],NOW+193_000);
  assert.deepEqual(await addPreflight('createUser',tokenAdmin,NOW+194_000),deny);

  // New authority snapshot is needed after every role update. Re-enabling
  // a role cannot resurrect an old bearer even when permissions return.
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='roles' WHERE role_name='RolesAdder'")
    .bind(JSON.stringify({roles:{add:false,view:true}})).run();
  assert.deepEqual(await addPreflight('addRole',tokenRole,NOW+195_000),deny);
  const demoted=await rpc('login',['01710000112',SECRET],NOW+196_000);
  assert.equal(demoted.body.success,true);
  assert.deepEqual(await addPreflight('addRole',demoted.body.data.token,NOW+197_000),deny);
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='' WHERE role_name='RolesAdder'")
    .bind(JSON.stringify({roles:{add:true,view:false}})).run();
  assert.deepEqual(await addPreflight('addRole',tokenRole,NOW+198_000),deny);
  assert.deepEqual(await addPreflight('addRole',demoted.body.data.token,NOW+198_000),deny);
  const renewed=await rpc('login',['01710000112',SECRET],NOW+199_000);
  assert.equal(renewed.body.success,true);
  assert.equal((await addPreflight('addRole',renewed.body.data.token,NOW+200_000)).body.eligible,true);
  await db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='RolesAdder'").run();
  assert.deepEqual(await addPreflight('addRole',renewed.body.data.token,NOW+201_000),deny);
  await db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='RolesAdder'").run();
  assert.deepEqual(await addPreflight('addRole',renewed.body.data.token,NOW+202_000),deny);
  const afterUsers=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  const afterRoles=await db.prepare('SELECT COUNT(*) AS n FROM auth_roles').first();
  assert.deepEqual(afterUsers,beforeUsers,'createUser preflight never creates a user');
  assert.deepEqual(afterRoles,beforeRoles,'addRole preflight never creates a role');
  assert.equal(JSON.stringify(ok('USR-RPC-ADMIN','Administrator')).includes(SECRET),false);
});


async function usersEditPreflight(methodName,token,nowMs=NOW+211_000,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/users-edit-preflight',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({methodName,token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('users.edit preflight requires live D1 action rights for update, reset password and status without writes',async()=>{
  const source=readFileSync(new URL('../../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  for(const [method,signature] of [
    ['updateUser','token, userId, payload'],
    ['resetPassword','token, userId, newPassword'],
    ['setUserStatus','token, userId, status'],
  ]){
    // Frozen signatures contain no regexp special characters.
    assert.match(source,new RegExp('function '+method+'\\('+signature+'\\)[\\s\\S]*?requirePermission_\\(token, \'users\', \'edit\'\\)'));
  }
  const countBefore=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  const accountBefore=await db.prepare(`SELECT user_id,status,role_name,
      password_hash,password_salt,credential_version,auth_version
    FROM auth_users WHERE user_id='USR-RPC-USER-EDIT'`).first();

  // Keep fixture setup serialized; the actual assertions target current D1
  // authority, not parallel login throttling or Workerd scheduler behavior.
  const signins=[];
  for(const phone of [
    '01710000101','01710000113','01710000111','01710000105','01710000110'
  ])signins.push(await rpc('login',[phone,SECRET],NOW+210_000));
  for(const r of signins)assert.equal(r.body.success,true);
  const [admin,editor,adder,viewer,deleter]=signins.map(r=>r.body.data.token);
  const deny={status:200,body:{eligible:false}};
  const allow=(id,role)=>({status:200,body:{eligible:true,actor:{id,role}}});

  for(const methodName of ['updateUser','resetPassword','setUserStatus']){
    assert.deepEqual(await usersEditPreflight(methodName,admin),
      allow('USR-RPC-ADMIN','Administrator'));
    assert.deepEqual(await usersEditPreflight(methodName,editor),
      allow('USR-RPC-USER-EDIT','UsersEditor'));
    for(const token of [adder,viewer,deleter])
      assert.deepEqual(await usersEditPreflight(methodName,token),deny,
        'users.add/users.delete/view must not imply users.edit');
  }
  assert.deepEqual(await usersEditPreflight('resetPassword',adder,NOW+212_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{users:{edit:true}},
    allowedModules:['users'],
    target:{id:'USR-RPC-ADMIN'},
    payload:{password:SECRET},
  }),deny);
  for(const methodName of ['updateRole','setRoleStatus','addRole','deleteUser',
    'updateUsers','resetPassword ','toString','constructor','__proto__',null]){
    assert.deepEqual(await usersEditPreflight(methodName,admin),deny,String(methodName));
  }
  assert.deepEqual(await usersEditPreflight('updateUser','bad-session'),deny);
  assert.deepEqual(await usersEditPreflight('resetPassword',editor,NOW+210_000+31*60*1000),
    deny,'idle session rejected');
  await rpc('logout',[admin],NOW+213_000);
  assert.deepEqual(await usersEditPreflight('setUserStatus',admin,NOW+214_000),deny);

  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='users' WHERE role_name='UsersEditor'")
    .bind(JSON.stringify({users:{view:true,edit:false}})).run();
  assert.deepEqual(await usersEditPreflight('updateUser',editor,NOW+215_000),deny);
  const downgraded=await rpc('login',['01710000113',SECRET],NOW+216_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await usersEditPreflight('resetPassword',downgraded.body.data.token,NOW+217_000),deny);
  await db.prepare("UPDATE auth_roles SET permissions_json=?,allowed_modules='' WHERE role_name='UsersEditor'")
    .bind(JSON.stringify({users:{edit:true}})).run();
  assert.deepEqual(await usersEditPreflight('updateUser',editor,NOW+218_000),deny);
  assert.deepEqual(await usersEditPreflight('updateUser',downgraded.body.data.token,NOW+218_000),deny);
  const reissued=await rpc('login',['01710000113',SECRET],NOW+219_000);
  assert.equal(reissued.body.success,true);
  assert.deepEqual(await usersEditPreflight('setUserStatus',reissued.body.data.token,NOW+220_000),
    allow('USR-RPC-USER-EDIT','UsersEditor'));
  await db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='UsersEditor'").run();
  assert.deepEqual(await usersEditPreflight('resetPassword',reissued.body.data.token,NOW+221_000),deny);
  await db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='UsersEditor'").run();
  assert.deepEqual(await usersEditPreflight('resetPassword',reissued.body.data.token,NOW+222_000),deny);

  // Read-time RBAC preview has NO staff or credential writes.
  const countAfter=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();
  const accountAfter=await db.prepare(`SELECT user_id,status,role_name,
      password_hash,password_salt,credential_version,auth_version
    FROM auth_users WHERE user_id='USR-RPC-USER-EDIT'`).first();
  assert.deepEqual(countAfter,countBefore);
  assert.deepEqual(accountAfter,accountBefore);
  const response=JSON.stringify(allow('USR-RPC-USER-EDIT','UsersEditor'));
  for(const secret of [SECRET,'password_hash','password_salt','auth_version','token_hash'])
    assert.equal(response.includes(secret),false,'private field should never be returned');
});

test('source-stored D1 role navigation mismatch blocks sign-in, revokes minted token and permits corrected view-only navigation',async()=>{
  const when=NOW+1_400_000;
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('VisibilityMismatch','Active',?,'products')`)
    .bind(JSON.stringify({
      sales:{view:true,edit:false},
      products:{view:false,edit:true},
    })).run();
  await seed('USR-RPC-VIS-MISMATCH','01710000114','VisibilityMismatch');

  // Frozen RoleManagement.gs computes visible modules only from view===true.
  // This D1 row is structurally valid but fraudulently shows Products rather
  // than the only view-authorized module, Sales.
  const denied=await rpc('login',['01710000114',SECRET],when);
  assert.deepEqual(denied,{
    status:200,
    body:{success:false,message:'Sign-in role configuration is unavailable.'}
  });
  const revoked=await db.prepare(`SELECT COUNT(*) AS n FROM auth_sessions
    WHERE user_id='USR-RPC-VIS-MISMATCH'
      AND revoked_at_ms=?`).bind(when).first();
  assert.equal(revoked.n,1,'any minted session for corrupted role must be revoked');

  // A corrected source-derived visible set is acceptable. An edit-only grant
  // for a nonvisible Products module must not fabricate navigation visibility.
  await db.prepare(`UPDATE auth_roles SET allowed_modules='sales'
    WHERE role_name='VisibilityMismatch'`).run();
  const ok=await rpc('login',['01710000114',SECRET],when+1000);
  assert.equal(ok.status,200);
  assert.equal(ok.body.success,true);
  assert.deepEqual(ok.body.data.allowedModules,['sales']);
  assert.deepEqual(ok.body.data.permissions,{
    sales:{view:true,edit:false},
    products:{view:false,edit:true}
  });
  const restored=await rpc('validateSession',[ok.body.data.token],when+2000);
  assert.equal(restored.body.success,true);
  assert.deepEqual(await rpc('logout',[ok.body.data.token],when+3000),{
    status:200,body:{success:true,data:'logged out'}
  });
});

test('source-profile SELECT must reject a session made idle between validation and profile read',async()=>{
  const start=NOW+3_000_000;
  let clock=start;
  await seed('USR-RPC-IDLE-DRIFT','01710000117');
  const bridge=createD1LegacyAuthRpc(db,{
    now:()=>clock,normalizeMobile:normalizeLegacyStaffPhoneSearch,
  });
  const signed=await bridge.login('01710000117',SECRET);
  assert.equal(signed.success,true);
  const token=signed.data.token;
  const digest=await tokenFingerprint(token);
  clock=start+1_000_000;
  assert.equal((await bridge.validateSession(token)).success,true,
    'a genuine intermediate D1 heartbeat remains within the idle window');

  // This trusted test adapter simulates another D1 write AFTER the core's
  // positive session heartbeat but BEFORE its separate source-profile SELECT.
  // Without a second independent idle predicate, profile data leaks through.
  clock=start+2_000_000;
  let injected=0;
  const interleaved={
    prepare(sql){
      const stmt=db.prepare(sql);
      if(!sql.includes('SELECT u.user_id,u.full_name,u.phone_key,u.role_name,'))
        return stmt;
      return {
        bind(...values){
          const bound=stmt.bind(...values);
          return {
            async first(){
              injected++;
              await db.prepare(
                'UPDATE auth_sessions SET last_activity_at_ms=? WHERE token_hash=?'
              ).bind(start,digest).run();
              return bound.first();
            },
          };
        },
      };
    },
  };
  const racing=createD1LegacyAuthRpc(interleaved,{
    now:()=>clock,normalizeMobile:normalizeLegacyStaffPhoneSearch,
  });
  const result=await racing.validateSession(token);
  assert.equal(injected,1,'the synthetic drift occurred at the intended real D1 read boundary');
  assert.deepEqual(result,{
    success:false,message:'Session expired. Please sign in again.'
  });
  const persisted=await db.prepare(
    'SELECT last_activity_at_ms FROM auth_sessions WHERE token_hash=?'
  ).bind(digest).first();
  assert.equal(persisted.last_activity_at_ms,start);
  assert.equal((await bridge.validateSession(token)).success,false,
    'a later ordinary core session check also refuses the stale heartbeat');
});

test('management previews deny contradictory view-derived role navigation while preserving independent action grants',async()=>{
  const at=NOW+4_000_000;
  const phone='01710000118';
  const permissions={
    sales:{view:true},
    users:{view:false,add:true,edit:true,delete:true},
    roles:{view:false,add:true,delete:true},
  };
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,allowed_modules,permissions_json)
    VALUES ('NavMismatchActions','Active','products',?)`)
    .bind(JSON.stringify(permissions)).run();
  await seed('USR-RPC-NAV-ACTIONS',phone,'NavMismatchActions');
  const countsBefore=await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first();

  // Test-only direct D1 core login establishes a genuine persisted session
  // without going through the source-profile bridge, which already denies
  // this contradictory role. This isolates the independent preview defect.
  const signIn=await loginWithD1(db,{phoneKey:phone,password:SECRET,nowMs:at});
  assert.equal(signIn.authenticated,true);
  const probes=[
    ['createUser',addPreflight],
    ['addRole',addPreflight],
    ['updateUser',usersEditPreflight],
    ['resetPassword',usersEditPreflight],
    ['setUserStatus',usersEditPreflight],
    ['deleteUser',deletePreflight],
    ['deleteRole',deletePreflight],
  ];
  const denied={status:200,body:{eligible:false}};
  for(const [method,probe] of probes)
    assert.deepEqual(await probe(method,signIn.token,at+1000),denied,
      method+' must reject the role metadata contradiction');

  // Correct the source-derived display navigation and use a fresh session:
  // users/roles action rights without view are legitimate, distinct grants.
  await db.prepare(`UPDATE auth_roles SET allowed_modules='sales'
    WHERE role_name='NavMismatchActions'`).run();
  assert.deepEqual(await addPreflight('createUser',signIn.token,at+2000),denied,
    'role authority version must invalidate the earlier session');
  const corrected=await loginWithD1(db,{
    phoneKey:phone,password:SECRET,nowMs:at+3000,
  });
  assert.equal(corrected.authenticated,true);
  const allowed={status:200,body:{
    eligible:true,actor:{id:'USR-RPC-NAV-ACTIONS',role:'NavMismatchActions'},
  }};
  for(const [method,probe] of probes)
    assert.deepEqual(await probe(method,corrected.token,at+4000),allowed,
      method+' must continue honoring independent non-view actions');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM auth_users').first()).n,
    countsBefore.n,'previews must never mutate the staff directory');
});

async function rolesEditPreflight(methodName,token,nowMs,claims={}){
  const response=await worker.fetch('http://m04.local/__m04_test__/roles-edit-preflight',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({methodName,token,nowMs,...claims}),
  });
  return {status:response.status,body:await response.json()};
}

test('roles.edit eligibility preview enforces source action separately from view/add/delete on real D1',async()=>{
  const source=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(source,/function updateRole\(token, roleId, payload\)[\s\S]*?requirePermission_\(token, 'roles', 'edit'\)/);
  assert.match(source,/function setRoleStatus\(token, roleId, status\)[\s\S]*?requirePermission_\(token, 'roles', 'edit'\)/);
  const at=NOW+5_000_000;
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,allowed_modules,permissions_json)
    VALUES ('M04RoleEditor','Active','',?),
      ('M04RoleViewer','Active','roles',?),
      ('M04RoleNavDrift','Active','sales',?)`)
    .bind(
      JSON.stringify({roles:{view:false,add:false,edit:true,delete:false}}),
      JSON.stringify({roles:{view:true,add:true,edit:false,delete:true}}),
      JSON.stringify({roles:{view:false,add:false,edit:true,delete:false}}),
    ).run();
  await seed('USR-RPC-ROLE-EDITOR','01710000119','M04RoleEditor');
  await seed('USR-RPC-ROLE-VIEWER','01710000120','M04RoleViewer');
  await seed('USR-RPC-ROLE-DRIFT','01710000121','M04RoleNavDrift');

  const editor=await rpc('login',['01710000119',SECRET],at);
  const viewer=await rpc('login',['01710000120',SECRET],at);
  const admin=await rpc('login',['01710000101',SECRET],at);
  for(const result of [editor,viewer,admin])
    assert.equal(result.body.success,true,'setup must produce a genuine D1 source-shaped session');
  const drift=await loginWithD1(db,{
    phoneKey:'01710000121',password:SECRET,nowMs:at,
  });
  assert.equal(drift.authenticated,true,
    'core token is needed to isolate the independent preview from profile checks');

  const before=await db.prepare(`SELECT COUNT(*) AS n FROM auth_roles`).first();
  const no={status:200,body:{eligible:false}};
  const yes=(id,role)=>({status:200,body:{eligible:true,actor:{id,role}}});
  for(const method of ['updateRole','setRoleStatus']){
    assert.deepEqual(await rolesEditPreflight(method,editor.body.data.token,at+1_000),
      yes('USR-RPC-ROLE-EDITOR','M04RoleEditor'),method+' requires roles.edit, not roles.view');
    assert.deepEqual(await rolesEditPreflight(method,admin.body.data.token,at+1_000),
      yes('USR-RPC-ADMIN','Administrator'),'active Administrator retains source rights');
    assert.deepEqual(await rolesEditPreflight(method,viewer.body.data.token,at+1_000),
      no,'view/add/delete do not grant edit');
    assert.deepEqual(await rolesEditPreflight(method,drift.token,at+1_000),
      no,'contradictory view-derived role navigation must fail closed');
    assert.deepEqual(await rolesEditPreflight(method,'bad-session',at+1_000),
      no,'invalid bearer must fail closed');
  }
  for(const invalidMethod of ['createUser','deleteRole','updateRole ','constructor','__proto__',null]){
    assert.deepEqual(await rolesEditPreflight(invalidMethod,admin.body.data.token,at+2_000),
      no,'unknown methods must be denied');
  }
  assert.deepEqual(await rolesEditPreflight('updateRole',viewer.body.data.token,at+3_000,{
    actor:{id:'USR-RPC-ADMIN',role:'Administrator'},
    permissions:{roles:{edit:true}},allowedModules:['roles'],
  }),no,'browser-supplied role or permissions cannot escalate privileges');

  // D1 triggers advance role authority: a formerly eligible token cannot
  // survive a role edit even if the actor still appears on the old screen.
  await db.prepare(`UPDATE auth_roles SET permissions_json=?
    WHERE role_name='M04RoleEditor'`)
    .bind(JSON.stringify({roles:{view:false,add:false,edit:false,delete:false}})).run();
  assert.deepEqual(await rolesEditPreflight('setRoleStatus',editor.body.data.token,at+4_000),
    no,'an old token is invalid after a D1 role authority-version update');
  const refreshed=await rpc('login',['01710000119',SECRET],at+5_000);
  assert.equal(refreshed.body.success,true);
  assert.deepEqual(await rolesEditPreflight('updateRole',refreshed.body.data.token,at+6_000),
    no,'new session still lacks the revoked roles.edit grant');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM auth_roles').first()).n,
    before.n,'eligibility preview must never write roles');
});

test('provenanced role directory returns only complete source ID and time from real D1',async()=>{
  const source=readFileSync(new URL('../../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(source,/function getRolesBootstrap\(token\)/);
  const at=NOW+6_000_000;
  const created='2026-11-14T08:09:10.123Z';
  await db.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,source_role_id,source_created_at_iso)
    VALUES ('M04SourceProvenanced','Active','{}','ROLE-SOURCE-04',?),
      ('M04SourceIncomplete','Inactive','{}','ROLE-INCOMPLETE-04',NULL),
      ('M04D1Native','Active','{}',NULL,NULL)`).bind(created).run();

  const admin=await rpc('login',['01710000101',SECRET],at);
  assert.equal(admin.body.success,true,'genuine active D1 Administrator session');
  assert.deepEqual(await roleDirectory('forged',at+1000),{
    status:200,body:{authorized:false},
  },'roles.view remains a mandatory stored-D1 gate');

  const visible=await roleDirectory(admin.body.data.token,at+1000);
  assert.equal(visible.status,200);
  assert.equal(visible.body.authorized,true);
  assert.equal(visible.body.partial,true,
    'this is still NOT a full source getRolesBootstrap response');
  const byName=name=>visible.body.roles.find(row=>row.name===name);
  assert.deepEqual(byName('M04SourceProvenanced'),{
    name:'M04SourceProvenanced',status:'Active',
    sourceRoleId:'ROLE-SOURCE-04',sourceCreatedAt:created,
  },'complete historical source ID and timestamp must be projected verbatim');
  assert.deepEqual(byName('M04SourceIncomplete'),{
    name:'M04SourceIncomplete',status:'Inactive',
  },'incomplete source provenance is never marketed as a verified pair');
  assert.deepEqual(byName('M04D1Native'),{
    name:'M04D1Native',status:'Active',
  },'D1-native role has no invented original ID or creation timestamp');
  assert.equal(visible.body.roles.some(x=>Object.hasOwn(x,'permissions')),false,
    'only source provenance, never permission JSON or authority metadata');
  assert.equal(visible.body.roles.some(x=>Object.hasOwn(x,'authVersion')),false);
});
