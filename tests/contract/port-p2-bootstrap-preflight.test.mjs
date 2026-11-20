import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  planBootstrapDryRun,
  verifyBootstrapReadOnly
} from '../../scripts/port-p2-bootstrap-preflight.mjs';

const manifest=()=>({
  formatVersion:1,
  accountId:'0123456789abcdef0123456789abcdef',
  workersSubdomain:'fresh-shop-account',
  workers:{admin:'admin-shererp',owner:'owner-shererp'},
  origins:{
    admin:'https://admin-shererp.fresh-shop-account.workers.dev',
    owner:'https://owner-shererp.fresh-shop-account.workers.dev'
  },
  googleClientId:'123-fixture.apps.googleusercontent.com',
  d1:{
    control:{name:'control-new',id:'11111111-1111-4111-8111-111111111111'},
    pilot:{name:'shop-new',id:'22222222-2222-4222-8222-222222222222',
      shopId:'33333333-3333-4333-8333-333333333333',
      marker:'44444444-4444-4444-8444-444444444444'}
  },
  rateLimits:{adminNamespaceId:'654321',ownerNamespaceId:'654322'}
});
const goodResults=()=>({
  account:{id:manifest().accountId},
  subdomain:{subdomain:manifest().workersSubdomain},
  control:{uuid:manifest().d1.control.id,name:manifest().d1.control.name},
  pilot:{uuid:manifest().d1.pilot.id,name:manifest().d1.pilot.name}
});
const response=(result,{ok=true,success=true}={})=>({
  ok,status:ok?200:403,
  async json(){return {success,result,errors:[]};}
});
const spy=(results=goodResults(),opts={})=>{
  const calls=[];
  const ids=manifest().d1;
  const byPath=new Map([
    ['/accounts/'+manifest().accountId,results.account],
    ['/accounts/'+manifest().accountId+'/workers/subdomain',results.subdomain],
    ['/accounts/'+manifest().accountId+'/d1/database/'+ids.control.id,results.control],
    ['/accounts/'+manifest().accountId+'/d1/database/'+ids.pilot.id,results.pilot],
  ]);
  async function fetchFn(url,init){
    calls.push({url,init});
    const pathname=new URL(url).pathname.replace(/^\/client\/v4/,'');
    if(!byPath.has(pathname))throw new Error('unexpected endpoint');
    const key=pathname.includes('workers/subdomain')?'subdomain':
      pathname.includes(ids.control.id)?'control':
        pathname.includes(ids.pilot.id)?'pilot':'account';
    if(opts.networkError===key)throw new Error('PRIVATE_HTTP_ERROR_WITH_TOKEN');
    return response(byPath.get(pathname),opts[key]||{});
  }
  return {fetchFn,calls};
};
const secret='DO_NOT_EVER_EXPOSE_THIS_BEARER_TOKEN';

test('offline plan is deterministic, sanitized, no write commands and never claims deployment readiness',()=>{
  const plan=planBootstrapDryRun(manifest());
  assert.equal(plan.mode,'offline-dry-run');
  assert.equal(plan.remoteQueries,0);
  assert.equal(plan.allowDeploy,false);
  assert.equal(plan.allowRemoteMigrations,false);
  assert.equal(plan.resourceVerification,'not-checked');
  assert.ok(plan.remainingGates.includes('cloudflare-identity'));
  for(const key of ['google-oauth','cloudflare-access','secrets','release-review',
    'migration-backup','worker-builds','shop-binding-topology'])assert.ok(plan.remainingGates.includes(key));
  const serialized=JSON.stringify(plan);
  for(const value of [secret,manifest().accountId,manifest().d1.control.id,
    manifest().origins.admin,manifest().googleClientId])assert.ok(!serialized.includes(value));
  assert.deepEqual(plan,planBootstrapDryRun({...manifest()}));
});

