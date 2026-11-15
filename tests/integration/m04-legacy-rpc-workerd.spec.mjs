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
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='GuardReader'")
    .bind(JSON.stringify({roles:{view:false},users:{view:false}})).run();
  assert.deepEqual(await authorizeRead('getRolesBootstrap',readerToken,NOW+105_000),deny);
  const downgraded=await rpc('login',['01710000108',SECRET],NOW+106_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await authorizeRead('getRolesBootstrap',downgraded.body.data.token,NOW+107_000),deny);
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='GuardReader'")
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
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='DirectoryReader'")
    .bind(JSON.stringify({users:{view:false}})).run();
  const downgraded=await rpc('login',['01710000109',SECRET],NOW+125_000);
  assert.equal(downgraded.body.success,true);
  assert.deepEqual(await staffDirectory(downgraded.body.data.token,NOW+126_000),denied);
  await db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='DirectoryReader'")
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
