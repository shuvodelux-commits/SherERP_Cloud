import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {issueAdminRecoveryCodes,beginAdminMfaRecovery,finishAdminMfaRecovery}
  from '../../src/auth/platform-admin-recovery.js';
import {readBrowserAdminFactorRecord}
  from '../../src/auth/browser-first-admin-setup.js';
import {validatePlatformSuperAdminSession}
  from '../../src/auth/platform-superadmin-session.js';

const subject='123456789012345678901';
const clientId='888-fixture.apps.googleusercontent.com';
const secret=Buffer.from('abcdef0123456789abcdef0123456789abcdef01','hex');
const aad=new TextEncoder().encode('shererp:platform:first-factor:v1');
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'recovery-fixture',alg:'RS256'};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sha=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const currentStep=()=>Math.floor(Date.now()/30000);
function totp(key=secret,step=currentStep()){
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',key).update(counter).digest();
  return String((mac.readUInt32BE(mac.at(-1)&15)&0x7fffffff)%1000000).padStart(6,'0');
}
function decodeBase32(key){
  let bits='';
  for(const letter of key)bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter).toString(2).padStart(5,'0');
  return Buffer.from(bits.match(/.{8}/g).map(n=>parseInt(n,2)));
}
async function fixture(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  config.name='m04-recovery-private-d1-'+randomBytes(4).toString('hex');
  config.d1_databases[0].database_id=crypto.randomUUID();
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const db=(await worker.getEnv()).CONTROL_DB;
  const factorKey='b'.repeat(64);
  const iv=randomBytes(12);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},
    await crypto.subtle.importKey('raw',Buffer.from(factorKey,'hex'),'AES-GCM',false,['encrypt']),
    secret);
  const encrypted=iv.toString('base64')+'.'+Buffer.from(ciphertext).toString('base64');
  const ts=Date.now(),setup='a'.repeat(64),browser='c'.repeat(64);
  const session='1'.repeat(64);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind(setup,'b'.repeat(43),'https://accounts.google.com',subject,ts-1000,ts+60000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com',subject,setup,ts-500),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_browser_first_factor VALUES (1,?)').bind(encrypted),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(browser,'d'.repeat(43),ts+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)').bind(browser,ts-100),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?,?,1,1,?,?,?)`)
      .bind(sha(session),browser,currentStep()-2,ts-100,ts+15*24*60*60_000)
  ]);
  const env={CONTROL_DB:db,PLATFORM_FACTOR_ENCRYPTION_KEY:factorKey,
    PLATFORM_CLIENT_ID:clientId,PLATFORM_BROWSER_SETUP:'true'};
  const challenge=async()=>{
    const browserToken=randomBytes(32).toString('hex');
    const nonce=randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind(await hashOpaqueSessionToken(browserToken),nonce,Date.now()+120000).run();
    return {browserToken,nonce};
  };
  const credential=(nonce,overrides={})=>{
    const now=Math.floor(Date.now()/1000);
    const claims={iss:'https://accounts.google.com',sub:subject,aud:clientId,nonce,
      email:'admin@gmail.com',email_verified:true,iat:now-1,exp:now+120,...overrides};
    const message=encode({alg:'RS256',kid:jwk.kid})+'.'+encode(claims);
    return message+'.'+sign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64url');
  };
  return {db,env,session,challenge,credential};
}
function googleMock(t){
  const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,opts)=>url==='https://www.googleapis.com/oauth2/v3/certs'
    ?Promise.resolve(Response.json({keys:[jwk]})):original(url,opts));
}

test('only a current MFA-verified Admin can generate and rotate 8 high-entropy backup codes',async t=>{
  const f=await fixture(t);
  assert.equal(await issueAdminRecoveryCodes(f.env,'0'.repeat(64),totp()),null);
  assert.equal(await issueAdminRecoveryCodes(f.env,f.session,'000000'),null);
  const first=await issueAdminRecoveryCodes(f.env,f.session,totp());
  assert.equal(first.length,8);
  assert.equal(new Set(first).size,8);
  assert.ok(first.every(v=>/^[0-9a-f]{8}(?:-[0-9a-f]{8}){3}$/.test(v)));
  assert.equal((await f.db.prepare(
    'SELECT COUNT(*) AS n FROM platform_admin_recovery_codes WHERE consumed_at_ms IS NULL').first()).n,8);
  const leak=JSON.stringify((await f.db.prepare(
    'SELECT code_hash FROM platform_admin_recovery_codes').all()).results);
  assert.ok(first.every(v=>!leak.includes(v)));
  const second=await issueAdminRecoveryCodes(f.env,f.session,totp());
  assert.equal(second.length,8);
  const current=(await f.db.prepare('SELECT code_hash FROM platform_admin_recovery_codes').all()).results;
  assert.equal(current.length,8,'code regeneration atomically replaces earlier codes');
});


