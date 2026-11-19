import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,describe,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {reserveShop,acceptOwnerInvite} from '../fixtures/m03-owner-onboarding/contract.js';

describe('local Owner onboarding',()=>{
  const adminToken=randomBytes(32).toString('hex');
  const issuer='https://accounts.google.com';
  const recipient={issuer,subject:'fixture-owner'};
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-platform-auth-local-test.jsonc'}]});
  let db;
  before(async()=>{
    await harness.listen();
    const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
    await worker.applyD1Migrations('CONTROL_DB');
    ({CONTROL_DB:db}=await worker.getEnv());
    const sql=await readFile(new URL('../fixtures/m03-owner-onboarding/schema.sql',import.meta.url),'utf8');
    await db.batch(sql.trim().split('-- next statement').map(text=>db.prepare(text.trim())));
    const now=Date.now();
    await db.batch([
      db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
        .bind('a'.repeat(64),'b'.repeat(43),issuer,'fixture-admin',now-1000,now+60000),
      db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
        .bind(issuer,'fixture-admin','a'.repeat(64),now-500),
      db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
      db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)').bind('c'.repeat(64),'d'.repeat(43),now+60000),
      db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind('c'.repeat(64),now-200),
      db.prepare(`INSERT INTO platform_admin_sessions
        (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
        VALUES (?,?,1,1,1,?,?)`)
        .bind(await hashOpaqueSessionToken(adminToken),'c'.repeat(64),now-100,now+60000),
    ]);
  });
  after(()=>harness.close());

  const invite=(shopId)=>({shopId,operationId:'reserve-'+shopId,recipient,inviteToken:randomBytes(32).toString('hex')});
  const accept=(input,identity=recipient)=>acceptOwnerInvite(db,{inviteToken:input.inviteToken,identity});
  const ready=input=>db.prepare('UPDATE fixture_shops SET ready=1 WHERE shop_id=?').bind(input.shopId).run();

  test('only a live platform session can reserve, and concurrent retries write one shop',async()=>{
    const input=invite('shop-a');
    assert.equal(await reserveShop(db,{...input,sessionToken:randomBytes(32).toString('hex')}),false);
    const results=await Promise.all([
      reserveShop(db,{...input,sessionToken:adminToken}),
      reserveShop(db,{...input,sessionToken:adminToken}),
    ]);
    assert.equal(results.filter(Boolean).length,1);
    const row=await db.prepare('SELECT shop_id,inviter_subject,invite_hash FROM fixture_shops').first();
    assert.deepEqual(row,{shop_id:'shop-a',inviter_subject:'fixture-admin',invite_hash:await hashOpaqueSessionToken(input.inviteToken)});
    assert.equal(await reserveShop(db,{...invite('other-shop'),operationId:input.operationId,sessionToken:adminToken}),false);
  });

  test('only the intended verified identity can accept a ready shop invite, exactly once',async()=>{
    const input=invite('shop-b');
    assert.equal(await reserveShop(db,{...input,sessionToken:adminToken}),true);
    assert.equal(await accept(input),false);
    await ready(input);
    assert.equal(await accept(input,{issuer,subject:'different-owner'}),false);
    assert.equal(await accept(input,{issuer:'https://other.example',subject:recipient.subject}),false);
    assert.equal(await accept(input,null),false);
    const outcomes=await Promise.all([accept(input),accept(input)]);
    assert.equal(outcomes.filter(Boolean).length,1);
    assert.equal(await accept(input),false);
    assert.deepEqual(await db.prepare('SELECT shop_id,subject,role FROM fixture_shop_memberships').first(),
      {shop_id:'shop-b',subject:'fixture-owner',role:'Owner'});
  });

  test('expired invitations, stale factor versions and revoked admin sessions cannot write',async()=>{
    const input=invite('shop-c');
    assert.equal(await reserveShop(db,{...input,sessionToken:adminToken}),true);
    await ready(input);
    await db.prepare('UPDATE fixture_shops SET expires_at_ms=0 WHERE shop_id=?').bind(input.shopId).run();
    assert.equal(await accept(input),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=2').run();
    assert.equal(await reserveShop(db,{...invite('stale-factor'),sessionToken:adminToken}),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=1').run();
    await db.prepare("UPDATE platform_admin_sessions SET revoked_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)").run();
    assert.equal(await reserveShop(db,{...invite('shop-d'),sessionToken:adminToken}),false);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM fixture_shop_memberships').first()).n,1);
  });
});
