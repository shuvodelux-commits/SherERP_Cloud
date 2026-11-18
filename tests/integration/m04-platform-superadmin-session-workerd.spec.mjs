import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {
  issuePlatformSuperAdminSession,validatePlatformSuperAdminSession,revokePlatformSuperAdminSession,
} from '../../src/auth/platform-superadmin-session.js';

const clientId='101-fixture.apps.googleusercontent.com';
const issuer='https://accounts.google.com';
const subject='101000000000000000001';
const secret=randomBytes(20);
const config={clientId,totpSecret:secret.toString('hex'),factorVersion:1};
const kid='m04-platform-session-fixture';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
let db;

before(async()=>{
  await harness.listen();
  ({DB:db}=await harness.getWorker('shererp-m04-auth-http-local-only').getEnv());
  for(const name of ['0001_platform_bootstrap','0002_platform_sessions']){
    const schema=await readFile(new URL('../../staging-migrations/platform-auth/'+name+'.sql',import.meta.url),'utf8');
    await db.batch(schema.trim().split('-- next statement').map(sql=>db.prepare(sql.trim())));
  }
  const setupHash=hash(randomBytes(32).toString('hex'));
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,1,2,NULL)')
      .bind(setupHash,randomBytes(32).toString('base64url'),issuer,subject),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,1)').bind(issuer,subject,setupHash),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
  ]);
});
beforeEach(async()=>{
  await db.batch([
    db.prepare('DELETE FROM platform_admin_sessions'),
    db.prepare('DELETE FROM platform_login_attempts'),
    db.prepare('DELETE FROM platform_login_challenges'),
    db.prepare('UPDATE platform_admin_auth SET enabled=1,factor_version=1'),
  ]);
});
after(()=>harness.close());

function googleKeys(t){
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,options)=>url==='https://www.googleapis.com/oauth2/v3/certs'
    ?Promise.resolve(Response.json({keys:[jwk]})):realFetch(url,options));
}

async function challenge({expiresAt=Date.now()+120_000}={}){
  const browserToken=randomBytes(32).toString('hex');
  const nonce=randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
    .bind(hash(browserToken),nonce,expiresAt).run();
  return {browserToken,nonce};
}

function credential(nonce,overrides){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:subject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+120,...overrides};
  const input=encode({alg:'RS256',kid})+'.'+encode(claims);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}

function authenticatorCode(key=secret,step=Math.floor(Date.now()/30_000)){
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',key).update(counter).digest();
  const offset=mac.at(-1)&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
}

function issue(browser,{code=authenticatorCode(),claims,settings=config}={}){
  return issuePlatformSuperAdminSession({
    controlDb:db,...settings,browserToken:browser.browserToken,
    credential:credential(browser.nonce,claims),code,
  });
}

test('requires the enrolled Google subject and a valid second factor',async t=>{
  googleKeys(t);
  assert.equal(await issue(await challenge(),{claims:{sub:'different'}}),null);
  assert.equal(await issue(await challenge(),{claims:{nonce:randomBytes(32).toString('base64url')}}),null);
  const browser=await challenge();
  assert.equal(await issue(browser,{settings:{...config,totpSecret:undefined}}),null);
  assert.equal(await issue(browser,{settings:{...config,factorVersion:2}}),null);
  const step=Math.floor(Date.now()/30_000);
  const valid=[authenticatorCode(secret,step-1),authenticatorCode(secret,step),authenticatorCode(secret,step+1)];
  const wrong=['123456','234567','345678','456789'].find(code=>!valid.includes(code));
  assert.equal(await issue(browser,{code:wrong}),null);
  assert.equal(await issue(browser),null,'a browser challenge gets one OTP attempt');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_admin_sessions').first()).n,0);
});

test('atomically limits Google-verified OTP attempts across challenges',async t=>{
  googleKeys(t);
  const browsers=await Promise.all(Array.from({length:8},()=>challenge()));
  const step=Math.floor(Date.now()/30_000);
  const valid=[authenticatorCode(secret,step-1),authenticatorCode(secret,step),authenticatorCode(secret,step+1)];
  const wrong=['123456','234567','345678','456789'].find(code=>!valid.includes(code));
  const denied=await Promise.all(browsers.map(browser=>issue(browser,{code:wrong})));
  assert.ok(denied.every(result=>result===null));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_login_attempts').first()).n,5);
  assert.equal(await issue(await challenge()),null);
});

test('allows one session across concurrent uses of the same OTP and stops replay',async t=>{
  googleKeys(t);
  const code=authenticatorCode();
  const browsers=await Promise.all([challenge(),challenge(),challenge()]);
  const results=await Promise.all(browsers.map(browser=>issue(browser,{code})));
  const [session]=results.filter(Boolean);
  assert.equal(results.filter(Boolean).length,1);
  assert.match(session.token,/^[0-9a-f]{64}$/);
  assert.equal(await issue(await challenge(),{code}),null);
  assert.equal((await db.prepare('SELECT token_hash FROM platform_admin_sessions').first()).token_hash,hash(session.token));
  assert.deepEqual(await validatePlatformSuperAdminSession(db,session.token),{issuer,subject,role:'PlatformSuperAdmin'});
  assert.equal(await revokePlatformSuperAdminSession(db,session.token),true);
  assert.equal(await revokePlatformSuperAdminSession(db,session.token),false);
  assert.equal(await validatePlatformSuperAdminSession(db,session.token),null);
});

test('rejects expired challenges and sessions, disabled admins and stale credential versions',async t=>{
  googleKeys(t);
  assert.equal(await issue(await challenge({expiresAt:Date.now()-1})),null);
  const {token,expiresAtMs}=await issue(await challenge());
  await db.prepare('UPDATE platform_admin_sessions SET expires_at_ms=issued_at_ms+1').run();
  assert.equal(await validatePlatformSuperAdminSession(db,token),null);
  await db.prepare('UPDATE platform_admin_sessions SET expires_at_ms=?').bind(expiresAtMs).run();
  await assert.rejects(db.prepare('UPDATE platform_admin_auth SET enabled=0').run());
  await db.prepare('UPDATE platform_admin_auth SET enabled=0,factor_version=2').run();
  assert.equal(await validatePlatformSuperAdminSession(db,token),null);
  assert.equal(await issue(await challenge()),null);
  await db.prepare('UPDATE platform_admin_auth SET enabled=1,factor_version=3').run();
  assert.equal(await validatePlatformSuperAdminSession(db,token),null);
  await assert.rejects(db.prepare('UPDATE platform_admin_auth SET factor_version=1').run());
});
