import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';

const TIME=1_800_400_000_000;
const PASSWORD='Synthetic!TestOnly#2026';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
const worker=harness.getWorker('shererp-m04-auth-http-local-only');
const ORIGIN='http://m04-http.local';
let DB;
const seed=async(id,phone,role)=>{
  const cred=await createOfflinePasswordCredential(PASSWORD);
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
    id,'Test '+id,phone,role,'Active',cred.passwordHash,cred.passwordSalt,cred.iterations
  ).run();
};
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO auth_roles (role_name,status,permissions_json,allowed_modules)
    VALUES ('Cashier','Active',?,?)`).bind(
    JSON.stringify({sales:{view:true,add:false}}),'sales'
  ).run();
  await seed('USR-HTTP-ADMIN','01710000801','Administrator');
  await seed('USR-HTTP-CASH','01710000802','Cashier');
});
after(async()=>{await harness.close();});
async function rpc(fnName,args,extra={},opts={}){
  const response=await worker.fetch(ORIGIN+'/__m04_test__/http-rpc',{
    method:opts.method||'POST',
    headers:{Origin:opts.origin||ORIGIN,'Content-Type':opts.type||'application/json'},
    body:opts.method==='GET'?undefined:JSON.stringify({fnName,args,...extra}),
  });
  return {status:response.status,body:await response.json(),
    cacheControl:response.headers.get('Cache-Control'),
    nosniff:response.headers.get('X-Content-Type-Options')};
}
test('actual local D1 and original HTTP envelope login, validate and logout',async()=>{
  const login=await rpc('login',['+880 1710000801',PASSWORD],{nowMs:-1,actor:'attacker'});
  assert.equal(login.status,200);
  assert.equal(login.body.success,true);
  assert.equal(login.cacheControl,'no-store');
  assert.equal(login.nosniff,'nosniff');
  const data=login.body.data;
  assert.match(data.token,/^[0-9a-f]{64}$/);
  assert.deepEqual(data.user,{
    id:'USR-HTTP-ADMIN',name:'Test USR-HTTP-ADMIN',
    mobile:'01710000801',role:'Administrator'
  });
  assert.equal(data.allowedModules,null);
  assert.equal(data.permissions,null);
  const digest=createHash('sha256').update(Buffer.from(data.token,'hex')).digest('hex');
  const stored=await DB.prepare(
    'SELECT token_hash,created_at_ms FROM auth_sessions WHERE token_hash=?'
  ).bind(digest).first();
  assert.equal(stored.token_hash,digest);
  assert.equal(stored.created_at_ms,TIME,'untrusted body nowMs does not override trusted server clock');
  assert.equal((await DB.prepare(
    'SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash=?'
  ).bind(data.token).first()).n,0);
  const restored=await rpc('validateSession',[data.token]);
  assert.equal(restored.status,200);
  assert.deepEqual(restored.body,login.body);
  const logout=await rpc('logout',[data.token]);
  assert.deepEqual(logout.body,{success:true,data:'logged out'});
  const invalid=await rpc('validateSession',[data.token]);
  assert.deepEqual(invalid.body,{
    success:false,message:'Session expired. Please sign in again.'
  });
});
test('Cashier source role metadata is display-only and never an RPC permission grant',async()=>{
  const login=await rpc('login',['01710000802',PASSWORD]);
  assert.equal(login.body.success,true);
  assert.deepEqual(login.body.data.allowedModules,['sales']);
  assert.deepEqual(login.body.data.permissions,{sales:{view:true,add:false}});
  for(const method of ['createFirstAdmin_','updateUser','getUsersBootstrap','completeSale','getAppShellData']){
    const denied=await rpc(method,[]);
    assert.equal(denied.status,501,method);
    assert.equal(denied.body.success,false);
  }
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-HTTP-CASH'").run();
  const revoked=await rpc('validateSession',[login.body.data.token]);
  assert.deepEqual(revoked.body,{
    success:false,message:'Session expired. Please sign in again.'
  });
});
test('real local D1 rejects incorrect password without identity disclosure',async()=>{
  const bad=await rpc('login',['01710000801','totally-wrong']);
  assert.equal(bad.status,200);
  assert.deepEqual(bad.body,{
    success:false,message:'Invalid mobile number or password.'
  });
  assert.equal(JSON.stringify(bad).includes('totally-wrong'),false);
});
test('same-origin/arity/type gates apply before D1 auth helper is called',async()=>{
  assert.equal((await rpc('login',['01710000801',PASSWORD],{},{
    origin:'https://evil.test'
  })).status,403);
  assert.equal((await rpc('login',['01710000801',PASSWORD],{},{
    type:'text/plain'
  })).status,415);
  assert.equal((await rpc('login',['01710000801',PASSWORD],{},{
    method:'GET'
  })).status,405);
  assert.equal((await rpc('login',['01710000801'])).status,400);
  assert.equal((await rpc('validateSession',[123])).status,400);
});
test('test Worker is local-only and has no public RPC or migration',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-auth-http-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m04-auth-http-worker.mjs');
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000019']);
  for(const path of ['/api/rpc','/api/health','/','/__m04_test__/login']){
    assert.equal((await worker.fetch(ORIGIN+path)).status,404);
  }
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(production.includes('authAdapter'),false);
  assert.equal(registry.includes('createD1LegacyAuthRpc'),false);
  assert.equal(preview.d1_databases,undefined);
});
