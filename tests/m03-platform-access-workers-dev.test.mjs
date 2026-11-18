import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import worker from '../src/m03-access-platform-auth-worker.js';
import publicWorker from '../src/index.js';

const origin='https://admin-hisabiq.agnishuvo.workers.dev';
const issuer='https://agnishuvo.cloudflareaccess.com';
const audience='a'.repeat(64);
const email='operator@example.test';
const keyId='access-fixture';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const badKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
const jwk={...publicKey.export({format:'jwk'}),kid:keyId,alg:'RS256'};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function assertion(overrides={},key=privateKey){
  const now=Math.floor(Date.now()/1000);
  const claims={iss:issuer,aud:[audience],email,sub:'access-fixture-user',type:'app',iat:now-1,exp:now+600,...overrides};
  const input=encode({alg:'RS256',kid:keyId})+'.'+encode(claims);
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
}

const bindings={
  PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,
  PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  PLATFORM_ACCESS_AUDIENCE:audience,PLATFORM_ACCESS_EMAIL:email,
  CONTROL_DB:{prepare(){assert.fail('D1 was not expected');},batch(){assert.fail('D1 was not expected');}},
  PLATFORM_INGRESS:{limit(){assert.fail('Ingress was not expected');}},
  ASSETS:{async fetch(){return new Response('Private fixture');}},
};

function request(path,{token,base=origin,method='GET',extra={}}={}){
  const headers=new Headers(extra);
  if(token)headers.set('Cf-Access-Jwt-Assertion',token);
  if(method==='POST'&&!headers.has('Origin'))headers.set('Origin',base);
  return new Request(base+path,{method,headers});
}

function trustFixtureKeys(t){
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,issuer+'/cdn-cgi/access/certs');
    assert.equal(options.redirect,'error');
    return Response.json({keys:[jwk]});
  });
}

test('only the dedicated admin workers.dev hostname can use the isolated staging config',()=>{
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.m03-platform-auth-access-staging.jsonc',import.meta.url)));
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url)));
  assert.equal(cfg.name,'admin-hisabiq');
  assert.equal(cfg.account_id,'ac66126a5dc7c2f21ae5c146341a5dfb');
  assert.equal(cfg.keep_vars,true);
  assert.equal(cfg.main,'src/m03-access-platform-auth-worker.js');
  assert.equal(cfg.workers_dev,true);
  assert.equal(cfg.preview_urls,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.assets.run_worker_first,true);
  assert.equal(cfg.vars.PLATFORM_AUTH_ORIGIN,origin);
  for(const name of ['PLATFORM_ACCESS_AUDIENCE','PLATFORM_ACCESS_EMAIL','PLATFORM_CLIENT_ID','PLATFORM_TOTP_SECRET','PLATFORM_FACTOR_VERSION'])
    assert.equal(cfg.vars[name],undefined);
  assert.deepEqual(cfg.d1_databases,[{
    binding:'CONTROL_DB',database_name:'shererp-platform-control-staging',
    database_id:'957c0870-d58e-4efc-aea9-807f8fe18c56',migrations_dir:'staging-migrations/platform-auth',remote:false,
  }]);
  assert.equal(preview.name,'hisabiq');
  assert.equal(preview.d1_databases,undefined);
});

