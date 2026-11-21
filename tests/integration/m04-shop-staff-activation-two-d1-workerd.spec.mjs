import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';
import {loginStaffForShop} from '../../src/auth/m04-shop-staff-session-scope.js';
import {issueStaffInviteForShop,activateInvitedStaffForShop}
  from '../../src/auth/m04-shop-staff-activation.js';

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
const phone='01812345678';
async function migrate(db,file){
  const sql=await readFile(file,'utf8');
  const results=await db.batch(unstable_splitSqlQuery(sql)
    .map(statement=>db.prepare(statement)));
  assert.ok(results.every(result=>result.success===true));
}
async function setupShop(db,identity,suffix){
  await migrate(db,'staging-migrations/shop-identity/0001_shop_identity.sql');
  await migrate(db,'migrations/0003_auth_core.sql');
  await migrate(db,'tests/fixtures/m04-staff-activation-candidate.sql');
  await db.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
    .bind(identity.shopId,identity.databaseId,identity.databaseMarker).run();
  await db.prepare('INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES (?,?,?,?)')
    .bind('Cashier','Active','{"pos":{"view":true,"add":true}}','pos').run();
  const password='Admin-Strong-'+suffix+'-2026';
  const credential=await createOfflinePasswordCredential(password);
  await db.prepare('INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES (?,?,?,?,?,?,?,?)')
    .bind('OWNER-'+suffix,'Admin '+suffix,'0171111111'+(suffix==='A'?'1':'2'),
      'Administrator','Active',credential.passwordHash,
      credential.passwordSalt,credential.iterations).run();
  const scope={...identity,shopDb:db};
  const signed=await loginStaffForShop(scope,{
    selectedShopId:identity.shopId,mobile:'0171111111'+(suffix==='A'?'1':'2'),
    password
  });
  assert.equal(signed.authenticated,true,'local admin login must be authenticated');
  return {scope,adminToken:signed.token};
}
async function fixture(t){
  const harness=createTestHarness({workers:[{
    configPath:'./wrangler.m04-shop-staff-session-test.jsonc'
  }]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker('shererp-m04-shop-staff-sessions-local-only');
  const {SHOP_A,SHOP_B}=await worker.getEnv();
  const [a,b]=await Promise.all([
    setupShop(SHOP_A,A,'A'),setupShop(SHOP_B,B,'B')
  ]);
  return {worker,a,b};
}
const request=(shop,adminToken,roleName='Cashier')=>({
  selectedShopId:shop.shopId,managerToken:adminToken,
  fullName:'New Counter Staff',mobile:phone,roleName
});
const activate=(shop,token,password='Counter-Strong-2026')=>({
  selectedShopId:shop.shopId,activationToken:token,password
});

test('trusted Shop issues one-time staff activation; employee chooses own PBKDF2 password and cannot cross Shops',async t=>{
  const {a,b,worker}=await fixture(t);
  const issued=await issueStaffInviteForShop(a.scope,
    request(a.scope,a.adminToken));
  assert.equal(issued.issued,true);
  assert.equal(issued.shopId,A.shopId);
  assert.match(issued.userId,/^STAFF-[0-9a-f-]{36}$/);
  assert.match(issued.activationToken,/^[0-9a-f]{64}$/);
  const row=await a.scope.shopDb.prepare('SELECT token_hash,expires_at_ms,issued_at_ms FROM auth_staff_activation_tickets WHERE user_id=?')
    .bind(issued.userId).first();
  assert.notEqual(row.token_hash,issued.activationToken,'store a hash, never a usable bearer');
  assert.ok(row.expires_at_ms-row.issued_at_ms<=900000);
  assert.deepEqual(await activateInvitedStaffForShop(b.scope,activate(B,issued.activationToken)),
    {activated:false},'physical cross-business D1 never accepts a different business token');
  assert.deepEqual(await activateInvitedStaffForShop(a.scope,
    activate(A,issued.activationToken,'short')),{activated:false});
  assert.equal((await a.scope.shopDb.prepare('SELECT consumed_at_ms FROM auth_staff_activation_tickets WHERE user_id=?')
    .bind(issued.userId).first()).consumed_at_ms,null);
  const active=await activateInvitedStaffForShop(a.scope,activate(A,issued.activationToken));
  assert.deepEqual(active,{activated:true,shopId:A.shopId,userId:issued.userId});
  assert.deepEqual(await activateInvitedStaffForShop(a.scope,activate(A,issued.activationToken)),
    {activated:false},'consumed token cannot change password twice');
  const signed=await loginStaffForShop(a.scope,{
    selectedShopId:A.shopId,mobile:phone,password:'Counter-Strong-2026'
  });
  assert.equal(signed.authenticated,true);
  assert.equal(signed.user.role,'Cashier');
  assert.equal((await loginStaffForShop(b.scope,{
    selectedShopId:B.shopId,mobile:phone,password:'Counter-Strong-2026'
  })).authenticated,false);
  assert.equal((await worker.fetch('http://staff.local/api/staff/activate',{
    method:'POST',body:'{}'
  })).status,404,'local contract must not expose a public activation endpoint');
});

test('wrong actor, role escalation, stale issuer, expired invitation, and concurrent redemption fail closed',async t=>{
  const {a,b}=await fixture(t);
  assert.deepEqual(await issueStaffInviteForShop(a.scope,request(a.scope,b.adminToken)),
    {issued:false},'token from another physical Shop never authorizes create');
  assert.deepEqual(await issueStaffInviteForShop(a.scope,
    request(a.scope,a.adminToken,'Administrator')),{issued:false},
    'staff activation must not create privileged Administrator accounts');
  const invalidRole=await issueStaffInviteForShop(a.scope,
    request(a.scope,a.adminToken,'NonexistentRole'));
  assert.deepEqual(invalidRole,{issued:false});
  let count=await a.scope.shopDb.prepare('SELECT count(*) AS n FROM auth_users').first();
  assert.equal(count.n,1,'rejected invites cannot leave partial user rows');
  const issued=await issueStaffInviteForShop(a.scope,request(a.scope,a.adminToken));
  assert.equal(issued.issued,true);
  await a.scope.shopDb.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='OWNER-A'").run();
  assert.deepEqual(await activateInvitedStaffForShop(a.scope,activate(A,issued.activationToken)),
    {activated:false},'revoked issuer makes unconsumed activation invalid');
  assert.equal((await a.scope.shopDb.prepare('SELECT consumed_at_ms FROM auth_staff_activation_tickets WHERE user_id=?')
    .bind(issued.userId).first()).consumed_at_ms,null);
  const second=await issueStaffInviteForShop(b.scope,request(b.scope,b.adminToken));
  assert.equal(second.issued,true);
  await b.scope.shopDb.prepare('UPDATE auth_staff_activation_tickets SET expires_at_ms=issued_at_ms+1 WHERE user_id=?')
    .bind(second.userId).run();
  assert.deepEqual(await activateInvitedStaffForShop(b.scope,activate(B,second.activationToken)),
    {activated:false},'expiration must be enforced in D1 at consumption');
  count=await b.scope.shopDb.prepare('SELECT count(*) AS n FROM auth_users WHERE status="Active"').first();
  assert.equal(count.n,1,'expired invitation must leave pending user inactive');
});

test('simultaneous redemption activates one staff account exactly once',async t=>{
  const {a}=await fixture(t);
  const issued=await issueStaffInviteForShop(a.scope,request(a.scope,a.adminToken));
  assert.equal(issued.issued,true);
  const results=await Promise.all([
    activateInvitedStaffForShop(a.scope,activate(A,issued.activationToken)),
    activateInvitedStaffForShop(a.scope,activate(A,issued.activationToken))
  ]);
  assert.equal(results.filter(x=>x.activated===true).length,1);
  assert.equal(results.filter(x=>x.activated===false).length,1);
  const row=await a.scope.shopDb.prepare(
    'SELECT credential_version,status FROM auth_users WHERE user_id=?'
  ).bind(issued.userId).first();
  assert.equal(row.status,'Active');
  assert.equal(row.credential_version,2,'credential must increment exactly once');
});
