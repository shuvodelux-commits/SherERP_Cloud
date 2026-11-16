import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../../src/auth/d1-auth-core.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m04-login-shell-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m04-login-shell-local-only');
const ORIGIN='http://m04-shell.local';
const PASSWORD='Synthetic!LoginShell2026';
let DB;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const core=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const start=core.indexOf('CREATE TABLE settings (');
  const end=core.indexOf('CREATE TABLE product_categories (');
  assert(start>=0 && end>start);
  await DB.prepare(core.slice(start,end).trim().replace(/;\s*$/,'')).run();
  for(const [key,value] of [
    ['Shop Name','শেরERP দোকান'],['Currency Symbol','৳'],
    ['Delete Confirmation Key','PRIVATE-DO-NOT-EXPOSE'],
    ['Phone 1','01710000801']
  ])await DB.prepare('INSERT INTO settings(key,value) VALUES (?,?)').bind(key,value).run();
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES('Cashier','Active',?,?)")
    .bind(JSON.stringify({sales:{view:true,add:false}}),'sales').run();
  for(const [id,phone,role] of [
    ['USR-ADMIN','01710000801','Administrator'],
    ['USR-CASHIER','01710000802','Cashier']
  ]){
    const credential=await createOfflinePasswordCredential(PASSWORD);
    await DB.prepare('INSERT INTO auth_users '+
      '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
      'VALUES (?,?,?,?,?,?,?,?)').bind(id,'Local '+id,phone,role,'Active',
      credential.passwordHash,credential.passwordSalt,credential.iterations).run();
  }
});
after(async()=>harness.close());

async function call(method,args=[],extras={}){
  const res=await worker.fetch(ORIGIN+'/__m04_test__/login-shell-rpc',{
    method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:method,args,...extras})
  });
  return {status:res.status,body:await res.json(),
    cache:res.headers.get('Cache-Control')};
}
test('real local D1 Administrator logs in, loads source NAV, restores, logs out and shell denies revoked token',async()=>{
  const login=await call('login',['+8801710000801',PASSWORD]);
  assert.equal(login.status,200);
  assert.equal(login.body.success,true);
  const token=login.body.data.token;
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal(login.body.data.user.role,'Administrator');
  const shell=await call('getAppShellData',[token]);
  assert.equal(shell.status,200);
  assert.equal(shell.body.success,true);
  assert.equal(shell.body.data.shopName,'শেরERP দোকান');
  assert.equal(shell.body.data.currencySymbol,'৳');
  assert(shell.body.data.navItems.some(x=>x.key==='pos'&&x.landingKey==='posv2'));
  assert.equal(JSON.stringify(shell.body).includes('PRIVATE-DO-NOT-EXPOSE'),false);
  assert.equal(shell.cache,'no-store');
  const restore=await call('validateSession',[token]);
  assert.equal(restore.status,200);
  assert.deepEqual(restore.body,login.body);
  const logout=await call('logout',[token]);
  assert.deepEqual(logout.body,{success:true,data:'logged out'});
  const denied=await call('getAppShellData',[token]);
  assert.equal(denied.status,503);
  assert.equal(denied.body.success,false);
});

test('ordinary active Cashier with sales.view but no settings.view can load presentation shell',async()=>{
  const login=await call('login',['01710000802',PASSWORD]);
  assert.equal(login.status,200);
  assert.equal(login.body.success,true);
  assert.deepEqual(login.body.data.allowedModules,['sales']);
  assert.deepEqual(login.body.data.permissions,{sales:{view:true,add:false}});
  const shell=await call('getAppShellData',[login.body.data.token]);
  assert.equal(shell.status,200);
  assert.equal(shell.body.success,true);
  assert.equal(shell.body.data.shopName,'শেরERP দোকান');
  assert.equal(JSON.stringify(shell.body).includes('PRIVATE-DO-NOT-EXPOSE'),false);
  assert.equal((await call('completeSale',[])).status,501);
  assert.equal((await call('getSettingsMap',[])).status,501);
  await DB.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'").run();
  assert.equal((await call('getAppShellData',[login.body.data.token])).status,503);
  assert.equal((await call('validateSession',[login.body.data.token])).body.success,false);
});

test('real local D1 wrong credentials, forged token and client-provided authority never unlock shell',async()=>{
  const bad=await call('login',['01710000801','wrong password']);
  assert.deepEqual(bad.body,{success:false,message:'Invalid mobile number or password.'});
  assert.equal((await call('getAppShellData',[])).status,400);
  assert.equal((await call('getAppShellData',['a'.repeat(64)])).status,503);
  assert.equal((await call('getAppShellData',['0'.repeat(64)],{
    nowMs:1_800_400_000_000,role:'Administrator',actor:'USR-ADMIN',
    sql:'SELECT * FROM auth_users'
  })).status,400);
  assert.equal((await call('getUsersBootstrap',[])).status,501);
});

test('test-only Workerd has no public routes and existing preview still refuses login and shell',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m04-login-shell-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m04-login-shell-worker.mjs');
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000020']);
  for(const path of ['/api/rpc','/api/health','/','/__m04_test__/login']){
    assert.equal((await worker.fetch(ORIGIN+path)).status,404);
  }
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8').includes('authAdapter'),false);
  const req=new Request('https://public.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://public.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'login',args:['01710000801',PASSWORD]})
  });
  const response=await publicWorker.fetch(req,{DB});
  assert.equal(response.status,503);
  assert.equal((await response.json()).success,false);
});
