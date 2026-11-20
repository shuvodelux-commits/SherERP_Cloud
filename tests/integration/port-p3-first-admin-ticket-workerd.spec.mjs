import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {after,before,test} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import {createTestHarness} from 'wrangler';
import {
  issueFirstPlatformSetupTicket,revokeFirstPlatformSetupTicket,
} from '../../src/auth/port-p3-first-admin-ticket.js';

const SUBJECT='101000000000000000001';
const ISSUER='https://accounts.google.com';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-platform-auth-local-test.jsonc'}]});
let db;

before(async()=>{
  await harness.listen();
  const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
  await worker.applyD1Migrations('CONTROL_DB');
  ({CONTROL_DB:db}=await worker.getEnv());
});
after(()=>harness.close());

const hash=value=>createHash('sha256').update(Buffer.from(value,'hex')).digest('hex');
const issue=(googleSubject=SUBJECT)=>issueFirstPlatformSetupTicket({controlDb:db,googleSubject});

test('issues a 10-minute single-use ticket whose digest, never plaintext, is stored in Control D1',async()=>{
  const issued=await issue();
  assert.match(issued.setupToken,/^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(issued.expiresAtMs));
  const row=await db.prepare('SELECT * FROM platform_setup_tickets WHERE token_hash=?')
    .bind(hash(issued.setupToken)).first();
  assert.equal(row.token_hash,hash(issued.setupToken));
  assert.equal(row.issuer,ISSUER);
  assert.equal(row.subject,SUBJECT);
  assert.match(row.nonce,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(row.expires_at_ms-row.issued_at_ms,600_000);
  assert.equal(row.revoked_at_ms,null);
  assert.equal(row.expires_at_ms,issued.expiresAtMs);
  assert.equal(JSON.stringify(row).includes(issued.setupToken),false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_first_superadmin').first()).n,0);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:issued.setupToken}),true);
});

test('accepts opaque Google subject values permitted by the existing verified identity contract',async()=>{
  const subject='opaque-google-sub_A9';
  const issued=await issue(subject);
  assert.ok(issued,'a Google subject accepted by the verifier must be issuable');
  const row=await db.prepare('SELECT subject FROM platform_setup_tickets WHERE token_hash=?')
    .bind(hash(issued.setupToken)).first();
  assert.equal(row.subject,subject);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:issued.setupToken}),true);
});

test('rejects unapproved identity shapes before any database query or token issuance',async()=>{
  let queries=0;
  const controlDb={prepare(){queries++;throw Error('SENSITIVE_VALUE');}};
  for(const googleSubject of ['', ' test', '123 abc', 'hello\nworld', 123, null, {}, '9'.repeat(256)]){
    assert.equal(await issueFirstPlatformSetupTicket({controlDb,googleSubject}),null);
  }
  assert.equal(queries,0);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb,setupToken:'bad'}),false);
  assert.equal(queries,0);
});

test('concurrent requests create at most one pending ticket and active-ticket replay fails',async()=>{
  const attempts=await Promise.all(Array.from({length:6},(_,i)=>issue(SUBJECT.slice(0,-1)+i)));
  const granted=attempts.filter(Boolean);
  assert.equal(granted.length,1);
  const current=await db.prepare('SELECT COUNT(*) AS n FROM platform_setup_tickets WHERE revoked_at_ms IS NULL AND expires_at_ms>CAST(unixepoch(\'subsec\')*1000 AS INTEGER)').first();
  assert.equal(current.n,1);
  assert.equal(await issue(),null);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:granted[0].setupToken}),true);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:granted[0].setupToken}),false);
});

test('reissues after a revoked or expired ticket but cannot recover plaintext from D1',async()=>{
  const first=await issue();
  assert.ok(first);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:first.setupToken}),true);
  const replacement=await issue();
  assert.ok(replacement);
  assert.notEqual(first.setupToken,replacement.setupToken);
  await db.prepare('UPDATE platform_setup_tickets SET expires_at_ms=issued_at_ms+1 WHERE token_hash=?')
    .bind(hash(replacement.setupToken)).run();
  await setTimeout(15);
  const afterExpiry=await issue();
  assert.ok(afterExpiry);
  assert.notEqual(afterExpiry.setupToken,replacement.setupToken);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:afterExpiry.setupToken}),true);
});

test('a permanent first administrator bars every future ticket, even when prior ones expire',async()=>{
  const issued=await issue();
  assert.ok(issued);
  await db.prepare(`INSERT INTO platform_first_superadmin
    (singleton,issuer,subject,setup_token_hash,enrolled_at_ms)
    VALUES (1,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))`)
    .bind(ISSUER,SUBJECT,hash(issued.setupToken)).run();
  assert.equal(await issue(),null);
  assert.equal(await revokeFirstPlatformSetupTicket({controlDb:db,setupToken:issued.setupToken}),false);
});
