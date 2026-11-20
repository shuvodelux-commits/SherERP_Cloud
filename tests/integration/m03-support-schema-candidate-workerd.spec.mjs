/** M03 isolated schema candidate — never apply to production D1. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {
  LOCAL_SUPPORT_READ_DDL,issueLocalSupportReadGrant,
  authorizeLocalSupportRead,revokeLocalSupportReadGrant,
} from '../../src/modules/m03-local-support-read-grants.js';

const candidate='staging-migrations/platform-support/0001_support_grants_and_events.sql';
const TOKEN='1'.repeat(64),reason='Authorized owner-visible read-only shop support';
function normalized(sql){return sql.trim().replace(/;\s*$/,'').replace(/\s+/g,' ');}
async function readCandidate(){
  const text=await readFile(candidate,'utf8');
  return text.split('-- next statement').map(s=>s.trim()).filter(Boolean);
}

test('support schema candidate is the exact reviewed D1 grant/event implementation',async()=>{
  const statements=await readCandidate();
  assert.equal(statements.length,LOCAL_SUPPORT_READ_DDL.length,'all tables/triggers/index required');
  assert.deepEqual(statements.map(normalized),LOCAL_SUPPORT_READ_DDL.map(normalized),
    'DDL differences require M03/M11 approval, not silent drift');
  assert.ok(candidate.startsWith('staging-migrations/platform-support/'));
});

test('isolated candidate installs on disposable Workerd and enforces scoped grant + immutable audit',async t=>{
  const cfg=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SCHEMA_A','SCHEMA_B'].map(binding=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),
    databaseMarker:crypto.randomUUID(),
  }));
  cfg.d1_databases.push(...shops.map(s=>({
    binding:s.binding,database_id:s.databaseId,
    database_name:'support-schema-'+s.binding.toLowerCase(),remote:false,
  })));
  const harness=createTestHarness({workers:[{config:cfg}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(cfg.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv(),db=env.CONTROL_DB;
  async function apply(db,path){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(x=>db.prepare(x)));
  }
  await apply(db,'staging-migrations/platform-onboarding/0001_shop_reservations.sql');
  await apply(db,'staging-migrations/platform-onboarding/0002_shop_bindings.sql');
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
      .bind('c'.repeat(64),now-300),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?)`)
      .bind(await hashOpaqueSessionToken(TOKEN),'c'.repeat(64),now-200,now+60000),
  ]);
  for(const s of shops){
    await apply(env[s.binding],'staging-migrations/shop-identity/0001_shop_identity.sql');
    await env[s.binding].prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker).run();
    await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(s.shopId,crypto.randomUUID(),'Fixture '+s.binding,'admin-subject',now-150).run();
    await db.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker,'admin-subject',now-100).run();
  }

  const statements=await readCandidate();
  for(const statement of statements)await db.prepare(statement).run();

  const scope=i=>({...shops[i],shopDb:env[shops[i].binding]});
  const a=await issueLocalSupportReadGrant(db,scope(0),{
    operationId:crypto.randomUUID(),reason,sessionToken:TOKEN,
  });
  assert.equal(a.status,'created');
  const events=async()=>(await db.prepare(
    'SELECT event_type,shop_id FROM m03_local_support_events ORDER BY rowid').all()).results;
  assert.deepEqual((await events()).map(e=>e.event_type),['START']);
  assert.deepEqual(await authorizeLocalSupportRead(db,scope(1),{
    eventId:crypto.randomUUID(),sessionToken:TOKEN,supportToken:a.supportToken,
  }),{status:'denied'},'Shop B cannot read Shop A');
  assert.deepEqual((await events()).map(e=>e.event_type),['START']);
  assert.deepEqual(await authorizeLocalSupportRead(db,scope(0),{
    eventId:crypto.randomUUID(),sessionToken:TOKEN,supportToken:a.supportToken,
  }),{status:'allowed'});
  assert.deepEqual(await revokeLocalSupportReadGrant(db,scope(0),{
    operationId:a.operationId,sessionToken:TOKEN,
  }),{status:'revoked'});
  assert.deepEqual(await authorizeLocalSupportRead(db,scope(0),{
    eventId:crypto.randomUUID(),sessionToken:TOKEN,supportToken:a.supportToken,
  }),{status:'denied'});
  assert.deepEqual((await events()).map(e=>e.event_type),['START','READ','END']);
  assert.deepEqual((await events()).map(e=>e.shop_id),
    [shops[0].shopId,shops[0].shopId,shops[0].shopId]);
  await assert.rejects(db.prepare('DELETE FROM m03_local_support_events').run(),/immutable support audit/);
  await assert.rejects(db.prepare('UPDATE m03_local_support_events SET event_type=?')
    .bind('START').run(),/immutable support audit/);
  await assert.rejects(db.prepare('DELETE FROM m03_local_support_grants').run(),/immutable support grant/);
  await db.prepare('UPDATE platform_admin_auth SET factor_version=2 WHERE singleton=1').run();
  assert.deepEqual(await issueLocalSupportReadGrant(db,scope(1),{
    operationId:crypto.randomUUID(),reason,sessionToken:TOKEN,
  }),{status:'denied'},'MFA-rotated admin cannot issue Shop B grant');
});