test('a factor rotation during code regeneration preserves existing recovery codes',async t=>{
  const f=await fixture(t);
  const issued=await issueAdminRecoveryCodes(f.env,f.session,totp());
  assert.equal(issued.length,8);
  const before=(await f.db.prepare(
    'SELECT code_hash FROM platform_admin_recovery_codes ORDER BY code_hash').all()).results;

  let batches=0;
  const raced={...f.env,CONTROL_DB:{
    prepare:(...args)=>f.db.prepare(...args),
    batch:async statements=>{
      batches++;
      // Reproduce an MFA change after session/factor reads, but before the
      // SQL transaction; the old trusted session must no longer mutate codes.
      await f.db.prepare('UPDATE platform_admin_auth SET factor_version=2 WHERE singleton=1').run();
      return f.db.batch(statements);
    }
  }};
  assert.equal(await issueAdminRecoveryCodes(raced,f.session,totp()),null);
  assert.equal(batches,1);
  assert.deepEqual((await f.db.prepare(
    'SELECT code_hash FROM platform_admin_recovery_codes ORDER BY code_hash').all()).results,
    before,'failed authorization must not delete or replace saved backup codes');
  assert.equal((await f.db.prepare(
    'SELECT factor_version FROM platform_admin_recovery_generation WHERE singleton=1').first())
    .factor_version,1,'rejected regeneration must not silently rebind the generation');
});

test('lost-phone recovery requires matching Google nonce and one unused backup code',async t=>{
  googleMock(t);
  const f=await fixture(t),codes=await issueAdminRecoveryCodes(f.env,f.session,totp());
  const wrong=await f.challenge();
  assert.equal(await beginAdminMfaRecovery(f.env,{
    browserToken:wrong.browserToken,credential:f.credential(wrong.nonce,{sub:'wrong-subject'}),
    recoveryCode:codes[0]
  }),null);
  const before=(await f.db.prepare('SELECT COUNT(*) AS n FROM platform_admin_recovery_codes WHERE consumed_at_ms IS NOT NULL').first()).n;
  assert.equal(before,0,'unverified Google identity cannot consume a backup code');
  const challenge=await f.challenge();
  const result=await beginAdminMfaRecovery(f.env,{
    browserToken:challenge.browserToken,credential:f.credential(challenge.nonce),
    recoveryCode:codes[0]
  });
  assert.match(result.recoveryToken,/^[0-9a-f]{64}$/);
  assert.match(result.manualKey,/^[A-Z2-7]{32}$/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM platform_admin_recovery_codes WHERE consumed_at_ms IS NOT NULL').first()).n,1);
  assert.equal(await beginAdminMfaRecovery(f.env,{
    browserToken:challenge.browserToken,credential:f.credential(challenge.nonce),
    recoveryCode:codes[0]
  }),null,'one-time code and Google challenge cannot be reused');
  const different=await f.challenge();
  assert.equal(await beginAdminMfaRecovery(f.env,{
    browserToken:different.browserToken,credential:f.credential(different.nonce),
    recoveryCode:codes[0]
  }),null,'a used code cannot authorize a different Google challenge');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM platform_admin_recovery_pending').first()).n,1,
    'replayed code must not even create an unauthorized pending replacement');
  assert.ok(await validatePlatformSuperAdminSession(f.db,f.session),
    'until factor rotation succeeds, existing sessions are still governed by normal grants');
});

test('recovery confirms a NEW authenticator, rotates factor and invalidates every old session/code',async t=>{
  googleMock(t);
  const f=await fixture(t),codes=await issueAdminRecoveryCodes(f.env,f.session,totp());
  const challenge=await f.challenge();
  const pending=await beginAdminMfaRecovery(f.env,{
    browserToken:challenge.browserToken,credential:f.credential(challenge.nonce),
    recoveryCode:codes[0]
  });
  assert.ok(pending);
  assert.equal(await finishAdminMfaRecovery(f.env,{recoveryToken:pending.recoveryToken,code:'000000'}),null);
  assert.equal(await validatePlatformSuperAdminSession(f.db,f.session)!==null,true);
  const output=await finishAdminMfaRecovery(f.env,{
    recoveryToken:pending.recoveryToken,code:totp(decodeBase32(pending.manualKey))
  });
  assert.match(output.sessionToken,/^[0-9a-f]{64}$/);
  assert.equal(output.codes.length,8,'new backup codes replace the old factor codes');
  assert.equal((await f.db.prepare('SELECT factor_version FROM platform_admin_auth').first()).factor_version,2);
  assert.equal(await validatePlatformSuperAdminSession(f.db,f.session),null);
  assert.ok(await validatePlatformSuperAdminSession(f.db,output.sessionToken));
  assert.equal(await finishAdminMfaRecovery(f.env,{
    recoveryToken:pending.recoveryToken,code:totp(decodeBase32(pending.manualKey))
  }),null,'cannot finish same recovery twice');
  const current=await readBrowserAdminFactorRecord(f.env);
  assert.equal(current.factorVersion,2);
  assert.notEqual(current.secret,secret.toString('hex'));
  assert.equal(current.secret,decodeBase32(pending.manualKey).toString('hex'));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM platform_admin_recovery_codes').first()).n,8);
});

