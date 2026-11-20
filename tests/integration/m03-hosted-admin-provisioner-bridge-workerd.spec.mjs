import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import platform from '../../src/m03-private-platform-auth-worker.js';
import {createPrivateShopProvisioner} from '../../src/m03-private-shop-provisioner-worker.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const origin='https://platform.example.test';
const account='0123456789abcdef0123456789abcdef';
const key='K'.repeat(64);
const token='1'.repeat(64);
const uuid=()=>crypto.randomUUID();

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.d1_databases[0].database_id=uuid();
  const server=createTestHarness({workers:[{config}]});
  t.after(()=>server.close());
  await server.listen();
  const worker=server.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv();
  const db=env.CONTROL_DB;
  for(const migration of ['0001_shop_reservations','0002_shop_bindings',
    '0003_owner_invitations','0004_first_shop_owner','0007_owner_gmail_approvals',
    '0011_control_center_provisioning','0012_hosted_shop_provisioning_journal']){
    const sql=await readFile('staging-migrations/platform-onboarding/'+migration+'.sql','utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
  const now=Date.now(),browser='c'.repeat(64),setup='a'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(setup,'b'.repeat(43),'https://accounts.google.com','fixture-admin',now-1000,now+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','fixture-admin',setup,now-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(browser,'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(browser,now-100),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`).bind(await hashOpaqueSessionToken(token),browser,now-100,now+60000)
  ]);
  let creates=0,forwards=0;
  const provisioner=createPrivateShopProvisioner({providerFactory:()=>({
    inspectAccount:async()=>({accountId:account,usedDatabases:1,maximumDatabases:10}),
    async createDatabase(action){creates++;return {
      ...action,id:uuid(),evidenceRef:'cf-d1:fixture-authorized'
    };},
    findCreation:async()=>null
  })});
  const privateEnv={
    CONTROL_DB:db,PROVISIONER_RELEASE_ENABLED:'true',
    PROVISIONER_INTERNAL_KEY:key,PROVISIONER_ALLOWED_ACCOUNT_ID:account,
    PROVISIONER_MAX_DATABASES:'10',CLOUDFLARE_API_TOKEN:'fixture-private-token-not-for-github'
  };
  const provisionerBinding={fetch(request){forwards++;return provisioner.fetch(request,privateEnv);}};
  const base={...env,PLATFORM_SHOP_RESERVATION_ENABLED:'true',
    PLATFORM_SHOP_DIRECTORY_ENABLED:'true',PLATFORM_PRIVATE_PROVISIONER_ENABLED:'true',
    PLATFORM_PRIVATE_PROVISIONER:provisionerBinding,PLATFORM_PROVISIONER_INTERNAL_KEY:key
  };
  const req=(path,body,patch={},session=token)=>platform.request(
    origin+'/api/platform'+path,body?{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
        Cookie:'__Host-shererp-platform-session='+session},
      body:JSON.stringify(body)
    }:{headers:{Cookie:'__Host-shererp-platform-session='+session}},
    {...base,...patch}
  );
  return {req,db,base,counts:()=>({creates,forwards})};
}

test('existing Create Business and listing reuse private service with no public D1 receipts',async t=>{
  const {req,db,counts}=await fixture(t);
  const auth=await req('/auth/session');
  assert.equal(auth.status,200);
  const session=await auth.json();
  assert.equal(session.hostedProvisioningEnabled,true);
  assert.equal(session.shopDirectoryEnabled,true);
  const op={operationId:uuid(),displayName:'Second Tools',
    ownerEmail:'owner.second@gmail.com'};
  const first=await req('/shops',op);
  assert.equal(first.status,202);
  const created=await first.json();
  assert.deepEqual(created,{...op,shopId:created.shopId,status:'reserved',failedStage:null});
  assert.equal(created.databaseId,undefined);
  assert.equal((await req('/shops',op)).status,200);
  assert.equal((await req('/shops',{...op,ownerEmail:'wrong@gmail.com'})).status,409);
  const second={operationId:uuid(),displayName:'Third Tiles',ownerEmail:'owner.third@gmail.com'};
  assert.equal((await req('/shops',second)).status,202);
  assert.notEqual((await req('/shops/setup/'+op.operationId)).status,404);
  const listing=await req('/shops/list');
  assert.equal(listing.status,200);
  const shops=(await listing.json()).shops;
  assert.equal(shops.length,2);
  assert.equal(shops[0].status,'reserved');
  assert.equal(shops[1].status,'reserved');
  assert.equal(shops[0].databaseId,undefined);
  assert.deepEqual(counts(),{creates:0,forwards:4},
    'reservation and reads never create a real D1');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0);
});

test('Resume stays reserved until separately approved D1-create gate; never becomes Owner Ready',async t=>{
  const {req,counts,db}=await fixture(t);
  const op={operationId:uuid(),displayName:'No Premature Owner',ownerEmail:'fifth@gmail.com'};
  assert.equal((await req('/shops',op)).status,202);
  let result=await req('/shops/resume',{operationId:op.operationId});
  assert.equal(result.status,200);
  assert.equal((await result.json()).status,'reserved');
  assert.equal(counts().creates,0);
  result=await req('/shops/resume',{operationId:op.operationId},
    {PLATFORM_HOSTED_D1_CREATE_APPROVED:'true'});
  assert.equal(result.status,200);
  assert.equal((await result.json()).status,'allocated');
  assert.equal(counts().creates,1);
  result=await req('/shops/resume',{operationId:op.operationId},
    {PLATFORM_HOSTED_D1_CREATE_APPROVED:'true'});
  assert.equal((await result.json()).status,'allocated');
  assert.equal(counts().creates,1);
  const list=await req('/shops/list');
  assert.equal((await list.json()).shops[0].status,'allocated');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first()).n,0);
});

test('missing service, disabled release, hosted pilot, wrong key and revoked MFA fail closed',async t=>{
  const {req,counts,db,base}=await fixture(t);
  const op={operationId:uuid(),displayName:'Never Expose',ownerEmail:'owner.test@gmail.com'};
  for(const env of [
    {PLATFORM_PRIVATE_PROVISIONER_ENABLED:'false'},
    {PLATFORM_PRIVATE_PROVISIONER:null},
    {PLATFORM_PROVISIONER_INTERNAL_KEY:'bad'},
    {PLATFORM_HOSTED_PILOT_ENABLED:'true'},
    {PLATFORM_LOCAL_PROVISIONING_ENABLED:'true'},
    {PLATFORM_SHOP_RESERVATION_ENABLED:'false'}
  ]){
    const auth=await req('/auth/session',null,env);
    assert.equal((await auth.json()).hostedProvisioningEnabled,undefined);
    assert.notEqual((await req('/shops',op,env)).status,202);
  }
  assert.equal((await req('/shops',op,{},'0'.repeat(64))).status,401);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first()).n,0);
  const rejected=await req('/shops',{...op,databaseId:uuid()});
  assert.equal(rejected.status,400);
  assert.equal(counts().creates,0);
  assert.equal((await req('/shops',op)).status,202);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=?').bind(Date.now()).run();
  assert.equal((await req('/shops/resume',{operationId:op.operationId},
    {PLATFORM_HOSTED_D1_CREATE_APPROVED:'true'})).status,401);
  assert.equal(counts().creates,0);
  assert.equal((await req('/shops/list')).status,401);
});
