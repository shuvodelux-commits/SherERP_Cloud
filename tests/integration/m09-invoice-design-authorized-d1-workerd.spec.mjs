import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';

const module=await import('../../src/modules/m09-invoice-design-authorized-d1-read.js')
  .catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(e));
const config=JSON.parse(readFileSync(
  new URL('../../wrangler.m03-m04-settings-view-test.jsonc',import.meta.url),'utf8'));
const sourceM02=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const NOW=1_800_000_000_000;
const hash=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const req=(patch={})=>({token:A,nowMs:NOW,...patch});
const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-settings-view-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-m04-settings-view-local-test');
let DB;
function reader(){
  assert.equal(typeof module?.createM09AuthorizedInvoiceDesignD1Reader,'function',
    'M09 authorized Invoice Design D1 reader not implemented');
  return module.createM09AuthorizedInvoiceDesignD1Reader({DB});
}
const count=async()=>(
  await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()
).n;

before(async()=>{
  assert.equal(config.workers_dev,false);
  assert.equal(config.main,'tests/fixtures/m03-m04-settings-worker.mjs');
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000014');
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const first=sourceM02.indexOf('CREATE TABLE settings (');
  const last=sourceM02.indexOf('CREATE TABLE product_categories (');
  assert.ok(first>=0&&last>first,'original M02 Settings schema must be reused');
  await DB.prepare(sourceM02.slice(first,last).trim().replace(/;\s*$/,'')).run();
  for(const [key,value,row] of [
    ['Shop Name','নবাবী হার্ডওয়্যার',2],
    ['Currency Symbol','৳',3],
    ['Delete Confirmation Key','PRIVATE-SECURE',4],
    ['Invoice Logo','',5]
  ])await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .bind(key,value,row).run();
  for(const [role,permissions] of [
    ['Viewer','{"settings":{"view":true,"edit":false}}'],
    ['Editor','{"settings":{"view":false,"edit":true}}']
  ])await DB.prepare(
    "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')"
  ).bind(role,permissions).run();
  for(const [user,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['VIEWER','01710000002','Viewer'],
    ['EDITOR','01710000003','Editor']
  ])await DB.prepare(
    "INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)"
  ).bind(user,user,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  for(const [token,user,epoch] of [
    [A,'ADMIN',null],[B,'VIEWER',1],[C,'EDITOR',1]
  ])await DB.prepare(
    "INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)"
  ).bind(hash(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000).run();
});
after(async()=>{await server.close();});

test('real local Workerd D1 returns source full Invoice Design map for Administrator and view-only role',async()=>{
  const read=reader();
  for(const token of [A,B]){
    const out=await read.getBootstrap(req({token}));
    assert.deepEqual(Object.keys(out),['settings','logoDataUri']);
    assert.deepEqual(out.settings,{
      'Shop Name':'নবাবী হার্ডওয়্যার',
      'Currency Symbol':'৳',
      'Delete Confirmation Key':'PRIVATE-SECURE',
      'Invoice Logo':''
    });
    assert.equal(out.logoDataUri,'');
  }
  assert.equal(await count(),4,'read has not written any Settings');
});

test('real local Workerd D1 denies edit-only, forged, expired and stale-role sessions',async()=>{
  const read=reader();
  for(const input of [
    req({token:C}),req({token:'f'.repeat(64)}),
    req({token:B,nowMs:NOW+1_200_000}),
    req({token:B,nowMs:NOW+31*60_000})
  ])await assert.rejects(()=>read.getBootstrap(input),/Denied/i);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"settings":{"view":false}}','Viewer').run();
  await assert.rejects(()=>read.getBootstrap(req({token:B})),/Denied/i);
  assert.equal(await count(),4);
});

test('real local Workerd D1 fails closed on unported legacy Drive logo rather than deleting the file ID',async()=>{
  await DB.prepare("UPDATE settings SET value='SECRET-LEGACY-FILE-ID' WHERE key='Invoice Logo'").run();
  let caught;
  try{await reader().getBootstrap(req());}catch(e){caught=e;}
  assert.ok(caught,'unmigrated source logo must fail closed');
  assert.match(caught.message,/NEEDS_REVIEW|logo/i);
  assert.doesNotMatch(caught.message,/SECRET-LEGACY-FILE-ID/);
  const row=await DB.prepare("SELECT value FROM settings WHERE key='Invoice Logo'").first();
  assert.equal(row.value,'SECRET-LEGACY-FILE-ID');
  await DB.prepare("UPDATE settings SET value='' WHERE key='Invoice Logo'").run();
  assert.equal((await reader().getBootstrap(req())).logoDataUri,'');
});

test('test-only Workerd does not enable public Settings, Invoice Design or RPC endpoints',async()=>{
  for(const path of ['/api/rpc','/settings/invoice-design',
    '/__m09_test__/invoice-design','/__m03_m04_settings__/view']){
    const response=await worker.fetch('http://invoice-design.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:A,rawSql:'SELECT * FROM settings'})
    });
    assert.equal(response.status,404);
  }
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(production,/m09-invoice-design-authorized-d1-read/);
  assert.equal(await count(),4);
});
