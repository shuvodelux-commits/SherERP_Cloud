import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {reserveHostedShop,advanceHostedShopCreate,readHostedShopCreate}
  from '../../src/provisioning/hosted-shop-create.js';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const token='1'.repeat(64);
const adminSubject='approved-google-subject';
const uuid=()=>crypto.randomUUID();
const now=()=>Date.now();
const input=()=>({
  operationId:uuid(),displayName:'Rajshahi Hardware',ownerEmail:'first.owner@gmail.com'
});
const receipt=row=>({
  accountId:ACCOUNT,name:row.name,attemptId:row.attemptId,
  id:uuid(),evidenceRef:'cf-d1:fixture-backed-creation'
});

async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='option-a-control-fixture';
  config.d1_databases[0].database_id=uuid();
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const db=(await worker.getEnv()).CONTROL_DB;
  for(const name of [
    '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
    '0004_first_shop_owner','0007_owner_gmail_approvals',
    '0011_control_center_provisioning'
  ]){
    const sql=await readFile('staging-migrations/platform-onboarding/'+name+'.sql','utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(s=>db.prepare(s)));
  }
  const journalSql=await readFile(
    'staging-migrations/platform-onboarding/0012_hosted_shop_provisioning_journal.sql','utf8');
  await db.batch(unstable_splitSqlQuery(journalSql).map(s=>db.prepare(s)));
  const ts=now(),browser='c'.repeat(64),setup='a'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(setup,'b'.repeat(43),'https://accounts.google.com',adminSubject,ts-1000,ts+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com',adminSubject,setup,ts-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(browser,'d'.repeat(43),ts+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind(browser,ts-200),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,1,?,?)`)
      .bind(await hashOpaqueSessionToken(token),browser,ts-100,ts+60000),
  ]);
  return db;
}
const dbState=(db,op)=>db.prepare(`SELECT state,database_id AS databaseId,
  database_name AS databaseName,attempt_id AS attemptId,evidence_ref AS evidenceRef
  FROM platform_hosted_shop_create_journal WHERE operation_id=?`).bind(op).first();

test('Admin reservation reuses existing immutable Create Business and stores one private journal',async t=>{
  const db=await fixture(t);
  const op=input();
  assert.equal((await reserveHostedShop(db,'0'.repeat(64),op,{accountId:ACCOUNT})).code,401);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first('n'),0);
  const first=await reserveHostedShop(db,token,op,{accountId:ACCOUNT});
  assert.equal(first.code,202);
  assert.equal(first.body.state,'reserved');
  assert.match(first.body.shopId,/^[a-f0-9-]{36}$/);
  assert.equal(first.body.databaseId,undefined);
  assert.equal((await reserveHostedShop(db,token,op,{accountId:ACCOUNT})).code,200);
  assert.equal((await reserveHostedShop(db,token,{...op,ownerEmail:'different@gmail.com'},
    {accountId:ACCOUNT})).code,409);
  assert.equal((await reserveHostedShop(db,token,{...op,displayName:'Another Shop'},
    {accountId:ACCOUNT})).code,409);
  assert.equal((await dbState(db,op.operationId)).state,'reserved');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_hosted_shop_create_journal').first('n'),1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first('n'),0);
  const outsider=await readHostedShopCreate(db,'0'.repeat(64),op.operationId);
  assert.equal(outsider.code,401);
  assert.equal((await readHostedShopCreate(db,token,op.operationId)).body.databaseId,undefined);
});

test('timeout after D1 create never retries POST blindly; only attributed receipt reconciles',async t=>{
  const db=await fixture(t);
  const op=input();
  await reserveHostedShop(db,token,op,{accountId:ACCOUNT});
  let creates=0,lookups=0,verified=null;
  const provider={
    inspectAccount:async()=>({accountId:ACCOUNT,usedDatabases:2,maximumDatabases:10}),
    async createDatabase(action){creates++;verified=receipt(action);throw Error('response lost after create');},
    async findCreation(action){lookups++;return lookups>=2?verified:null;}
  };
  const first=await advanceHostedShopCreate(db,token,op.operationId,provider);
  assert.equal(first.code,200);
  assert.equal(first.body.state,'outcome-unknown');
  assert.equal(creates,1);
  const pending=await advanceHostedShopCreate(db,token,op.operationId,provider);
  assert.equal(pending.body.state,'outcome-unknown');
  assert.equal(creates,1);
  const finished=await advanceHostedShopCreate(db,token,op.operationId,provider);
  assert.equal(finished.body.state,'database-created');
  assert.equal(creates,1);
  assert.equal((await dbState(db,op.operationId)).databaseId,verified.id);
  assert.equal((await advanceHostedShopCreate(db,token,op.operationId,provider)).body.state,
    'database-created');
  assert.equal(creates,1);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM platform_owner_gmail_approvals').first('n'),0,
    'Owner only activates after migration + binding + Worker publication');
});

test('two parallel resumes claim only one create and preserve exact intent',async t=>{
  const db=await fixture(t);
  const op=input();
  await reserveHostedShop(db,token,op,{accountId:ACCOUNT});
  let creates=0;
  const provider={
    inspectAccount:async()=>({accountId:ACCOUNT,usedDatabases:1,maximumDatabases:10}),
    async createDatabase(action){creates++;await Promise.resolve();return receipt(action);},
    findCreation:async()=>null
  };
  const [a,b]=await Promise.all([
    advanceHostedShopCreate(db,token,op.operationId,provider),
    advanceHostedShopCreate(db,token,op.operationId,provider)
  ]);
  assert.equal(creates,1);
  assert.ok(['database-created','outcome-unknown'].includes(a.body.state));
  assert.ok(['database-created','outcome-unknown'].includes(b.body.state));
  assert.equal((await dbState(db,op.operationId)).state,'database-created');
});

test('revoked MFA/unauthorized actor or quota denial never invokes create API',async t=>{
  const db=await fixture(t);
  const op=input();
  await reserveHostedShop(db,token,op,{accountId:ACCOUNT});
  let creates=0,inspections=0;
  const provider={
    async inspectAccount(){inspections++;return {
      accountId:ACCOUNT,usedDatabases:10,maximumDatabases:10
    };},
    async createDatabase(){creates++;throw Error('should not create');},
    async findCreation(){return null;}
  };
  assert.equal((await advanceHostedShopCreate(db,'0'.repeat(64),op.operationId,provider)).code,401);
  assert.equal(inspections,0);
  const quota=await advanceHostedShopCreate(db,token,op.operationId,provider);
  assert.equal(quota.body.state,'reserved');
  assert.equal(quota.body.failedStage,'capacity');
  assert.equal(creates,0);
  await db.prepare('UPDATE platform_admin_sessions SET revoked_at_ms=?')
    .bind(now()).run();
  assert.equal((await advanceHostedShopCreate(db,token,op.operationId,provider)).code,401);
  assert.equal(creates,0);
});
