import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import publicWorker from '../../src/index.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m03-daybook-http-test.jsonc'
}]});
const worker=server.getWorker('shererp-m03-daybook-http-local-only');
const ORIGIN='http://m03-daybook-http.local';
const NOW=1_800_000_000_000;
const ADMIN='a'.repeat(64),STAFF='b'.repeat(64),DENIED='c'.repeat(64),
  REVOKE='d'.repeat(64);
const digest=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const modules=[
  'Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
  'Customer Advance Refund','Supplier Payment','Expense','Finance',
  'Bank','Bank Transfer','Stock Adjustment'
];
let DB;

async function rpc(fnName='getDayBookBootstrap',args=[STAFF],extras={},opts={}){
  const response=await worker.fetch(ORIGIN+'/__m03_test__/daybook-http',{
    method:opts.method||'POST',
    headers:{
      Origin:opts.origin||ORIGIN,
      'Content-Type':opts.type||'application/json'
    },
    body:opts.method==='GET'?undefined:JSON.stringify({fnName,args,...extras})
  });
  return {
    status:response.status,body:await response.json(),
    cache:response.headers.get('Cache-Control'),
    nosniff:response.headers.get('X-Content-Type-Options')
  };
}

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  const ddl=readFileSync(
    new URL('../../migrations/0001_core_catalog.sql',import.meta.url),'utf8'
  );
  const start=ddl.indexOf('CREATE TABLE settings (');
  const end=ddl.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0&&end>start,'source-approved Settings DDL missing');
  await DB.prepare(ddl.slice(start,end).trim().replace(/;\s*$/,'')).run();
  for(const [key,value] of [
    ['Currency Symbol','৳'],['Day Book Editable Days','5'],
    ['Shop Name','SECRET_SHOP_NAME'],['JWT_SECRET','SECRET_JWT_NOT_FOR_BROWSER']
  ])await DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
    .bind(key,value).run();
  for(const [name,permissions] of [
    ['DayBookReader',JSON.stringify({daybook:{view:true}})],
    ['ReportReader',JSON.stringify({reports:{view:true}})]
  ])await DB.prepare(
    "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'daybook')"
  ).bind(name,permissions).run();
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000701'],
    ['STAFF','DayBookReader','01710000702'],
    ['DENIED','ReportReader','01710000703'],
    ['REVOKE','DayBookReader','01710000704']
  ])await DB.prepare('INSERT INTO auth_users'+
    '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)'+
    " VALUES(?,?,?,?,'Active',?,?,210000)")
    .bind(id,id,phone,role,'a'.repeat(64),'b'.repeat(48)).run();
  for(const [token,id,roleVersion] of [
    [ADMIN,'ADMIN',null],[STAFF,'STAFF',1],
    [DENIED,'DENIED',1],[REVOKE,'REVOKE',1]
  ])await DB.prepare('INSERT INTO auth_sessions'+
    '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
    'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES(?,?,1,?,1,?,?,?)')
    .bind(digest(token),id,roleVersion,NOW-300_000,NOW-60_000,NOW+1_200_000).run();
});
after(async()=>server.close());

test('real HTTP to local Workerd/D1 returns exact original Day Book data without secret Settings',async()=>{
  for(const [token,isAdmin] of [[ADMIN,true],[STAFF,false]]){
    const r=await rpc('getDayBookBootstrap',[token]);
    assert.deepEqual(r,{
      status:200,cache:'no-store',nosniff:'nosniff',
      body:{success:true,data:{
        currencySymbol:'৳',editableDays:5,modules,isAdmin
      }}
    });
    assert.equal(r.body.data.then,undefined);
    assert.doesNotMatch(JSON.stringify(r),/SECRET_|JWT|auth_users|token_hash/);
  }
});

test('real HTTP rejects unauthorized and unknown session or RPC name without private data',async()=>{
  for(const token of [DENIED,'f'.repeat(64)]){
    const r=await rpc('getDayBookBootstrap',[token]);
    assert.equal(r.status,503);
    assert.deepEqual(r.body,{
      success:false,message:'Day Book is unavailable or access denied.'
    });
    assert.equal(r.cache,'no-store');
    assert.equal(r.nosniff,'nosniff');
  }
  for(const name of ['getDayBookTransactions','getSettingsMap_','completeSale']){
    const r=await rpc(name,[STAFF]);
    assert.equal(r.status,501,name);
    assert.equal(r.body.success,false);
  }
  assert.equal((await rpc('login',[STAFF])).status,503,
    'existing auth-unconfigured fallback must stay intact');
});

test('same-origin/POST/JSON and source arity/role injection protections precede D1',async()=>{
  for(const [options,expected] of [
    [{method:'GET'},405],
    [{origin:'https://evil.invalid'},403],
    [{type:'text/plain'},415]
  ])assert.equal((await rpc('getDayBookBootstrap',[STAFF],{},options)).status,expected);
  for(const [args,extra] of [
    [[],{}],[[STAFF,'extra'],{}],[['A'.repeat(64)],{}],
    [[STAFF],{role:'Administrator'}],[[STAFF],{nowMs:NOW}],
    [[STAFF],{sql:'SELECT * FROM auth_users'}]
  ]){
    const r=await rpc('getDayBookBootstrap',args,extra);
    assert.equal(r.status,400);
    assert.deepEqual(r.body,{success:false,message:'Invalid RPC arguments'});
  }
});

test('session revoke and account disable block even previously authorized HTTP reads',async()=>{
  assert.equal((await rpc('getDayBookBootstrap',[REVOKE])).status,200);
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW+1000,digest(REVOKE)).run();
  assert.equal((await rpc('getDayBookBootstrap',[REVOKE])).status,503);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='STAFF'").run();
  assert.equal((await rpc('getDayBookBootstrap',[STAFF])).status,503);
});

test('test route cannot appear at public paths; source Settings never mutated',async()=>{
  for(const path of ['/api/rpc','/api/health','/','/__m03_test__/daybook']){
    assert.equal((await worker.fetch(ORIGIN+path,{method:'POST'})).status,404);
  }
  const publicResponse=await publicWorker.fetch(new Request(ORIGIN+'/api/rpc',{
    method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getDayBookBootstrap',args:[ADMIN]})
  }),{DB});
  assert.equal(publicResponse.status,501);
  assert.deepEqual(await publicResponse.json(),{
    success:false,message:'RPC method not migrated'
  });
  const count=await DB.prepare('SELECT COUNT(*) AS n FROM settings').first();
  assert.equal(count.n,4);
  assert.equal((await DB.prepare("SELECT value FROM settings WHERE key='JWT_SECRET'").first()).value,
    'SECRET_JWT_NOT_FOR_BROWSER');
  const cfg=JSON.parse(readFileSync(
    new URL('../../wrangler.m03-daybook-http-test.jsonc',import.meta.url),'utf8'
  ));
  const preview=JSON.parse(readFileSync(
    new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'
  ));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m03-daybook-http-worker.mjs');
  assert.equal(cfg.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000336');
  assert.equal(preview.d1_databases,undefined);
});
