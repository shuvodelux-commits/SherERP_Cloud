import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {AUTH_POLICY} from '../../src/auth/d1-auth-core.js';
import {createM09AuthorizedDayBookBootstrapReader}
  from '../../src/modules/m09-authorized-daybook-bootstrap.js';

const server=createTestHarness({workers:[{configPath:'./wrangler.m09-daybook-authorized-test.jsonc'}]});
const worker=server.getWorker('shererp-m09-daybook-authorized-local');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),
  D='d'.repeat(64),E='e'.repeat(64),F='f'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const req=(token=A,extra={})=>({token,nowMs:NOW,...extra});
let DB;
const reader=()=>createM09AuthorizedDayBookBootstrapReader({DB});

async function session(token,user,roleVersion=1){
  await DB.prepare('INSERT INTO auth_sessions (token_hash,user_id,user_auth_version,'+
    'role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms) '+
    'VALUES (?,?,1,?,1,?,?,?)').bind(digest(token),user,roleVersion,
      NOW-300000,NOW-60000,NOW+1200000).run();
}

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const sql=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const first=sql.indexOf('CREATE TABLE settings (');
  const next=sql.indexOf('CREATE TABLE product_categories (');
  assert.ok(first>=0 && next>first,'Frozen source-key Settings schema missing');
  await DB.prepare(sql.slice(first,next).trim().replace(/;\s*$/,'')).run();
  for(const [key,value] of [
    ['Currency Symbol','৳'],['Day Book Editable Days','4'],
    ['Shop Name','মোহিম হার্ডওয়্যার'],['JWT_SECRET','PRIVATE-NEVER-RETURN']
  ])await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind(key,value).run();

  for(const [role,permissions] of [
    ['Clerk','{"daybook":{"view":true}}'],
    ['ReportsOnly','{"reports":{"view":true}}'],
    ['SettingsOnly','{"settings":{"view":true}}'],
    ['NoView','{"daybook":{"view":false,"edit":true}}'],
    ['Revoker','{"daybook":{"view":true}}']
  ])await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) "+
    "VALUES(?,'Active',?,'daybook')").bind(role,permissions).run();

  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000301'],
    ['CLERK','Clerk','01710000302'],
    ['REPORTS','ReportsOnly','01710000303'],
    ['SETTINGS','SettingsOnly','01710000304'],
    ['NOVIEW','NoView','01710000305'],
    ['REVOKER','Revoker','01710000306']
  ])await DB.prepare('INSERT INTO auth_users '+
    '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
    "VALUES (?,?,?,?,'Active',?,?,210000)").bind(
      id,id,phone,role,'a'.repeat(64),'b'.repeat(48)).run();
  for(const [token,id,v] of [
    [A,'ADMIN',null],[B,'CLERK',1],[C,'REPORTS',1],
    [D,'SETTINGS',1],[E,'NOVIEW',1],[F,'REVOKER',1]
  ])await session(token,id,v);
});
after(async()=>server.close());

test('real D1 returns four source fields to Administrator and literal daybook.view staff',async()=>{
  for(const [token,admin] of [[A,true],[B,false]]){
    const value=await reader().getBootstrap(req(token));
    assert.deepEqual(Object.keys(value),[
      'currencySymbol','editableDays','modules','isAdmin'
    ]);
    assert.equal(value.currencySymbol,'৳');
    assert.equal(value.editableDays,4);
    assert.equal(value.isAdmin,admin);
    assert.equal(value.modules.length,12);
    assert.equal(value.modules[0],'Sales');
    assert.equal(value.modules.at(-1),'Stock Adjustment');
    assert.doesNotMatch(JSON.stringify(value),/PRIVATE-NEVER-RETURN|মোহিম হার্ডওয়্যার/);
  }
});

test('reports.view and settings.view do not grant daybook.view; metadata and edit only cannot grant',async()=>{
  for(const token of [C,D,E,'9'.repeat(64)]){
    await assert.rejects(()=>reader().getBootstrap(req(token)),/Denied/i);
  }
});

test('malformed server input rejected, idle and expired sessions fail closed on real D1',async()=>{
  await assert.rejects(()=>reader().getBootstrap(req(B,{role:'Administrator'})),/invalid|request/i);
  await assert.rejects(()=>reader().getBootstrap(req(B,{nowMs:'bad'})),/invalid|request/i);
  await assert.rejects(()=>reader().getBootstrap(req(B,{
    nowMs:NOW+AUTH_POLICY.sessionIdleMs+1000
  })),/Denied/i);
  await assert.rejects(()=>reader().getBootstrap(req(B,{nowMs:NOW+1200000})),/Denied/i);
});

test('revocation, role epoch and stale user epoch never reinstate old Day Book sessions',async()=>{
  assert.equal((await reader().getBootstrap(req(F))).isAdmin,false);
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+1000,digest(F)).run();
  await assert.rejects(()=>reader().getBootstrap(req(F,{nowMs:NOW+2000})),/Denied/i);

  assert.equal((await reader().getBootstrap(req(B))).editableDays,4);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"daybook":{"view":false}}','Clerk').run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"daybook":{"view":true}}','Clerk').run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);

  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='CLERK'").run();
  await assert.rejects(()=>reader().getBootstrap(req(B)),/Denied/i);
});

test('read-only Settings remain intact and public test Worker exposes no Day Book endpoint',async()=>{
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,4);
  assert.equal((await DB.prepare("SELECT value FROM settings WHERE key='JWT_SECRET'").first()).value,
    'PRIVATE-NEVER-RETURN');
  for(const path of ['/api/rpc','/daybook/bootstrap','/__m09_test__/daybook']){
    const response=await worker.fetch('http://m09-daybook.local'+path,{method:'POST'});
    assert.equal(response.status,404);
  }
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  const testConfig=JSON.parse(readFileSync(
    new URL('../../wrangler.m09-daybook-authorized-test.jsonc',import.meta.url),'utf8'));
  assert.equal(testConfig.workers_dev,false);
  assert.equal(testConfig.main,'tests/fixtures/m03-m04-settings-worker.mjs');
  const prod=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(prod.includes('m09-authorized-daybook-bootstrap'),false);
});

test('valid authorized user with no Settings records gets frozen zero defaults',async()=>{
  await DB.prepare("DELETE FROM settings WHERE key IN ('Currency Symbol','Day Book Editable Days')").run();
  const result=await reader().getBootstrap(req(A));
  assert.equal(result.currencySymbol,'');
  assert.equal(result.editableDays,0);
  assert.equal(result.isAdmin,true);
  assert.equal(result.modules.length,12);
});
