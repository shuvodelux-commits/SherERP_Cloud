import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';

const mod=await import('../../src/modules/m09-authorized-dashboard-currency-read.js')
  .catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(e));
const config=JSON.parse(readFileSync(new URL('../../wrangler.m03-m04-settings-view-test.jsonc',import.meta.url),'utf8'));
const m02=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const server=createTestHarness({workers:[{configPath:'./wrangler.m03-m04-settings-view-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-m04-settings-view-local-test');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const NOW=1_800_000_000_000;
const hash=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const req=(change={})=>({token:A,nowMs:NOW,...change});
let DB;
function reader(){
  assert.equal(typeof mod?.createM09AuthorizedDashboardCurrencyReader,'function',
    'M09 authorized Dashboard currency reader not implemented');
  return mod.createM09AuthorizedDashboardCurrencyReader({DB});
}
before(async()=>{
  assert.equal(config.workers_dev,false);
  assert.equal(config.main,'tests/fixtures/m03-m04-settings-worker.mjs');
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000014');
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const first=m02.indexOf('CREATE TABLE settings (');
  const last=m02.indexOf('CREATE TABLE product_categories (');
  assert.ok(first>=0&&last>first);
  await DB.prepare(m02.slice(first,last).trim().replace(/;\s*$/,'')).run();
  for(const [key,value,row] of [
    ['Shop Name','HARDWARE PRIVATE',2],
    ['Currency Symbol','৳',3],
    ['Delete Confirmation Key','PRIVATE',4]
  ])await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .bind(key,value,row).run();
  for(const [role,permissions] of [
    ['DashboardOnly','{"dashboard":{"view":true},"settings":{"view":false}}'],
    ['SettingsOnly','{"dashboard":{"view":false},"settings":{"view":true}}']
  ])await DB.prepare(
    "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')"
  ).bind(role,permissions).run();
  for(const [user,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['DASH','01710000002','DashboardOnly'],
    ['SETTING','01710000003','SettingsOnly']
  ])await DB.prepare(
    "INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)"
  ).bind(user,user,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  for(const [token,user,epoch] of [[A,'ADMIN',null],[B,'DASH',1],[C,'SETTING',1]])
    await DB.prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)'
    ).bind(hash(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000).run();
});
after(async()=>{await server.close();});

test('real isolated Workerd/D1 returns source currency for Administrator and dashboard.view only',async()=>{
  const read=reader();
  assert.equal(await read.getCurrencySymbol(req()),'৳');
  assert.equal(await read.getCurrencySymbol(req({token:B})),'৳');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,3);
});
test('Settings-only, forged, expired, revoked and stale role reject in local D1',async()=>{
  const read=reader();
  for(const input of [
    req({token:C}),req({token:'f'.repeat(64)}),
    req({token:B,nowMs:NOW+31*60_000}),
    req({token:B,nowMs:NOW+1_200_000})
  ])await assert.rejects(()=>read.getCurrencySymbol(input),/Denied/i);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"dashboard":{"view":false}}','DashboardOnly').run();
  await assert.rejects(()=>read.getCurrencySymbol(req({token:B})),/Denied/i);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"dashboard":{"view":true}}','DashboardOnly').run();
  await assert.rejects(()=>read.getCurrencySymbol(req({token:B})),/Denied/i);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,3);
});
test('missing currency defaults empty and cannot expose private Settings fields',async()=>{
  await DB.prepare("DELETE FROM settings WHERE key='Currency Symbol'").run();
  assert.equal(await reader().getCurrencySymbol(req()),'');
  assert.equal((await DB.prepare("SELECT value FROM settings WHERE key='Delete Confirmation Key'").first()).value,
    'PRIVATE');
});
test('the test worker and live registry expose no Dashboard currency route',async()=>{
  for(const p of ['/api/rpc','/__m09__/dashboard-currency','/dashboard-currency']){
    const r=await worker.fetch('http://dashboard.local'+p,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:A,table:'settings'})});
    assert.equal(r.status,404);
  }
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(live,/m09-authorized-dashboard-currency-read/);
});
