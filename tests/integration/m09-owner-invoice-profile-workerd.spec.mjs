import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {Hono} from 'hono';
import {registerOwnerInvoiceProfileRoutes}
  from '../../src/modules/m09-owner-invoice-profile-routes.js';
import {defaultInvoiceProfile,readOwnerInvoiceProfile,saveOwnerInvoiceProfile,INVOICE_PROFILE_KEY}
  from '../../src/modules/m09-owner-invoice-profile.js';

const server=createTestHarness({workers:[{
  configPath:'./wrangler.m09-owner-invoice-profile-test.jsonc'
}]});
const worker=server.getWorker('shererp-m09-owner-invoice-profile-local-only');
const A={
  shopId:'11111111-1111-4111-8111-111111111111',
  databaseId:'22222222-2222-4222-8222-222222222222',
  databaseMarker:'33333333-3333-4333-8333-333333333333'
};
const B={
  shopId:'44444444-4444-4444-8444-444444444444',
  databaseId:'55555555-5555-4555-8555-555555555555',
  databaseMarker:'66666666-6666-4666-8666-666666666666'
};
const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
const digest=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const now=()=>Date.now();
let shopA,shopB;
const load=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const statements=name=>load(name).split('-- next statement').map(s=>s.trim()).filter(Boolean);
async function createSchema(db,identity,token){
  for(const sql of statements('staging-migrations/shop-identity/0001_shop_identity.sql'))
    await db.prepare(sql).run();
  const m02=load('migrations/0001_core_catalog.sql');
  const start=m02.indexOf('CREATE TABLE settings (');
  const end=m02.indexOf('CREATE TABLE product_categories (');
  assert.ok(start>=0&&end>start);
  await db.prepare(m02.slice(start,end).trim().replace(/;\s*$/,'')).run();
  await db.prepare('INSERT INTO shop_identity(singleton,shop_id,database_id,database_marker) VALUES(1,?,?,?)')
    .bind(identity.shopId,identity.databaseId,identity.databaseMarker).run();
  for(const sql of statements('staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql'))
    await db.prepare(sql).run();
  for(const sql of statements('staging-migrations/shop-owner-write/0004_owner_write_lease.sql'))
    await db.prepare(sql).run();
  await db.prepare('UPDATE shop_owner_write_grant SET generation=1,enabled=1,token_hash=?,expires_at_ms=? WHERE singleton=1')
    .bind(digest(token),now()+300000).run();
  return {...identity,shopDb:db};
}
const settingsRow=scope=>scope.shopDb.prepare('SELECT value FROM settings WHERE key=?').bind(INVOICE_PROFILE_KEY).first();
const save=(scope,token,expectedRevision,profile)=>
  saveOwnerInvoiceProfile(scope,{token,expectedRevision,profile});
const read=(scope,token)=>readOwnerInvoiceProfile(scope,{token});
before(async()=>{
  await server.listen();
  const env=await worker.getEnv();
  shopA=await createSchema(env.SHOP_A,A,tokenA);
  shopB=await createSchema(env.SHOP_B,B,tokenB);
});
after(async()=>{await server.close();});

test('Shop A initial read is real D1 authorized default; other Shop and token denied',async()=>{
  const a=await read(shopA,tokenA);
  assert.deepEqual(a,{status:'ok',profile:defaultInvoiceProfile(),revision:null});
  assert.equal((await read(shopB,tokenA)).status,'denied');
  assert.equal((await read({...shopA,shopId:B.shopId},tokenA)).status,'denied');
  assert.equal((await read({...shopA,databaseMarker:B.databaseMarker},tokenA)).status,'denied');
  assert.equal(await settingsRow(shopA),null);
  assert.equal(await settingsRow(shopB),null);
});

test('authorized Owner creates one preview record, not invoice/stock/other Settings',async()=>{
  await shopA.shopDb.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
    .bind('Delete Confirmation Key','NEVER EXPOSE').run();
  const profile={...defaultInvoiceProfile(),template:'Compact',paper:'58 mm',
    checks:{...defaultInvoiceProfile().checks,signature:false}};
  const result=await save(shopA,tokenA,null,profile);
  assert.equal(result.status,'saved');
  const stored=await settingsRow(shopA);
  assert.equal(stored.value,result.revision);
  assert.deepEqual(await read(shopA,tokenA),{status:'ok',profile,revision:result.revision});
  assert.equal(await settingsRow(shopB),null);
  assert.equal((await shopA.shopDb.prepare('SELECT value FROM settings WHERE key=?')
    .bind('Delete Confirmation Key').first()).value,'NEVER EXPOSE');
  assert.equal((await save(shopB,tokenA,null,profile)).status,'denied-or-stale');
  assert.equal(await settingsRow(shopB),null);
});

test('concurrent same-revision D1 updates admit exactly one winner; stale CAS is denied',async()=>{
  const before=await read(shopA,tokenA);
  const option1={...before.profile,template:'Classic'};
  const option2={...before.profile,template:'Standard'};
  const pair=await Promise.all([
    save(shopA,tokenA,before.revision,option1),
    save(shopA,tokenA,before.revision,option2)
  ]);
  assert.equal(pair.filter(x=>x.status==='saved').length,1);
  assert.equal(pair.filter(x=>x.status==='denied-or-stale').length,1);
  const current=await read(shopA,tokenA);
  assert.deepEqual(current.profile,pair[0].status==='saved'?option1:option2);
  assert.equal((await save(shopA,tokenA,before.revision,option1)).status,'denied-or-stale');
});

