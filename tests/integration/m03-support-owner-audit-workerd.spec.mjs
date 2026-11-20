/** M03 Owner support audit: real Workerd/Control D1 and two distinct physical Shop D1s. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import ownerWorker from '../../src/m03-owner-redemption-worker.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {
  LOCAL_SUPPORT_READ_DDL,issueLocalSupportReadGrant,
  authorizeLocalSupportRead,revokeLocalSupportReadGrant,
} from '../../src/modules/m03-local-support-read-grants.js';
import {readOwnerSupportAudit} from '../../src/auth/m03-support-owner-audit.js';

const ADMIN='1'.repeat(64),ownerTokens=['3'.repeat(64),'4'.repeat(64)];
const ADMIN_ORIGIN='https://platform.example.test',OWNER_ORIGINS=[
  'https://owner-a.example.test','https://owner-b.example.test',
];
const reason='Investigate the catalog for an authorized support request';

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SUPPORT_OWNER_A','SUPPORT_OWNER_B'].map((binding,i)=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),
    databaseMarker:crypto.randomUUID(),subject:'owner-google-'+i,
  }));
  config.d1_databases.push(...shops.map(s=>({
    binding:s.binding,database_id:s.databaseId,
    database_name:'m03-owner-audit-'+s.binding.toLowerCase(),remote:false,
  })));
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv(),db=env.CONTROL_DB;
  async function apply(d1,path){
    const sql=await readFile(path,'utf8');
    await d1.batch(unstable_splitSqlQuery(sql).map(stmt=>d1.prepare(stmt)));
  }
  for(const file of ['0001_shop_reservations','0002_shop_bindings',
    '0003_owner_invitations','0004_first_shop_owner','0005_owner_sessions']){
    await apply(db,'staging-migrations/platform-onboarding/'+file+'.sql');
  }
  const now=Date.now();
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),'https://accounts.google.com','admin-subject',now-1000,now+599000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','admin-subject','a'.repeat(64),now-900),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind('c'.repeat(64),now-400),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?)`)
      .bind(await hashOpaqueSessionToken(ADMIN),'c'.repeat(64),now-200,now+60000),
  ]);
  for(const [i,s] of shops.entries()){
    await apply(env[s.binding],'staging-migrations/shop-identity/0001_shop_identity.sql');
    await env[s.binding].prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker).run();
    await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(s.shopId,crypto.randomUUID(),'Shop '+i,'admin-subject',now-200).run();
    await db.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker,'admin-subject',now-180).run();
    const inviteHash=String(i+7).repeat(64);
    await db.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)')
      .bind(inviteHash,s.shopId,'https://accounts.google.com',s.subject,
        'admin-subject',now-150,now+599000).run();
    await db.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)')
      .bind(s.shopId,inviteHash,'https://accounts.google.com',s.subject,now-130).run();
    await db.prepare('INSERT INTO platform_shop_owner_sessions (shop_id,token_hash,issued_at_ms) VALUES (?,?,?)')
      .bind(s.shopId,await hashOpaqueSessionToken(ownerTokens[i]),now-100).run();
  }
  for(const sql of LOCAL_SUPPORT_READ_DDL)await db.prepare(sql).run();
  const scope=i=>({...shops[i],shopDb:env[shops[i].binding]});
  const support=async i=>{
    const grant=await issueLocalSupportReadGrant(db,scope(i),{
      operationId:crypto.randomUUID(),reason,sessionToken:ADMIN,
    });
    assert.equal(grant.status,'created');
    return grant;
  };
  const audit=async i=>(await db.prepare(
    'SELECT event_type,shop_id FROM m03_local_support_events WHERE shop_id=? ORDER BY rowid'
  ).bind(shops[i].shopId).all()).results;
  function ownerEnv(i,enabled=true){
    const s=shops[i];
    return {
      CONTROL_DB:db,PLATFORM_PILOT_DB:env[s.binding],
      PLATFORM_PILOT_SHOP_ID:s.shopId,PLATFORM_PILOT_D1_ID:s.databaseId,
      PLATFORM_PILOT_MARKER:s.databaseMarker,OWNER_AUTH_ORIGIN:OWNER_ORIGINS[i],
      PLATFORM_AUTH_ORIGIN:ADMIN_ORIGIN,PLATFORM_OWNER_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{async limit(){return {success:true};}},
      OWNER_LOGIN_ENABLED:'true',
      ...(enabled?{OWNER_SUPPORT_AUDIT_ENABLED:'true'}:{}),
    };
  }
  async function request(i,token=ownerTokens[i],environment=ownerEnv(i),path='/api/owner/support/audit'){
    const response=await ownerWorker.request(OWNER_ORIGINS[i]+path,{
      method:'GET',headers:{Cookie:'__Host-shererp-owner-session='+token},
    },environment);
    return {status:response.status,body:await response.json().catch(()=>({}))};
  }
  return {db,env,shops,scope,support,audit,ownerEnv,request,now};
}

test('Owner support audit endpoint stays 404 by default and no public routing is activated',async t=>{
  const x=await fixture(t);
  const a=await x.support(0);
  assert.equal((await x.request(0,ownerTokens[0],x.ownerEnv(0,false))).status,404);
  assert.equal((await x.request(0,ownerTokens[0],{
    ...x.ownerEnv(0,false),OWNER_SUPPORT_AUDIT_ENABLED:'false',
  })).status,404);
  assert.equal((await x.request(0,ownerTokens[0],x.ownerEnv(0),'/api/owner/support/audit?shopId='+
    x.shops[1].shopId)).status,400,'no query-selected tenants');
  assert.equal((await x.audit(0)).length,1,'reads do not mutate support audit');
  assert.equal(a.status,'created');
});

test('each active Owner sees only own START/READ/END receipts, redacted reason and actor',async t=>{
  const x=await fixture(t);
  const a=await x.support(0);
  assert.deepEqual(await authorizeLocalSupportRead(x.db,x.scope(0),{
    eventId:crypto.randomUUID(),sessionToken:ADMIN,supportToken:a.supportToken,
  }),{status:'allowed'});
  assert.deepEqual(await revokeLocalSupportReadGrant(x.db,x.scope(0),{
    operationId:a.operationId,sessionToken:ADMIN,
  }),{status:'revoked'});
  const b=await x.support(1);
  const ownerA=await x.request(0),ownerB=await x.request(1);
  assert.equal(ownerA.status,200);
  assert.equal(ownerB.status,200);
  assert.equal(ownerA.body.events.length,3);
  assert.deepEqual(ownerA.body.events.map(e=>e.eventType),['END','READ','START']);
  assert.equal(ownerB.body.events.length,1);
  assert.equal(ownerB.body.events[0].eventType,'START');
  assert.equal(ownerA.body.events[0].operationId,a.operationId);
  assert.equal(ownerB.body.events[0].operationId,b.operationId);
  assert.equal(ownerA.body.events[0].reason,reason);
  assert.equal(ownerA.body.events[0].actor,'Platform Super Admin');
  for(const body of [ownerA.body,ownerB.body]){
    const serialized=JSON.stringify(body);
    for(const secret of ['admin-subject','owner-google','token_hash','databaseId',
      'databaseMarker',a.supportToken,b.supportToken,ownerTokens[0],ownerTokens[1]]){
      assert.equal(serialized.includes(secret),false,secret);
    }
  }
  assert.deepEqual((await x.audit(0)).map(x=>x.event_type),['START','READ','END']);
});

test('valid Owner with no support events has honest empty list',async t=>{
  const x=await fixture(t);
  const response=await x.request(1);
  assert.equal(response.status,200);
  assert.deepEqual(response.body,{events:[]});
});

test('wrong Shop, revoked, disabled and SQL-expired Owner sessions fail closed',async t=>{
  const x=await fixture(t);
  await x.support(0);
  assert.equal((await x.request(0,ownerTokens[1])).status,401);
  assert.equal((await x.request(1,ownerTokens[0])).status,401);
  assert.equal((await x.request(0,'f'.repeat(64))).status,401);
  const wrong={...x.ownerEnv(0),PLATFORM_PILOT_DB:x.env[x.shops[1].binding]};
  assert.equal((await x.request(0,ownerTokens[0],wrong)).status,401);
  await x.db.prepare('UPDATE platform_shop_owner_sessions SET issued_at_ms=? WHERE shop_id=?')
    .bind(x.now-13*60*60*1000,x.shops[0].shopId).run();
  assert.equal((await x.request(0)).status,401);
  await x.db.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
    .bind(x.shops[1].shopId).run();
  assert.equal((await x.request(1)).status,401);
  assert.equal((await x.audit(0)).length,1,'failed Owner reads cannot mutate admin audit');
});

test('audit schema missing fails unavailable, never silently reports zero support activity',async t=>{
  const x=await fixture(t);
  await x.db.prepare('DROP TABLE m03_local_support_events').run();
  const result=await x.request(0);
  assert.equal(result.status,503);
  assert.equal(result.body.error,'Support audit unavailable');
});
