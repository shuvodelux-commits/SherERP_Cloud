import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential,loginWithD1} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-workerd-local-only');
const BASE=1_800_100_000_000;
const PASS='SyntheticTestOnly!!2026';
let DB;
const deny={status:200,body:{authenticated:false}};
async function seed(id,phone,role='Administrator'){
  const cred=await createOfflinePasswordCredential(PASS);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,?)`)
    .bind(id,'Synthetic '+id,phone,role,cred.passwordHash,cred.passwordSalt,cred.iterations).run();
}
async function rpc(method,body){
  const res=await worker.fetch('http://m04-version.local/__m04_test__/'+method,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  return {status:res.status,body:await res.json()};
}
const login=(phone,now=BASE)=>rpc('login',{phoneKey:phone,password:PASS,nowMs:now});
const validate=(token,now=BASE+1000)=>rpc('validate',{token,nowMs:now});
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare("INSERT INTO auth_roles (role_name,status,permissions_json) VALUES ('Cashier','Active','{}')").run();
  await seed('USR-VERSION-ADMIN-A','01720000001');
  await seed('USR-VERSION-ADMIN-B','01720000002');
  await seed('USR-VERSION-CASHIER','01720000003','Cashier');
});
after(async()=>{await harness.close();});

test('old token remains revoked after inactive Administrator is reactivated',async()=>{
  const a=await login('01720000001');
  const b=await login('01720000002');
  assert.equal(a.body.authenticated,true);
  assert.equal(b.body.authenticated,true);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-VERSION-ADMIN-A'").run();
  assert.deepEqual(await validate(a.body.token),deny);
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='USR-VERSION-ADMIN-A'").run();
  assert.deepEqual(await validate(a.body.token,BASE+2000),deny);
  assert.equal((await validate(b.body.token,BASE+2000)).body.authenticated,true);
  assert.equal((await login('01720000001',BASE+3000)).body.authenticated,true);
});

test('changing and restoring a credential digest does not resurrect an earlier token',async()=>{
  const a=await login('01720000002',BASE+10_000);
  assert.equal(a.body.authenticated,true);
  const stored=await DB.prepare("SELECT password_hash FROM auth_users WHERE user_id='USR-VERSION-ADMIN-B'").first();
  await DB.prepare("UPDATE auth_users SET password_hash=? WHERE user_id='USR-VERSION-ADMIN-B'").bind('ab'.repeat(32)).run();
  await DB.prepare("UPDATE auth_users SET password_hash=? WHERE user_id='USR-VERSION-ADMIN-B'").bind(stored.password_hash).run();
  assert.deepEqual(await validate(a.body.token,BASE+11_000),deny);
  assert.equal((await login('01720000002',BASE+12_000)).body.authenticated,true);
});

test('role permission changes invalidate old session but never unrelated Administrator',async()=>{
  const cash=await login('01720000003',BASE+20_000);
  const admin=await login('01720000002',BASE+20_000);
  assert.equal(cash.body.authenticated,true);
  assert.equal(admin.body.authenticated,true);
  await DB.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Cashier'")
    .bind('{"sales":{"edit":false}}').run();
  assert.deepEqual(await validate(cash.body.token,BASE+21_000),deny);
  assert.equal((await validate(admin.body.token,BASE+21_000)).body.authenticated,true);
  assert.equal((await login('01720000003',BASE+22_000)).body.authenticated,true);
});

test('temporary role suspension and restoration never revive a prior session',async()=>{
  const cash=await login('01720000003',BASE+30_000);
  assert.equal(cash.body.authenticated,true);
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'").run();
  assert.deepEqual(await validate(cash.body.token,BASE+31_000),deny);
  await DB.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='Cashier'").run();
  assert.deepEqual(await validate(cash.body.token,BASE+32_000),deny);
  assert.equal((await login('01720000003',BASE+33_000)).body.authenticated,true);
});

test('role permission update after password verification but before SQL insert denies session issuance',async()=>{
  const db={prepare(sql){
    const statement=DB.prepare(sql);
    if(!/INSERT INTO auth_sessions/.test(sql)) return statement;
    return {bind(...params){
      const bound=statement.bind(...params);
      return {async run(){
        await DB.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Cashier'")
          .bind('{"sales":{"delete":"disabled"}}').run();
        return bound.run();
      }};
    }};
  }};
  const output=await loginWithD1(db,{phoneKey:'01720000003',password:PASS,nowMs:BASE+40_000});
  assert.deepEqual(output,{authenticated:false});
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id='USR-VERSION-CASHIER' AND created_at_ms=?").bind(BASE+40_000).first()).n,0);
});


test('REPLACE may not reset a role authority epoch while its staff session is active',async()=>{
  const role='M04-Replace',phone='01720000009';
  const old='{"sales":{"view":true}}';
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES (?,'Active',?)")
    .bind(role,old).run();
  await seed('USR-ROLE-REPLACE',phone,role);
  const signed=await login(phone,BASE+50_000);
  assert.equal(signed.body.authenticated,true);
  const before=await DB.prepare("SELECT auth_version,permissions_json FROM auth_roles WHERE role_name=?")
    .bind(role).first();
  try {
    await assert.rejects(
      ()=>DB.prepare("INSERT OR REPLACE INTO auth_roles(role_name,status,permissions_json) VALUES (?,'Active',?)")
        .bind(role,'{"sales":{"view":false}}').run(),
      /role.*replace|constraint|unique/i
    );
  } finally {
    const current=await DB.prepare("SELECT permissions_json FROM auth_roles WHERE role_name=?").bind(role).first();
    if(current?.permissions_json!==old)
      await DB.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name=?").bind(old,role).run();
  }
  assert.deepEqual(await DB.prepare("SELECT auth_version,permissions_json FROM auth_roles WHERE role_name=?")
    .bind(role).first(),before);
  assert.equal((await validate(signed.body.token,BASE+51_000)).body.authenticated,true);
});

test('delete assigned role denied, including when assigned user is inactive; unassigned role can delete',async()=>{
  const role='M04-Assigned',phone='01720000010';
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES (?,'Active','{}')")
    .bind(role).run();
  await seed('USR-ROLE-ASSIGNED',phone,role);
  const signed=await login(phone,BASE+60_000);
  assert.equal(signed.body.authenticated,true);
  try {
    await assert.rejects(()=>DB.prepare("DELETE FROM auth_roles WHERE role_name=?")
      .bind(role).run(),/assigned|role.*delete|constraint/i);
  } finally {
    const exists=await DB.prepare("SELECT role_name FROM auth_roles WHERE role_name=?").bind(role).first();
    if(!exists) await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES (?,'Active','{}')")
      .bind(role).run();
  }
  assert.equal((await validate(signed.body.token,BASE+61_000)).body.authenticated,true);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-ROLE-ASSIGNED'").run();
  await assert.rejects(()=>DB.prepare("DELETE FROM auth_roles WHERE role_name=?")
    .bind(role).run(),/assigned|role.*delete|constraint/i);
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES ('M04-Unused','Active','{}')").run();
  await DB.prepare("DELETE FROM auth_roles WHERE role_name='M04-Unused'").run();
});


test('role auth epoch cannot roll back to revive a session after permission changes',async()=>{
  const role='M04-Role-Epoch-Monotonic',phone='01720000011';
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json) VALUES (?,'Active','{}')")
    .bind(role).run();
  await seed('USR-ROLE-EPOCH-MONOTONIC',phone,role);
  const issued=await login(phone,BASE+70_000);
  assert.equal(issued.body.authenticated,true);
  const previous=(await DB.prepare('SELECT auth_version FROM auth_roles WHERE role_name=?')
    .bind(role).first()).auth_version;
  await DB.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name=?")
    .bind('{"sales":{"view":false}}',role).run();
  const latest=(await DB.prepare('SELECT auth_version FROM auth_roles WHERE role_name=?')
    .bind(role).first()).auth_version;
  assert.ok(latest>previous);
  assert.deepEqual(await validate(issued.body.token,BASE+71_000),deny);
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_roles SET auth_version=? WHERE role_name=?')
      .bind(previous,role).run(),/rollback|monotonic|constraint/i);
  } finally {
    const current=await DB.prepare('SELECT auth_version FROM auth_roles WHERE role_name=?').bind(role).first();
    if(current.auth_version<latest)
      await DB.prepare('UPDATE auth_roles SET auth_version=? WHERE role_name=?').bind(latest,role).run();
  }
  assert.equal((await DB.prepare('SELECT auth_version FROM auth_roles WHERE role_name=?')
    .bind(role).first()).auth_version,latest);
  assert.deepEqual(await validate(issued.body.token,BASE+72_000),deny);
});

test('user auth epoch cannot be rolled back after disabling and restoring an account',async()=>{
  const phone='01720000012',id='USR-AUTH-EPOCH-MONOTONIC';
  await seed(id,phone);
  const issued=await login(phone,BASE+80_000);
  assert.equal(issued.body.authenticated,true);
  const previous=(await DB.prepare('SELECT auth_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).auth_version;
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id=?").bind(id).run();
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id=?").bind(id).run();
  const latest=(await DB.prepare('SELECT auth_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).auth_version;
  assert.ok(latest>previous);
  assert.deepEqual(await validate(issued.body.token,BASE+81_000),deny);
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_users SET auth_version=? WHERE user_id=?')
      .bind(previous,id).run(),/rollback|monotonic|constraint/i);
  } finally {
    const current=await DB.prepare('SELECT auth_version FROM auth_users WHERE user_id=?').bind(id).first();
    if(current.auth_version<latest)
      await DB.prepare('UPDATE auth_users SET auth_version=? WHERE user_id=?').bind(latest,id).run();
  }
  assert.equal((await DB.prepare('SELECT auth_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).auth_version,latest);
  assert.deepEqual(await validate(issued.body.token,BASE+82_000),deny);
});

test('credential version cannot decrease after a credential rotation',async()=>{
  const phone='01720000013',id='USR-CREDENTIAL-EPOCH-MONOTONIC';
  await seed(id,phone);
  const issued=await login(phone,BASE+90_000);
  assert.equal(issued.body.authenticated,true);
  const previous=(await DB.prepare('SELECT credential_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).credential_version;
  await DB.prepare('UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id=?')
    .bind(id).run();
  const latest=(await DB.prepare('SELECT credential_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).credential_version;
  assert.equal(latest,previous+1);
  assert.deepEqual(await validate(issued.body.token,BASE+91_000),deny);
  try {
    await assert.rejects(()=>DB.prepare('UPDATE auth_users SET credential_version=? WHERE user_id=?')
      .bind(previous,id).run(),/rollback|monotonic|constraint/i);
  } finally {
    const current=await DB.prepare('SELECT credential_version FROM auth_users WHERE user_id=?')
      .bind(id).first();
    if(current.credential_version<latest)
      await DB.prepare('UPDATE auth_users SET credential_version=? WHERE user_id=?').bind(latest,id).run();
  }
  assert.equal((await DB.prepare('SELECT credential_version FROM auth_users WHERE user_id=?')
    .bind(id).first()).credential_version,latest);
  assert.deepEqual(await validate(issued.body.token,BASE+92_000),deny);
});
