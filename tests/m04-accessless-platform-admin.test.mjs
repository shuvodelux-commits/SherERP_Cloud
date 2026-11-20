import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

// Preserve the original Admin HTML/CSS/JS; this entry must not invent another UI.
const files=new Map(['index.html','platform-auth.js','platform-auth.css'].map(name=>{
  const url=new URL('../frontend/platform-auth/'+name,import.meta.url);
  return [url.href,readFileSync(url,'utf8')];
}));
const hooks=registerHooks({load(url,context,next){
  if(files.has(url))return {format:'module',source:'export default '+JSON.stringify(files.get(url)),shortCircuit:true};
  return next(url,context);
}});
const {default:worker}=await import('../src/auth/m04-accessless-platform-admin-worker.js');
hooks.deregister();

const origin='https://admin.hisab.workers.dev';
const issuer='https://accounts.google.com';
const subject='123456789012345678901';
const setupToken='a'.repeat(64);
const nonce='b'.repeat(43);
let current={issuer,subject};
let approvedTicket={issuer,subject,nonce};
let queries=0;
const db={
  prepare(sql){
    queries++;
    const statement={async first(){
      if(sql.includes('FROM platform_first_superadmin'))return current;
      if(sql.includes('FROM platform_setup_tickets'))return approvedTicket;
      assert.fail('unexpected SQL statement');
    },bind(...values){
      return {async first(){
        if(sql.includes('COUNT(*) AS total')){
          assert.deepEqual(values,[issuer,subject]);
          return {total:approvedTicket?1:0,
            approved:Number(approvedTicket?.issuer===issuer&&approvedTicket?.subject===subject)};
        }
        if(sql.includes('FROM platform_setup_tickets'))return approvedTicket;
        assert.fail('unexpected bound SQL');
      }};
    }};
    return statement;
  },
  async batch(){assert.fail('unexpected database write');},
};
const base={
  PLATFORM_AUTH_MODE:'google-totp-without-access',
  PLATFORM_AUTH_SCOPE:'private-platform-auth',
  PLATFORM_AUTH_ORIGIN:origin,
  PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  PLATFORM_OPERATOR_GOOGLE_SUBJECT:subject,
  PLATFORM_TOTP_SECRET:'f'.repeat(40),
  PLATFORM_FACTOR_VERSION:'1',
  CONTROL_DB:db,
  PLATFORM_INGRESS:{async limit(){return {success:true};}},
};
const get=(path='/',env=base,host=origin,headers={})=>worker.fetch(new Request(host+path,{headers}),env,{});
const post=(path,env=base,headers={},body={})=>worker.fetch(
  new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},
    body:JSON.stringify(body)}),env,{});

test('Google/TOTP-only Admin serves original assets without relying on Cloudflare Access',async()=>{
  current={issuer,subject};queries=0;
  for(const [path,name] of [['/','index.html'],['/platform-auth.js','platform-auth.js'],['/platform-auth.css','platform-auth.css']]){
    const reply=await get(path);
    assert.equal(reply.status,200,path);
    assert.equal(await reply.text(),files.get(new URL('../frontend/platform-auth/'+name,import.meta.url).href));
    assert.equal(reply.headers.get('Cache-Control'),'no-store');
  }
  assert.ok(queries>0);
  const unauthenticated=await get('/api/platform/auth/session',base,origin,{
    'Cf-Access-Authenticated-User-Email':'operator@example.test',
    'Cf-Access-Jwt-Assertion':'forged',
    Cookie:'CF_Authorization=forged',
  });
  assert.equal(unauthenticated.status,401,'Access headers are not a platform session');
});

