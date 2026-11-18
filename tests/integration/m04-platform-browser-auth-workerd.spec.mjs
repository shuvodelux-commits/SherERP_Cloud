import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import worker from '../../src/m03-private-platform-auth-worker.js';
import publicWorker from '../../src/index.js';

const origin='https://platform.example.test';
const clientId='654-fixture.apps.googleusercontent.com';
const issuer='https://accounts.google.com';
const subject='654000000000000000001';
const secret=randomBytes(20);
const ticket=randomBytes(32).toString('hex');
const setupNonce=randomBytes(32).toString('base64url');
const kid='m04-platform-browser-key';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
let db,env;

before(async()=>{
  await harness.listen();
  ({DB:db}=await harness.getWorker('shererp-m04-auth-http-local-only').getEnv());
  for(const name of ['m04-platform-bootstrap','m04-platform-session']){
    const sql=await readFile(new URL('../fixtures/'+name+'.sql',import.meta.url),'utf8');
    await db.batch(sql.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  }
  const now=Date.now();
  await db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
    .bind(hash(ticket),setupNonce,issuer,subject,now-1000,now+120_000).run();
  env={
    PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,PLATFORM_CLIENT_ID:clientId,
    PLATFORM_TOTP_SECRET:secret.toString('hex'),PLATFORM_FACTOR_VERSION:'1',CONTROL_DB:db,
    PLATFORM_INGRESS:{async limit(){return {success:true};}},
  };
});
after(()=>harness.close());

function credential(nonce){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:subject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+120};
  const input=encode({alg:'RS256',kid})+'.'+encode(claims);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}

async function authenticatorCode(){
  const row=await db.prepare("SELECT CAST(unixepoch('subsec')/30 AS INTEGER) AS step").first();
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(row.step));
  const mac=createHmac('sha1',secret).update(counter).digest();
  const offset=mac.at(-1)&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');
}

function googleKeys(t){
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,options)=>url==='https://www.googleapis.com/oauth2/v3/certs'
    ?Promise.resolve(Response.json({keys:[jwk]})):realFetch(url,options));
}

const call=(path,{method='POST',payload,cookie,requestOrigin=origin,urlOrigin=origin,bindings=env}={})=>{
  const headers=new Headers();
  if(method==='POST'&&requestOrigin)headers.set('Origin',requestOrigin);
  if(payload!==undefined)headers.set('Content-Type','application/json');
  if(cookie)headers.set('Cookie',cookie);
  return worker.fetch(new Request(urlOrigin+path,{
    method,headers,body:payload===undefined?undefined:JSON.stringify(payload),
  }),bindings);
};
function cookie(response,name){
  const line=response.headers.getSetCookie().find(value=>value.startsWith(name+'='));
  assert.ok(line,name);
  for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(line.includes('; '+flag),flag);
  assert.doesNotMatch(line,/; Domain=/i);
  return line.split(';')[0];
}

test('private platform auth requires trusted exact origin and an ingress limiter before touching D1',async()=>{
  const path='/api/platform/auth/challenge';
  const guarded={
    ...env,CONTROL_DB:{prepare(){assert.fail('D1 must not be reached');}},
    PLATFORM_INGRESS:{async limit(){return {success:false};}},
  };
  assert.equal((await call(path,{urlOrigin:'https://other.example.test',bindings:guarded})).status,403);
  assert.equal((await call(path,{requestOrigin:'https://other.example.test',bindings:guarded})).status,403);
  assert.equal((await call(path,{requestOrigin:null,bindings:guarded})).status,403);
  assert.equal((await call(path,{bindings:{...guarded,PLATFORM_INGRESS:undefined}})).status,503);
  assert.equal((await call(path,{bindings:guarded})).status,429);
  assert.equal((await call(path+'?token=synthetic',{bindings:guarded})).status,400);
  assert.equal((await call('/api/platform/tenants',{bindings:guarded})).status,404);
  assert.equal((await publicWorker.fetch(new Request(origin+path,{method:'POST'}),{})).status,404);
});

test('operator ticket setup and MFA login use separate browser cookies and real D1 sessions',async t=>{
  googleKeys(t);
  const setupChallenge=await call('/api/platform/setup/challenge',{payload:{setupToken:ticket}});
  assert.equal(setupChallenge.status,200);
  assert.deepEqual(await setupChallenge.json(),{clientId,nonce:setupNonce});
  const setupCookie=cookie(setupChallenge,'__Host-shererp-platform-setup');
  const setupPayload={credential:credential(setupNonce)};
  assert.equal((await call('/api/platform/setup',{payload:setupPayload})).status,401);
  const setup=await call('/api/platform/setup',{payload:setupPayload,cookie:setupCookie});
  assert.equal(setup.status,200);
  assert.deepEqual(await setup.json(),{enrolled:true});
  assert.ok(setup.headers.getSetCookie().every(value=>!value.startsWith('__Host-shererp-platform-session=')));
  assert.equal((await call('/api/platform/setup',{payload:setupPayload,cookie:setupCookie})).status,401);

  await db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)').run();
  const challenge=await call('/api/platform/auth/challenge');
  assert.equal(challenge.status,200);
  assert.equal(challenge.headers.get('Cache-Control'),'no-store');
  const browser=cookie(challenge,'__Host-shererp-platform-challenge');
  const {nonce,clientId:actualClient}=await challenge.json();
  assert.equal(actualClient,clientId);
  const payload={credential:credential(nonce),code:await authenticatorCode()};
  assert.equal((await call('/api/platform/auth/login',{payload})).status,401);
  const login=await call('/api/platform/auth/login',{payload,cookie:browser});
  assert.equal(login.status,200);
  assert.deepEqual(await login.json(),{role:'PlatformSuperAdmin'});
  const session=cookie(login,'__Host-shererp-platform-session');
  assert.equal((await call('/api/platform/auth/login',{payload,cookie:browser})).status,401);

  const sessionPath='/api/platform/auth/session';
  const restore=await call(sessionPath,{method:'GET',cookie:session});
  assert.equal(restore.status,200);
  assert.deepEqual(await restore.json(),{role:'PlatformSuperAdmin'});
  assert.equal((await call(sessionPath,{method:'GET',cookie:browser})).status,401);
  const logout=await call('/api/platform/auth/logout',{cookie:session});
  assert.equal(logout.status,200);
  assert.ok(logout.headers.getSetCookie().some(value=>value.includes('Max-Age=0')));
  assert.equal((await call(sessionPath,{method:'GET',cookie:session})).status,401);
});

test('D1 limits parallel browser challenge creation before external verification',async()=>{
  const responses=await Promise.all(Array.from({length:12},()=>call('/api/platform/auth/challenge')));
  const accepted=responses.filter(r=>r.status===200).length;
  assert.ok(accepted>=1 && accepted<=8);
  assert.ok(responses.some(r=>r.status===429));
  assert.ok(responses.every(r=>[200,429].includes(r.status)));
  for(const denied of responses.filter(r=>r.status===429)){
    assert.equal(denied.headers.has('Set-Cookie'),false);
  }
});
