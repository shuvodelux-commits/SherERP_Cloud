import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {
  planHostedControlCenterDryRun,
  verifyHostedControlCenterReadOnly,
  verifyOwnerReadyMigrationFiles
} from '../../scripts/port-p2-hosted-control-center-preflight.mjs';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../../src/db/m03-owner-ready-shop-migrations.js';

const secret='SYNTHETIC_BEARER_DO_NOT_PRINT_012345';
// The reviewed, SHA-pinned SQL profile is the authority. An append-only
// migration must not break read-only hosted preflight tests via a stale count.
const reviewedMigrations=OWNER_READY_SHOP_MIGRATION_PLAN;
const reviewedMigrationCount=reviewedMigrations.length;

test('reviewed Shop migration names are unique and byte-pin SHA-256 digests',()=>{
  assert.ok(reviewedMigrationCount>=10,'unexpected truncation of reviewed Shop schema');
  assert.equal(new Set(reviewedMigrations.map(item=>item.name)).size,reviewedMigrationCount);
  for(const {name,checksum} of reviewedMigrations){
    assert.match(name,/^(?:migrations|staging-migrations)\/[a-zA-Z0-9_/.\-]+\.sql$/);
    assert.match(checksum,/^[a-f0-9]{64}$/);
  }
});
const fixture=()=>({
  formatVersion:1,
  accountId:'0123456789abcdef0123456789abcdef',
  workersSubdomain:'fresh-operator',
  workers:{admin:'admin-shererp',owner:'owner-shererp'},
  origins:{
    admin:'https://admin-shererp.fresh-operator.workers.dev',
    owner:'https://owner-shererp.fresh-operator.workers.dev'
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
const adminD1=()=>({name:'CONTROL_DB',type:'d1',database_id:fixture().d1.control.id});
const pilotD1=()=>({name:'PLATFORM_PILOT_DB',type:'d1',database_id:fixture().d1.pilot.id});
const normalBinding=()=>({name:'OWNER_INGRESS',type:'ratelimit',namespace_id:fixture().rateLimits.ownerNamespaceId,simple:{limit:20,period:60}});
const goodWorkers=()=>({
  admin:{bindings:[adminD1(),{name:'PLATFORM_INGRESS',type:'ratelimit',namespace_id:fixture().rateLimits.adminNamespaceId,simple:{limit:20,period:60}}]},
  owner:{bindings:[adminD1(),pilotD1(),normalBinding()]}
});
const resources=()=>({
  account:{id:fixture().accountId},
  subdomain:{subdomain:fixture().workersSubdomain},
  control:{uuid:fixture().d1.control.id,name:fixture().d1.control.name},
  pilot:{uuid:fixture().d1.pilot.id,name:fixture().d1.pilot.name},
  ...goodWorkers()
});
function simulatedCloudflare(values=resources(),options={}){
  const f=fixture(),base='/client/v4/accounts/'+f.accountId;
  const paths=new Map([
    [base,values.account],
    [base+'/workers/subdomain',values.subdomain],
    [base+'/d1/database/'+f.d1.control.id,values.control],
    [base+'/d1/database/'+f.d1.pilot.id,values.pilot],
    [base+'/workers/scripts/'+f.workers.admin+'/settings',values.admin],
    [base+'/workers/scripts/'+f.workers.owner+'/settings',values.owner],
  ]);
  const calls=[];
  async function fetchFn(url,init={}){
    calls.push({url,init});
    const pathname=new URL(url).pathname;
    if(!paths.has(pathname))throw Error('unexpected endpoint');
    if(options.networkFailure===pathname)throw Error('private network failure with '+secret);
    if(options.failPath===pathname)return Response.json({success:false,result:paths.get(pathname)}, {status:403});
    return Response.json({success:true,result:paths.get(pathname)});
  }
  return {fetchFn,calls};
}

test('offline hosted plan tracks the reviewed migration manifest without authorizing remote operations',()=>{
  const plan=planHostedControlCenterDryRun(fixture());
  assert.deepEqual(plan,planHostedControlCenterDryRun(fixture()));
  assert.equal(plan.mode,'offline-dry-run');
  assert.equal(plan.remoteQueries,0);
  assert.equal(plan.ownerReadyMigrationCount,reviewedMigrationCount);
  assert.equal(plan.migrationFilesVerified,false);
  for(const flag of ['allowCreateDatabase','allowRemoteWrites','allowRemoteMigrations','allowDeploy','allowOwnerActivation'])
    assert.equal(plan[flag],false,flag);
  assert.ok(plan.remainingGates.includes('independent-security-review'));
  assert.ok(plan.remainingGates.includes('m10-recovery'));
  assert.ok(plan.remainingGates.includes('owner-deployment-approval'));
  assert.ok(plan.remainingGates.includes('worker-version-binding-promotion'));
  const message=JSON.stringify(plan);
  for(const privateValue of [fixture().accountId,fixture().d1.control.id,fixture().d1.pilot.id,
    fixture().origins.owner,fixture().googleClientId,secret])assert.ok(!message.includes(privateValue));
});

test('Owner-ready source preflight verifies every SHA-pinned SQL file before HTTP',async()=>{
  assert.ok(reviewedMigrationCount>=10,'unexpected truncation of reviewed Owner-ready migrations');
  assert.deepEqual(await verifyOwnerReadyMigrationFiles(),
    {verified:true,migrationCount:reviewedMigrationCount});
  for(const target of [reviewedMigrations[3].name,reviewedMigrations.at(-1).name]){
    const changed=async(file)=> {
      const bytes=await readFile(file);
      return String(file).endsWith('/'+target.split('/').at(-1))
        ?Buffer.concat([bytes,Buffer.from('\\n-- unexpected mutation')]):bytes;
    };
    await assert.rejects(()=>verifyOwnerReadyMigrationFiles({readFileFn:changed}),
      /Hosted Control Center preflight denied/);
  }
});

test('hosted preflight makes six Cloudflare GETs, proves exact Worker D1 bindings and redacts results',async()=>{
  const {fetchFn,calls}=simulatedCloudflare();
  const output=await verifyHostedControlCenterReadOnly(fixture(),{token:secret,fetchFn});
  assert.equal(output.mode,'cloudflare-read-only');
  assert.equal(output.remoteQueries,6);
  assert.equal(output.ownerReadyMigrationCount,reviewedMigrationCount);
  assert.equal(output.migrationFilesVerified,true);
  assert.deepEqual(output.verified,[
    'cloudflare-account','workers-subdomain','control-d1','pilot-d1',
    'admin-worker-d1-bindings','owner-worker-d1-bindings','private-worker-ingress-limits','owner-ready-migration-files'
  ]);
  assert.equal(output.resourceVerification,'verified');
  for(const flag of ['allowCreateDatabase','allowRemoteWrites','allowRemoteMigrations','allowDeploy','allowOwnerActivation'])
    assert.equal(output[flag],false);
  assert.equal(calls.length,6);
  for(const call of calls){
    assert.equal(new URL(call.url).origin,'https://api.cloudflare.com');
    assert.equal(call.init.method,'GET');
    assert.equal(call.init.redirect,'error');
    assert.equal(call.init.cache,'no-store');
    assert.equal(call.init.headers.Authorization,'Bearer '+secret);
    assert.equal(call.init.headers.Accept,'application/json');
    assert.ok(call.init.signal);
    assert.equal(call.init.body,undefined);
  }
  const report=JSON.stringify(output);
  for(const privateValue of [fixture().accountId,fixture().d1.control.id,fixture().d1.pilot.id,
    fixture().origins.admin,secret])assert.equal(report.includes(privateValue),false);
});

test('hosted preflight rejects unknown, swapped, duplicate, extraneous and unverified D1 bindings',async()=>{
  const base=goodWorkers();
  const cases=[
    {admin:{bindings:[{...adminD1(),database_id:fixture().d1.pilot.id}]}},
    {owner:{bindings:[adminD1(),{...pilotD1(),database_id:fixture().d1.control.id}]}},
    {owner:{bindings:[adminD1(),adminD1(),pilotD1()]}},
    {owner:{bindings:[adminD1(),normalBinding()]}},
    {owner:{bindings:[adminD1(),pilotD1(),{name:'SHOP_C_DB',type:'d1',database_id:crypto.randomUUID()}]}},
    {admin:{bindings:[{name:'CONTROL_DB',type:'kv_namespace',namespace_id:'broken'}]}},
    {admin:{bindings:undefined}},
    {owner:{bindings:'not-array'}},
    {owner:{bindings:[adminD1(),{name:'PLATFORM_PILOT_DB',type:'d1',id:fixture().d1.pilot.id}]}}
  ];
  for(const changed of cases){
    const {fetchFn,calls}=simulatedCloudflare({...resources(),...base,...changed});
    await assert.rejects(()=>verifyHostedControlCenterReadOnly(fixture(),{token:secret,fetchFn}),
      /Hosted Control Center preflight denied/);
    assert.ok(calls.every(x=>x.init.method==='GET'));
  }
});

test('invalid portable instance and token stop before HTTP; failure never leaks private API text',async()=>{
  const f=simulatedCloudflare();
  await assert.rejects(()=>verifyHostedControlCenterReadOnly({...fixture(),accountId:'NOTVALID'},
    {token:secret,fetchFn:f.fetchFn}),/Invalid portable instance/);
  assert.equal(f.calls.length,0);
  await assert.rejects(()=>verifyHostedControlCenterReadOnly(fixture(),{
    token:'',fetchFn:f.fetchFn
  }),/Hosted Control Center preflight denied/);
  assert.equal(f.calls.length,0);
  const bad='/client/v4/accounts/'+fixture().accountId+'/workers/scripts/'+fixture().workers.owner+'/settings';
  for(const options of [{failPath:bad},{networkFailure:bad}]){
    const fake=simulatedCloudflare(resources(),options);
    try{
      await verifyHostedControlCenterReadOnly(fixture(),{token:secret,fetchFn:fake.fetchFn});
      assert.fail('expected deny');
    }catch(error){
      assert.match(error.message,/Hosted Control Center preflight denied/);
      assert.doesNotMatch(error.message,/private network failure|DO_NOT_PRINT|0123456789abcdef/);
      assert.ok(fake.calls.every(x=>x.init.method==='GET'));
    }
  }
});

test('hosted preflight requires the configured ingress limiter on each private Worker',async()=>{
  for(const role of ['admin','owner']){
    for(const change of [null,{type:'plain_text'},{namespace_id:'999'},{simple:{limit:2000,period:60}},{simple:{limit:20,period:10}}]){
      const values=resources();
      const limiter=values[role].bindings.pop();
      if(change)values[role].bindings.push({...limiter,...change});
      const {fetchFn}=simulatedCloudflare(values);
      await assert.rejects(()=>verifyHostedControlCenterReadOnly(fixture(),{token:secret,fetchFn}),
        /Hosted Control Center preflight denied/);
    }
  }
});