test('invalid/unavailable invoice presets cannot corrupt saved record',async()=>{
  const before=(await settingsRow(shopA)).value;
  const current=await read(shopA,tokenA);
  for(const p of [
    {...current.profile,template:'Modern'},
    {...current.profile,role:'Super Admin'},
    {...current.profile,checks:{...current.profile.checks,warranty:'false'}}
  ])assert.equal((await save(shopA,tokenA,current.revision,p)).status,'invalid');
  assert.equal((await settingsRow(shopA)).value,before);
});

test('SQL-time revoked grant denies both reads and updates, preserving record',async()=>{
  const original=(await settingsRow(shopA)).value;
  const current=await read(shopA,tokenA);
  await shopA.shopDb.prepare('UPDATE shop_owner_write_grant SET enabled=0 WHERE singleton=1').run();
  assert.equal((await read(shopA,tokenA)).status,'denied');
  assert.equal((await save(shopA,tokenA,current.revision,current.profile)).status,'denied-or-stale');
  assert.equal((await settingsRow(shopA)).value,original);
  await shopA.shopDb.prepare('UPDATE shop_owner_write_grant SET generation=2,token_hash=?,enabled=1,expires_at_ms=? WHERE singleton=1')
    .bind(digest(tokenB),now()+180000).run();
  assert.equal((await read(shopA,tokenA)).status,'denied');
  assert.equal((await read(shopA,tokenB)).status,'ok');
});

test('expired Owner lease denies access; malformed persisted JSON fails closed',async()=>{
  await shopA.shopDb.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
    .bind(now()-1000).run();
  assert.equal((await read(shopA,tokenB)).status,'denied');
  await shopA.shopDb.prepare('UPDATE shop_owner_write_grant SET generation=3,token_hash=?,enabled=1,expires_at_ms=? WHERE singleton=1')
    .bind(digest(tokenB),now()+180000).run().catch(()=>{});
  // The generation transition forbids reuse of the exact token; leave corrupt
  // storage validation to the independent authorized Shop B grant.
  await shopB.shopDb.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
    .bind(INVOICE_PROFILE_KEY,'{"unexpected":"unsafe"}').run();
  assert.equal((await read(shopB,tokenB)).status,'unavailable');
  assert.equal((await settingsRow(shopB)).value,'{"unexpected":"unsafe"}');
});

test('local-only Workerd has no public/preview/Invoice Studio RPC route',async()=>{
  for(const path of ['/api/owner/invoice-profile','/api/rpc','/__m09_profile']) {
    const response=await worker.fetch('http://local.test'+path,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});


test('isolated Hono HTTP adapter enforces private Owner gates and exact Shop profile CAS',async()=>{
  const app=new Hono();
  let trustedScope=shopB,trustedToken=tokenB;
  // These are test-owned trusted closures, NOT request-derived Shop/token.
  registerOwnerInvoiceProfileRoutes(app,{
    protectLogin:async (_c,next)=>next(),
    limitBody:async (_c,next)=>next(),
    currentOwnerContext:async()=>({scope:trustedScope,token:trustedToken})
  });
  const env={OWNER_INVOICE_PROFILE_ENABLED:'true',OWNER_WRITE_GRANTS_ENABLED:'true'};
  const request=(method,body,policy=env)=>app.request('http://local.test/api/owner/invoice-profile',{
    method,headers:{'Content-Type':'application/json'},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  },policy);
  await shopB.shopDb.prepare('DELETE FROM settings WHERE key=?').bind(INVOICE_PROFILE_KEY).run();
  assert.equal((await request('GET',undefined,{...env,OWNER_INVOICE_PROFILE_ENABLED:'false'})).status,404);
  assert.equal((await request('GET',undefined,{...env,OWNER_WRITE_GRANTS_ENABLED:'false'})).status,404);
  const first=await request('GET');
  assert.equal(first.status,200);
  assert.deepEqual((await first.json()).data,{
    shopId:B.shopId,profile:defaultInvoiceProfile(),revision:null
  });
  const toSave={...defaultInvoiceProfile(),template:'Classic'};
  const posted=await request('POST',{expectedRevision:null,profile:toSave});
  assert.equal(posted.status,200);
  const saved=(await posted.json()).data;
  assert.equal(saved.shopId,B.shopId);
  assert.deepEqual(saved.profile,toSave);
  assert.equal((await settingsRow(shopB)).value,saved.revision);
  assert.equal((await request('POST',{expectedRevision:null,profile:toSave})).status,409);
  assert.equal((await request('POST',{expectedRevision:saved.revision,profile:toSave,shopId:A.shopId})).status,400);
  assert.equal((await request('POST',{expectedRevision:saved.revision,profile:{...toSave,template:'Elegant'}})).status,400);
  trustedToken=tokenA;
  assert.equal((await request('GET')).status,403);
  trustedScope=shopA;
  assert.equal((await request('GET')).status,403);
  assert.equal((await settingsRow(shopB)).value,saved.revision);
});