test('read-only account verification accepts exact matching account/subdomain/two D1 IDs and names',async()=>{
  const {fetchFn,calls}=spy();
  const evidence=await verifyBootstrapReadOnly(manifest(),{token:secret,fetchFn});
  assert.equal(evidence.mode,'cloudflare-read-only');
  assert.equal(evidence.resourceVerification,'verified');
  assert.equal(evidence.allowDeploy,false);
  assert.equal(evidence.allowRemoteMigrations,false);
  assert.equal(evidence.remoteQueries,4);
  assert.deepEqual(evidence.verified,['cloudflare-account','workers-subdomain','control-d1','pilot-d1']);
  assert.ok(evidence.remainingGates.includes('cloudflare-access'));
  assert.ok(evidence.remainingGates.includes('shop-binding-topology'));
  assert.equal(calls.length,4);
  for(const {url,init} of calls){
    assert.equal(new URL(url).origin,'https://api.cloudflare.com');
    assert.ok(url.includes('/client/v4/accounts/'+manifest().accountId));
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer '+secret);
    assert.equal(init.cache,'no-store');
    assert.ok(init.signal);
    assert.equal(JSON.stringify(evidence).includes(secret),false);
  }
  assert.deepEqual(await verifyBootstrapReadOnly(manifest(),{token:secret,fetchFn:spy().fetchFn}),evidence,
    'read-only retry is stable');
});

test('fails closed on wrong account, subdomain and swapped database names or IDs',async()=>{
  const variants=[
    {account:{id:'wrongaccount'}},
    {subdomain:{subdomain:'otheraccount'}},
    {control:{uuid:manifest().d1.pilot.id,name:manifest().d1.control.name}},
    {control:{uuid:manifest().d1.control.id,name:'another-control'}},
    {pilot:{uuid:manifest().d1.pilot.id,name:manifest().d1.control.name}},
    {pilot:{uuid:manifest().d1.control.id,name:manifest().d1.pilot.name}},
    {control:{}},
    {account:undefined}
  ];
  for(const changed of variants){
    const fake=spy({...goodResults(),...changed});
    await assert.rejects(()=>verifyBootstrapReadOnly(manifest(),{token:secret,fetchFn:fake.fetchFn}),
      /PORT-P2 read-only verification failed/);
    assert.ok(fake.calls.length<=4);
    assert.ok(fake.calls.every(c=>c.init.method==='GET'));
  }
});

test('rejects cloud permission denial, unsuccessful or malformed HTTP response, network error and missing token without leaking values',async()=>{
  const cases=[
    {account:{ok:false}},
    {control:{success:false}},
    {pilot:{ok:false}},
    {networkError:'pilot'}
  ];
  for(const opts of cases){
    const fake=spy(goodResults(),opts);
    try{
      await verifyBootstrapReadOnly(manifest(),{token:secret,fetchFn:fake.fetchFn});
      assert.fail('expected preflight failure');
    }catch(e){
      assert.match(e.message,/PORT-P2 read-only verification failed/);
      for(const value of [secret,manifest().accountId,manifest().d1.control.id,
        'PRIVATE_HTTP_ERROR_WITH_TOKEN'])assert.ok(!e.message.includes(value));
    }
  }
  const fake=spy();
  await assert.rejects(()=>verifyBootstrapReadOnly(manifest(),{token:'',fetchFn:fake.fetchFn}),
    /PORT-P2 read-only verification failed/);
  assert.equal(fake.calls.length,0);
  await assert.rejects(()=>verifyBootstrapReadOnly(manifest(),{token:'Bearer '+secret,fetchFn:fake.fetchFn}),
    /PORT-P2 read-only verification failed/);
});

test('untrusted manifest is rejected before any remote API is called',async()=>{
  const fake=spy();
  await assert.rejects(()=>verifyBootstrapReadOnly({...manifest(),accountId:'not-valid'},
    {token:secret,fetchFn:fake.fetchFn}),/Invalid portable instance/);
  assert.equal(fake.calls.length,0);
});

test('public preview remains unbound and cannot acquire secrets via P2 plan',()=>{
  const preview=readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8');
  assert.match(preview,/"previews"\s*:\s*\{\s*\}/);
  assert.doesNotMatch(preview,/"d1_databases"\s*:/);
  assert.doesNotMatch(JSON.stringify(planBootstrapDryRun(manifest())),
    /CLOUDFLARE_API_TOKEN|JWT_SECRET|wrangler deploy|--remote/);
});
