import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {requestSupportEditGrant,authorizeSupportWriteIntent}
  from '../../src/modules/m03-support-write-authority.js';

const session='1'.repeat(64);
const factor=Buffer.from('0123456789abcdef0123456789abcdef01234567','hex');
const factorKey='b'.repeat(64);
const uuid=()=>crypto.randomUUID();
const step=()=>Math.floor(Date.now()/30000);
const totp=(n=step())=>{
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(n));
  const signed=createHmac('sha1',factor).update(counter).digest();
  const code=(signed.readUInt32BE(signed.at(-1)&15)&0x7fffffff)%1000000;
  return String(code).padStart(6,'0');
};

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shopId=uuid(),databaseId=uuid(),marker=uuid(),readId=uuid();
  config.name='m03-support-edit-'+randomBytes(3).toString('hex');
  config.d1_databases[0].database_id=uuid();
  config.d1_databases.push({binding:'PLATFORM_PILOT_DB',
    database_name:'support-edit-fixture',database_id:databaseId});
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv(),db=env.CONTROL_DB,shopDb=env.PLATFORM_PILOT_DB;
  for(const migration of [
    'staging-migrations/platform-onboarding/0001_shop_reservations.sql',
    'staging-migrations/platform-onboarding/0002_shop_bindings.sql',
    'staging-migrations/platform-onboarding/0003_owner_invitations.sql',
    'staging-migrations/platform-onboarding/0004_first_shop_owner.sql',
    'staging-migrations/platform-onboarding/0007_owner_gmail_approvals.sql',
    'staging-migrations/platform-onboarding/0011_control_center_provisioning.sql',
    'staging-migrations/platform-support/0001_support_grants_and_events.sql',
    'staging-migrations/platform-support/0002_support_write_authority.sql'
  ]){
    const sql=await readFile(migration,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
  await shopDb.prepare(`CREATE TABLE shop_identity
    (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    shop_id TEXT,database_id TEXT,database_marker TEXT)`).run();
  await shopDb.prepare('INSERT INTO shop_identity VALUES(1,?,?,?)')
    .bind(shopId,databaseId,marker).run();
  const now=Date.now(),subject='fixture-admin',ticket='a'.repeat(64),challenge='c'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(ticket,'d'.repeat(43),'https://accounts.google.com',subject,now-1000,now+120000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com',subject,ticket,now-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES(1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES(?,?,?)')
      .bind(challenge,'f'.repeat(43),now+120000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind(challenge,now-300),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,?,?,?)`)
      .bind(await hashOpaqueSessionToken(session),challenge,step()-3,now-200,now+120000),
  ]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const aad=new TextEncoder().encode('shererp:platform:first-factor:v1');
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},
    await crypto.subtle.importKey('raw',Buffer.from(factorKey,'hex'),'AES-GCM',false,['encrypt']),
    factor);
  await db.prepare('INSERT INTO platform_browser_first_factor VALUES(1,?)')
    .bind(Buffer.from(iv).toString('base64')+'.'+Buffer.from(ciphertext).toString('base64')).run();
  const reserve=uuid();
  await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
    .bind(shopId,reserve,'First Hardware',subject,now-500).run();
  await db.prepare(`INSERT INTO platform_shop_provisioning
    (shop_id,owner_email,database_marker,stage,database_id,binding_key,allocation_evidence)
    VALUES (?,?,?,'allocated',?,?,?)`)
    .bind(shopId,'owner@gmail.com',marker,databaseId,'SHOP_PILOT_DB','fixture-evidence').run();
  await db.prepare("UPDATE platform_shop_provisioning SET stage='ready' WHERE shop_id=?")
    .bind(shopId).run();
  await db.prepare(`INSERT INTO m03_local_support_grants
    (operation_id,token_hash,shop_id,database_id,database_marker,
     admin_session_hash,actor_subject,reason,issued_at_ms,expires_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(readId,'e'.repeat(64),shopId,databaseId,marker,
      await hashOpaqueSessionToken(session),subject,
      'Review requested catalog correction',now-200,now+299800).run();
  const scope={shopDb,shopId,databaseId,databaseMarker:marker};
  const attrs={CONTROL_DB:db,PLATFORM_BROWSER_SETUP:'true',
    PLATFORM_FACTOR_ENCRYPTION_KEY:factorKey,M03_SUPPORT_WRITE_ENABLED:'true',
    PLATFORM_PILOT_DB:shopDb,PLATFORM_PILOT_SHOP_ID:shopId,
    PLATFORM_PILOT_D1_ID:databaseId,PLATFORM_PILOT_MARKER:marker};
  const attempt=(patch={})=>requestSupportEditGrant({...attrs,...patch},{
    readGrantOperationId:readId,writeGrantOperationId:uuid(),scope:'products',
    reason:'Correct a product after customer ticket',otpCode:totp(),sessionToken:session
  });
  return {db,shopDb,scope,readId,attrs,attempt,shopId,databaseId,marker};
}

test('opt-in only and fresh MFA required; no Shop D1 changes or fake Owner session',async t=>{
  const f=await fixture(t);
  assert.equal(await f.attempt({M03_SUPPORT_WRITE_ENABLED:'false'}),null);
  assert.equal(await requestSupportEditGrant(f.attrs,{
    readGrantOperationId:f.readId,writeGrantOperationId:uuid(),scope:'products',
    reason:'Ticket-based product update',otpCode:'000000',
    sessionToken:session
  }),null);
  const result=await f.attempt();
  assert.equal(result.scope,'products');
  assert.equal(result.shopId,f.shopId);
  assert.match(result.grantId,/^[0-9a-f-]{36}$/);
  assert.equal(result.ownerSession,undefined);
  assert.equal(result.shopDb,undefined);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_grants').first()).n,1);
  assert.equal((await f.db.prepare(
    "SELECT count(*) AS n FROM m03_support_write_events WHERE event_type='GRANT'").first()).n,1);
  assert.equal((await f.shopDb.prepare('SELECT count(*) AS n FROM sqlite_schema').first()).n,1,
    'grant process must not install business write authority or mutate Shop DB');
});

test('same six-digit step cannot authorize more than one edit grant and wrong scope denies',async t=>{
  const f=await fixture(t);
  const granted=await f.attempt();
  assert.ok(granted);
  assert.equal(await f.attempt(),null,'TOTP replay across another operation is denied');
  assert.equal(await requestSupportEditGrant(f.attrs,{
    readGrantOperationId:f.readId,writeGrantOperationId:uuid(),scope:'everything',
    reason:'All finance edit without restrictions',otpCode:totp(),sessionToken:session
  }),null);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_grants').first()).n,1);
});

test('revoke, expired grant, wrong business binding and invalid Admin session fail closed',async t=>{
  const f=await fixture(t);
  assert.equal(await f.attempt({PLATFORM_PILOT_MARKER:uuid()}),null);
  await f.db.prepare('UPDATE m03_local_support_grants SET revoked_at_ms=? WHERE operation_id=?')
    .bind(Date.now(),f.readId).run();
  assert.equal(await f.attempt(),null);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_grants').first()).n,0);
});

test('authorization journal is action-scoped, replay-safe and invalid after read grant revocation',async t=>{
  const f=await fixture(t);
  const granted=await f.attempt();
  const action={grantId:granted.grantId,action:'products.add',intentId:uuid(),
    intentHash:'a'.repeat(64),sessionToken:session};
  const ok=await authorizeSupportWriteIntent(f.attrs,action);
  assert.equal(ok.status,'authorized-intent');
  assert.equal((await authorizeSupportWriteIntent(f.attrs,action)).status,'replayed');
  assert.equal((await authorizeSupportWriteIntent(f.attrs,{...action,intentHash:'b'.repeat(64)})).status,
    'denied');
  assert.equal((await authorizeSupportWriteIntent(f.attrs,{...action,intentId:uuid(),
    action:'finance.post'})).status,'denied','product scope cannot authorize financial posting');
  assert.equal((await f.db.prepare(
    "SELECT count(*) AS n FROM m03_support_write_events WHERE event_type='INTENT'").first()).n,1);
  await f.db.prepare('UPDATE m03_local_support_grants SET revoked_at_ms=? WHERE operation_id=?')
    .bind(Date.now(),f.readId).run();
  assert.equal((await authorizeSupportWriteIntent(f.attrs,{
    ...action,intentId:uuid()
  })).status,'denied');
  assert.equal((await f.shopDb.prepare('SELECT count(*) AS n FROM sqlite_schema').first()).n,1);
});

test('revoked Admin and rotated MFA deny every new support edit intent',async t=>{
  const f=await fixture(t);
  const grant=await f.attempt();
  assert.ok(grant);
  const action=()=>authorizeSupportWriteIntent(f.attrs,{
    grantId:grant.grantId,action:'products.add',intentId:uuid(),
    intentHash:'f'.repeat(64),sessionToken:session
  });
  await f.db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(Date.now(),await hashOpaqueSessionToken(session)).run();
  assert.equal((await action()).status,'denied');
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_intents').first()).n,0);
});

test('invalid MFA attempts are throttled and support audit rows cannot be deleted',async t=>{
  const f=await fixture(t);
  for(let i=0;i<5;i++)assert.equal(await requestSupportEditGrant(f.attrs,{
    readGrantOperationId:f.readId,writeGrantOperationId:uuid(),scope:'products',
    reason:'Investigating a support ticket',otpCode:'000000',sessionToken:session
  }),null);
  assert.equal(await f.attempt(),null,'valid TOTP after 5 bad attempts is locked for this minute');
  const attempts=await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_attempts').first();
  assert.equal(attempts.n,5);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_grants').first()).n,0);
  await assert.rejects(
    f.db.prepare("DELETE FROM m03_local_support_events").run(),/immutable/i);
});

test('physical Shop D1 identity changes invalidate a previously authorized edit grant',async t=>{
  const f=await fixture(t);
  const granted=await f.attempt();
  await f.shopDb.prepare('UPDATE shop_identity SET database_marker=? WHERE singleton=1')
    .bind(uuid()).run();
  const result=await authorizeSupportWriteIntent(f.attrs,{
    grantId:granted.grantId,action:'products.add',intentId:uuid(),
    intentHash:'a'.repeat(64),sessionToken:session
  });
  assert.equal(result.status,'denied');
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM m03_support_write_intents').first()).n,0);
});
