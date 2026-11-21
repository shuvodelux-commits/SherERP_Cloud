import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {revokeOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import worker from '../../src/m03-owner-redemption-worker.js';

const ORIGIN='https://owner.example.test';
const PATH='/api/owner/customers';
const migration='staging-migrations/shop-owner-write/0015_owner_customer_master.sql';
async function apply(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(query=>db.prepare(query)));
}
async function install(db){
  await apply(db,'migrations/0002_party_identity.sql');
  await apply(db,migration);
}
const sample=(name='Rahim Hardware',extra={})=>({
  operationId:crypto.randomUUID(),name,phone:'01712345678',
  fatherName:'',relationType:'Father',address:'',notes:'',openingBalance:'0',...extra,
});
function fixtureEnv(owner,overrides={}){
  return {...owner.env,OWNER_LOGIN_ENABLED:'true',OWNER_CLEAN_PRODUCTS_ENABLED:'true',
    OWNER_CUSTOMERS_ENABLED:'true',OWNER_AUTH_ORIGIN:ORIGIN,
    PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
    OWNER_INGRESS:{limit:async()=>({success:true})},...overrides};
}
function request(path,token,bindings,{body}={}){
  return worker.request(ORIGIN+path,{
    method:body?'POST':'GET',
    headers:{Cookie:'__Host-shererp-owner-session='+token,
      ...(body?{Origin:ORIGIN,'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})
  },bindings);
}

test('Customer D1 create is one Party Customer role, zero financial opening, exact replay and explicit duplicate phone IDs',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);
    const envA=fixtureEnv(ownerA),envB=fixtureEnv(ownerB);
    const first=sample();
    assert.equal((await request(PATH,ownerA.token,fixtureEnv(ownerA,{OWNER_CUSTOMERS_ENABLED:'false'}))).status,404);
    assert.deepEqual(await (await request(PATH,ownerA.token,envA)).json(),
      {success:true,data:{customers:[],bankAccounts:[],currencySymbol:''}});
    const created=await request(PATH,ownerA.token,envA,{body:first});
    assert.equal(created.status,201);
    assert.deepEqual(await created.json(),{success:true,data:{id:'CUS-000001'}});
    assert.deepEqual(await (await request(PATH,ownerA.token,envA,{body:first})).json(),
      {success:true,data:{id:'CUS-000001'}});
    assert.equal((await request(PATH,ownerA.token,envA,{body:{...first,name:'Changed'}})).status,409);
    assert.equal((await request(PATH,ownerA.token,envA,{body:sample('Other buyer')})).status,201);
    const listed=await (await request(PATH,ownerA.token,envA)).json();
    assert.deepEqual(listed.data.customers.map(x=>[
      x['Customer ID'],x['Customer Name'],x.Phone,x['Opening Balance'],x['Current Due']
    ]),[
      ['CUS-000001','Rahim Hardware','01712345678',0,0],
      ['CUS-000002','Other buyer','01712345678',0,0]
    ]);
    assert.equal((await request(PATH,ownerB.token,envB,{body:sample()})).status,201);
    assert.deepEqual((await (await request(PATH,ownerB.token,envB)).json()).data.customers.map(x=>x['Customer ID']),['CUS-000001']);
    assert.equal((await a.prepare("SELECT count(*) n FROM party_roles WHERE role='Customer'").first()).n,2);
    assert.equal((await a.prepare('SELECT count(*) n FROM parties').first()).n,2);
    assert.equal((await a.prepare('SELECT count(*) n FROM owner_customer_create_receipts').first()).n,2);
    assert.deepEqual((await a.prepare('SELECT party_id FROM owner_customer_master ORDER BY customer_id').all()).results.map(x=>x.party_id),[
      'PTY-CUS-000001','PTY-CUS-000002'
    ]);
    assert.equal((await a.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name LIKE 'owner_customer_%cash%'").first()).n,0);
    assert.equal((await a.prepare('SELECT count(*) n FROM party_legacy_links').first()).n,0);
  }finally{await close();}
});

test('Customer D1 strict validation, expired write grants, revoked sessions and cross-Shop isolation',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await install(a);await install(b);
    const env=fixtureEnv(ownerA),envB=fixtureEnv(ownerB);
    for(const bad of [sample('No phone',{phone:''}),sample('Nonzero',{openingBalance:'-50'}),
      sample('Nonzero due',{openingBalance:'4.00'}),sample('Invalid ID',{operationId:'bad'}),
      sample('Injected',{unknown:'x'}),sample('Control',{name:'\u0001'})]){
      assert.equal((await request(PATH,ownerA.token,env,{body:bad})).status,400);
    }
    assert.equal((await request(PATH,ownerB.token,env)).status,401);
    assert.equal((await request(PATH,ownerA.token,envB)).status,401);
    await a.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.equal((await request(PATH,ownerA.token,env,{body:sample('Expired')})).status,403);
    assert.equal((await a.prepare('SELECT count(*) n FROM parties').first()).n,0);
    assert.equal((await a.prepare('SELECT count(*) n FROM owner_customer_create_receipts').first()).n,0);
    assert.equal(await revokeOwnerSession(ownerA.env,ownerA.token),true);
    assert.equal((await request(PATH,ownerA.token,env,{body:sample('Revoked owner')})).status,401);
    assert.equal((await request(PATH,ownerB.token,envB,{body:sample('Authorized B')})).status,201);
  }finally{await close();}
});

