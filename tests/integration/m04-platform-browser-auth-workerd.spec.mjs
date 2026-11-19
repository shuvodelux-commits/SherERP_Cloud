import assert from 'node:assert/strict';
import {createHash,createHmac,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
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
const pilotDatabaseId=randomUUID();
const otherDatabaseId=randomUUID();
let db,env,pilotDb,otherDb,harness,directory;

before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'shererp-private-binding-proof-'));
  const configPath=join(directory,'wrangler.json');
  const config=JSON.parse(await readFile('./wrangler.m04-auth-http-test.jsonc','utf8'));
  config.main=resolve(config.main);
  config.d1_databases[0].migrations_dir=resolve(config.d1_databases[0].migrations_dir);
  config.d1_databases.push(
    {binding:'PILOT_DB',database_name:'fixture-pilot',database_id:pilotDatabaseId,remote:false},
    {binding:'OTHER_DB',database_name:'fixture-other',database_id:otherDatabaseId,remote:false},
  );
  await writeFile(configPath,JSON.stringify(config),{mode:0o600});
  harness=createTestHarness({workers:[{configPath}]});
  await harness.listen();
  ({DB:db,PILOT_DB:pilotDb,OTHER_DB:otherDb}=await harness.getWorker(config.name).getEnv());
  for(const name of ['0001_platform_bootstrap','0002_platform_sessions']){
    const sql=await readFile(new URL('../../staging-migrations/platform-auth/'+name+'.sql',import.meta.url),'utf8');
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
after(async()=>{
  try{await harness?.close();}finally{if(directory)await rm(directory,{recursive:true,force:true});}
});

function credential(nonce,googleSubject=subject){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:googleSubject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+120};
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
    ...env,CONTROL_DB:{
      prepare(){assert.fail('D1 must not be reached');},
      batch(){assert.fail('D1 must not be reached');},
    },
    PLATFORM_INGRESS:{async limit(){return {success:false};}},
  };
  assert.equal((await call(path,{urlOrigin:'https://other.example.test',bindings:guarded})).status,403);
  assert.equal((await call(path,{requestOrigin:'https://other.example.test',bindings:guarded})).status,403);
  assert.equal((await call(path,{requestOrigin:null,bindings:guarded})).status,403);
  assert.equal((await call(path,{bindings:{...guarded,PLATFORM_INGRESS:undefined}})).status,503);
  assert.equal((await call(path,{bindings:guarded})).status,429);
  assert.equal((await call(path+'?token=synthetic',{bindings:guarded})).status,400);
  assert.equal((await call('/api/platform/tenants',{bindings:guarded})).status,404);
  assert.equal((await call('/api/platform/auth/login',{payload:{credential:'x'.repeat(10241),code:'123456'},
    bindings:{...guarded,PLATFORM_INGRESS:env.PLATFORM_INGRESS}})).status,413);
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
  const pending=await call('/api/platform/auth/challenge');
  const pendingCookie=cookie(pending,'__Host-shererp-platform-challenge');
  const {nonce:pendingNonce}=await pending.json();
  let interrupted=false;
  const queuedDb={
    batch:db.batch.bind(db),
    prepare(sql){
      const statement=db.prepare(sql);
      if(!sql.includes('INSERT INTO platform_admin_sessions'))return statement;
      return {bind(...values){
        const bound=statement.bind(...values);
        return {async first(){
          interrupted=true;
          assert.equal((await call('/api/platform/auth/logout',{cookie:pendingCookie})).status,200);
          return bound.first();
        }};
      }};
    },
  };
  const queued=await call('/api/platform/auth/login',{
    cookie:pendingCookie,bindings:{...env,CONTROL_DB:queuedDb},
    payload:{credential:credential(pendingNonce),code:await authenticatorCode()},
  });
  assert.equal(interrupted,true,'sign-out must run while the session write is queued');
  assert.equal(queued.status,401,'queued login may not mint a session after sign-out');

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
  const shopPath='/api/platform/shops';
  const shopPayload={operationId:randomUUID(),displayName:'  আমার দোকান  '};
  const shopRequest={payload:shopPayload,cookie:session};
  assert.equal((await call(shopPath,shopRequest)).status,404,'disabled by default');
  assert.equal((await publicWorker.fetch(new Request(origin+shopPath,{method:'POST'}),{})).status,404);
  const bindings={...env,PLATFORM_SHOP_RESERVATION_ENABLED:'true'};
  const enabledSession=await call(sessionPath,{method:'GET',cookie:session,bindings});
  assert.equal(enabledSession.status,200);
  assert.deepEqual(await enabledSession.json(),{role:'PlatformSuperAdmin',shopReservationEnabled:true});
  assert.equal((await call(sessionPath,{method:'GET',cookie:browser,bindings})).status,401);
  assert.equal((await call(shopPath,{...shopRequest,bindings,requestOrigin:'https://other.example.test'})).status,403);
  assert.equal((await call(shopPath,{payload:shopPayload,cookie:browser,bindings})).status,401,
    'a Google challenge cookie does not grant platform write access');

  const reservationMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0001_shop_reservations.sql',import.meta.url),'utf8');
  await db.batch(reservationMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  assert.equal((await call(shopPath,{...shopRequest,bindings,payload:{...shopPayload,owner:'forged'}})).status,400);
  const [first,retry]=await Promise.all([call(shopPath,{...shopRequest,bindings}),call(shopPath,{...shopRequest,bindings})]);
  assert.deepEqual([first.status,retry.status].sort(),[200,201]);
  const reservation=await first.json();
  assert.deepEqual(await retry.json(),reservation);
  assert.match(reservation.shopId,/^[0-9a-f-]{36}$/);
  assert.equal(reservation.displayName,'আমার দোকান');
  assert.equal(reservation.status,'reserved');
  assert.equal((await call(shopPath,{...shopRequest,bindings,payload:{...shopPayload,displayName:'Different business'}})).status,409);
  assert.deepEqual(await db.prepare('SELECT count(*) AS n,min(created_by_subject) AS creator FROM platform_shop_reservations').first(),
    {n:1,creator:subject});
  await assert.rejects(db.prepare('UPDATE platform_shop_reservations SET display_name=?').bind('Altered').run(),/immutable/);
  await assert.rejects(db.prepare('DELETE FROM platform_shop_reservations').run(),/immutable/);

  await assert.rejects(db.prepare(`INSERT OR REPLACE INTO platform_shop_reservations
    SELECT shop_id,operation_id,'Altered',created_by_subject,created_at_ms FROM platform_shop_reservations`).run(),/immutable/);
  const verifyPath='/api/platform/shops/verify-binding';
  const verifyRequest={cookie:session,payload:{shopId:reservation.shopId}};
  assert.equal((await call(verifyPath,verifyRequest)).status,404,'binding verification is disabled by default');
  assert.equal((await call(verifyPath,{...verifyRequest,bindings:{...bindings,PLATFORM_SHOP_BINDING_ENABLED:'true'}})).status,503,
    'enabling without a trusted shop mapping must fail closed');

  const pilotMarker=randomUUID();
  const verifyBindings={...bindings,PLATFORM_SHOP_BINDING_ENABLED:'true',PLATFORM_PILOT_DB:pilotDb,
    PLATFORM_PILOT_SHOP_ID:reservation.shopId,PLATFORM_PILOT_D1_ID:pilotDatabaseId,PLATFORM_PILOT_MARKER:pilotMarker};
  assert.equal((await publicWorker.fetch(new Request(origin+verifyPath,{method:'POST'}),{})).status,404);
  const verify=async(extra={})=>call(verifyPath,{...verifyRequest,bindings:verifyBindings,...extra});
  assert.equal((await verify({cookie:browser})).status,401);
  assert.equal((await verify({payload:{shopId:reservation.shopId,databaseId:pilotDatabaseId}})).status,400);
  assert.equal((await verify({payload:{shopId:randomUUID()}})).status,404);
  assert.equal((await verify()).status,409,'a shop with no identity row must not be marked verified');

  const controlMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0002_shop_bindings.sql',import.meta.url),'utf8');
  await db.batch(controlMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  const shopMigration=await readFile(new URL('../../staging-migrations/shop-identity/0001_shop_identity.sql',import.meta.url),'utf8');
  for(const [shop,databaseId] of [[pilotDb,pilotDatabaseId],[otherDb,otherDatabaseId]]){
    await shop.batch(shopMigration.trim().split('-- next statement').map(statement=>shop.prepare(statement.trim())));
    await shop.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').bind(reservation.shopId,databaseId,pilotMarker).run();
  }
  const swapped={...verifyBindings,PLATFORM_PILOT_DB:otherDb};
  assert.equal((await verify({bindings:swapped})).status,409);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,0);
  let invalidated=false;
  const bindingRaceDb={
    prepare:db.prepare.bind(db),
    async batch(statements){
      await db.prepare('UPDATE platform_admin_sessions SET factor_version=2').run();
      invalidated=true;
      return db.batch(statements);
    },
  };
  try{
    assert.equal((await verify({bindings:{...verifyBindings,CONTROL_DB:bindingRaceDb}})).status,401);
    assert.equal(invalidated,true,'the session became stale immediately before the receipt write');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_bindings').first()).n,0);
  }finally{
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=1').run();
  }
  const invitePath='/api/platform/shops/invite-owner';
  const inviteRequest={cookie:session,payload:{googleSubject:'654000000000000000002'}};
  assert.equal((await call(invitePath,inviteRequest)).status,404);
  assert.equal((await publicWorker.fetch(new Request(origin+invitePath,{method:'POST'}),{})).status,404);
  const inviteBindings={...verifyBindings,PLATFORM_OWNER_INVITATION_ENABLED:'true',PLATFORM_OWNER_CLIENT_ID:clientId};
  const invite=(options={})=>call(invitePath,{...inviteRequest,bindings:inviteBindings,...options});
  assert.equal((await invite({cookie:browser})).status,401);
  assert.equal((await invite({requestOrigin:'https://other.example.test'})).status,403);
  assert.equal((await invite({payload:{...inviteRequest.payload,shopId:reservation.shopId}})).status,400);
  assert.equal((await invite({bindings:{...inviteBindings,PLATFORM_PILOT_DB:otherDb}})).status,409);
  const inviteMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0003_owner_invitations.sql',import.meta.url),'utf8');
  await db.batch(inviteMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  const membershipMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0004_first_shop_owner.sql',import.meta.url),'utf8');
  await db.batch(membershipMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  assert.equal((await invite()).status,409,'the live shop identity is not sufficient without a binding receipt');
  const results=await Promise.all([verify(),verify()]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,201]);
  for(const result of results)assert.deepEqual(await result.json(),{shopId:reservation.shopId,status:'binding-verified'});
  assert.equal((await verify({bindings:swapped})).status,409,'a previous receipt cannot hide a swapped binding');
  assert.deepEqual(await db.prepare('SELECT shop_id, database_id, verified_by_subject FROM platform_shop_bindings').first(),
    {shop_id:reservation.shopId,database_id:pilotDatabaseId,verified_by_subject:subject});
  await assert.rejects(db.prepare('DELETE FROM platform_shop_bindings').run(),/immutable/);
  await assert.rejects(pilotDb.prepare('UPDATE shop_identity SET database_id=?').bind(otherDatabaseId).run(),/immutable/);

  const inviteSession=await call(sessionPath,{method:'GET',cookie:session,bindings:inviteBindings});
  assert.equal((await inviteSession.json()).ownerInvitationShopId,reservation.shopId);
  let staleAtWrite=false;
  const invitationRaceDb={
    batch:db.batch.bind(db),
    prepare(sql){
      const statement=db.prepare(sql);
      if(!sql.includes('INSERT INTO platform_owner_invitations'))return statement;
      return {bind(...values){
        const bound=statement.bind(...values);
        return {async first(){
          await db.prepare('UPDATE platform_admin_sessions SET factor_version=2').run();
          staleAtWrite=true;
          return bound.first();
        }};
      }};
    },
  };
  try{
    assert.equal((await invite({bindings:{...inviteBindings,CONTROL_DB:invitationRaceDb}})).status,409);
    assert.equal(staleAtWrite,true);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_owner_invitations').first()).n,0);
  }finally{
    await db.prepare('UPDATE platform_admin_sessions SET factor_version=1').run();
  }
  const invitations=await Promise.all([invite(),invite()]);
  assert.deepEqual(invitations.map(response=>response.status).sort(),[201,409]);
  const winner=invitations.find(response=>response.status===201);
  assert.equal(winner.headers.get('Cache-Control'),'no-store');
  const {inviteCode,expiresAtMs}=await winner.json();
  assert.match(inviteCode,/^[a-f0-9]{64}$/);
  assert.ok(expiresAtMs>Date.now());
  const issued=await db.prepare('SELECT token_hash,shop_id,recipient_subject,issued_by_subject FROM platform_owner_invitations').first();
  assert.deepEqual(issued,{token_hash:hash(inviteCode),shop_id:reservation.shopId,
    recipient_subject:inviteRequest.payload.googleSubject,issued_by_subject:subject});
  assert.equal((await invite()).status,409);
  await assert.rejects(db.prepare('DELETE FROM platform_owner_invitations').run(),/immutable/);

  const {readOwnerInviteChallenge,acceptOwnerInvite}=await import('../../src/auth/platform-owner-acceptance.js');
  const {issueOwnerSession,validateOwnerSession,revokeOwnerSession}=await import('../../src/auth/platform-owner-sessions.js');
  const ownerSessionMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0005_owner_sessions.sql',import.meta.url),'utf8');
  await db.batch(ownerSessionMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  const expiredCode=randomBytes(32).toString('hex');
  await db.prepare(`INSERT INTO platform_owner_invitations
    (token_hash,shop_id,recipient_issuer,recipient_subject,issued_by_subject,issued_at_ms,expires_at_ms)
    VALUES (?,?,?,?,?,1,2)`).bind(hash(expiredCode),reservation.shopId,issuer,inviteRequest.payload.googleSubject,subject).run();
  assert.equal(await readOwnerInviteChallenge(inviteBindings,expiredCode),null);
  assert.equal(await readOwnerInviteChallenge(inviteBindings,randomBytes(32).toString('hex')),null);
  const nonceForOwner=await readOwnerInviteChallenge(inviteBindings,inviteCode);
  assert.match(nonceForOwner,/^[A-Za-z0-9_-]{43}$/);
  const accept=(googleCredential,bindings=inviteBindings)=>acceptOwnerInvite(bindings,{inviteCode,credential:googleCredential});
  const ownerCredential=credential(nonceForOwner,inviteRequest.payload.googleSubject);
  assert.equal(await accept(credential(nonceForOwner)),null);
  assert.equal(await accept(credential(setupNonce,inviteRequest.payload.googleSubject)),null);
  assert.equal(await accept(ownerCredential,{...inviteBindings,PLATFORM_PILOT_DB:otherDb}),null);
  const {default:ownerWorker}=await import('../../src/m03-owner-redemption-worker.js');
  const ownerOrigin='https://owner.example.test';
  const ownerBindings={...inviteBindings,OWNER_REDEMPTION_ENABLED:'true',OWNER_AUTH_ORIGIN:ownerOrigin,
    OWNER_INGRESS:{limit:async()=>({success:true})}};
  const ownerCall=(path,data,{browserCookie,originHeader=ownerOrigin,bindings=ownerBindings}={})=>ownerWorker.fetch(
    new Request(ownerOrigin+'/api/owner/setup'+path,{
      method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json',...(browserCookie?{Cookie:browserCookie}:{})},
      body:JSON.stringify(data),
    }),bindings);
  assert.equal((await ownerCall('/challenge',{inviteCode},{bindings:inviteBindings})).status,404);
  assert.equal((await ownerCall('/challenge',{inviteCode},{originHeader:origin})).status,403);
  assert.equal((await ownerCall('/challenge',{inviteCode},{bindings:{...ownerBindings,OWNER_INGRESS:{limit:async()=>({success:false})}}})).status,429);
  assert.equal((await ownerCall('/challenge',{inviteCode,shopId:reservation.shopId})).status,400);
  assert.equal((await ownerCall('',{credential:ownerCredential})).status,401);
  const ownerChallenge=await ownerCall('/challenge',{inviteCode});
  assert.equal(ownerChallenge.status,200);
  assert.equal(ownerChallenge.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await ownerChallenge.json(),{clientId,nonce:nonceForOwner});
  const ownerCookie=cookie(ownerChallenge,'__Host-shererp-owner-invite');
  let redemptionPermits=0;
  const redeem=()=>ownerCall('',{credential:ownerCredential},{browserCookie:ownerCookie,
    bindings:{...ownerBindings,OWNER_INGRESS:{limit:async()=>{redemptionPermits++;return {success:true};}}}});

  const accepted=await Promise.all([redeem(),redeem()]);
  assert.deepEqual(accepted.map(result=>result.status).sort(),[201,401]);
  assert.equal(redemptionPermits,2);
  const acceptedResponse=accepted.find(result=>result.status===201);
  assert.deepEqual(await acceptedResponse.json(),{shopId:reservation.shopId,role:'Owner'});
  assert.equal(acceptedResponse.headers.getSetCookie().length,1);
  assert.ok(acceptedResponse.headers.getSetCookie().every(value=>value.startsWith('__Host-shererp-owner-invite=')&&value.includes('Max-Age=0')));
  assert.equal(await readOwnerInviteChallenge(inviteBindings,inviteCode),null);
  assert.equal(await accept(ownerCredential),null);
  assert.equal((await invite()).status,409);
  await assert.rejects(db.prepare('DELETE FROM platform_first_shop_owners').run(),/immutable/);

  const ownerLoginMigration=await readFile(new URL('../../staging-migrations/platform-onboarding/0006_owner_login_challenges.sql',import.meta.url),'utf8');
  await db.batch(ownerLoginMigration.trim().split('-- next statement').map(statement=>db.prepare(statement.trim())));
  const ownerIdentity={issuer,subject:inviteRequest.payload.googleSubject};
  assert.equal(await issueOwnerSession(inviteBindings,{issuer,subject}),null);
  const firstOwnerSession=await issueOwnerSession(inviteBindings,ownerIdentity);
  assert.match(firstOwnerSession,/^[a-f0-9]{64}$/);
  await db.prepare('UPDATE platform_shop_owner_sessions SET issued_at_ms=1').run();
  const ownerScope={shopId:reservation.shopId,role:'Owner'};
  assert.deepEqual(await validateOwnerSession(inviteBindings,firstOwnerSession),ownerScope);
  assert.equal(await validateOwnerSession(swapped,firstOwnerSession),null);
  assert.equal(await validateOwnerSession(inviteBindings,session.split('=')[1]),null);
  const anotherOwnerSession=await issueOwnerSession(inviteBindings,ownerIdentity);
  assert.equal(await validateOwnerSession(inviteBindings,firstOwnerSession),null);
  assert.deepEqual(await validateOwnerSession(inviteBindings,anotherOwnerSession),ownerScope);
  assert.equal(await revokeOwnerSession(inviteBindings,firstOwnerSession),false);
  assert.equal(await revokeOwnerSession(inviteBindings,anotherOwnerSession),true);
  assert.equal(await validateOwnerSession(inviteBindings,anotherOwnerSession),null);
  const remainingOwnerSession=await issueOwnerSession(inviteBindings,ownerIdentity);
  await db.prepare('UPDATE platform_shop_owner_access SET enabled=0').run();
  assert.equal(await validateOwnerSession(inviteBindings,remainingOwnerSession),null);
  assert.equal(await issueOwnerSession(inviteBindings,ownerIdentity),null);
  await db.prepare('UPDATE platform_shop_owner_access SET enabled=1').run();
  assert.equal(await validateOwnerSession(inviteBindings,remainingOwnerSession),null);

  const ownerAuth=(path,{data,browserCookie,method='POST',bindings={...ownerBindings,OWNER_LOGIN_ENABLED:'true'}}={})=>ownerWorker.fetch(
    new Request(ownerOrigin+'/api/owner/auth/'+path,{
      method,headers:{...(method==='POST'?{Origin:ownerOrigin}:{}),...(data?{'Content-Type':'application/json'}:{}),
        ...(browserCookie?{Cookie:browserCookie}:{})},body:data?JSON.stringify(data):undefined,
    }),bindings);
  assert.equal((await ownerAuth('challenge',{bindings:ownerBindings})).status,404);
  const freshChallenge=await ownerAuth('challenge');
  assert.equal(freshChallenge.status,200);
  const loginCookie=cookie(freshChallenge,'__Host-shererp-owner-login');
  const {nonce:ownerLoginNonce}=await freshChallenge.json();
  const loginData={credential:credential(ownerLoginNonce,ownerIdentity.subject)};
  assert.equal((await ownerAuth('login',{data:loginData})).status,401);
  const loginResults=await Promise.all([ownerAuth('login',{data:loginData,browserCookie:loginCookie}),
    ownerAuth('login',{data:loginData,browserCookie:loginCookie})]);
  assert.deepEqual(loginResults.map(response=>response.status).sort(),[200,401]);
  const ownerSessionCookie=cookie(loginResults.find(response=>response.status===200),'__Host-shererp-owner-session');
  assert.deepEqual(await (await ownerAuth('session',{method:'GET',browserCookie:ownerSessionCookie})).json(),ownerScope);
  assert.equal((await ownerAuth('session',{method:'GET',browserCookie:session})).status,401);
  const loginThrottled={...ownerBindings,OWNER_LOGIN_ENABLED:'true',OWNER_INGRESS:{
    limit:async({key})=>({success:key!=='/api/owner/auth/challenge'}),
  }};
  assert.equal((await ownerAuth('challenge',{bindings:loginThrottled})).status,429);
  assert.equal((await ownerAuth('logout',{browserCookie:ownerSessionCookie,bindings:loginThrottled})).status,200);
  assert.equal((await ownerAuth('session',{method:'GET',browserCookie:ownerSessionCookie})).status,401);
  const cancelled=await ownerAuth('challenge');
  const cancelledCookie=cookie(cancelled,'__Host-shererp-owner-login');
  const {nonce:cancelledNonce}=await cancelled.json();
  assert.equal((await ownerAuth('logout',{browserCookie:cancelledCookie})).status,200);
  assert.equal((await ownerAuth('login',{browserCookie:cancelledCookie,
    data:{credential:credential(cancelledNonce,ownerIdentity.subject)}})).status,401);

  let signedOut=false;
  const reservationRaceDb={
    prepare:db.prepare.bind(db),
    async batch(statements){
      const logout=await call('/api/platform/auth/logout',{cookie:browser});
      assert.equal(logout.status,200);
      assert.ok(logout.headers.getSetCookie().some(value=>value.includes('Max-Age=0')));
      signedOut=true;
      return db.batch(statements);
    },
  };
  const revokedWrite=await call(shopPath,{
    ...shopRequest,payload:{...shopPayload,operationId:randomUUID()},bindings:{...bindings,CONTROL_DB:reservationRaceDb},
  });
  assert.equal(signedOut,true,'sign-out ran immediately before the reservation batch');
  assert.equal(revokedWrite.status,401);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM platform_shop_reservations').first()).n,1);
  assert.equal((await call(sessionPath,{method:'GET',cookie:session})).status,401,
    'sign-out revokes a session issued before its cookie arrived');
  assert.equal((await call(shopPath,{...shopRequest,bindings})).status,401);
  assert.equal((await verify()).status,401);
  assert.equal((await invite()).status,401);
  assert.equal((await call('/api/platform/auth/logout',{cookie:session})).status,200);
});

test('D1 limits parallel browser challenge creation before external verification',async()=>{
  const responses=await Promise.all(Array.from({length:12},()=>call('/api/platform/auth/challenge')));
  const accepted=responses.filter(r=>r.status===200).length;
  assert.ok(accepted>=1 && accepted<=8);
  assert.ok(responses.some(r=>r.status===429));
  assert.ok(responses.every(r=>[200,429].includes(r.status)));
  const issued=await db.prepare(`SELECT count(*) AS n FROM platform_login_challenges
    WHERE expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)+60000`).first();
  assert.equal(issued.n,8);
  for(const denied of responses.filter(r=>r.status===429)){
    assert.equal(denied.headers.has('Set-Cookie'),false);
  }
});