test('Access is required for HTML, assets and API even if the edge stops enforcing it',async t=>{
  const getKeys=t.mock.method(globalThis,'fetch',()=>assert.fail('early denials must not fetch signing keys'));
  const guarded={...bindings,ASSETS:{fetch(){assert.fail('private assets must not be reached');}}};
  for(const path of ['/','/platform-auth.js','/platform-auth.css','/api/platform/auth/challenge']){
    const method=path.startsWith('/api/')?'POST':'GET';
    assert.equal((await worker.fetch(request(path,{method}),guarded)).status,403);
  }
  assert.equal((await worker.fetch(request('/',{token:assertion(),base:'https://preview.example.test'}),guarded)).status,403);
  assert.equal((await worker.fetch(request('/',{token:assertion()}),{...guarded,PLATFORM_ACCESS_AUDIENCE:undefined})).status,503);
  assert.equal((await worker.fetch(request('/',{token:assertion()}),{...guarded,PLATFORM_ACCESS_EMAIL:undefined})).status,503);
  assert.equal((await worker.fetch(request('/',{extra:{Cookie:'CF_Authorization=malformed'}}),guarded)).status,403);
  assert.equal(getKeys.mock.callCount(),0);
  assert.equal((await publicWorker.fetch(request('/api/platform/auth/session'),{})).status,404);
});

test('only a current signed Access application token for this audience and human operator is accepted',async t=>{
  trustFixtureKeys(t);
  const denied=[assertion({},badKey),assertion({iss:'https://another.cloudflareaccess.com'}),
    assertion({aud:['b'.repeat(64)]}),assertion({type:'org'}),assertion({email:'someone@example.test'}),
    assertion({email:undefined}),assertion({exp:1}),assertion({exp:undefined}),
    assertion({iat:Math.floor(Date.now()/1000)+3600}),assertion({sub:undefined})];
  for(const token of denied){
    const response=await worker.fetch(request('/',{token}),bindings);
    assert.equal(response.status,403);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  const token=assertion();
  const page=await worker.fetch(request('/',{token}),bindings);
  assert.equal(page.status,200);
  assert.equal(await page.text(),'Private fixture');
  assert.equal((await worker.fetch(request('/api/platform/auth/session',{token}),bindings)).status,401);
  const login=await worker.fetch(request('/api/platform/auth/login',{token,method:'POST'}),{
    ...bindings,PLATFORM_INGRESS:{async limit(){return {success:true};}},
  });
  assert.equal(login.status,401);
  assert.equal(login.headers.has('Set-Cookie'),false);
});


test('a signed browser Access cookie can supply a missing assertion header',async t=>{
  trustFixtureKeys(t);
  const token=assertion();
  const cookies='unrelated=value; CF_Authorization='+token+'; trailing=value';
  for(const path of ['/','/platform-auth.js','/platform-auth.css']){
    const response=await worker.fetch(request(path,{extra:{Cookie:cookies}}),bindings);
    assert.equal(response.status,200,path);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  const session=await worker.fetch(request('/api/platform/auth/session',{extra:{Cookie:cookies}}),bindings);
  assert.equal(session.status,401,'Access admission cannot create a SherERP session');
  assert.equal(session.headers.has('Set-Cookie'),false);
  const badOrigin=await worker.fetch(request('/api/platform/auth/challenge',{
    method:'POST',extra:{Cookie:cookies,Origin:'https://another.example.test'},
  }),bindings);
  assert.equal(badOrigin.status,403);
});

test('invalid headers, forged cookies and duplicate cookie names fail closed',async t=>{
  trustFixtureKeys(t);
  const valid='CF_Authorization='+assertion();
  const cookieCases=[
    request('/',{token:assertion({},badKey),extra:{Cookie:valid}}),
    request('/',{extra:{'Cf-Access-Jwt-Assertion':'',Cookie:valid}}),
    request('/',{extra:{Cookie:valid+'; '+valid}}),
    request('/',{extra:{Cookie:'CF_Authorization=; '+valid}}),
    request('/',{extra:{Cookie:'CF_Authorization='+assertion({},badKey)}}),
    request('/',{extra:{Cookie:'CF_Authorization='+assertion({aud:['b'.repeat(64)]})}}),
    request('/',{extra:{Cookie:'CF_Authorization='+assertion({type:'org'})}}),
    request('/',{extra:{Cookie:'CF_Authorization='+assertion({exp:1})}}),
  ];
  for(const req of cookieCases)assert.equal((await worker.fetch(req,bindings)).status,403);
});
