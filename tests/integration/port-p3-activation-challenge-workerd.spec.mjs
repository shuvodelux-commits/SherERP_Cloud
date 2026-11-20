import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {issueFirstPlatformSetupTicket} from '../../src/auth/port-p3-first-admin-ticket.js';
import {bootstrapPlatformSuperAdmin,readPlatformSetupNonce} from '../../src/auth/platform-superadmin-bootstrap.js';
import {
  activateFirstPlatformFactorFromChallenge,
  createTrustedFirstMfaOperator,
  issueFirstPlatformActivationChallenge,
  verifyAndConsumeFirstPlatformActivationChallenge,
  revokeFirstPlatformActivationChallenge,
} from '../../src/auth/port-p3-activation-challenge.js';

const issuer='https://accounts.google.com';
const subject='101000000000000000001';
const anotherSubject='101000000000000000002';
const clientId='101-fixture.apps.googleusercontent.com';
const kid='port-p3-run3-fixture';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256'};
const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const hash=value=>createHash('sha256').update(Buffer.from(value,'hex')).digest('hex');

function googleCredential(nonce,overrides={}){
  const now=Math.floor(Date.now()/1000);
  const payload=enc({alg:'RS256',kid})+'.'+enc({
    iss:issuer,sub:subject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+90,...overrides,
  });
  return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url');
}
function mockGoogleKeys(t){
  const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,opts)=>
    url==='https://www.googleapis.com/oauth2/v3/certs'
      ?Promise.resolve(Response.json({keys:[jwk]})):original(url,opts));
}
async function withD1(run,{fixture=true}={}){
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB:db}=await harness.getWorker('shererp-m04-auth-http-local-only').getEnv();
    for(const file of ['0001_platform_bootstrap.sql','0002_platform_sessions.sql']){
      const sql=await readFile(new URL('../../staging-migrations/platform-auth/'+file,import.meta.url),'utf8');
      await db.batch(sql.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
    }
    if(fixture){
      const testOnly=await readFile(new URL('../fixtures/port-p3-activation-challenge.sql',import.meta.url),'utf8');
      await db.prepare(testOnly).run();
    }
    return await run(db);
  }finally{
    await harness.close();
  }
}
async function enroll(db){
  const ticket=await issueFirstPlatformSetupTicket({controlDb:db,googleSubject:subject});
  assert.ok(ticket);
  const setupNonce=await readPlatformSetupNonce(db,ticket.setupToken);
  assert.ok(setupNonce);
  assert.equal(await bootstrapPlatformSuperAdmin({
    controlDb:db,clientId,setupToken:ticket.setupToken,
    credential:googleCredential(setupNonce),
  }),true);
  return {setupToken:ticket.setupToken,setupNonce};
}
async function challengeRow(db,challengeToken){
  return db.prepare('SELECT * FROM port_p3_activation_challenges WHERE challenge_hash=?')
    .bind(hash(challengeToken)).first();
}
const issue=(db,setupToken)=>issueFirstPlatformActivationChallenge({controlDb:db,setupToken});
const verify=(db,setupToken,challenge,settings={})=>
  verifyAndConsumeFirstPlatformActivationChallenge({
    controlDb:db,setupToken,challengeToken:challenge.challengeToken,
    clientId,credential:googleCredential(challenge.nonce),...settings,
  });

