import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {issueFirstPlatformSetupTicket} from '../../src/auth/port-p3-first-admin-ticket.js';
import {bootstrapPlatformSuperAdmin,readPlatformSetupNonce} from '../../src/auth/platform-superadmin-bootstrap.js';
import {
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
async function withD1(run){
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB:db}=await harness.getWorker('shererp-m04-auth-http-local-only').getEnv();
    for(const file of ['0001_platform_bootstrap.sql','0002_platform_sessions.sql']){
      const sql=await readFile(new URL('../../staging-migrations/platform-auth/'+file,import.meta.url),'utf8');
      await db.batch(sql.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
    }
    const testOnly=await readFile(new URL('../fixtures/port-p3-activation-challenge.sql',import.meta.url),'utf8');
    await db.prepare(testOnly).run();
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

test('issues an independent nonce and digest-only short-lived single active challenge after enrollment',async()=>{
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

test('invalid bearer inputs, unenrolled admin and active MFA cannot create an activation challenge',async()=>{
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
  let triggered=false;
  await withD1(async db=>{
    const {setupToken}=await enroll(db);
    const challenge=await issue(db,setupToken);
    t.mock.method(globalThis,'fetch',async(url,opts)=>{
      if(url!=='https://www.googleapis.com/oauth2/v3/certs')return original(url,opts);
      triggered=true;
      await db.prepare('UPDATE port_p3_activation_challenges SET expires_at_ms=issued_at_ms+1 WHERE challenge_hash=?')
        .bind(hash(challenge.challengeToken)).run();
      return Response.json({keys:[jwk]});
    });
    assert.equal(await verify(db,setupToken,challenge),false);
    assert.equal(triggered,true);
    assert.equal((await challengeRow(db,challenge.challengeToken)).consumed_at_ms,null);
  });
});
