import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {bootstrapPlatformSuperAdmin} from '../../src/auth/platform-superadmin-bootstrap.js';

const clientId='101-fixture.apps.googleusercontent.com';
const issuer='https://accounts.google.com';
const subject='101000000000000000001';
const otherSubject='101000000000000000002';
const kid='m04-platform-fixture';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256'};
const encode=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
const hash=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');

const harness=createTestHarness({workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]});
let db;
before(async()=>{
  await harness.listen();
  const worker=harness.getWorker('shererp-m04-auth-http-local-only');
  ({DB:db}=await worker.getEnv());
  const schema=await readFile(new URL('../fixtures/m04-platform-bootstrap.sql',import.meta.url),'utf8');
  await db.batch(schema.trim().split('-- next statement').map(text=>db.prepare(text.trim())));
});
after(()=>harness.close());

function signedCredential(nonce,overrides={}){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,sub:subject,aud:clientId,nonce,email_verified:true,iat:now-1,exp:now+60,...overrides};
  const input=encode({alg:'RS256',kid})+'.'+encode(claims);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}

async function makeTicket({expectedSubject=subject,expired=false,revoked=false}={}){
  const token=randomBytes(32).toString('hex');
  const nonce=randomBytes(32).toString('base64url');
  const now=Date.now();
  const expires=expired?now-1000:now+60_000;
  await db.prepare(`INSERT INTO platform_setup_tickets
    (token_hash,nonce,issuer,subject,issued_at_ms,expires_at_ms,revoked_at_ms)
    VALUES (?,?,?,?,?,?,?)`).bind(hash(token),nonce,issuer,expectedSubject,now-5000,expires,revoked?now:null).run();
  return {token,nonce};
}

function supplyGoogleKeys(t,readKeys=()=>{}){
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',(url,options)=>{
    if(url!=='https://www.googleapis.com/oauth2/v3/certs')return realFetch(url,options);
    readKeys();
    return Promise.resolve(Response.json({keys:[jwk]}));
  });
}

const bootstrap=(ticket,credential=signedCredential(ticket.nonce))=>
  bootstrapPlatformSuperAdmin({controlDb:db,clientId,setupToken:ticket.token,credential});

test('denies wrong credentials, nonce, and unapproved Google identity',async t=>{
  supplyGoogleKeys(t);
  const ticket=await makeTicket();
  for(const credential of [
    signedCredential(ticket.nonce,{sub:otherSubject}),
    signedCredential(ticket.nonce,{aud:'102-other.apps.googleusercontent.com'}),
    signedCredential(randomBytes(32).toString('base64url')),
    signedCredential(ticket.nonce,{email_verified:false}),
  ])assert.equal(await bootstrap(ticket,credential),false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM platform_first_superadmin').first()).count,0);
});

test('expired, revoked and unknown tickets reach neither Google nor enrollment',async t=>{
  supplyGoogleKeys(t,()=>assert.fail('Google keys must not be fetched for invalid tickets'));
  assert.equal(await bootstrap(await makeTicket({expired:true})),false);
  assert.equal(await bootstrap(await makeTicket({revoked:true})),false);
  assert.equal(await bootstrap({token:randomBytes(32).toString('hex'),nonce:randomBytes(32).toString('base64url')}),false);
});

test('rechecks revocation at insert even when the credential was already being verified',async t=>{
  const ticket=await makeTicket();
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url!=='https://www.googleapis.com/oauth2/v3/certs')return realFetch(url,options);
    await db.prepare('UPDATE platform_setup_tickets SET revoked_at_ms=? WHERE token_hash=?')
      .bind(Date.now(),hash(ticket.token)).run();
    return Response.json({keys:[jwk]});
  });
  assert.equal(await bootstrap(ticket),false);
});

test('exactly one first Super Admin is created across parallel tickets and replays',async t=>{
  supplyGoogleKeys(t);
  const first=await makeTicket();
  const second=await makeTicket({expectedSubject:otherSubject});
  const firstAssertion=signedCredential(first.nonce);
  const secondAssertion=signedCredential(second.nonce,{sub:otherSubject});
  const results=await Promise.all([
    bootstrap(first,firstAssertion),bootstrap(second,secondAssertion),bootstrap(first,firstAssertion),
  ]);
  assert.equal(results.filter(Boolean).length,1);
  const [row]=((await db.prepare('SELECT * FROM platform_first_superadmin').all()).results);
  assert.equal(row.singleton,1);
  assert.equal(row.issuer,issuer);
  const firstWon=results[0]||results[2];
  assert.equal(row.subject,firstWon?subject:otherSubject);
  assert.equal(row.setup_token_hash,hash((firstWon?first:second).token));
  assert.ok(Number.isSafeInteger(row.enrolled_at_ms));
  assert.equal(await bootstrap(first,firstAssertion),false);
  assert.equal(await bootstrap(second,secondAssertion),false);
  await assert.rejects(db.prepare('DELETE FROM platform_first_superadmin').run());
  await assert.rejects(db.prepare("UPDATE platform_first_superadmin SET subject='different'").run());
  await assert.rejects(db.prepare(`INSERT OR REPLACE INTO platform_first_superadmin VALUES (1,?,?,?,?)`)
    .bind(row.issuer,otherSubject,row.setup_token_hash,row.enrolled_at_ms).run());
  assert.deepEqual(await db.prepare('SELECT * FROM platform_first_superadmin').first(),row);
});