test('issues an independent nonce and digest-only short-lived single active challenge after enrollment',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken,setupNonce}=await enroll(db);
    const first=await issue(db,setupToken);
    assert.match(first?.challengeToken??'',/^[0-9a-f]{64}$/);
    assert.match(first.nonce,/^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first.nonce,setupNonce,'fresh activation challenge must not reuse setup nonce');
    const row=await challengeRow(db,first.challengeToken);
    assert.equal(row.challenge_hash,hash(first.challengeToken));
    assert.equal(row.ticket_hash,hash(setupToken));
    assert.equal(row.issuer,issuer);
    assert.equal(row.subject,subject);
    assert.equal(row.nonce,first.nonce);
    assert.equal(row.expires_at_ms,first.expiresAtMs);
    assert.ok(row.expires_at_ms-row.issued_at_ms<=120000);
    const approvedTicket=await db.prepare('SELECT expires_at_ms FROM platform_setup_tickets WHERE token_hash=?')
      .bind(hash(setupToken)).first();
    assert.ok(row.expires_at_ms<=approvedTicket.expires_at_ms);
    assert.equal(row.attempt_count,0);
    assert.equal(row.consumed_at_ms,null);
    assert.equal(JSON.stringify(row).includes(first.challengeToken),false);
    assert.equal(await issue(db,setupToken),null,'active duplicate denied');
    assert.equal(await revokeFirstPlatformActivationChallenge({
      controlDb:db,setupToken,challengeToken:first.challengeToken,
    }),true);
    assert.equal(await revokeFirstPlatformActivationChallenge({
      controlDb:db,setupToken,challengeToken:first.challengeToken,
    }),false);
    const replacement=await issue(db,setupToken);
    assert.ok(replacement);
    assert.notEqual(replacement.challengeToken,first.challengeToken);
    assert.notEqual(replacement.nonce,first.nonce);
  });
});

test('invalid bearer inputs, unenrolled admin and active MFA cannot create an activation challenge',async t=>{
  mockGoogleKeys(t);
  let calls=0;
  const controlDb={prepare(){calls++;throw Error('DATABASE_SHOULD_NOT_BE_QUERIED');}};
  assert.equal(await issueFirstPlatformActivationChallenge({controlDb,setupToken:'bad'}),null);
  assert.equal(await verifyAndConsumeFirstPlatformActivationChallenge({
    controlDb,setupToken:'bad',challengeToken:'bad',clientId,credential:'bad',
  }),false);
  assert.equal(await revokeFirstPlatformActivationChallenge({
    controlDb,setupToken:'bad',challengeToken:'bad',
  }),false);
  assert.equal(calls,0);
  await withD1(async db=>{
    const ticket=await issueFirstPlatformSetupTicket({controlDb:db,googleSubject:subject});
    assert.equal(await issue(db,ticket.setupToken),null);
    const setupNonce=await readPlatformSetupNonce(db,ticket.setupToken);
    assert.equal(await bootstrapPlatformSuperAdmin({
      controlDb:db,setupToken:ticket.setupToken,clientId,credential:googleCredential(setupNonce),
    }),true);
    await db.prepare('INSERT INTO platform_admin_auth(singleton,enabled,factor_version) VALUES(1,1,1)').run();
    assert.equal(await issue(db,ticket.setupToken),null);
  });
});

test('wrong signed Google identity, nonce, audience and unverified email never consume challenge',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    for(const overrides of [
      {sub:anotherSubject},
      {aud:'999-other.apps.googleusercontent.com'},
      {nonce:randomBytes(32).toString('base64url')},
      {email_verified:false},
    ]){
      assert.equal(await verify(db,setupToken,challenge,{
        credential:googleCredential(challenge.nonce,overrides),
      }),false);
    }
    const row=await challengeRow(db,challenge.challengeToken);
    assert.equal(row.attempt_count,4);
    assert.equal(row.consumed_at_ms,null);
    assert.equal(await verify(db,setupToken,challenge),true,'fifth valid attempt succeeds');
    assert.equal((await challengeRow(db,challenge.challengeToken)).attempt_count,5);
    assert.equal(await verify(db,setupToken,challenge),false,'consumed challenge not replayable');
  });
});

test('five bad Google verification attempts permanently deny even a later valid token',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    for(let i=0;i<5;i++){
      assert.equal(await verify(db,setupToken,challenge,{
        credential:googleCredential(challenge.nonce,{sub:anotherSubject}),
      }),false);
    }
    assert.equal(await verify(db,setupToken,challenge),false);
    const row=await challengeRow(db,challenge.challengeToken);
    assert.equal(row.attempt_count,5);
    assert.equal(row.consumed_at_ms,null);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_admin_auth').first()).n,0);
  });
});