test('Customer migration preserves independent Supplier Party and refuses ambiguous prior Customer roles',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await apply(a,'migrations/0002_party_identity.sql');
    await apply(a,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
    await apply(a,migration);
    const supplied=await createOwnerSupplier(pilotShopConfiguration(ownerA.env),{
      token:ownerA.token,ownerSubject:ownerA.env.PLATFORM_PILOT_SHOP_ID,
      input:{operationId:crypto.randomUUID(),name:'Independent Supplier',phone:'01712345678',
        address:'',notes:'',openingBalance:'0'}
    });
    assert.equal(supplied.status,'created');
    const env=fixtureEnv(ownerA);
    assert.equal((await request(PATH,ownerA.token,env,{body:sample('Shop Customer')})).status,201);
    assert.equal((await a.prepare("SELECT count(*) n FROM party_roles WHERE role='Customer'").first()).n,1);
    assert.equal((await a.prepare("SELECT count(*) n FROM party_roles WHERE role='Supplier'").first()).n,1);
    assert.equal((await a.prepare('SELECT COUNT(*) n FROM parties').first()).n,2);
  }finally{await close();}
  const second=await startCleanShopHarness();
  try{
    await apply(second.SHOP_A_DB,'migrations/0002_party_identity.sql');
    await second.SHOP_A_DB.prepare("INSERT INTO parties(party_id,display_name,created_at) VALUES('OLD-PARTY','Legacy Customer','2026-11-21')").run();
    await second.SHOP_A_DB.prepare("INSERT INTO party_roles(party_id,role,created_at) VALUES('OLD-PARTY','Customer','2026-11-21')").run();
    await assert.rejects(apply(second.SHOP_A_DB,migration),/CHECK|constraint|preflight/i);
    assert.equal((await second.SHOP_A_DB.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='owner_customer_create_receipts'").first()).n,0);
  }finally{await second.close();}
});

test('Customer API joins source POS bootstrap only when private Shop Customer capability is enabled',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await install(a);
    await apply(a,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
    await apply(a,'staging-migrations/shop-owner-write/0006_owner_mvp_credit_purchase.sql');
    const env=fixtureEnv(ownerA,{OWNER_MVP_PURCHASE_ENABLED:'true',OWNER_MVP_POS_CASH_ENABLED:'true'});
    assert.equal((await request(PATH,ownerA.token,env,{body:sample('POS verified customer')})).status,201);
    const endpoint=await request('/api/owner/pos/bootstrap',ownerA.token,env);
    assert.equal(endpoint.status,200);
    const payload=await endpoint.json();
    assert.equal(payload.success,true);
    assert.deepEqual(payload.data.customers,[{id:'CUS-000001',name:'POS verified customer',
      phone:'01712345678',fatherName:'',relationType:'Father',address:'',currentDue:0}]);
    const disabled=await request('/api/owner/pos/bootstrap',ownerA.token,
      {...env,OWNER_CUSTOMERS_ENABLED:'false'});
    assert.equal(disabled.status,200);
    assert.deepEqual((await disabled.json()).data.customers,[]);
  }finally{await close();}
});

test('a D1 trigger failure in Customer role insert leaves no orphan Party, Customer or receipt',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await install(a);
    await a.prepare(`CREATE TRIGGER deny_customer_role BEFORE INSERT ON party_roles
      WHEN NEW.role='Customer' BEGIN SELECT RAISE(ABORT,'M03_TEST_CUSTOMER_ROLE_FAILURE'); END`).run();
    const env=fixtureEnv(ownerA),input=sample('Atomic test customer');
    assert.equal((await request(PATH,ownerA.token,env,{body:input})).status,503);
    for(const table of ['parties','party_roles','owner_customer_master','owner_customer_create_receipts']){
      assert.equal((await a.prepare('SELECT count(*) AS n FROM '+table).first()).n,0,table);
    }
    await a.prepare('DROP TRIGGER deny_customer_role').run();
    assert.equal((await request(PATH,ownerA.token,env,{body:input})).status,201);
    assert.equal((await a.prepare('SELECT count(*) AS n FROM owner_customer_master').first()).n,1);
  }finally{await close();}
});
