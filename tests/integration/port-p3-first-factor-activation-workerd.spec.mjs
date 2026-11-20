import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {issueFirstPlatformSetupTicket} from '../../src/auth/port-p3-first-admin-ticket.js';
import {bootstrapPlatformSuperAdmin,readPlatformSetupNonce} from '../../src/auth/platform-superadmin-bootstrap.js';
import {issuePlatformSuperAdminSession,validatePlatformSuperAdminSession} from '../../src/auth/platform-superadmin-session.js';
import {activateFirstPlatformFactor} from '../../src/auth/port-p3-first-factor-activation.js';

const clientId='101-fixture.apps.googleusercontent.com';
const issuer='https://accounts.google.com';
const subject='101000000000000000001';
const wrongSubject='101000000000000000002';
const totpSecret=randomBytes(20).toString('hex');
const kid='port-p3-first-factor-fixture';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256'};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const tokenHash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');

function googleCredential(nonce,overrides={}){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:subject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+120,...overrides};
  const payload=encode({alg:'RS256',kid})+'.'+encode(claims);
  return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url');
}
function otp(secret=totpSecret,step=Math.floor(Date.now()/30_000)){
  const input=Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',Buffer.from(secret,'hex')).update(input).digest();
  const at=mac.at(-1)&15;
  return String((mac.readUInt32BE(at)&0x7fffffff)%1_000_000).padStart(6,'0');
}
function invalidOtp(){
  const current=Math.floor(Date.now()/30_000);
  const possible=new Set([otp(totpSecret,current-1),otp(totpSecret,current),otp(totpSecret,current+1)]);
  return ['000000','111111','222222','333333','444444'].find(code=>!possible.has(code));
}
function googleKeys(t){
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,opts)=>url==='https://www.googleapis.com/oauth2/v3/certs'
    ?Promise.resolve(Response.json({keys:[jwk]})):originalFetch(url,opts));
}
async function withControlDb(fn){
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB:db}=await harness.getWorker('shererp-m04-auth-http-local-only').getEnv();
    for(const file of ['0001_platform_bootstrap.sql','0002_platform_sessions.sql']){
      const schema=await readFile(new URL('../../staging-migrations/platform-auth/'+file,import.meta.url),'utf8');
      await db.batch(schema.trim().split('-- next statement').map(sql=>db.prepare(sql.trim())));
    }
    return await fn(db);
  }finally{
    await harness.close();
  }
}
async function enroll(db){
  const issued=await issueFirstPlatformSetupTicket({controlDb:db,googleSubject:subject});
  assert.ok(issued);
  const nonce=await readPlatformSetupNonce(db,issued.setupToken);
  assert.match(nonce,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(await bootstrapPlatformSuperAdmin({
    controlDb:db,clientId,setupToken:issued.setupToken,credential:googleCredential(nonce),
  }),true);
  return {setupToken:issued.setupToken,nonce};
}
const activate=(db,setupToken,nonce,settings={})=>activateFirstPlatformFactor({
  controlDb:db,clientId,setupToken,credential:googleCredential(nonce),
  totpSecret,code:otp(),...settings,
});
async function factorRow(db){
  return db.prepare('SELECT singleton,enabled,factor_version FROM platform_admin_auth').first();
}

test('rejects malformed bearer, code and TOTP secret before any Control D1 access',async()=>{
  let dbCalls=0;
  const controlDb={prepare(){dbCalls++;throw Error('SECRET_DATABASE_PROBE');}};
  const validToken=randomBytes(32).toString('hex');
  for(const change of [
    {setupToken:'bad'},
    {code:'12345'},
    {code:'1234567'},
    {code:123456},
    {totpSecret:'not-a-secret'},
    {totpSecret:'ff'.repeat(21)},
    {totpSecret:'AA'.repeat(20)},
    {totpSecret:undefined},
    {controlDb:undefined},
  ]){
    const outcome=await activateFirstPlatformFactor({
      controlDb,clientId,setupToken:validToken,credential:'bad.jwt.token',
      totpSecret,code:'123456',...change,
    });
    assert.equal(outcome,false);
  }
  assert.equal(dbCalls,0);
});

test('an issued setup ticket cannot activate MFA before the Google identity is enrolled',async t=>{
  googleKeys(t);
  await withControlDb(async db=>{
    const issued=await issueFirstPlatformSetupTicket({controlDb:db,googleSubject:subject});
    const nonce=await readPlatformSetupNonce(db,issued.setupToken);
    assert.equal(await activate(db,issued.setupToken,nonce),false);
    assert.equal(await factorRow(db),null);
  });
});

test('wrong signed Google identity, nonce, audience or authenticator code cannot enable factor',async t=>{
  googleKeys(t);
  await withControlDb(async db=>{
    const {setupToken,nonce}=await enroll(db);
    for(const credential of [
      googleCredential(nonce,{sub:wrongSubject}),
      googleCredential(randomBytes(32).toString('base64url')),
      googleCredential(nonce,{aud:'wrong.apps.googleusercontent.com'}),
      googleCredential(nonce,{email_verified:false}),
    ]){
      assert.equal(await activate(db,setupToken,nonce,{credential}),false);
    }
    assert.equal(await activate(db,setupToken,nonce,{code:invalidOtp()}),false);
    assert.equal(await factorRow(db),null);
  });
});

test('revoked or expired post-enrollment setup tickets cannot activate a factor',async t=>{
  googleKeys(t);
  await withControlDb(async db=>{
    const {setupToken,nonce}=await enroll(db);
    await db.prepare('UPDATE platform_setup_tickets SET revoked_at_ms=CAST(unixepoch(\'subsec\')*1000 AS INTEGER) WHERE token_hash=?')
      .bind(tokenHash(setupToken)).run();
    assert.equal(await activate(db,setupToken,nonce),false);
    assert.equal(await factorRow(db),null);
  });
  await withControlDb(async db=>{
    const {setupToken,nonce}=await enroll(db);
    await db.prepare('UPDATE platform_setup_tickets SET expires_at_ms=issued_at_ms+1 WHERE token_hash=?')
      .bind(tokenHash(setupToken)).run();
    assert.equal(await activate(db,setupToken,nonce),false);
    assert.equal(await factorRow(db),null);
  });
});

test('D1 denies an activation whose setup ticket expires after Google and TOTP verification',async t=>{
  googleKeys(t);
  await withControlDb(async db=>{
    const {setupToken,nonce}=await enroll(db);
    let attempted=false;
    const intercept={
      prepare(sql){
        const prepared=db.prepare(sql);
        if(!sql.includes('INSERT INTO platform_admin_auth'))return prepared;
        return {bind(...values){
          const bound=prepared.bind(...values);
          return {async run(){
            attempted=true;
            await db.prepare('UPDATE platform_setup_tickets SET expires_at_ms=issued_at_ms+1 WHERE token_hash=?')
              .bind(tokenHash(setupToken)).run();
            return bound.run();
          }};
        }};
      },
    };
    assert.equal(await activate(intercept,setupToken,nonce),false);
    assert.equal(attempted,true);
    assert.equal(await factorRow(db),null);
  });
});

test('first verified TOTP activation is single-winner and enables the unchanged private login session',async t=>{
  googleKeys(t);
  await withControlDb(async db=>{
    const {setupToken,nonce}=await enroll(db);
    const results=await Promise.all(Array.from({length:5},()=>activate(db,setupToken,nonce)));
    assert.equal(results.filter(Boolean).length,1);
    assert.deepEqual(await factorRow(db),{singleton:1,enabled:1,factor_version:1});
    assert.equal(await activate(db,setupToken,nonce),false);
    const all=JSON.stringify((await db.prepare('SELECT * FROM platform_admin_auth').first()));
    assert.equal(all.includes(totpSecret),false);

    const browserToken=randomBytes(32).toString('hex');
    const challengeNonce=randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO platform_login_challenges(binding_hash,nonce,expires_at_ms) VALUES (?,?,?)')
      .bind(tokenHash(browserToken),challengeNonce,Date.now()+120_000).run();
    const session=await issuePlatformSuperAdminSession({
      controlDb:db,clientId,totpSecret,factorVersion:1,browserToken,
      credential:googleCredential(challengeNonce),code:otp(),
    });
    assert.match(session?.token??'',/^[0-9a-f]{64}$/);
    assert.deepEqual(await validatePlatformSuperAdminSession(db,session.token),
      {issuer,subject,role:'PlatformSuperAdmin'});
  });
});