test('revocation and reissue cannot reset the five-attempt budget for one setup ticket',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const first=await issue(db,setupToken);
    for(let i=0;i<4;i++){
      assert.equal(await verify(db,setupToken,first,{
        credential:googleCredential(first.nonce,{sub:anotherSubject}),
      }),false);
    }
    assert.equal(await revokeFirstPlatformActivationChallenge({
      controlDb:db,setupToken,challengeToken:first.challengeToken,
    }),true);
    const second=await issue(db,setupToken);
    assert.ok(second,'one attempt should remain after first challenge is revoked');
    assert.equal(await verify(db,setupToken,second,{
      credential:googleCredential(second.nonce,{sub:anotherSubject}),
    }),false);
    assert.equal(await verify(db,setupToken,second),false,'sixth attempt across ticket is refused');
    assert.equal(await revokeFirstPlatformActivationChallenge({
      controlDb:db,setupToken,challengeToken:second.challengeToken,
    }),true);
    assert.equal(await issue(db,setupToken),null,'no new challenge after ticket budget exhausted');
  });
});

test('parallel correct Google proofs consume challenge exactly once without granting MFA or session',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    const attempts=await Promise.all(Array.from({length:8},()=>verify(db,setupToken,challenge)));
    assert.equal(attempts.filter(Boolean).length,1);
    const row=await challengeRow(db,challenge.challengeToken);
    assert.ok(row.attempt_count>=1 && row.attempt_count<=5);
    assert.ok(Number.isSafeInteger(row.consumed_at_ms));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_admin_auth').first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_admin_sessions').first()).n,0);
    assert.equal(await verify(db,setupToken,challenge),false);
  });
});

test('expiry or revocation of original setup ticket or challenge fails closed',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    await db.prepare("UPDATE platform_setup_tickets SET revoked_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE token_hash=?")
      .bind(hash(setupToken)).run();
    assert.equal(await verify(db,setupToken,challenge),false);
    assert.equal((await challengeRow(db,challenge.challengeToken)).consumed_at_ms,null);
  });
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    await db.prepare('UPDATE platform_setup_tickets SET expires_at_ms=issued_at_ms+1 WHERE token_hash=?')
      .bind(hash(setupToken)).run();
    assert.equal(await verify(db,setupToken,challenge),false);
    assert.equal(await issue(db,setupToken),null);
  });
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    await db.prepare('UPDATE port_p3_activation_challenges SET expires_at_ms=issued_at_ms+1 WHERE challenge_hash=?')
      .bind(hash(challenge.challengeToken)).run();
    assert.equal(await verify(db,setupToken,challenge),false);
    assert.equal((await challengeRow(db,challenge.challengeToken)).consumed_at_ms,null);
  });
});

test('D1 final consumption rechecks expiry even if ticket changes during Google JWKS verification',async t=>{
  const original=globalThis.fetch;
  let expiredDb=null;
  let expiredChallenge=null;
  let triggered=false;
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url!=='https://www.googleapis.com/oauth2/v3/certs')return original(url,opts);
    if(expiredDb){
      triggered=true;
      await expiredDb.prepare('UPDATE port_p3_activation_challenges SET expires_at_ms=issued_at_ms+1 WHERE challenge_hash=?')
        .bind(expiredChallenge).run();
    }
    return Response.json({keys:[jwk]});
  });
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    expiredDb=db;
    expiredChallenge=hash(challenge.challengeToken);
    assert.equal(await verify(db,setupToken,challenge),false);
    assert.equal(triggered,true);
    assert.equal((await challengeRow(db,challenge.challengeToken)).consumed_at_ms,null);
  });
});

