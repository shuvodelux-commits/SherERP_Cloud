import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {requestSupportEditGrant} from '../../src/modules/m03-support-write-authority.js';
import {createSupportProduct} from '../../src/db/m03-support-product-create.js';
const S='1'.repeat(64), K='b'.repeat(64);
const T=Buffer.from('0123456789abcdef0123456789abcdef01234567','hex');
const step=()=>Math.floor(Date.now()/30000);
const code=()=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(step()));
  const h=createHmac('sha1',T).update(b).digest();
  return String((h.readUInt32BE(h.at(-1)&15)&0x7fffffff)%1000000).padStart(6,'0');};
const draft=(name,operationId=crypto.randomUUID())=>({
  operationId,name,brand:'',category:'',unit:'pcs',barcode:'',
  purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',minStock:'0',
  productType:'Standard',components:[]});
const migrate=async(db,name)=>{
  const sql=await readFile(name,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(v=>db.prepare(v)));
};
async function fixture(t){
  const f=await startCleanShopHarness();
  t.after(f.close);
  const {ownerA:a,ownerB:b,SHOP_A_DB:shopA,SHOP_B_DB:shopB}=f;
  const db=a.env.CONTROL_DB,n=Date.now();
  for(const path of [
    'staging-migrations/platform-auth/0001_platform_bootstrap.sql',
    'staging-migrations/platform-auth/0002_platform_sessions.sql',
    'staging-migrations/platform-auth/0003_platform_first_mfa_activation.sql',
    'staging-migrations/platform-auth/0004_platform_browser_first_factor.sql',
    'staging-migrations/platform-onboarding/0011_control_center_provisioning.sql',
    'staging-migrations/platform-support/0001_support_grants_and_events.sql',
    'staging-migrations/platform-support/0002_support_write_authority.sql'
  ])await migrate(db,path);
  for(const target of [shopA,shopB])
    await migrate(target,'staging-migrations/shop-owner-write/0013_support_product_permit.sql');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({
    name:'AES-GCM',iv,additionalData:new TextEncoder().encode('shererp:platform:first-factor:v1')
  },await crypto.subtle.importKey('raw',Buffer.from(K,'hex'),'AES-GCM',false,['encrypt']),T);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES(?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),'https://accounts.google.com','fixture-admin',n-1000,n+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES(1,?,?,?,?)')
      .bind('https://accounts.google.com','fixture-admin','a'.repeat(64),n-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES(1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES(?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),n+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES(?,?)')
      .bind('c'.repeat(64),n-500),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES(?,?,1,1,?,?,?)`)
      .bind(await hashOpaqueSessionToken(S),'c'.repeat(64),step()-3,n-100,n+300000),
    db.prepare('INSERT INTO platform_browser_first_factor VALUES(1,?)')
      .bind(Buffer.from(iv).toString('base64')+'.'+Buffer.from(cipher).toString('base64'))
  ]);
  const grants=[];
  for(const [i,o] of [a,b].entries()){
    const e=o.env,readId=crypto.randomUUID();
    await db.prepare(`INSERT INTO platform_shop_provisioning
      (shop_id,owner_email,database_marker,stage,database_id,binding_key,allocation_evidence)
      VALUES(?,?,?,'ready',?,?,?)`).bind(e.PLATFORM_PILOT_SHOP_ID,'owner@gmail.com',
      e.PLATFORM_PILOT_MARKER,e.PLATFORM_PILOT_D1_ID,
      i?'SHOP_B_DB':'SHOP_A_DB','fixture-'+i).run();
    await db.prepare(`INSERT INTO m03_local_support_grants
      (operation_id,token_hash,shop_id,database_id,database_marker,
       admin_session_hash,actor_subject,reason,issued_at_ms,expires_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(readId,(i?'f':'e').repeat(64),
        e.PLATFORM_PILOT_SHOP_ID,e.PLATFORM_PILOT_D1_ID,e.PLATFORM_PILOT_MARKER,
        await hashOpaqueSessionToken(S),'fixture-admin',
        'Review product data after shop support request',n-100,n+299900).run();
    grants.push(readId);
  }
  const ctx=o=>({...o.env,PLATFORM_BROWSER_SETUP:'true',
    PLATFORM_FACTOR_ENCRYPTION_KEY:K,M03_SUPPORT_WRITE_ENABLED:'true',
    M03_SUPPORT_PRODUCT_WRITES_ENABLED:'true'});
  const issue=async(o,i)=>{
    const env=ctx(o),r=await requestSupportEditGrant(env,{
      readGrantOperationId:grants[i],writeGrantOperationId:crypto.randomUUID(),
      scope:'products',reason:'Correct a product from support ticket',
      otpCode:code(),sessionToken:S
    });
    assert.ok(r,'fresh MFA and the exact Shop grant are required');
    return {env,r};
  };
  return {...f,db,ctx,issue,grants};
}
test('support product uses real Owner receipt trigger, separate actor and exact Shop D1',async t=>{
  const f=await fixture(t),{env,r}=await f.issue(f.ownerA,0);
  const input=draft('Support wrench');
  const disabled=await createSupportProduct({...env,M03_SUPPORT_PRODUCT_WRITES_ENABLED:'false'},{
    grantId:r.grantId,sessionToken:S,input});
  assert.equal(disabled.status,'denied');
  const saved=await createSupportProduct(env,{grantId:r.grantId,sessionToken:S,input});
  assert.equal(saved.status,'created');
  assert.equal(saved.id,'PRD-000001');
  assert.equal((await f.SHOP_A_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
  assert.equal((await f.SHOP_B_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
  assert.equal((await f.SHOP_A_DB.prepare('SELECT actor_id FROM owner_product_create_receipts').first()).actor_id,'support:fixture-admin');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM m03_support_write_events WHERE event_type='RESULT'").first()).n,1);
  assert.equal((await createSupportProduct(env,{grantId:r.grantId,sessionToken:S,input})).status,'replayed');
  assert.equal((await f.SHOP_A_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
});

test('cross-Shop grant, altered payload, nonzero opening stock and direct Support SQL are denied',async t=>{
  const f=await fixture(t),{env,r}=await f.issue(f.ownerA,0);
  const input=draft('Support-only drill');
  assert.equal((await createSupportProduct(f.ctx(f.ownerB),{
    grantId:r.grantId,sessionToken:S,input})).status,'denied');
  assert.equal((await createSupportProduct(env,{
    grantId:r.grantId,sessionToken:S,input:{...input,stock:'8'}})).status,'invalid');
  assert.equal((await createSupportProduct(env,{
    grantId:r.grantId,sessionToken:S,input})).status,'created');
  assert.equal((await createSupportProduct(env,{
    grantId:r.grantId,sessionToken:S,
    input:{...input,name:'Tampered post-approval'}})).status,'denied');
  await assert.rejects(f.SHOP_A_DB.prepare(`INSERT INTO owner_product_create_receipts
    (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
    VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),'support:fixture-admin',
    'a'.repeat(64),'forged','{}',Date.now()).run(),/support/i);
  assert.equal((await f.SHOP_A_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
  assert.equal((await f.SHOP_B_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
});
test('ending Support before the Product write denies even a previously approved grant',async t=>{
  const f=await fixture(t),{env,r}=await f.issue(f.ownerA,0);
  await f.db.prepare('UPDATE m03_local_support_grants SET revoked_at_ms=? WHERE operation_id=?')
    .bind(Date.now(),f.grants[0]).run();
  assert.equal((await createSupportProduct(env,{
    grantId:r.grantId,sessionToken:S,input:draft('Blocked after End Support')})).status,'denied');
  assert.equal((await f.SHOP_A_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
});
test('the original Owner still creates a Product with its separate lease',async t=>{
  const f=await fixture(t);
  const {createOwnerProduct}=await import('../../src/db/m03-owner-product-create.js');
  const e=f.ownerA.env;
  const s={shopDb:f.SHOP_A_DB,shopId:e.PLATFORM_PILOT_SHOP_ID,
    databaseId:e.PLATFORM_PILOT_D1_ID,databaseMarker:e.PLATFORM_PILOT_MARKER};
  const result=await createOwnerProduct(s,{
    token:f.ownerA.token,ownerSubject:'fixture-owner-a',input:draft('Original Owner item')});
  assert.equal(result.status,'created');
  assert.equal((await f.SHOP_A_DB.prepare('SELECT actor_id FROM owner_product_create_receipts').first()).actor_id,
    'google:fixture-owner-a');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM m03_support_write_events').first()).n,0);
});

test('SQL-time permit seals exact Product payload and cannot be edited or deleted',async t=>{
  const f=await fixture(t);
  const env=f.ownerA.env,DB=f.SHOP_A_DB,id=crypto.randomUUID();
  const p=draft('Original sealed drill',id);
  const payload={name:p.name,brand:'',category:'Uncategorized',unit:'pcs',
    barcode:'',purchasePrice:p.purchasePrice,sellingPrice:p.sellingPrice,minStock:'0'};
  const serialized=JSON.stringify(payload),now=Date.now();
  await DB.prepare(`INSERT INTO shop_support_product_permits
    (intent_id,grant_id,operation_id,shop_id,database_id,database_marker,
     actor_id,name_key,payload,intent_hash,issued_at_ms,expires_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,crypto.randomUUID(),id,env.PLATFORM_PILOT_SHOP_ID,
      env.PLATFORM_PILOT_D1_ID,env.PLATFORM_PILOT_MARKER,
      'support:fixture-admin',p.name.toLowerCase(),serialized,
      'a'.repeat(64),now,now+300000).run();
  await assert.rejects(DB.prepare(`INSERT INTO owner_product_create_receipts
    (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
    VALUES(?,?,?,?,?,?)`).bind(id,'support:fixture-admin','a'.repeat(64),
    p.name.toLowerCase(),JSON.stringify({...payload,sellingPrice:'99.99'}),now).run(),/Support Product permit/i);
  await assert.rejects(DB.prepare('UPDATE shop_support_product_permits SET name_key=? WHERE intent_id=?')
    .bind('forged',id).run(),/immutable Support Product permit/i);
  await assert.rejects(DB.prepare('DELETE FROM shop_support_product_permits WHERE intent_id=?')
    .bind(id).run(),/immutable Support Product permit/i);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM products').first()).n,0);
});
