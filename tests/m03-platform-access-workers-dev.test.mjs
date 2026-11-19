import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import publicWorker from '../src/index.js';

// Mirror the staging Wrangler Text rules so Node can assert the original bytes.
const files=new Map(['index.html','platform-auth.js','platform-auth.css'].map(name=>{
  const url=new URL('../frontend/platform-auth/'+name,import.meta.url);
  return [url.href,readFileSync(url,'utf8')];
}));
const hooks=registerHooks({load(url,context,next){
  if(files.has(url))return {format:'module',source:'export default '+JSON.stringify(files.get(url)),shortCircuit:true};
  return next(url,context);
}});
const {default:worker}=await import('../src/m03-access-platform-auth-worker.js');
hooks.deregister();

const origin='https://admin-hisabiq.agnishuvo.workers.dev';
const audience='a'.repeat(64);
const email='operator@example.test';
const bindings={
  PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,
  PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  PLATFORM_ACCESS_AUDIENCE:audience,PLATFORM_ACCESS_EMAIL:email,
  CONTROL_DB:{prepare(){assert.fail('D1 was not expected');},batch(){assert.fail('D1 was not expected');}},
  PLATFORM_INGRESS:{limit(){assert.fail('Ingress was not expected');}},
};
const access={aud:audience,getIdentity:async()=>({email})};
const request=(path='/',base=origin)=>new Request(base+path);
const routes=[['/','index.html'],['/platform-auth.js','platform-auth.js'],['/platform-auth.css','platform-auth.css']];

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
  assert.equal(cfg.assets,undefined);
  assert.equal(cfg.rules[0].type,'Text');
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


test('native Access serves the original page assets without contacting signing keys',async t=>{
  const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('signing keys unavailable');});
  for(const [path,file] of routes){
    const response=await worker.fetch(request(path),bindings,{access});
    assert.equal(response.status,200);
    assert.equal(await response.text(),files.get(new URL('../frontend/platform-auth/'+file,import.meta.url).href));
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(network.mock.callCount(),0);
});

test('client-supplied Access headers and cookies cannot grant admission',async()=>{
  for(const path of [...routes.map(([path])=>path),'/api/platform/auth/session']){
    const req=new Request(origin+path,{headers:{
      'Cf-Access-Jwt-Assertion':'forged',
      'Cf-Access-Authenticated-User-Email':email,
      Cookie:'CF_Authorization=forged',
    }});
    assert.equal((await worker.fetch(req,bindings,{})).status,403);
  }
});

test('rejects wrong audience, missing identity, wrong operator and identity lookup failure',async()=>{
  let called=false;
  const cases=[
    {aud:'b'.repeat(64),getIdentity:async()=>{called=true;return {email};}},
    {aud:audience},
    {aud:audience,getIdentity:async()=>undefined},
    {aud:audience,getIdentity:async()=>({email:'other@example.test'})},
    {aud:audience,getIdentity:async()=>{throw new Error('unavailable');}},
  ];
  for(const proof of cases)assert.equal((await worker.fetch(request(),bindings,{access:proof})).status,403);
  assert.equal(called,false);
});

test('requires the exact origin and valid operator configuration',async()=>{
  assert.equal((await worker.fetch(request('/','https://preview.example.test'),bindings,{access})).status,403);
  for(const key of ['PLATFORM_ACCESS_AUDIENCE','PLATFORM_ACCESS_EMAIL'])
    assert.equal((await worker.fetch(request(),{...bindings,[key]:undefined},{access})).status,503);
});

test('the public Worker health remains database-free',async()=>{
  const response=await publicWorker.fetch(new Request('https://hisabiq.agnishuvo.workers.dev/api/health'),{});
  assert.equal((await response.json()).database,'not-connected');
});