const factorSecret=randomBytes(20).toString('hex');
function otp(step=Math.floor(Date.now()/30_000)){
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',Buffer.from(factorSecret,'hex')).update(counter).digest();
  return String((mac.readUInt32BE(mac.at(-1)&15)&0x7fffffff)%1_000_000).padStart(6,'0');
}
function wrongOtp(){
  const current=Math.floor(Date.now()/30_000);
  const expected=[otp(current-1),otp(current),otp(current+1)];
  return ['000000','111111','222222','333333'].find(code=>!expected.includes(code));
}
const activate=(controlDb,setupToken,challenge,settings={})=>
  activateFirstPlatformFactorFromChallenge({
    controlDb,setupToken,challengeToken:challenge.challengeToken,clientId,
    credential:googleCredential(challenge.nonce),totpSecret:factorSecret,code:otp(),...settings,
  });
const factor=db=>db.prepare('SELECT enabled,factor_version FROM platform_admin_auth').first();

test('fresh activation nonce and TOTP share the ticket budget, and enable MFA together on the fifth attempt',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken,setupNonce}=await enroll(db);
    const challenge=await issue(db,setupToken);
    assert.equal(await activate(db,setupToken,challenge,{credential:googleCredential(setupNonce)}),false);
    assert.equal(await activate(db,setupToken,challenge,{
      credential:googleCredential(challenge.nonce,{sub:anotherSubject}),
    }),false);
    assert.equal(await activate(db,setupToken,challenge,{
      credential:googleCredential(challenge.nonce,{aud:'999-other.apps.googleusercontent.com'}),
    }),false);
    assert.equal(await activate(db,setupToken,challenge,{code:wrongOtp()}),false);
    assert.equal(await factor(db),null);
    const pending=await challengeRow(db,challenge.challengeToken);
    assert.equal(pending.attempt_count,4);
    assert.equal(pending.consumed_at_ms,null);

    assert.equal(await activate(db,setupToken,challenge),true);
    assert.deepEqual(await factor(db),{enabled:1,factor_version:1});
    const consumed=await challengeRow(db,challenge.challengeToken);
    assert.equal(consumed.attempt_count,5);
    assert.ok(Number.isSafeInteger(consumed.consumed_at_ms));
    assert.equal(await activate(db,setupToken,challenge),false);
    assert.deepEqual(await challengeRow(db,challenge.challengeToken),consumed);
  });
});

test('concurrent valid activation has one winner and issues no sessions',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    const attempts=await Promise.all(Array.from({length:8},()=>activate(db,setupToken,challenge)));
    assert.equal(attempts.filter(Boolean).length,1);
    assert.deepEqual(await factor(db),{enabled:1,factor_version:1});
    const row=await challengeRow(db,challenge.challengeToken);
    assert.ok(row.attempt_count>=1 && row.attempt_count<=5);
    assert.ok(Number.isSafeInteger(row.consumed_at_ms));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_admin_sessions').first()).n,0);
  });
});

test('a setup ticket expiring immediately before the batch cannot consume the challenge or enable MFA',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    let reachedCommit=false;
    const controlDb={
      prepare:db.prepare.bind(db),
      async batch(statements){
        reachedCommit=true;
        await db.prepare('UPDATE platform_setup_tickets SET expires_at_ms=issued_at_ms+1 WHERE token_hash=?')
          .bind(hash(setupToken)).run();
        return db.batch(statements);
      },
    };
    assert.equal(await activate(controlDb,setupToken,challenge),false);
    assert.equal(reachedCommit,true);
    assert.equal(await factor(db),null);
    const row=await challengeRow(db,challenge.challengeToken);
    assert.equal(row.attempt_count,1);
    assert.equal(row.consumed_at_ms,null);
  });
});

