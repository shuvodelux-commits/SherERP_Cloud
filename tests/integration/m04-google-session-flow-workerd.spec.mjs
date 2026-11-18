import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import stagingWorker from '../../src/m03-google-auth-staging-worker.js';

const origin='https://google-auth.example.test';
const clientId='123456-example.apps.googleusercontent.com';
const subject='123456789012345678901';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'google-fixture',alg:'RS256'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const credential=(nonce,overrides={})=>{
  const now=Math.floor(Date.now()/1000);
  const header=encode({alg:'RS256',kid:jwk.kid});
  const claims=encode({iss:'https://accounts.google.com',aud:clientId,sub:subject,
    email:'admin@example.test',email_verified:true,nonce,iat:now-5,exp:now+120,...overrides});
  const input=`${header}.${claims}`;
  return `${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;
};
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
let DB,env;
before(async()=>{
  await harness.listen();
  const worker=harness.getWorker('shererp-m04-auth-http-local-only');
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.batch([
    DB.prepare(`CREATE TABLE settings(
      row_id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT ''
    ) STRICT`),
    DB.prepare(`INSERT INTO settings(key,value) VALUES
      ('Shop Name','Synthetic Google Shell'),
      ('Currency Symbol','৳'),
      ('Unrelated Setting','synthetic-private-value')`),
  ]);
  const schema=await readFile(new URL('../../staging-migrations/google-auth/0015_google_staging_auth.sql',import.meta.url),'utf8');
  await DB.batch(schema.split('-- next statement').map(text=>DB.prepare(text.trim())));
  await DB.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,credential_state,
     password_hash,password_salt,password_iterations)
    VALUES ('USR-GOOGLE','Synthetic Administrator','01710000801','Administrator','Active',
            'LegacyPending',?,?,210000),
           ('USR-BACKUP','Synthetic Backup','01710000802','Administrator','Active',
            'LegacyPending',?,?,210000)`)
    .bind('a'.repeat(64),'b'.repeat(48),'a'.repeat(64),'b'.repeat(48)).run();
  await DB.prepare(`INSERT INTO auth_google_links(issuer,subject,user_id)
    VALUES ('https://accounts.google.com',?,'USR-GOOGLE')`).bind(subject).run();
  env={DB,GOOGLE_CLIENT_ID:clientId,M03_GOOGLE_AUTH_ORIGIN:origin,
    M03_GOOGLE_AUTH_SCOPE:'reviewed-google-staging-auth-only',
    M03_AUTH_SCOPE:'reviewed-staging-auth-only',
    M03_AUTH_D1_UUID:'aa04618e-1639-4cb9-bdf5-7b967d8b968b'};
});
after(()=>harness.close());

function stubKeys(t){
  const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(request,options)=>
    request==='https://www.googleapis.com/oauth2/v3/certs'
      ?Promise.resolve(Response.json({keys:[jwk]})):original(request,options));
}
function request(path,{cookie,method='POST',payload,requestOrigin=origin,authorization}={}){
  const headers=new Headers({Origin:requestOrigin});
  if(cookie)headers.set('Cookie',cookie);
  if(authorization)headers.set('Authorization',authorization);
  if(payload)headers.set('Content-Type','application/json');
  return stagingWorker.fetch(new Request(origin+path,{method,headers,body:payload&&JSON.stringify(payload)}),env);
}
const cookiePair=(response,name)=>response.headers.getSetCookie().find(x=>x.startsWith(name+'='))?.split(';')[0];
async function start(){
  const response=await request('/api/auth/google/challenge');
  assert.equal(response.status,200);
  const attributes=response.headers.get('Set-Cookie').split('; ');
  for(const flag of ['Secure','HttpOnly','SameSite=Strict'])
    assert.ok(attributes.includes(flag),`missing ${flag} cookie flag`);
  return {nonce:(await response.json()).data.nonce,
    cookie:cookiePair(response,'__Host-shererp-google-challenge')};
}
const login=(attempt,overrides)=>request('/api/auth/google',{cookie:attempt.cookie,
  payload:{credential:credential(attempt.nonce,overrides)}});
const restore=cookie=>request('/api/auth/google/session',{cookie,method:'GET'});
const shell=cookie=>request('/api/auth/google/shell',{cookie,method:'GET'});

