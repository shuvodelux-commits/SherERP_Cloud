import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {AUTH_POLICY,createOfflinePasswordCredential,loginWithD1}
  from '../../src/auth/d1-auth-core.js';
import {createM04AuthorizedShellSettingsReadAdapter}
  from '../../src/db/m04-settings-view.js';

import {createM04AuthorizedAppShellReader}
  from '../../src/modules/m04-authorized-app-shell-reader.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-settings-view-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-m04-settings-view-local-test');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
let DB;
const req=(patch={})=>({token:A,nowMs:NOW,...patch});
const adapter=()=>createM04AuthorizedShellSettingsReadAdapter({DB});
const settings=async()=>(await DB.prepare('SELECT key,value,legacy_sheet_row FROM settings ORDER BY row_id').all())
  .results.map(x=>({...x}));

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const m02=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const start=m02.indexOf('CREATE TABLE settings (');
  const end=m02.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0&&end>start,'must use unchanged reviewed M02 Settings DDL');
  await DB.prepare(m02.slice(start,end).trim().replace(/;\s*$/,'')).run();
  for(const [key,value,row] of [
    ['Shop Name','নবাবী হার্ডওয়্যার',2],
    ['Currency Symbol','৳',3],
    ['Phone 1','01712345678',4],
    ['Delete Confirmation Key','PRIVATE',5],
    ['Invoice Logo','SECRET_LOGO',6]
  ])await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .bind(key,value,row).run();
  for(const [role,perms] of [
    ['Viewer','{"settings":{"view":true,"edit":false}}'],
    ['Editor','{"settings":{"view":false,"edit":true}}']
  ])await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES(?,'Active',?,'')`).bind(role,perms).run();
  for(const [user,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['VIEWER','01710000002','Viewer'],
    ['EDITOR','01710000003','Editor']
  ])await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES(?,?,?,?,'Active',?,?,210000)`)
    .bind(user,user,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  for(const [token,user,roleVersion] of [
    [A,'ADMIN',null],[B,'VIEWER',1],[C,'EDITOR',1]
  ])await DB.prepare(`INSERT INTO auth_sessions
    (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
     created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
    VALUES(?,?,1,?,1,?,?,?,NULL)`)
    .bind(digest(token),user,roleVersion,NOW-300_000,NOW-60_000,NOW+1_200_000).run();
});
after(async()=>{await server.close();});