test('a zero-row factor write rolls back challenge consumption and permits a bounded retry',async t=>{
  mockGoogleKeys(t);
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    await db.prepare(`CREATE TRIGGER fixture_ignore_factor BEFORE INSERT ON platform_admin_auth
      BEGIN SELECT RAISE(IGNORE); END`).run();
    assert.equal(await activate(db,setupToken,challenge),false);
    assert.equal(await factor(db),null);
    const pending=await challengeRow(db,challenge.challengeToken);
    assert.equal(pending.attempt_count,1);
    assert.equal(pending.consumed_at_ms,null);
    await db.prepare('DROP TRIGGER fixture_ignore_factor').run();
    assert.equal(await activate(db,setupToken,challenge),true);
    assert.deepEqual(await factor(db),{enabled:1,factor_version:1});
    assert.ok(Number.isSafeInteger((await challengeRow(db,challenge.challengeToken)).consumed_at_ms));
  });
});

const operatorBearer=randomBytes(32).toString('hex');
const operatorId='cloud-operator-01';
const createOperator=(controlDb,overrides={})=>createTrustedFirstMfaOperator({
  controlDb,operatorId,operatorBearer,clientId,googleSubject:subject,totpSecret:factorSecret,...overrides,
});
async function withOperatorD1(t,run){
  mockGoogleKeys(t);
  return withD1(async db=>{
    const {setupToken}=await enroll(db);
    const migration=await readFile(new URL(
      '../../staging-migrations/platform-auth/0003_platform_first_mfa_activation.sql',import.meta.url,
    ),'utf8');
    await db.batch(migration.trim().split('-- next statement').map(sql=>db.prepare(sql.trim())));
    return run(db,setupToken);
  },{fixture:false});
}
const auditRows=db=>db.prepare('SELECT * FROM platform_first_mfa_activation_audit').all();
const operatorProof=(setupToken,challenge)=>({
  bearer:operatorBearer,setupToken,challengeToken:challenge.challengeToken,
  credential:googleCredential(challenge.nonce),code:otp(),
});

test('numbered activation migration preserves pre-existing enrollment and records one trusted completion',async t=>{
  await withOperatorD1(t,async(db,setupToken)=>{
    const operator=await createOperator(db);
    const challenge=await operator.issueChallenge({bearer:operatorBearer,setupToken});
    const proof=operatorProof(setupToken,challenge);
    const results=await Promise.all(Array.from({length:6},()=>operator.activate({
      ...proof,operatorId:'supplied-by-request',totpSecret:'0'.repeat(40),
      controlDb:null,clientId:'999-other.apps.googleusercontent.com',
    })));
    assert.equal(results.filter(Boolean).length,1);
    assert.deepEqual(await factor(db),{enabled:1,factor_version:1});
    assert.equal((await db.prepare('SELECT subject FROM platform_first_superadmin').first()).subject,subject);
    const {results:[audit]}=await auditRows(db);
    assert.equal(audit.operator_id,operatorId);
    assert.equal(audit.challenge_hash,hash(challenge.challengeToken));
    assert.equal(audit.factor_version,1);
    assert.equal(audit.activated_at_ms,(await challengeRow(db,challenge.challengeToken)).consumed_at_ms);
    assert.deepEqual(await operator.readReceipt(proof),{
      operatorId,factorVersion:1,activatedAtMs:audit.activated_at_ms,
    });
    assert.equal(await operator.activate(proof),false);
    assert.equal((await auditRows(db)).results.length,1);
    assert.deepEqual(Object.keys(audit).sort(),
      ['activated_at_ms','challenge_hash','factor_version','operator_id','singleton']);
    for(const secret of [factorSecret,setupToken,challenge.challengeToken,operatorBearer,proof.credential,proof.code]){
      assert.ok(!Object.values(audit).includes(secret));
    }
    await assert.rejects(db.prepare('UPDATE platform_first_mfa_activation_audit SET operator_id=?').bind('changed').run());
    await assert.rejects(db.prepare('DELETE FROM platform_first_mfa_activation_audit').run());
    await assert.rejects(db.prepare(`INSERT OR REPLACE INTO platform_first_mfa_activation_audit
      SELECT singleton,challenge_hash,'changed',factor_version,activated_at_ms
      FROM platform_first_mfa_activation_audit`).run());
  });
});

