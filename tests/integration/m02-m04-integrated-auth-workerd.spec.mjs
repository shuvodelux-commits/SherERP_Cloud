import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-m04-integrated-auth-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-m04-integrated-auth-local-test');
const ORIGIN='http://m02-m04.local';
const PASSWORD='SyntheticIntegrationOnly!2026';
const ADMIN_PHONE='01790000101';
const CASHIER_PHONE='01790000102';
let DB;

async function rpc(fnName,args=[],extra={}){
  const response=await worker.fetch(ORIGIN+'/__integration__/rpc',{
    method:'POST',headers:{'Content-Type':'application/json',...extra},
    body:JSON.stringify({fnName,args}),
  });
  return {status:response.status,body:await response.json()};
}

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules)
    VALUES ('Cashier','Active',?,'products')`)
    .bind(JSON.stringify({products:{view:true,add:false}})).run();
  for(const [user,phone,role] of [
    ['USR-INTEGRATED-ADMIN',ADMIN_PHONE,'Administrator'],
    ['USR-INTEGRATED-CASH',CASHIER_PHONE,'Cashier'],
  ]){
    const cred=await createOfflinePasswordCredential(PASSWORD);
    await DB.prepare(`INSERT INTO auth_users
      (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
      VALUES (?,?,?,?,'Active',?,?,?)`)
      .bind(user,'Synthetic '+user,phone,role,cred.passwordHash,cred.passwordSalt,cred.iterations).run();
  }
});
after(async()=>harness.close());

test('real core migrations 0001–0011 coexist with 5 guarded auth tables and no financial schemas',async()=>{
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first();
  assert.equal(count.n,11);
  const rows=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN
    ('settings','product_categories','product_units','parties','party_roles','party_legacy_links',
     'party_identity_review','auth_roles','auth_users','auth_legacy_credentials','auth_sessions',
     'auth_login_throttle') ORDER BY name`).all();
  assert.equal(rows.results.length,12);
  assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM sqlite_master
    WHERE type='table' AND name IN ('party_accounts','journal_lines','cash_book','sales','purchases')`).first()).n,0);
  const protections=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'
    AND name IN ('trg_auth_last_admin_update','trg_auth_last_admin_delete',
      'trg_auth_session_identity_seal','trg_auth_session_no_delete',
      'trg_auth_session_no_replace','trg_auth_user_version','trg_auth_role_version')`).all();
  assert.equal(protections.results.length,7);
});

