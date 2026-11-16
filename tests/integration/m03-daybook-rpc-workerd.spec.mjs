import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import publicWorker from '../../src/index.js';
import {createM03DayBookRpcBridge}
  from '../../src/rpc/internal-daybook-bootstrap.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m09-daybook-authorized-test.jsonc'
}]});
const worker=server.getWorker('shererp-m09-daybook-authorized-local');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const invoke=(token=B)=>({fnName:'getDayBookBootstrap',args:[token]});
let DB;
const bridge=()=>createM03DayBookRpcBridge({DB},{now:()=>NOW});

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const ddl=readFileSync(new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
  const start=ddl.indexOf('CREATE TABLE settings (');
  const end=ddl.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0&&end>start,'approved original source Settings DDL');
  await DB.prepare(ddl.slice(start,end).trim().replace(/;\s*$/,'')).run();
  for(const [key,value] of [
    ['Currency Symbol','৳'],['Day Book Editable Days','3'],
    ['Shop Name','PRIVATE_SHOP_NAME'],['Delete Confirmation Key','SECRET_NEVER_RETURN']
  ])await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind(key,value).run();
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) "+
    "VALUES('DaybookClerk','Active','{\"daybook\":{\"view\":true}}','daybook')").run();
  await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) "+
    "VALUES('Blocked','Active','{\"daybook\":{\"view\":false}}','daybook')").run();
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000601'],
    ['CLERK','DaybookClerk','01710000602'],
    ['BLOCKED','Blocked','01710000603']
  ])await DB.prepare('INSERT INTO auth_users '+
    '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
    "VALUES(?,?,?,?,'Active',?,?,210000)").bind(
      id,id,phone,role,'a'.repeat(64),'b'.repeat(48)).run();
  for(const [token,id,roleVersion] of [[A,'ADMIN',null],[B,'CLERK',1],[C,'BLOCKED',1]]){
    await DB.prepare('INSERT INTO auth_sessions '+
      '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
      'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES(?,?,1,?,1,?,?,?)')
      .bind(digest(token),id,roleVersion,NOW-300000,NOW-60000,NOW+1200000).run();
  }
});

after(async()=>server.close());

test('original getDayBookBootstrap RPC successfully awaits authorized local D1',async()=>{
  const modules=[
    'Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
    'Customer Advance Refund','Supplier Payment','Expense','Finance',
    'Bank','Bank Transfer','Stock Adjustment'
  ];
  for(const [token,isAdmin] of [[A,true],[B,false]]){
    const result=await bridge().invoke(invoke(token));
    assert.deepEqual(result,{success:true,data:{
      currencySymbol:'৳',editableDays:3,modules,isAdmin
    }});
    assert.equal(result.data.then,undefined,'RPC data must not contain a Promise');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SHOP_NAME|SECRET_NEVER_RETURN|auth_sessions/);
  }
});

test('real D1 denies user without daybook.view, unknown token and expired session',async()=>{
  for(const token of [C,'f'.repeat(64)]){
    assert.deepEqual(await bridge().invoke(invoke(token)),{
      success:false,message:'Day Book is unavailable or access denied.'
    });
  }
  const expired=createM03DayBookRpcBridge({DB},{now:()=>NOW+1200000});
  assert.deepEqual(await expired.invoke(invoke(B)),{
    success:false,message:'Day Book is unavailable or access denied.'
  });
  for(const bad of [
    {fnName:'getDayBookBootstrap',args:[B],role:'Administrator'},
    {fnName:'getDayBookBootstrap',args:[B,NOW]},
    {fnName:'getSettingsMap_',args:[B]}
  ]){
    const r=await bridge().invoke(bad);
    assert.equal(r.success,false);
    assert.equal(Object.hasOwn(r,'data'),false);
  }
});

test('revocation, role update and staff deactivation fail closed even after a successful read',async()=>{
  assert.equal((await bridge().invoke(invoke(B))).success,true);
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"daybook":{"view":false}}','DaybookClerk').run();
  const afterRevocation=await bridge().invoke(invoke(B));
  assert.deepEqual(afterRevocation,{
    success:false,message:'Day Book is unavailable or access denied.'
  });
  await DB.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
    .bind('{"daybook":{"view":true}}','DaybookClerk').run();
  assert.equal((await bridge().invoke(invoke(B))).success,false,
    'old role version must never authorize after restore');
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='CLERK'").run();
  assert.equal((await bridge().invoke(invoke(B))).success,false);
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+1000,digest(A)).run();
  assert.equal((await bridge().invoke(invoke(A))).success,false);
});

test('real Settings remain intact and neither test Worker nor public Worker exposes the internal bridge',async()=>{
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM settings').first();
  assert.equal(count.n,4);
  assert.equal((await DB.prepare("SELECT value FROM settings WHERE key='Delete Confirmation Key'").first()).value,
    'SECRET_NEVER_RETURN');
  const http=await worker.fetch('http://m03-daybook.local/api/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(invoke(B))
  });
  assert.equal(http.status,404,'fixture Worker has no RPC routes');
  const response=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{'Origin':'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify(invoke(B))
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{
    success:false,message:'RPC method not migrated'
  });
});