test('fail-closed on wrong host, missing explicit mode, approved identity, factor, limiter or D1',async()=>{
  const wrongHost=await get('/',base,'https://shererp.hisab.workers.dev');
  assert.equal(wrongHost.status,403);
  const missing=['PLATFORM_AUTH_MODE','PLATFORM_OPERATOR_GOOGLE_SUBJECT','PLATFORM_CLIENT_ID',
    'PLATFORM_TOTP_SECRET','PLATFORM_FACTOR_VERSION','PLATFORM_INGRESS','CONTROL_DB'];
  for(const key of missing){
    const result=await get('/',{...base,[key]:undefined});
    assert.equal(result.status,503,key);
  }
  assert.equal((await get('/',{...base,PLATFORM_OPERATOR_GOOGLE_SUBJECT:'not-valid!'})).status,503);
  assert.equal((await get('/',{...base,PLATFORM_FACTOR_VERSION:'0'})).status,503);
  const cleanEntry=await get('/?token=never');
  assert.equal(cleanEntry.status,302,'homepage query parameters are stripped');
  assert.equal(cleanEntry.headers.get('Location'),origin+'/','query input never selects redirect destination');
  assert.equal((await get('/api/platform/auth/session?token=never')).status,400,
    'authentication API query parameters remain unsupported');
  assert.equal((await post('/api/platform/auth/challenge',base,{Origin:'https://attacker.test'})).status,403);
  assert.equal((await post('/api/platform/auth/challenge',base,{Origin:''})).status,403);
});

test('database enrolled Google subject must match explicit administrator subject on every request',async()=>{
  current={issuer,subject:'different-account'};
  assert.equal((await get('/')).status,403);
  assert.equal((await post('/api/platform/auth/challenge')).status,403);
  current={issuer:'accounts.example.test',subject};
  assert.equal((await get('/')).status,403);
  current={issuer,subject};
  assert.equal((await get('/')).status,200);
});

test('before first enrollment only authorized single-use ticket may access setup endpoints',async()=>{
  current=null;
  approvedTicket=null;
  assert.equal((await post('/api/platform/setup/challenge',base,{}, {setupToken})).status,403);
  approvedTicket={issuer,subject:'other-user',nonce};
  assert.equal((await post('/api/platform/setup/challenge',base,{}, {setupToken})).status,403);
  approvedTicket={issuer,subject,nonce};
  const approved=await post('/api/platform/setup/challenge',base,{}, {setupToken});
  assert.equal(approved.status,200);
  assert.deepEqual(await approved.json(),{clientId:base.PLATFORM_CLIENT_ID,nonce});
  assert.equal((await post('/api/platform/auth/challenge')).status,403,
    'unprovisioned Admin must not start ordinary sessions');
  current={issuer,subject};
});

test('all public requests are ingress-limited before touching Control D1',async()=>{
  current={issuer,subject};
  const noDb={
    prepare(){assert.fail('D1 must not be reached after rate-limit denial');},
    batch(){assert.fail('D1 must not be reached after rate-limit denial');},
  };
  const blocked={...base,CONTROL_DB:noDb,PLATFORM_INGRESS:{async limit(){return {success:false};}}};
  const reply=await get('/',blocked);
  assert.equal(reply.status,429);
  assert.equal(reply.headers.get('Cache-Control'),'no-store');
});

test('oversized first-admin setup payload reaches existing bounded Hono body guard',async()=>{
  current=null;approvedTicket={issuer,subject,nonce};
  const huge={setupToken:'a'.repeat(20000)};
  assert.equal((await post('/api/platform/setup/challenge',base,{},huge)).status,413);
  current={issuer,subject};
});

test('ingress rate keys separate Cloudflare client IPs, never X-Forwarded-For',async()=>{
  current={issuer,subject};
  const keys=[];
  const env={...base,PLATFORM_INGRESS:{async limit({key}){keys.push(key);return {success:true};}}};
  for(const address of ['203.0.113.9','198.51.100.18']){
    const response=await get('/',env,origin,{
      'CF-Connecting-IP':address,'X-Forwarded-For':'attacker-controlled',
    });
    assert.equal(response.status,200);
  }
  assert.equal(keys.length,2);
  assert.notEqual(keys[0],keys[1]);
  assert.ok(keys.every(key=>!key.includes('attacker-controlled')));
});
