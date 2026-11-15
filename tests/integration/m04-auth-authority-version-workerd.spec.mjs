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
