
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import platform from '../../src/m03-private-platform-auth-worker.js';
import owner from '../../src/m03-owner-redemption-worker.js';
import {beginFirstOwnerGmailLogin,loginFirstOwnerWithGmail} from '../../src/auth/platform-owner-gmail-login.js';
import {validateOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {applyLocalShopMigrations,shopMigrationPlan} from '../fixtures/port-p2-local-shop-migrations.mjs';
import {makeSignedGmailOwnerToken,ownerJwk} from '../fixtures/m03-clean-shop-owner-jwt.mjs';

const adminOrigin='https://platform.example.test';
const ownerOrigin='https://owner.example.test';
const issuer='https://accounts.google.com';
const clientId='123456-example.apps.googleusercontent.com';
const controlFiles=[
  '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
  '0004_first_shop_owner','0005_owner_sessions','0006_owner_login_challenges',
  '0007_owner_gmail_approvals','0008_owner_gmail_challenges',
  '0011_control_center_provisioning'
];
const appStatus=async(response,expected)=>{
  assert.equal(response.status,expected);
  return response.json();
};
async function migrate(db,path){
  const sql=await readFile(path,'utf8');
  return db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
}

test('two newly provisioned local businesses require exact signed Owner Gmail before isolated first-product write',async t=>{
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const inventory=['SHOP_A_DB','SHOP_B_DB'].map(binding=>({binding,id:crypto.randomUUID()}));
  for(const target of inventory)config.d1_databases.push({
    binding:target.binding,database_id:target.id,database_name:target.binding.toLowerCase(),remote:false
  });
  const harness=createTestHarness({workers:[{
    config:{...config,vars:{...config.vars,
      PLATFORM_SHOP_RESERVATION_ENABLED:'true',
      PLATFORM_LOCAL_PROVISIONING_ENABLED:'true',PLATFORM_LOCAL_SHOP_INVENTORY:inventory,
    }}
  }]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv(),db=env.CONTROL_DB;
  for(const name of controlFiles)await migrate(db,'staging-migrations/platform-onboarding/'+name+'.sql');
  for(const name of ['0009_owner_session_generation','0010_owner_grant_claim']){
    await migrate(db,'staging-migrations/platform-owner-write/'+name+'.sql');
  }
  const adminToken='1'.repeat(64),now=Date.now();
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),issuer,'fixture-admin',now-1000,now+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind(issuer,'fixture-admin','a'.repeat(64),now-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind('c'.repeat(64),now-200),
    db.prepare('INSERT INTO platform_admin_sessions (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms) VALUES (?,?,1,1,1,?,?)')
      .bind(await hashOpaqueSessionToken(adminToken),'c'.repeat(64),now-100,now+60000)
  ]);
  const receipts=new Map();
  let creates=0;
  const provider={
    async createDatabase(action){
      const binding=inventory[creates++];
      assert.ok(binding,'cannot create an extra Shop D1');
      const result={...action,id:binding.id,binding:binding.binding,evidenceRef:'synthetic-provider-'+creates};
      receipts.set(action.attemptId,result);
      return result;
    },
    async findCreation(action){return receipts.get(action.attemptId);},
    async verifyTarget(scope,dbHandle){
      return inventory.some(item=>scope.binding===item.binding&&scope.databaseId===item.id&&dbHandle===env[item.binding]);
    },
    async prepareShop(scope){await applyLocalShopMigrations(env[scope.binding],scope);}
  };
  const platformEnv={...env,PLATFORM_LOCAL_SHOP_INVENTORY:inventory,
    PLATFORM_LOCAL_SHOP_PROVIDER:provider,PLATFORM_LOCAL_SHOP_MIGRATIONS:shopMigrationPlan,
    PLATFORM_SHOP_RESERVATION_ENABLED:'true',PLATFORM_LOCAL_PROVISIONING_ENABLED:'true',
    PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:adminOrigin,
    PLATFORM_CLIENT_ID:clientId,PLATFORM_INGRESS:{limit:async()=>({success:true})}};
  const adminRequest=(path,body)=>platform.request(adminOrigin+'/api/platform'+path,{
    method:'POST',headers:{origin:adminOrigin,'Content-Type':'application/json',
      Cookie:'__Host-shererp-platform-session='+adminToken},body:JSON.stringify(body)
  },platformEnv);
  const claims=[
    {name:'Shop A',email:'fixture.a@gmail.com',subject:'fixture-owner-a'},
    {name:'Shop B',email:'fixture.b@gmail.com',subject:'fixture-owner-b'}
  ];
  for(const claim of claims){
    claim.operationId=crypto.randomUUID();
    const intent={operationId:claim.operationId,displayName:claim.name,ownerEmail:claim.email};
    const setup=await appStatus(await adminRequest('/shops',intent),202);
    assert.equal(setup.status,'reserved');
    claim.shopId=setup.shopId;
    const result=await appStatus(await adminRequest('/shops/resume',{operationId:claim.operationId}),200);
    assert.equal(result.status,'ready');
    assert.equal(result.shopId,setup.shopId);
  }
  assert.equal(creates,2);
  assert.notEqual(claims[0].shopId,claims[1].shopId);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_first_shop_owners').first()).n,0,
    'business Ready means approved Gmail but NOT automatically authenticated Owner');

  // Product/Owner-write migrations are release-candidate fixtures, never
  // part of the private provisioning deployment flags.
  for(const item of inventory){
    const shopDb=env[item.binding];
    for(const path of [
      'migrations/0013_product_catalog_revisions.sql',
      'staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql',
      'staging-migrations/shop-owner-write/0003_owner_product_create_receipts.sql'
    ])await migrate(shopDb,path);
  }
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');
    assert.equal(options.redirect,'manual');
    return Response.json({keys:[ownerJwk]});
  });
  const ownerSessions=[];
  for(const [index,claim] of claims.entries()){
    const binding=inventory[index];
    const ownerEnv={...env,
      PLATFORM_PILOT_DB:env[binding.binding],PLATFORM_PILOT_SHOP_ID:claim.shopId,
      PLATFORM_PILOT_D1_ID:binding.id,
      PLATFORM_PILOT_MARKER:(await db.prepare('SELECT database_marker FROM platform_shop_provisioning WHERE shop_id=?')
        .bind(claim.shopId).first()).database_marker,
      OWNER_AUTH_ORIGIN:ownerOrigin,PLATFORM_AUTH_ORIGIN:adminOrigin,
      PLATFORM_OWNER_CLIENT_ID:clientId,OWNER_INGRESS:{limit:async()=>({success:true})},
      OWNER_LOGIN_ENABLED:'true',OWNER_GMAIL_SIGNUP_ENABLED:'true',
      OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_WRITE_GRANTS_ENABLED:'true'
    };
    const challenge=await beginFirstOwnerGmailLogin(ownerEnv);
    assert.ok(challenge?.browserToken&&challenge?.nonce);
    const wrong=makeSignedGmailOwnerToken({
      nonce:challenge.nonce,clientId,subject:claim.subject,email:'someone.else@gmail.com'
    });
    assert.equal(await loginFirstOwnerWithGmail(ownerEnv,{
      browserToken:challenge.browserToken,credential:wrong
    }),null,'same valid Google subject with wrong Gmail cannot claim Owner');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_first_shop_owners').first()).n,index);
    const verified=makeSignedGmailOwnerToken({
      nonce:challenge.nonce,clientId,subject:claim.subject,email:claim.email
    });
    const token=await loginFirstOwnerWithGmail(ownerEnv,{
      browserToken:challenge.browserToken,credential:verified
    });
    assert.equal(typeof token,'string');
    assert.deepEqual(await validateOwnerSession(ownerEnv,token),{shopId:claim.shopId,role:'Owner'});
    ownerSessions.push({env:ownerEnv,token});
    assert.equal(await beginFirstOwnerGmailLogin(ownerEnv),null,
      'first-Owner signup cannot be reopened after successful claim');
  }
  const makeProduct=(name)=>({
    operationId:crypto.randomUUID(),name,brand:'',category:'',unit:'pcs',
    purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',
    minStock:'0',barcode:'',productType:'Standard',components:[]
  });
  const writeProduct=(env,token,payload)=>owner.request(ownerOrigin+'/api/owner/catalog',{
    method:'POST',headers:{Origin:ownerOrigin,'Content-Type':'application/json',
      Cookie:'__Host-shererp-owner-session='+token},body:JSON.stringify(payload)
  },env);
  const [a,b]=ownerSessions,productA=makeProduct('Fixture wrench A'),productB=makeProduct('Fixture wrench B');
  assert.equal((await writeProduct(b.env,a.token,productB)).status,401,'Owner A cannot act in Shop B');
  assert.equal((await writeProduct(a.env,b.token,productA)).status,401,'Owner B cannot act in Shop A');
  const firstA=await appStatus(await writeProduct(a.env,a.token,productA),201);
  assert.equal(firstA.data.id,'PRD-000001');
  assert.deepEqual(await appStatus(await writeProduct(a.env,a.token,productA),200),firstA);
  assert.equal((await writeProduct(a.env,a.token,{...productA,name:'Changed'})).status,409);
  const firstB=await appStatus(await writeProduct(b.env,b.token,productB),201);
  assert.equal(firstB.data.id,'PRD-000001');
  assert.equal((await env.SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
  assert.equal((await env.SHOP_B_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
  assert.equal((await env.SHOP_A_DB.prepare('SELECT count(*) AS n FROM owner_product_create_receipts').first()).n,1);
  assert.equal((await env.SHOP_B_DB.prepare('SELECT count(*) AS n FROM owner_product_create_receipts').first()).n,1);
  const catalog=async(env,token)=>owner.request(ownerOrigin+'/api/owner/catalog',{
    headers:{Cookie:'__Host-shererp-owner-session='+token}
  },env);
  assert.equal((await catalog(b.env,a.token)).status,401);
  assert.deepEqual((await appStatus(await catalog(a.env,a.token),200)).data.map(row=>row.productId),['PRD-000001']);
  assert.deepEqual((await appStatus(await catalog(b.env,b.token),200)).data.map(row=>row.productId),['PRD-000001']);
  assert.notDeepEqual(
    (await env.SHOP_A_DB.prepare('SELECT product_name FROM products').first()).product_name,
    (await env.SHOP_B_DB.prepare('SELECT product_name FROM products').first()).product_name
  );
  await env.SHOP_A_DB.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
  assert.equal((await writeProduct(a.env,a.token,makeProduct('After revoke'))).status,403);
  assert.equal((await writeProduct(b.env,b.token,makeProduct('Unrelated Owner still active'))).status,201);
});
