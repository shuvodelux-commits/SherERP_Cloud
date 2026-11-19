import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {after,before,describe,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {reserveShop,acceptOwnerInvite,recordShopReadiness} from '../fixtures/m03-owner-onboarding/contract.js';

describe('local Owner onboarding',()=>{
  const adminToken=randomBytes(32).toString('hex');
  const issuer='https://accounts.google.com';
  const recipient={issuer,subject:'fixture-owner'};
  let db,shopA,shopB,harness,directory;
  before(async()=>{
    directory=await mkdtemp(join(tmpdir(),'shererp-owner-attestation-'));
    const configPath=join(directory,'wrangler.json');
    const config=JSON.parse(await readFile('./wrangler.m03-platform-auth-local-test.jsonc','utf8'));
    config.main=resolve(config.main);
    config.assets.directory=resolve(config.assets.directory);
    config.d1_databases[0].migrations_dir=resolve(config.d1_databases[0].migrations_dir);
    for(const binding of ['SHOP_A','SHOP_B'])config.d1_databases.push({
      binding,database_name:binding.toLowerCase(),database_id:randomUUID(),remote:false,
    });
    await writeFile(configPath,JSON.stringify(config),{mode:0o600});
    harness=createTestHarness({workers:[{configPath}]});
    await harness.listen();
    const worker=harness.getWorker('shererp-m03-platform-auth-local-test');
    await worker.applyD1Migrations('CONTROL_DB');
    ({CONTROL_DB:db,SHOP_A:shopA,SHOP_B:shopB}=await worker.getEnv());
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
  after(async()=>{
    try{await harness?.close();}finally{if(directory)await rm(directory,{recursive:true,force:true});}
  });

  const invite=shopId=>({
    shopId,operationId:'reserve-'+shopId,recipient,
    inviteToken:randomBytes(32).toString('hex'),databaseMarker:randomUUID(),
  });
  const reservedA=invite('shop-a');
  const reservedB=invite('shop-b');
  const accept=(input,identity=recipient)=>acceptOwnerInvite(db,{inviteToken:input.inviteToken,identity});
  const attest=(input,shopDb,sessionToken=adminToken)=>recordShopReadiness(db,{
    shopDb,shopId:input.shopId,operationId:input.operationId,sessionToken,
  });
  const seedMarker=(shopDb,{shopId,databaseMarker})=>shopDb.batch([
    shopDb.prepare('CREATE TABLE shop_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), shop_id TEXT NOT NULL, database_marker TEXT NOT NULL) STRICT'),
    shopDb.prepare('INSERT INTO shop_identity VALUES (1,?,?)').bind(shopId,databaseMarker),
  ]);

  test('only a live platform session can reserve, and concurrent retries write one shop',async()=>{
    const input=reservedA;
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

  test('readiness requires the intended database and operation, with one concurrent winner',async()=>{
    const input=reservedA;
    assert.equal(await attest(input,shopA),false);
    await seedMarker(shopB,reservedB);
    assert.equal(await attest(input,shopB),false);
    await seedMarker(shopA,{...input,databaseMarker:randomUUID()});
    assert.equal(await attest(input,shopA),false);
    await shopA.prepare('UPDATE shop_identity SET database_marker=? WHERE singleton=1').bind(input.databaseMarker).run();
    assert.equal(await attest({...input,operationId:'stale-operation'},shopA),false);
    assert.equal(await attest(input,shopA,'0'.repeat(64)),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=2').run();
    assert.equal(await attest(input,shopA),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=1').run();
    const outcomes=await Promise.all([attest(input,shopA),attest(input,shopA)]);
    assert.equal(outcomes.filter(Boolean).length,1);
  });

  test('only the intended verified identity can accept a ready shop invite, exactly once',async()=>{
    const input=reservedB;
    assert.equal(await reserveShop(db,{...input,sessionToken:adminToken}),true);
    assert.equal(await accept(input),false);
    assert.equal(await attest(input,shopB),true);
    assert.equal(await accept(input,{issuer,subject:'different-owner'}),false);
    assert.equal(await accept(input,{issuer:'https://other.example',subject:recipient.subject}),false);
    assert.equal(await accept(input,null),false);
    const outcomes=await Promise.all([accept(input),accept(input)]);
    assert.equal(outcomes.filter(Boolean).length,1);
    assert.equal(await accept(input),false);
    assert.deepEqual(await db.prepare('SELECT shop_id,subject,role FROM fixture_shop_memberships').first(),
      {shop_id:'shop-b',subject:'fixture-owner',role:'Owner'});
    await db.prepare('DELETE FROM fixture_shop_memberships WHERE shop_id=?').bind(input.shopId).run();
    const hash=await hashOpaqueSessionToken(input.inviteToken);
    await assert.rejects(db.prepare('UPDATE fixture_invite_consumptions SET consumed_at_ms=1 WHERE invite_hash=?').bind(hash).run(),/immutable/);
    await assert.rejects(db.prepare('DELETE FROM fixture_invite_consumptions WHERE invite_hash=?').bind(hash).run(),/immutable/);
    await assert.rejects(db.prepare('INSERT OR REPLACE INTO fixture_invite_consumptions VALUES (?,1)').bind(hash).run(),/already consumed/);
    assert.equal(await accept(input),false,'removing the Owner must never reopen an invite');
  });

  test('expired invitations, stale factor versions and revoked admin sessions cannot write',async()=>{
    const input=reservedA;
    await db.prepare('UPDATE fixture_shops SET expires_at_ms=0 WHERE shop_id=?').bind(input.shopId).run();
    assert.equal(await accept(input),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=2').run();
    assert.equal(await reserveShop(db,{...invite('stale-factor'),sessionToken:adminToken}),false);
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=1').run();
    await db.prepare("UPDATE platform_admin_sessions SET revoked_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)").run();
    assert.equal(await reserveShop(db,{...invite('shop-d'),sessionToken:adminToken}),false);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM fixture_shop_memberships').first()).n,0);
  });
});