test('one browser-bound Google challenge issues at most one revocable session on real D1',async(t)=>{
  stubKeys(t);
  const attempt=await start();
  const replies=await Promise.all([login(attempt),login(attempt)]);
  assert.deepEqual(replies.map(x=>x.status).sort(),[200,401]);
  const ok=replies.find(x=>x.ok);
  const session=cookiePair(ok,'__Host-shererp-google-session');
  assert.equal((await restore(session)).status,200);
  const shellResponse=await shell(session);
  assert.equal(shellResponse.status,200);
  assert.equal(shellResponse.headers.get('Cache-Control'),'no-store');
  const envelope=await shellResponse.json();
  assert.deepEqual(Object.keys(envelope.data).sort(),['currencySymbol','navItems','shopName']);
  assert.equal(envelope.data.shopName,'Synthetic Google Shell');
  assert.equal(envelope.data.currencySymbol,'৳');
  assert.ok(envelope.data.navItems.some(item=>item.key==='dashboard'));
  assert.equal(JSON.stringify(envelope).includes('synthetic-private-value'),false);
  const stored=await DB.prepare('SELECT token_hash FROM auth_google_sessions').first('token_hash');
  assert.match(stored,/^[0-9a-f]{64}$/);
  assert.notEqual(stored,session.split('=')[1]);
  assert.equal(await DB.prepare('SELECT count(*) AS n FROM auth_sessions').first('n'),0);
  assert.equal(await DB.prepare("SELECT credential_state FROM auth_users WHERE user_id='USR-GOOGLE'")
    .first('credential_state'),'LegacyPending');
  assert.equal((await request('/api/auth/google/logout',{cookie:session})).status,200);
  await assert.rejects(DB.prepare('UPDATE auth_google_sessions SET revoked_at_ms=NULL').run());
  await assert.rejects(DB.prepare('DELETE FROM auth_google_sessions').run());
  await assert.rejects(DB.prepare('INSERT OR REPLACE INTO auth_google_sessions SELECT * FROM auth_google_sessions').run());
  assert.equal((await restore(session)).status,401);
  assert.equal((await shell(session)).status,401);
  assert.equal((await login(attempt)).status,401);
});

test('wrong browser, unlinked subject with the same email and cross-origin attempts are denied',async(t)=>{
  stubKeys(t);
  const attempt=await start();
  const other=await start();
  assert.equal((await login({...attempt,cookie:other.cookie})).status,401);
  assert.equal((await login(attempt,{sub:'other-google-identity'})).status,401);
  assert.equal((await shell()).status,401);
  assert.equal((await request('/api/auth/google/shell',{
    method:'GET',authorization:'Bearer '+'a'.repeat(64),
  })).status,401);
  assert.equal((await request('/api/auth/google/challenge',{requestOrigin:'https://foreign.example.test'})).status,403);
  assert.equal((await request('/api/rpc',{payload:{fnName:'completeSale',args:[]}})).status,501);
});

test('a linked Administrator cannot start a Google session during an active account lock',async(t)=>{
  stubKeys(t);
  const hash=createHash('sha256').update('01710000801').digest('hex');
  const now=Date.now();
  await DB.prepare(`INSERT INTO auth_login_throttle
    (login_hash,failure_count,locked_until_ms,reset_at_ms) VALUES (?,5,?,?)`)
    .bind(hash,now+60000,now+120000).run();
  assert.equal((await login(await start())).status,401);
  await DB.prepare('DELETE FROM auth_login_throttle WHERE login_hash=?').bind(hash).run();
});

test('disabling staff or revoking the link invalidates existing Google sessions',async(t)=>{
  stubKeys(t);
  const makeSession=async()=>cookiePair(await login(await start()),'__Host-shererp-google-session');
  const active=await makeSession();
  assert.equal((await restore(active)).status,200);
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='USR-GOOGLE'").run();
  assert.equal((await restore(active)).status,401);
  assert.equal((await shell(active)).status,401);
  assert.equal((await login(await start())).status,401);
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='USR-GOOGLE'").run();
  const linked=await makeSession();
  assert.equal((await restore(linked)).status,200);
  await DB.prepare('UPDATE auth_google_links SET revoked_at_ms=? WHERE subject=?')
    .bind(Date.now(),subject).run();
  await assert.rejects(DB.prepare('UPDATE auth_google_links SET revoked_at_ms=NULL').run());
  await assert.rejects(DB.prepare('DELETE FROM auth_google_links').run());
  await assert.rejects(DB.prepare('INSERT OR REPLACE INTO auth_google_links SELECT * FROM auth_google_links').run());
  assert.equal((await restore(linked)).status,401);
  assert.equal((await shell(linked)).status,401);
  assert.equal((await login(await start())).status,401);
});

test('parallel challenge creation is capped and removes only unused expired challenges',async()=>{
  const expired='f'.repeat(64);
  await DB.prepare('INSERT INTO auth_google_challenges VALUES (?,?,?)')
    .bind(expired,'unused-expired-challenge',1).run();
  const responses=await Promise.all(Array.from({length:16},()=>
    request('/api/auth/google/challenge')));
  assert.ok(responses.some(response=>response.status===429));
  assert.ok(responses.every(response=>response.status===200||response.status===429));
  assert.equal(await DB.prepare('SELECT count(*) AS n FROM auth_google_challenges').first('n'),12);
  assert.equal(await DB.prepare('SELECT nonce FROM auth_google_challenges WHERE binding_hash=?')
    .bind(expired).first(),null);
});
