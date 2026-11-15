import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';

const impl=await import('../../src/modules/m09-authorized-shell-settings-save.js')
  .catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(e));
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64);
const digest=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const request=(patch={})=>({
  token:A,nowMs:NOW,key:'Shop Name',newValue:'  নতুন দোকান  ',
  expectedValue:'Original Shop',...patch
});
const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-settings-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-m04-settings-local-test');
let DB;
function adapter(){
  assert.equal(typeof impl?.createM09AuthorizedShellSettingsSave,'function',
    'M09 authorized Shell Settings save adapter not implemented');
  return impl.createM09AuthorizedShellSettingsSave({DB});
}
async function records(){
  const result=await DB.prepare('SELECT row_id,legacy_sheet_row,key,value FROM settings ORDER BY row_id').all();
  assert.equal(result?.success,true);
  return result.results.map(row=>({...row}));
}
before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const src=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const start=src.indexOf('CREATE TABLE settings ('),end=src.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0&&end>start,'must use reviewed M02 Settings DDL');
  await DB.prepare(src.slice(start,end).trim().replace(/;\s*$/,'')).run();
  for(const [key,value,index] of [
    ['Shop Name','Original Shop',2],
    ['Currency Symbol','৳',3],
    ['Phone 1','01712345678',4],
    ['Delete Confirmation Key','DO-NOT-CHANGE',5]
  ])await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .bind(key,value,index).run();
  for(const [role,grant] of [
    ['Editor','{"settings":{"edit":true,"view":false}}'],
    ['Viewer','{"settings":{"view":true,"edit":false}}']
  ])await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')")
    .bind(role,grant).run();
  for(const [id,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['STAFF','01710000002','Editor'],
    ['VIEWER','01710000003','Viewer']
  ])await DB.prepare("INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)")
    .bind(id,id,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  for(const [token,user,epoch] of [
    [A,'ADMIN',null],[B,'STAFF',1],[C,'VIEWER',1]
  ])await DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)")
    .bind(digest(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000).run();
});
after(async()=>{await server.close();});

test('real Workerd D1 commits original Shop Name after M04 authorization; no second SQL or private Settings mutation',async()=>{
  const beforeRows=await records();
  const result=await adapter().saveOne(request());
  assert.deepEqual(result,{success:true,data:'Settings saved.'});
  const afterRows=await records();
  assert.deepEqual(afterRows[0],{...beforeRows[0],value:'নতুন দোকান'});
  assert.deepEqual(afterRows.slice(1),beforeRows.slice(1));
});

test('real Workerd denies malformed Shop Name before SQL and edit-only staff succeeds under current grant',async()=>{
  const beforeRows=await records();
  const bad=await adapter().saveOne(request({newValue:'   ',expectedValue:'নতুন দোকান'}));
  assert.deepEqual(bad,{success:false,error:'Shop Name is required.'});
  assert.deepEqual(await records(),beforeRows);
  assert.deepEqual(await adapter().saveOne(request({
    token:B,newValue:' Authorized Editor ',expectedValue:'নতুন দোকান'
  })),{success:true,data:'Settings saved.'});
  assert.equal((await records())[0].value,'Authorized Editor');
});

test('real Workerd denies view-only, unknown, expired and stale permission epoch without modifying data',async()=>{
  const beforeRows=await records();
  for(const patch of [
    {token:C},{token:'f'.repeat(64)},
    {token:B,nowMs:NOW+1_200_000}
  ])await assert.rejects(()=>adapter().saveOne(request({
    ...patch,expectedValue:'Authorized Editor',newValue:'SHOULD NOT APPEAR'
  })),/Denied|stale/i);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"settings":{"edit":false}}','Editor').run();
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"settings":{"edit":true}}','Editor').run();
  await assert.rejects(()=>adapter().saveOne(request({
    token:B,expectedValue:'Authorized Editor',newValue:'STALE ROLE'
  })),/Denied|stale/i);
  assert.deepEqual(await records(),beforeRows);
});

test('real Workerd two concurrent same-preimage Currency updates commit at most one, preserve row lineage',async()=>{
  const beforeRows=await records();
  const result=await Promise.allSettled([
    adapter().saveOne(request({key:'Currency Symbol',expectedValue:'৳',newValue:'BDT'})),
    adapter().saveOne(request({key:'Currency Symbol',expectedValue:'৳',newValue:'টাকা'}))
  ]);
  assert.equal(result.filter(v=>v.status==='fulfilled').length,1);
  assert.equal(result.filter(v=>v.status==='rejected').length,1);
  const winning=result[0].status==='fulfilled'?'BDT':'টাকা';
  const afterRows=await records();
  assert.equal(afterRows[1].value,winning);
  assert.equal(afterRows[1].legacy_sheet_row,beforeRows[1].legacy_sheet_row);
  assert.deepEqual(afterRows.filter(x=>x.key!=='Currency Symbol'),
    beforeRows.filter(x=>x.key!=='Currency Symbol'));
});

test('real Worker remains inert: no public mutation, no new RPC, no D1 binding to preview',async()=>{
  const beforeRows=await records();
  for(const path of ['/api/rpc','/settings/update','/m09/settings/save','/__m09_shell__/save']){
    const response=await worker.fetch('http://shererp-test.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(request({newValue:'FORGED'}))
    });
    assert.equal(response.status,404);
  }
  await assert.rejects(()=>adapter().saveOne(request({
    key:'Delete Confirmation Key',expectedValue:'DO-NOT-CHANGE',newValue:'EXPOSE'
  })),/Invalid|unsupported/i);
  assert.deepEqual(await records(),beforeRows);
  const main=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/m09-authorized-shell-settings-save/);
});
