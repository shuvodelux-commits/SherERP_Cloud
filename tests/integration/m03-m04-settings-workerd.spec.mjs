import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {AUTH_POLICY,createOfflinePasswordCredential,loginWithD1}
  from '../../src/auth/d1-auth-core.js';
import {createM04AuthorizedShellSettingsUpdateAdapter}
  from '../../src/db/m04-settings-update.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-m04-settings-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-m04-settings-local-test');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const make=(patch={})=>({
  token:A,nowMs:NOW,key:'Shop Name',
  newValue:'Changed Shop',expectedValue:'Original Shop',...patch
});
let DB;
const records=async()=>(await DB.prepare(
  'SELECT row_id,legacy_sheet_row,key,value FROM settings ORDER BY row_id'
).all()).results.map(x=>({...x}));
const update=()=>createM04AuthorizedShellSettingsUpdateAdapter({DB});

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  // Apply the unchanged M02 catalog/Settings DDL in the same isolated
  // D1 binding as the M04 test-only migration (not a deployment migration).
  const source=readFileSync(
    new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8'
  );
  const start=source.indexOf('CREATE TABLE settings (');
  const end=source.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0 && end>start,'the reviewed M02 Settings DDL must exist');
  const ddl=source.slice(start,end).trim().replace(/;\s*$/,'');
  await DB.prepare(ddl).run();
  for(const [key,value,index] of [
    ['Shop Name','Original Shop',2],
    ['Currency Symbol','৳',3],
    ['Delete Confirmation Key','TOP_SECRET',4],
    ['Phone 1','01712345678',5]
  ]){
    await DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
      .bind(key,value,index).run();
  }
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES('Cashier','Active','{"settings":{"edit":true}}','settings')`).run();
  for(const [id,phone,role] of [
    ['ADMIN-A','01710000001','Administrator'],
    ['ADMIN-B','01710000002','Administrator'],
    ['STAFF-C','01710000003','Cashier']
  ]){
    await DB.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
      status,password_hash,password_salt,password_iterations)
      VALUES(?,?,?,?,'Active',?,?,210000)`)
      .bind(id,'Synthetic '+id,phone,role,'d'.repeat(64),'e'.repeat(48)).run();
  }
  for(const [token,user,roleEpoch] of [
    [A,'ADMIN-A',null],[B,'ADMIN-B',null],[C,'STAFF-C',1]
  ]){
    await DB.prepare(`INSERT INTO auth_sessions
      (token_hash,user_id,user_auth_version,role_auth_version,
       credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES(?,?,1,?,1,?,?,?,NULL)`).bind(
      digest(token),user,roleEpoch,NOW-300_000,NOW-60_000,NOW+3_600_000
    ).run();
  }
});
after(async()=>{await server.close();});

test('actual M04 session authorizes source-shaped D1 Settings CAS in same SQL statement',async()=>{
  const before=await records();
  assert.deepEqual(await update().updateExisting_(make({
    newValue:'  নবাবী হার্ডওয়্যার  '
  })),{updated:true});
  const after=await records();
  assert.deepEqual(after[0],{...before[0],value:'নবাবী হার্ডওয়্যার'});
  assert.deepEqual(after.slice(1),before.slice(1));
});

test('active custom staff role cannot update even if its permission JSON says settings edit',async()=>{
  const before=await records();
  await assert.rejects(()=>update().updateExisting_(make({
    token:C,expectedValue:'নবাবী হার্ডওয়্যার',newValue:'Unauthorized'
  })),/Denied|stale|conflict/i);
  assert.deepEqual(await records(),before);
});

test('same-preimage concurrent Administrators cannot both commit Currency Symbol change',async()=>{
  const outcomes=await Promise.allSettled([
    update().updateExisting_(make({
      token:A,key:'Currency Symbol',expectedValue:'৳',newValue:'BDT'
    })),
    update().updateExisting_(make({
      token:B,key:'Currency Symbol',expectedValue:'৳',newValue:'TK'
    }))
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const current=(await records())[1];
  assert.equal(current.value,outcomes[0].status==='fulfilled'?'BDT':'TK');
  assert.equal(current.legacy_sheet_row,3);
});

test('expired, idle-expired or nonexistent bearer cannot alter existing D1 Settings',async()=>{
  const before=await records();
  for(const changed of [
    {token:'f'.repeat(64)},
    {nowMs:NOW+3_600_000},
    {nowMs:NOW+AUTH_POLICY.sessionIdleMs-60_000}
  ]){
    await assert.rejects(()=>update().updateExisting_(make({
      ...changed,newValue:'Blocked',expectedValue:'নবাবী হার্ডওয়্যার'
    })),/Denied|stale|conflict/i);
  }
  assert.deepEqual(await records(),before);
});

test('actual PBKDF2 M04 login bearer can authorize the same guarded Settings mutation',async()=>{
  const cred=await createOfflinePasswordCredential('SyntheticPassword123!');
  await DB.prepare(`UPDATE auth_users
    SET password_hash=?,password_salt=?,password_iterations=?
    WHERE user_id='ADMIN-A'`).bind(cred.passwordHash,cred.passwordSalt,cred.iterations).run();
  const login=await loginWithD1(DB,{
    phoneKey:'01710000001',password:'SyntheticPassword123!',nowMs:NOW+10_000
  });
  assert.equal(login.authenticated,true);
  assert.match(login.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(await update().updateExisting_(make({
    token:login.token,nowMs:NOW+10_000,
    expectedValue:'নবাবী হার্ডওয়্যার',newValue:'Authenticated Shop'
  })),{updated:true});
  const changed=await records();
  assert.equal(changed[0].value,'Authenticated Shop');
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+11_000,digest(login.token)).run();
  await assert.rejects(()=>update().updateExisting_(make({
    token:login.token,nowMs:NOW+12_000,
    expectedValue:'Authenticated Shop',newValue:'Revoked Attempt'
  })),/Denied|stale|conflict/i);
  assert.equal((await records())[0].value,'Authenticated Shop');
});

test('user disable/re-enable and credential epoch updates invalidate old M04 sessions',async()=>{
  const before=await records();
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='ADMIN-B'").run();
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='ADMIN-B'").run();
  await assert.rejects(()=>update().updateExisting_(make({
    token:B,expectedValue:'Authenticated Shop',newValue:'Stale session'
  })),/Denied|stale|conflict/i);
  assert.deepEqual(await records(),before);
});

test('private Settings and guessed RPC routes stay unavailable on local test Worker',async()=>{
  const before=await records();
  await assert.rejects(()=>update().updateExisting_(make({
    key:'Delete Confirmation Key',expectedValue:'TOP_SECRET',newValue:'Bad'
  })),/Invalid|unsupported/i);
  for(const path of ['/api/rpc','/settings/update','/__m03_m04_settings__/update']){
    const response=await worker.fetch('http://m03m04-settings.local'+path,{
      method:'POST',body:JSON.stringify({token:A,key:'Shop Name',newValue:'Bad'})
    });
    assert.equal(response.status,404);
  }
  assert.deepEqual(await records(),before);
  const config=JSON.parse(readFileSync(
    new URL('../../wrangler.m03-m04-settings-test.jsonc',import.meta.url),'utf8'
  ));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000013');
  const prod=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(prod.includes('m04-settings-update'),false);
});
