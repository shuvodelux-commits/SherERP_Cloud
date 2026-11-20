/**
 * Real disposable Workerd/D1 integration, NO deployed support API.
 * The Admin credential is always an existing MFA-authenticated Control D1 session.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {
  LOCAL_SUPPORT_READ_DDL,issueLocalSupportReadGrant,
  authorizeLocalSupportRead,revokeLocalSupportReadGrant,
} from '../../src/modules/m03-local-support-read-grants.js';

const ADMIN_TOKEN='1'.repeat(64);
const OTHER_SESSION='2'.repeat(64);
const reason='Investigate a Shop invoice display problem';
const issuer='https://accounts.google.com';

async function localContext(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SHOP_A_DB','SHOP_B_DB'].map(binding=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),databaseMarker:crypto.randomUUID(),
  }));
  for(const item of shops)config.d1_databases.push({
    binding:item.binding,database_id:item.databaseId,
    database_name:'m03-support-'+item.binding.toLowerCase(),remote:false,
  });
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv();
  const db=env.CONTROL_DB;
  for(const path of [
    'staging-migrations/platform-onboarding/0001_shop_reservations.sql',
    'staging-migrations/platform-onboarding/0002_shop_bindings.sql',
  ]){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  }
  const now=Date.now();
  const ADMIN_HASH=await hashOpaqueSessionToken(ADMIN_TOKEN);
  const ONE_HASH=await hashOpaqueSessionToken(OTHER_SESSION);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),issuer,'fixture-admin',now-2000,now+598000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind(issuer,'fixture-admin','a'.repeat(64),now-1500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?),(?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+600000,'e'.repeat(64),'f'.repeat(43),now+600000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?),(?,?)')
      .bind('c'.repeat(64),now-700,'e'.repeat(64),now-700),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?),(?,?,1,1,2,?,?)`)
      .bind(ADMIN_HASH,'c'.repeat(64),now-400,now+600000,
        ONE_HASH,'e'.repeat(64),now-400,now+600000),
  ]);
  for(const item of shops){
    const sql=await readFile('staging-migrations/shop-identity/0001_shop_identity.sql','utf8');
    await env[item.binding].batch(unstable_splitSqlQuery(sql).map(stmt=>env[item.binding].prepare(stmt)));
    await env[item.binding].prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(item.shopId,item.databaseId,item.databaseMarker).run();
    await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(item.shopId,crypto.randomUUID(),'Fixture '+item.binding,'fixture-admin',now-200).run();
    await db.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(item.shopId,item.databaseId,item.databaseMarker,'fixture-admin',now-100).run();
  }
  for(const sql of LOCAL_SUPPORT_READ_DDL)await db.prepare(sql).run();
  const scope=i=>({...shops[i],shopDb:env[shops[i].binding]});
  const issue=(i=0,override={})=>issueLocalSupportReadGrant(db,scope(i),{
    operationId:crypto.randomUUID(),reason,sessionToken:ADMIN_TOKEN,...override,
  });
  const read=(i,grant,override={})=>authorizeLocalSupportRead(db,scope(i),{
    eventId:crypto.randomUUID(),sessionToken:ADMIN_TOKEN,
    supportToken:grant.supportToken,...override,
  });
  const revoke=(i,grant,override={})=>revokeLocalSupportReadGrant(db,scope(i),{
    operationId:grant.operationId,sessionToken:ADMIN_TOKEN,...override,
  });
  const records=async name=>(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results;
  return {db,shops,scope,issue,read,revoke,records,now,ADMIN_HASH};
}

test('issues a 5-minute read-only token for one immutable Shop and audits START, READ, END',async t=>{
  const x=await localContext(t);
  const op=crypto.randomUUID();
  const grant=await x.issue(0,{operationId:op});
  assert.equal(grant.status,'created');
  assert.equal(grant.operationId,op);
  assert.match(grant.supportToken,/^[a-f0-9]{64}$/);
  assert.ok(grant.expiresAtMs>Date.now()&&grant.expiresAtMs<=Date.now()+300000);
  assert.equal('writeToken' in grant,false);
  let rows=await x.records('m03_local_support_grants');
  assert.equal(rows.length,1);
  assert.equal(rows[0].shop_id,x.shops[0].shopId);
  assert.equal(rows[0].admin_session_hash,x.ADMIN_HASH);
  assert.notEqual(rows[0].token_hash,grant.supportToken,'raw token never in D1');
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START']);
  assert.deepEqual(await x.read(0,grant),{status:'allowed'});
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START','READ']);
  assert.deepEqual(await x.revoke(0,grant),{status:'revoked'});
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START','READ','END']);
  assert.deepEqual(await x.read(0,grant),{status:'denied'});
  assert.deepEqual(await x.revoke(0,grant),{status:'denied'});
  assert.equal((await x.records('m03_local_support_events')).length,3,'rejected reads cannot create audit READ');
});

test('same operation replay cannot release token twice; changed intent and concurrent grants fail closed',async t=>{
  const x=await localContext(t),op=crypto.randomUUID();
  const [a,b]=await Promise.all([x.issue(0,{operationId:op}),x.issue(0,{operationId:op})]);
  assert.deepEqual([a.status,b.status].sort(),['created','replayed']);
  assert.equal('supportToken' in (a.status==='replayed'?a:b),false);
  assert.deepEqual(await x.issue(0,{operationId:op,reason:reason+' altered'}),{status:'denied'});
  assert.deepEqual(await x.issue(0,{operationId:crypto.randomUUID()}),{status:'denied'},
    'one active read grant per Shop even with a different operation');
  assert.equal((await x.records('m03_local_support_grants')).length,1);
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START']);
  const c=await x.issue(1);
  assert.equal(c.status,'created','other Shop can have its own independent read grant');
  assert.equal((await x.records('m03_local_support_grants')).length,2);
});

test('foreign Shop token, incorrect physical Shop D1, different Admin session and forged scope cannot authorize read',async t=>{
  const x=await localContext(t);
  const a=await x.issue(0),b=await x.issue(1);
  assert.equal(a.status,'created');assert.equal(b.status,'created');
  assert.deepEqual(await x.read(1,a),{status:'denied'});
  assert.deepEqual(await x.read(0,b),{status:'denied'});
  assert.deepEqual(await x.read(0,a,{sessionToken:OTHER_SESSION}),{status:'denied'});
  assert.deepEqual(await x.read(0,a,{supportToken:'f'.repeat(64)}),{status:'denied'});
  assert.deepEqual(await x.read(0,a,{eventId:'not-uuid'}),{status:'invalid'});
  const forged={...x.scope(0),shopDb:x.scope(1).shopDb};
  assert.deepEqual(await authorizeLocalSupportRead(x.db,forged,{
    eventId:crypto.randomUUID(),sessionToken:ADMIN_TOKEN,supportToken:a.supportToken,
  }),{status:'denied'});
  const wrongMarker={...x.scope(0),databaseMarker:x.scope(1).databaseMarker};
  assert.deepEqual(await issueLocalSupportReadGrant(x.db,wrongMarker,{
    operationId:crypto.randomUUID(),reason,sessionToken:ADMIN_TOKEN,
  }),{status:'denied'});
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START','START']);
});

test('revoked or rotated Super Admin and expired support credentials deny SQL reads without audit leakage',async t=>{
  const x=await localContext(t);
  const a=await x.issue(0);
  assert.equal(a.status,'created');
  // Directly seed an expired historical grant to prove SQL time rejects it,
  // with valid D1 content but no raw credential persisted.
  const expiredToken='8'.repeat(64), op=crypto.randomUUID();
  const expiredHash=await hashOpaqueSessionToken(expiredToken);
  await x.db.prepare(`INSERT INTO m03_local_support_grants
    (operation_id,token_hash,shop_id,database_id,database_marker,
     admin_session_hash,actor_subject,reason,issued_at_ms,expires_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(op,expiredHash,x.shops[1].shopId,x.shops[1].databaseId,
      x.shops[1].databaseMarker,x.ADMIN_HASH,'fixture-admin',reason,
      x.now-600000,x.now-300000).run();
  assert.deepEqual(await x.read(1,{supportToken:expiredToken}),{status:'denied'});
  await x.db.prepare('UPDATE platform_admin_auth SET factor_version=2 WHERE singleton=1').run();
  assert.deepEqual(await x.read(0,a),{status:'denied'},'rotating MFA fences existing support token');
  assert.deepEqual(await x.issue(1),{status:'denied'},'old Admin session cannot issue after MFA rotation');
  assert.deepEqual(await x.revoke(0,a),{status:'denied'},'revoked authority cannot mutate grant');
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START','START']);
});

test('immutable event log and late START audit trigger failure do not leave partial grants',async t=>{
  const x=await localContext(t);
  const a=await x.issue(0);
  assert.equal(a.status,'created');
  await assert.rejects(x.db.prepare("UPDATE m03_local_support_events SET event_type='READ'").run(),/immutable/i);
  await assert.rejects(x.db.prepare('DELETE FROM m03_local_support_events').run(),/immutable/i);
  await assert.rejects(x.db.prepare("UPDATE m03_local_support_grants SET reason='changed'").run(),/immutable/i);
  await x.db.prepare(`CREATE TRIGGER m03_support_injected_abort AFTER INSERT ON m03_local_support_events
    WHEN NEW.event_type='START' AND NEW.shop_id=(SELECT shop_id FROM m03_local_support_grants
      WHERE operation_id=NEW.grant_operation_id AND reason='Inject delayed audit failure')
    BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`).run();
  const before=await x.records('m03_local_support_grants');
  await assert.rejects(x.issue(1,{reason:'Inject delayed audit failure'}),/audit failure/);
  assert.deepEqual(await x.records('m03_local_support_grants'),before);
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START']);
});

test('malformed grant, missing purpose, unknown actor and revoked session cannot mint authority',async t=>{
  const x=await localContext(t);
  assert.deepEqual(await x.issue(0,{reason:'oops'}),{status:'invalid'});
  assert.deepEqual(await x.issue(0,{operationId:'fake'}),{status:'invalid'});
  assert.deepEqual(await x.issue(0,{sessionToken:'bad'}),{status:'denied'});
  const grant=await x.issue(0);
  assert.equal(grant.status,'created');
  await x.db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(Date.now(),x.ADMIN_HASH).run();
  assert.deepEqual(await x.read(0,grant),{status:'denied'});
  assert.deepEqual(await x.issue(1),{status:'denied'});
  assert.deepEqual(await x.revoke(0,grant),{status:'denied'});
  assert.deepEqual((await x.records('m03_local_support_events')).map(a=>a.event_type),['START']);
});