test('original ROLES Role ID remains unique and immutable through direct D1 writes and REPLACE',async()=>{
  await DB.prepare(`INSERT INTO auth_roles (role_name,source_role_id,status)
    VALUES ('ImportedSourceRole','ROL-00051','Active')`).run();
  const original=await DB.prepare(`SELECT role_name,source_role_id FROM auth_roles
    WHERE source_role_id='ROL-00051'`).first();
  assert.deepEqual(original,{role_name:'ImportedSourceRole',source_role_id:'ROL-00051'});
  await assert.rejects(()=>DB.prepare(`INSERT OR REPLACE INTO auth_roles
    (role_name,source_role_id,status) VALUES('ReplacementRole','ROL-00051','Active')`).run(),
    /source role id replacement forbidden/i);
  await assert.rejects(()=>DB.prepare(`UPDATE auth_roles SET source_role_id='ROL-OTHER'
    WHERE role_name='ImportedSourceRole'`).run(),/source role id immutable/i);
  await assert.rejects(()=>DB.prepare(`UPDATE auth_roles SET source_role_id=NULL
    WHERE role_name='ImportedSourceRole'`).run(),/source role id immutable/i);
  await assert.rejects(()=>DB.prepare(`INSERT INTO auth_roles (role_name,source_role_id,status)
    VALUES ('BlankSourceRole','','Active')`).run(),/constraint|check/i);
  assert.deepEqual(await DB.prepare(`SELECT role_name,source_role_id FROM auth_roles
    WHERE source_role_id='ROL-00051'`).first(),original);
  assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_roles
    WHERE role_name='ReplacementRole'`).first()).n,0);
});

test('trusted internal HTTP bridge logs in against real migrated D1 then revokes a hashed session',async()=>{
  const login=await rpc('login',[ADMIN_PHONE,PASSWORD]);
  assert.equal(login.status,200);
  assert.equal(login.body.success,true);
  assert.match(login.body.data.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(login.body.data.user,{
    id:'USR-INTEGRATED-ADMIN',name:'Synthetic USR-INTEGRATED-ADMIN',
    mobile:ADMIN_PHONE,role:'Administrator',
  });
  assert.equal(login.body.data.allowedModules,null);
  const token=login.body.data.token;
  const hash=createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
  assert.equal((await DB.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=?').bind(hash).first()).token_hash,hash);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=?').bind(token).first()).n,0);
  assert.deepEqual(await rpc('validateSession',[token]),login);
  assert.deepEqual(await rpc('logout',[token]),{status:200,body:{success:true,data:'logged out'}});
  assert.deepEqual(await rpc('validateSession',[token]),{
    status:200,body:{success:false,message:'Session expired. Please sign in again.'},
  });
  await assert.rejects(()=>DB.prepare('UPDATE auth_sessions SET revoked_at_ms=NULL WHERE token_hash=?').bind(hash).run(),/immutable/i);
});

test('cashier role display metadata is not business RPC authorization; public registry remains empty',async()=>{
  const login=await rpc('login',[CASHIER_PHONE,PASSWORD]);
  assert.equal(login.body.success,true);
  assert.deepEqual(login.body.data.allowedModules,['products']);
  assert.deepEqual(login.body.data.permissions,{products:{view:true,add:false}});
  for(const method of ['getUsersBootstrap','completeSale','products.add','createFirstAdmin_']){
    const result=await rpc(method,[login.body.data.token]);
    assert.equal(result.status,method==='products.add'?400:501,method);
  }
  const index=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(index,/authAdapter|createD1LegacyAuthRpc/);
  assert.match(registry,/Object\.create\(null\)/);
  assert.equal((await worker.fetch(ORIGIN+'/api/rpc',{method:'POST'})).status,404);
});

test('SQL last-administrator and staff/Party role separation remain enforced',async()=>{
  await assert.rejects(()=>DB.prepare(`UPDATE auth_users SET status='Inactive'
    WHERE user_id='USR-INTEGRATED-ADMIN'`).run(),/last active administrator/i);
  await DB.prepare(`INSERT INTO parties(party_id,display_name,created_at)
    VALUES('PT-M04-SELF','Synthetic Party','2026-11-16T00:00:00Z')`).run();
  await DB.prepare(`INSERT INTO party_roles(party_id,role,created_at)
    VALUES ('PT-M04-SELF','Customer','2026-11-16T00:00:00Z')`).run();
  assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM auth_users WHERE role_name='Customer'`).first()).n,0);
  const cash=await rpc('login',[CASHIER_PHONE,PASSWORD]);
  assert.equal(cash.body.success,true);
  await DB.prepare(`UPDATE auth_users SET status='Inactive'
    WHERE user_id='USR-INTEGRATED-CASH'`).run();
  assert.deepEqual(await rpc('validateSession',[cash.body.data.token]),{
    status:200,body:{success:false,message:'Session expired. Please sign in again.'},
  });
});

test('malformed and cross-origin HTTP auth inputs fail closed on local Workerd',async()=>{
  assert.deepEqual(await rpc('login',[ADMIN_PHONE,'wrong']),{
    status:200,body:{success:false,message:'Invalid mobile number or password.'},
  });
  const foreign=await rpc('login',[ADMIN_PHONE,PASSWORD],{Origin:'https://evil.invalid'});
  assert.equal(foreign.status,403);
  assert.equal((await rpc('login',[ADMIN_PHONE])).status,400);
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m02-m04-integrated-auth-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000021');
});
