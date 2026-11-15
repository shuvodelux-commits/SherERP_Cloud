import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {AUTH_POLICY} from '../../src/auth/d1-auth-core.js';
import {createM04AuthorizedReportsBootstrapReader}
  from '../../src/modules/m04-authorized-reports-bootstrap.js';

const server=createTestHarness({workers:[{configPath:'./wrangler.m04-reports-bootstrap-test.jsonc'}]});
const worker=server.getWorker('shererp-m04-reports-bootstrap-local');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64),E='e'.repeat(64),F='f'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
let DB;
const req=(token=A,changes={})=>({token,nowMs:NOW,today:'2026-11-15',...changes});
const reader=()=>createM04AuthorizedReportsBootstrapReader({DB});
const insertSession=async(token,user,version=1)=>DB.prepare(`INSERT INTO auth_sessions
  (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
   created_at_ms,last_activity_at_ms,expires_at_ms)
   VALUES (?,?,1,?,1,?,?,?)`).bind(
     digest(token),user,version,NOW-300000,NOW-60000,NOW+1200000
   ).run();

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const m02=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const first=m02.indexOf('CREATE TABLE settings (');
  const last=m02.indexOf('CREATE TABLE product_categories (');
  assert.ok(first>=0 && last>first,'frozen M02 Settings schema must exist');
  await DB.prepare(m02.slice(first,last).trim().replace(/;\s*$/,'')).run();
  for(const [key,value] of [
    ['Shop Name','নবাবী হার্ডওয়্যার'],['Currency Symbol','৳'],
    ['JWT_SECRET','DO-NOT-RETURN-SECRET'],['Phone 1','PRIVATE-PHONE']
  ])await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind(key,value).run();
  for(const [role,permissions,modules] of [
    ['Reporter','{"reports":{"view":true}}',''],
    ['SettingsOnly','{"settings":{"view":true}}','reports'],
    ['NoView','{"reports":{"view":false,"edit":true}}','reports'],
    ['Corrupt','{bad-json','reports'],
    ['Revoker','{"reports":{"view":true}}','']
  ])await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES(?,'Active',?,?)`).bind(role,permissions,modules).run();
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000201'],
    ['REPORTER','Reporter','01710000202'],
    ['SETTINGS','SettingsOnly','01710000203'],
    ['NOVIEW','NoView','01710000204'],
    ['CORRUPT','Corrupt','01710000205'],
    ['REVOKER','Revoker','01710000206']
  ])await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,210000)`).bind(
      id,id,phone,role,'a'.repeat(64),'b'.repeat(48)
    ).run();
  for(const [token,user,version] of [
    [A,'ADMIN',null],[B,'REPORTER',1],[C,'SETTINGS',1],
    [D,'NOVIEW',1],[E,'CORRUPT',1],[F,'REVOKER',1]
  ])await insertSession(token,user,version);
});
after(async()=>server.close());

test('real D1 authenticates Administrator and literal reports.view with source-shaped output',async()=>{
  for(const token of [A,B]){
    const output=await reader().getBootstrap(req(token));
    assert.equal(output.shopName,'নবাবী হার্ডওয়্যার');
    assert.equal(output.currencySymbol,'৳');
    assert.equal(output.defaultFrom,'2026-11-01');
    assert.equal(output.defaultTo,'2026-11-15');
    assert.deepEqual(output.reportTypes.map(r=>r.key),[
      'sales','purchase','stock','cashbank','profit','balancesheet'
    ]);
    assert.deepEqual(Object.keys(output),[
      'reportTypes','currencySymbol','shopName','defaultFrom','defaultTo'
    ]);
    assert.doesNotMatch(JSON.stringify(output),/DO-NOT-RETURN-SECRET|PRIVATE-PHONE/);
  }
});

test('real D1 rejects display-only reports metadata, settings.view, edit-only and malformed JSON',async()=>{
  for(const token of [C,D,E,'9'.repeat(64)])
    await assert.rejects(()=>reader().getBootstrap(req(token)),/Denied/i);
});

test('single D1 read denies idle, absolute expired and invalid trusted shop time',async()=>{
  await assert.rejects(()=>reader().getBootstrap(req(B,{
    nowMs:NOW+AUTH_POLICY.sessionIdleMs-60000
  })),/Denied/i);
  await assert.rejects(()=>reader().getBootstrap(req(B,{nowMs:NOW+1200000})),/Denied/i);
  await assert.rejects(()=>reader().getBootstrap(req(B,{today:'2026-02-30'})),/invalid|trusted/i);
});

test('revocation and role epoch changes fail closed despite valid bearer and Settings rows',async()=>{
  assert.equal((await reader().getBootstrap(req(F))).currencySymbol,'৳');
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+1000,digest(F)).run();
  await assert.rejects(()=>reader().getBootstrap(req(F,{nowMs:NOW+2000})),/Denied/i);

  // Change the Reporter role and change it back: old B must remain invalid.
  await DB.prepare(`UPDATE auth_roles SET permissions_json='{"reports":{"view":false}}'
    WHERE role_name='Reporter'`).run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);
  await DB.prepare(`UPDATE auth_roles SET permissions_json='{"reports":{"view":true}}'
    WHERE role_name='Reporter'`).run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='REPORTER'").run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);
});

test('original Settings are unchanged, public HTTP remains 404 and preview has no D1',async()=>{
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM settings').first();
  assert.equal(count.n,4);
  assert.equal((await DB.prepare('SELECT value FROM settings WHERE key=?')
    .bind('JWT_SECRET').first()).value,'DO-NOT-RETURN-SECRET');
  for(const path of ['/api/rpc','/__m04_test__/reports-bootstrap','/reports/bootstrap']){
    const response=await worker.fetch('http://m04-reports.local'+path,{method:'POST'});
    assert.equal(response.status,404);
  }
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(production.includes('m04-authorized-reports-bootstrap'),false);
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m04-reports-bootstrap-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.main,'tests/fixtures/m03-m04-settings-worker.mjs');
  assert.equal(config.workers_dev,false);
});