test('a caller without the trusted operator credential cannot issue, attempt, or read activation',async t=>{
  await withOperatorD1(t,async(db,setupToken)=>{
    const operator=await createOperator(db);
    assert.equal(await createOperator(db,{operatorBearer:'malformed'}),null);
    assert.equal(await operator.issueChallenge({bearer:'0'.repeat(64),setupToken}),null);
    const wrongSubjectOperator=await createOperator(db,{googleSubject:anotherSubject});
    assert.equal(await wrongSubjectOperator.issueChallenge({bearer:operatorBearer,setupToken}),null);
    const challenge=await operator.issueChallenge({bearer:operatorBearer,setupToken});
    const proof=operatorProof(setupToken,challenge);
    assert.equal(await operator.activate({...proof,bearer:'0'.repeat(64),operatorId}),false);
    assert.equal(await wrongSubjectOperator.activate({...proof,googleSubject:subject}),false);
    assert.equal((await challengeRow(db,challenge.challengeToken)).attempt_count,0);
    assert.equal(await factor(db),null);
    assert.equal(await operator.activate(proof),true);
    assert.equal(await operator.readReceipt({...proof,bearer:'0'.repeat(64)}),null);
    const different=await createOperator(db,{operatorId:'another-operator'});
    assert.equal(await different.readReceipt(proof),null);
  });
});

test('D1 rolls back challenge and factor when the audit write affects no rows',async t=>{
  await withOperatorD1(t,async(db,setupToken)=>{
    const operator=await createOperator(db);
    const challenge=await operator.issueChallenge({bearer:operatorBearer,setupToken});
    const proof=operatorProof(setupToken,challenge);
    await db.prepare(`CREATE TRIGGER fixture_ignore_mfa_audit BEFORE INSERT ON platform_first_mfa_activation_audit
      BEGIN SELECT RAISE(IGNORE); END`).run();
    assert.equal(await operator.activate(proof),false);
    const row=await challengeRow(db,challenge.challengeToken);
    assert.equal(row.attempt_count,1);
    assert.equal(row.consumed_at_ms,null);
    assert.equal(await factor(db),null);
    assert.deepEqual((await auditRows(db)).results,[]);
    await db.prepare('DROP TRIGGER fixture_ignore_mfa_audit').run();
    assert.equal(await operator.activate(proof),true);
    assert.equal((await auditRows(db)).results.length,1);
  });
});

test('private loopback transport gates and completes the audited activation',async t=>{
  const {createPrivateFirstMfaHandler}=await import('../../src/auth/port-p3-private-transport.js');
  await withOperatorD1(t,async(db,setupToken)=>{
    const handler=await createPrivateFirstMfaHandler({
      controlDb:db,operatorId,operatorBearer,clientId,googleSubject:subject,totpSecret:factorSecret,
    });
    const call=(action,body,{token=operatorBearer,host='127.0.0.1',headers={}}={})=>
      handler(new Request('http://'+host+':8790/'+action,{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},
        body:JSON.stringify(body),
      }));
    assert.equal((await call('challenge',{setupToken},{token:'0'.repeat(64)})).status,404);
    assert.equal((await call('challenge',{setupToken},{host:'admin.example.test'})).status,404);
    assert.equal((await call('challenge',{setupToken},{headers:{Origin:'http://127.0.0.1:8790'}})).status,404);
    assert.equal((await call('challenge',{setupToken,operatorId:'override'})).status,400);
    const issued=await call('challenge',{setupToken});
    assert.equal(issued.status,200);
    assert.equal(issued.headers.get('Cache-Control'),'no-store');
    const {challengeToken,nonce}=await issued.json();
    const proof={setupToken,challengeToken,credential:googleCredential(nonce),code:otp()};
    assert.equal((await call('activate',proof)).status,200);
    const receipt=await call('receipt',{challengeToken});
    assert.equal((await receipt.json()).operatorId,operatorId);
    assert.equal((await call('activate',proof)).status,409);
  });
});