test('recovery has no Google-only bypass and pending expires / limits wrong OTP attempts',async t=>{
  googleMock(t);
  const f=await fixture(t),codes=await issueAdminRecoveryCodes(f.env,f.session,totp());
  const ch=await f.challenge();
  assert.equal(await beginAdminMfaRecovery(f.env,{
    browserToken:ch.browserToken,credential:f.credential(ch.nonce),recoveryCode:'f'.repeat(8)
  }),null);
  const another=await f.challenge();
  assert.equal(await beginAdminMfaRecovery(f.env,{
    browserToken:another.browserToken,credential:f.credential(another.nonce,{nonce:'wrong'}),
    recoveryCode:codes[0]
  }),null);
  const valid=await f.challenge();
  const pending=await beginAdminMfaRecovery(f.env,{
    browserToken:valid.browserToken,credential:f.credential(valid.nonce),
    recoveryCode:codes[0]
  });
  for(let i=0;i<6;i++)assert.equal(await finishAdminMfaRecovery(f.env,{
    recoveryToken:pending.recoveryToken,code:'999999'
  }),null);
  assert.equal(await finishAdminMfaRecovery(f.env,{
    recoveryToken:pending.recoveryToken,code:totp(decodeBase32(pending.manualKey))
  }),null,'too many OTP attempts must close recovery');
  assert.equal((await f.db.prepare('SELECT factor_version FROM platform_admin_auth').first()).factor_version,1);
});

test('protected Admin HTTP recovery routes require the flag, active session, Google and private cookies',async t=>{
  googleMock(t);
  const f=await fixture(t);
  const platform=(await import('../../src/m03-private-platform-auth-worker.js')).default;
  const env={...f.env,PLATFORM_ADMIN_RECOVERY_ENABLED:'true',
    PLATFORM_BOOTSTRAP_CODE:'a'.repeat(64),
    PLATFORM_AUTH_SCOPE:'private-platform-auth',
    PLATFORM_AUTH_ORIGIN:'https://platform.example.test',
    PLATFORM_INGRESS:{limit:async()=>({success:true})}};
  const request=(path,data,cookie='',patch={})=>platform.request(
    'https://platform.example.test/api/platform'+path,{
      method:'POST',headers:{Origin:'https://platform.example.test',
        'Content-Type':'application/json',Cookie:cookie},
      body:JSON.stringify(data)
    },{...env,...patch});
  const initial=await request('/auth/recovery/codes',{code:totp()},
    '__Host-shererp-platform-session='+f.session,
    {PLATFORM_ADMIN_RECOVERY_ENABLED:'false'});
  assert.equal(initial.status,404,'new MFA recovery is opt-in after the migration');
  const denied=await request('/auth/recovery/codes',{code:totp()},
    '__Host-shererp-platform-session='+'0'.repeat(64));
  assert.equal(denied.status,401);
  const response=await request('/auth/recovery/codes',{code:totp()},
    '__Host-shererp-platform-session='+f.session);
  assert.equal(response.status,200);
  const codes=(await response.json()).codes;
  assert.equal(codes.length,8);
  const ch=await f.challenge();
  const start=await request('/auth/recovery/start',{
    credential:f.credential(ch.nonce),recoveryCode:codes[0]
  },'__Host-shererp-platform-challenge='+ch.browserToken);
  assert.equal(start.status,200);
  const output=await start.json();
  assert.equal(typeof output.manualKey,'string');
  assert.ok(output.qr.startsWith('data:image/svg+xml;base64,'));
  assert.equal(output.recoveryToken,undefined,'the recovery bearer belongs only in HttpOnly cookie');
  const saved=start.headers.get('set-cookie')||'';
  assert.match(saved,/__Host-shererp-platform-recovery=/);
  assert.match(saved,/HttpOnly/i);
  const recoveryCookie=saved.match(/__Host-shererp-platform-recovery=[0-9a-f]{64}/)?.[0];
  assert.ok(recoveryCookie);
  const finish=await request('/auth/recovery/finish',{
    code:totp(decodeBase32(output.manualKey))
  },recoveryCookie);
  assert.equal(finish.status,200);
  const signed=await finish.json();
  assert.equal(signed.recoveryCompleted,true);
  assert.equal(signed.role,undefined,'completion returns codes but no reusable API privileges');
  assert.equal(signed.codes.length,8);
  assert.match(finish.headers.get('set-cookie')||'',/__Host-shererp-platform-session=/);
  assert.equal((await request('/auth/recovery/finish',{
    code:totp(decodeBase32(output.manualKey))
  },recoveryCookie)).status,401,'already consumed recovery cookie cannot grant another session');
});
