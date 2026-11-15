import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';

// This fixture is never a production/staging Cloudflare binding.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-workerd-local-only');
const ID='USR-ONLY-ADMIN',PHONE='01730000001';
const SECRET='SyntheticStaffOnly!2026';
let DB,credential;

const insert=(id,phone,role='Administrator',status='Active')=>
  DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind(id,'Synthetic '+id,phone,role,status,
      credential.passwordHash,credential.passwordSalt,credential.iterations).run();

const soleAdmin=()=>DB.prepare(`SELECT user_id,role_name,status FROM auth_users
  WHERE phone_key=?`).bind(PHONE).first();
const adminCount=()=>DB.prepare(`SELECT COUNT(*) AS n FROM auth_users
  WHERE role_name='Administrator' AND status='Active'`).first().then(x=>x.n);

// Reset synthetic test state even if an unsafe REPLACE unexpectedly succeeds
// in the RED phase. No sessions refer to this one-off staff identity.
async function restoreSoleAdmin(){
  const row=await soleAdmin();
  if(row?.user_id===ID && row.role_name==='Administrator' && row.status==='Active') return;
  if(row) await DB.prepare('DELETE FROM auth_users WHERE user_id=?').bind(row.user_id).run();
  await insert(ID,PHONE);
}

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  credential=await createOfflinePasswordCredential(SECRET);
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json) VALUES ('Cashier','Active','{}')`).run();
  await insert(ID,PHONE);
});
after(async()=>{await harness.close();});

test('local D1 rejects INSERT OR REPLACE by staff ID that would remove the final active Administrator',async()=>{
  assert.equal(await adminCount(),1);
  const statement=DB.prepare(`INSERT OR REPLACE INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind(ID,'Synthetic replacement',PHONE,
      'Cashier','Active',credential.passwordHash,credential.passwordSalt,credential.iterations);
  try {
    await assert.rejects(()=>statement.run(),/constraint|replace|administrator|identity/i);
  } finally {
    await restoreSoleAdmin();
  }
  assert.deepEqual(await soleAdmin(),{user_id:ID,role_name:'Administrator',status:'Active'});
  assert.equal(await adminCount(),1);
});

test('local D1 rejects INSERT OR REPLACE by the same phone with a different staff ID',async()=>{
  assert.equal(await adminCount(),1);
  const statement=DB.prepare(`INSERT OR REPLACE INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind('USR-TAKEOVER','Synthetic replacement',PHONE,
      'Cashier','Active',credential.passwordHash,credential.passwordSalt,credential.iterations);
  try {
    await assert.rejects(()=>statement.run(),/constraint|replace|administrator|identity/i);
  } finally {
    await restoreSoleAdmin();
  }
  assert.deepEqual(await soleAdmin(),{user_id:ID,role_name:'Administrator',status:'Active'});
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE user_id='USR-TAKEOVER'")
    .first().then(x=>x.n),0);
});

test('unique staff creation remains allowed, while two simultaneous admin deactivations cannot remove both',async()=>{
  await insert('USR-OTHER','01730000002','Administrator');
  assert.equal(await adminCount(),2);
  const outcomes=await Promise.allSettled([
    DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id=?").bind(ID).run(),
    DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id=?").bind('USR-OTHER').run(),
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  assert.equal(await adminCount(),1);
  const survivors=await DB.prepare(`SELECT user_id FROM auth_users WHERE
    role_name='Administrator' AND status='Active'`).all();
  assert.equal(survivors.results.length,1);
});
