import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {createOfflinePasswordCredential}
  from '../../src/auth/d1-auth-core.js';
import {loginStaffForShop,validateStaffForShop,revokeStaffForShop}
  from '../../src/auth/m04-shop-staff-session-scope.js';

const A={
  shopId:'11111111-1111-4111-8111-111111111111',
  databaseId:'22222222-2222-4222-8222-222222222222',
  databaseMarker:'33333333-3333-4333-8333-333333333333'
};
const B={
  shopId:'44444444-4444-4444-8444-444444444444',
  databaseId:'55555555-5555-4555-8555-555555555555',
  databaseMarker:'66666666-6666-4666-8666-666666666666'
};
async function migrate(db,file){
  const sql=await readFile(file,'utf8');
  const rows=await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  assert.ok(rows.every(x=>x.success===true),'full reviewed local schema must apply');
}
const sessions=scope=>scope.shopDb.prepare('SELECT count(*) AS n FROM auth_sessions').first();
async function provision(db,identity,{name,role='Cashier',password}){
  await migrate(db,'staging-migrations/shop-identity/0001_shop_identity.sql');
  await migrate(db,'migrations/0003_auth_core.sql');
  await db.prepare('INSERT INTO shop_identity(singleton,shop_id,database_id,database_marker) VALUES(1,?,?,?)')
    .bind(identity.shopId,identity.databaseId,identity.databaseMarker).run();
  await db.prepare('INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES (?, ?, ?, ?)')
    .bind(role,'Active','{"pos":{"view":true,"add":true}}','pos').run();
  const cred=await createOfflinePasswordCredential(password);
  await db.prepare('INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,?,?,?,?)')
    .bind('STAFF-'+name,name+' Staff','01712345678',role,'Active',cred.passwordHash,cred.passwordSalt,cred.iterations).run();
  return {...identity,shopDb:db};
}
test('M04 sessions are isolated by verified physical Shop D1, normalized mobile and current role/user epochs',async t=>{
  const harness=createTestHarness({workers:[{
    configPath:'./wrangler.m04-shop-staff-session-test.jsonc'
  }]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker('shererp-m04-shop-staff-sessions-local-only');
  const {SHOP_A,SHOP_B}=await worker.getEnv();
  const first=await provision(SHOP_A,A,{name:'A',password:'A-strong-passphrase-2026'});
  const second=await provision(SHOP_B,B,{name:'B',password:'B-strong-passphrase-2026'});
  const input=(shop,phone,password)=>({selectedShopId:shop.shopId,mobile:phone,password});
  assert.equal((await sessions(first)).n,0);
  assert.equal((await sessions(second)).n,0);
  // An app-level wrong Shop does not even check credentials or insert a login session.
  assert.deepEqual(await loginStaffForShop(first,input(second,'01712345678','A-strong-passphrase-2026')),
    {authenticated:false});
  assert.deepEqual(await loginStaffForShop({...first,shopDb:second.shopDb},
    input(first,'01712345678','A-strong-passphrase-2026')),{authenticated:false});
  assert.equal((await sessions(first)).n,0);
  assert.equal((await sessions(second)).n,0);

  // Reuse the preexisting M04 PBKDF2/lock/session code (not a duplicate auth stack).
  const a=await loginStaffForShop(first,input(first,'০১৭১২৩৪৫৬৭৮','A-strong-passphrase-2026'));
  assert.equal(a.authenticated,true);
  assert.equal(a.shopId,A.shopId);
  assert.match(a.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(a.user,{id:'STAFF-A',name:'A Staff',role:'Cashier'});
  assert.equal((await sessions(first)).n,1);
  assert.equal((await sessions(second)).n,0);
  assert.deepEqual(await loginStaffForShop(second,
    input(second,'+8801712345678','A-strong-passphrase-2026')),{authenticated:false});
  const b=await loginStaffForShop(second,
    input(second,'+8801712345678','B-strong-passphrase-2026'));
  assert.equal(b.authenticated,true);
  assert.notEqual(a.token,b.token);
  assert.deepEqual(b.user,{id:'STAFF-B',name:'B Staff',role:'Cashier'});
  assert.deepEqual(await validateStaffForShop(first,{selectedShopId:A.shopId,token:a.token}),
    {authenticated:true,shopId:A.shopId,user:a.user});
  assert.deepEqual(await validateStaffForShop(second,{selectedShopId:B.shopId,token:b.token}),
    {authenticated:true,shopId:B.shopId,user:b.user});
  assert.deepEqual(await validateStaffForShop(second,{selectedShopId:B.shopId,token:a.token}),
    {authenticated:false});
  assert.deepEqual(await validateStaffForShop(first,{selectedShopId:A.shopId,token:b.token}),
    {authenticated:false});

  // Independent business permissions invalidate that business's token only.
  await first.shopDb.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"pos":{"view":false,"add":false}}','Cashier').run();
  assert.deepEqual(await validateStaffForShop(first,{selectedShopId:A.shopId,token:a.token}),
    {authenticated:false});
  assert.equal((await validateStaffForShop(second,{
    selectedShopId:B.shopId,token:b.token
  })).authenticated,true);

  // Disabling and re-enabling a staff account cannot revive the old session.
  await second.shopDb.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='STAFF-B'").run();
  assert.deepEqual(await validateStaffForShop(second,{selectedShopId:B.shopId,token:b.token}),
    {authenticated:false});
  await second.shopDb.prepare("UPDATE auth_users SET status='Active' WHERE user_id='STAFF-B'").run();
  assert.deepEqual(await validateStaffForShop(second,{selectedShopId:B.shopId,token:b.token}),
    {authenticated:false});
  const refreshed=await loginStaffForShop(second,input(second,'01712345678','B-strong-passphrase-2026'));
  assert.equal(refreshed.authenticated,true);
  assert.deepEqual(await revokeStaffForShop(second,{
    selectedShopId:B.shopId,token:refreshed.token
  }),{revoked:true});
  assert.deepEqual(await validateStaffForShop(second,{
    selectedShopId:B.shopId,token:refreshed.token
  }),{authenticated:false});

  // A local-only test fixture is not a public login endpoint.
  assert.equal((await worker.fetch('http://staff.local/api/staff/login',{
    method:'POST',body:JSON.stringify(input(first,'01712345678','A-strong-passphrase-2026'))
  })).status,404);
});