test('actual local D1 grants Administrator and view-only staff the same two-key shell',async()=>{
  const output={shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'};
  assert.deepEqual(await adapter().getAppShellSettings_(req()),output);
  assert.deepEqual(await adapter().getAppShellSettings_(req({token:B})),output);
  assert.equal((await settings()).length,5);
  assert.equal(JSON.stringify(output).includes('PRIVATE'),false);
});

test('actual Workerd D1 returns complete frozen shell only to current settings.view sessions',async()=>{
  const shell=createM04AuthorizedAppShellReader({DB});
  const expected={success:true,data:{
    shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
  }};
  const admin=await shell.getAppShellData(req());
  const viewer=await shell.getAppShellData(req({token:B}));
  for(const envelope of [admin,viewer]){
    assert.equal(envelope.success,expected.success);
    assert.equal(envelope.data.shopName,expected.data.shopName);
    assert.equal(envelope.data.currencySymbol,expected.data.currencySymbol);
    assert.ok(envelope.data.navItems.some(item=>item.key==='pos' &&
      item.landingKey==='posv2'));
    assert.equal(JSON.stringify(envelope).includes('PRIVATE'),false);
    assert.equal(JSON.stringify(envelope).includes('SECRET_LOGO'),false);
  }
  viewer.data.navItems[0].label='TAMPER';
  const refreshed=await shell.getAppShellData(req({token:B}));
  assert.notEqual(refreshed.data.navItems[0].label,'TAMPER');
  for(const token of [C,'f'.repeat(64)]){
    await assert.rejects(()=>shell.getAppShellData(req({token})),/Denied/i);
  }
});

test('edit-only user, bad session, idle expired and absolute expired are denied by real D1',async()=>{
  for(const patch of [
    {token:C},
    {token:'f'.repeat(64)},
    {token:B,nowMs:NOW+AUTH_POLICY.sessionIdleMs-60_000},
    {token:B,nowMs:NOW+1_200_000}
  ])await assert.rejects(()=>adapter().getAppShellSettings_(req(patch)),/Denied/i);
});

test('actual D1 source fallbacks handle no Settings rows or whitespace without exposing other keys',async()=>{
  const before=await settings();
  await DB.prepare("DELETE FROM settings WHERE key IN ('Shop Name','Currency Symbol')").run();
  assert.deepEqual(await adapter().getAppShellSettings_(req({token:B})),{
    shopName:'Hardware Store ERP',currencySymbol:''
  });
  await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .bind('Shop Name','   ',2).run();
  assert.deepEqual(await adapter().getAppShellSettings_(req()),{
    shopName:'   ',currencySymbol:''
  });
  await DB.prepare("DELETE FROM settings WHERE key='Shop Name'").run();
  for(const row of before.filter(x=>x.key==='Shop Name'||x.key==='Currency Symbol')){
    await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
      .bind(row.key,row.value,row.legacy_sheet_row).run();
  }
  assert.equal((await settings()).filter(x=>x.key==='Delete Confirmation Key')[0].value,'PRIVATE');
});

test('real M04 PBKDF2 login-issued view-only session can read and revocation immediately denies',async()=>{
  const credential=await createOfflinePasswordCredential('ViewerAccessPassword123!');
  await DB.prepare(`UPDATE auth_users SET password_hash=?,password_salt=?,password_iterations=?
    WHERE user_id='VIEWER'`).bind(
      credential.passwordHash,credential.passwordSalt,credential.iterations
    ).run();
  const auth=await loginWithD1(DB,{
    phoneKey:'01710000002',password:'ViewerAccessPassword123!',nowMs:NOW+1000
  });
  assert.equal(auth.authenticated,true);
  assert.match(auth.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(await adapter().getAppShellSettings_({
    token:auth.token,nowMs:NOW+1000
  }),{shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'});
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+1100,digest(auth.token)).run();
  await assert.rejects(()=>adapter().getAppShellSettings_({
    token:auth.token,nowMs:NOW+1200
  }),/Denied/i);
});

test('role grant change and restore deny previous session but fresh M04 session regains view',async()=>{
  await DB.prepare(`UPDATE auth_roles SET permissions_json='{"settings":{"view":false}}'
    WHERE role_name='Viewer'`).run();
  await DB.prepare(`UPDATE auth_roles SET permissions_json='{"settings":{"view":true}}'
    WHERE role_name='Viewer'`).run();
  await assert.rejects(()=>adapter().getAppShellSettings_(req({token:B})),/Denied/i);
  const issued=await loginWithD1(DB,{
    phoneKey:'01710000002',password:'ViewerAccessPassword123!',nowMs:NOW+2000
  });
  assert.equal(issued.authenticated,true);
  assert.deepEqual(await adapter().getAppShellSettings_({
    token:issued.token,nowMs:NOW+2000
  }),{shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'});
  await DB.prepare(`UPDATE auth_roles SET status='Inactive' WHERE role_name='Viewer'`).run();
  await assert.rejects(()=>adapter().getAppShellSettings_({
    token:issued.token,nowMs:NOW+3000
  }),/Denied/i);
});

test('standalone test Worker never exposes credential, Settings or arbitrary RPC routes',async()=>{
  for(const path of ['/api/rpc','/settings/get','/__m03_m04_settings__/view']){
    const resp=await worker.fetch('http://settings-view.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        token:A,actor:'ADMIN',key:'Delete Confirmation Key',sql:'SELECT * FROM settings'
      })
    });
    assert.equal(resp.status,404);
  }
  const conf=JSON.parse(readFileSync(new URL('../../wrangler.m03-m04-settings-view-test.jsonc',import.meta.url),'utf8'));
  assert.equal(conf.workers_dev,false);
  assert.equal(conf.routes,undefined);
  assert.equal(conf.main,'tests/fixtures/m03-m04-settings-worker.mjs');
  assert.equal(conf.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000014');
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(production.includes('m04-settings-view'),false);
});

test('actual local Workerd D1 returns complete Settings map only for current settings.view',async()=>{
  const expected=Object.assign(Object.create(null),{
    'Shop Name':'নবাবী হার্ডওয়্যার','Currency Symbol':'৳',
    'Phone 1':'01712345678','Delete Confirmation Key':'PRIVATE',
    'Invoice Logo':'SECRET_LOGO'
  });
  assert.deepEqual(await adapter().getSettingsMap_(req()),expected);
  for(const patch of [{token:C},{token:B},{token:'f'.repeat(64)},
    {token:A,nowMs:NOW+1_200_000}]){
    await assert.rejects(()=>adapter().getSettingsMap_(req(patch)),/Denied/i);
  }
  assert.deepEqual(await adapter().getAppShellSettings_(req()),{
    shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
  });
  assert.equal((await settings()).length,5,'read must never mutate Settings');
});

test('actual local D1 enforces 256-entry authorized Settings map limit and recovers after cleanup',async()=>{
  const insert=DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
  const records=[];
  for(let i=0;i<251;i++)records.push(insert.bind('Local extra '+i,String(i)));
  await DB.batch(records); // existing 5 rows + 251 extras = 256
  const full=await adapter().getSettingsMap_(req());
  assert.equal(Object.keys(full).length,256);
  assert.equal(full['Local extra 250'],'250');
  await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
    .bind('Local extra overflow','overflow').run();
  await assert.rejects(()=>adapter().getSettingsMap_(req()),/NEEDS_REVIEW|limit|exceed/i);
  await DB.prepare("DELETE FROM settings WHERE key LIKE 'Local extra %'").run();
  assert.equal((await settings()).length,5);
  assert.equal((await adapter().getSettingsMap_(req()))['Phone 1'],'01712345678');
});

test('real Workerd refuses unsafe Settings map keys, leaves D1 unchanged, and never exposes a public map RPC',async()=>{
  await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
    .bind('__proto__','DANGEROUS').run();
  await assert.rejects(()=>adapter().getSettingsMap_(req()),/NEEDS_REVIEW/i);
  await DB.prepare("DELETE FROM settings WHERE key='__proto__'").run();
  assert.equal(Object.prototype.DANGEROUS,undefined);
  for(const path of ['/api/rpc','/settings/bootstrap','/__m03_test__/settings-map']){
    const response=await worker.fetch('http://settings-view.local'+path,{
      method:'POST',body:JSON.stringify({token:A,permission:'settings.view'})
    });
    assert.equal(response.status,404);
  }
  assert.deepEqual(await adapter().getAppShellSettings_(req()),{
    shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
  });
});
