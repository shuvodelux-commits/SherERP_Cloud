import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertPrivateOwnerDeployOwnership} from
  '../../scripts/m03-private-deploy-owner-guard.mjs';
import {buildShopUserDeployment} from '../../scripts/build-shop-user-deploy.mjs';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const sha='f'.repeat(40);
const pilotShop='44444444-4444-4444-8444-444444444444';
const addedShop='55555555-5555-4555-8555-555555555555';
const pilotMarker='66666666-6666-4666-8666-666666666666';
const addedMarker='77777777-7777-4777-8777-777777777777';
const initialVersion='88888888-8888-4888-8888-888888888888';
const addedBinding='SHOP_'+addedShop.replaceAll('-','').toUpperCase();
const account='0123456789abcdef0123456789abcdef';
const release=(bindingIds=[a,b],other={})=>({
  accountId:account,workerName:'shererp',versionId:initialVersion,codeSha:sha,
  bindings:[{binding:'CONTROL_DB',databaseId:bindingIds[0]},
    ...bindingIds.slice(1).map((id,i)=>({
      binding:i===0?'PLATFORM_PILOT_DB':addedBinding,databaseId:id
    }))],
  shops:bindingIds.slice(1).map((id,i)=>i===0?{
    shopId:pilotShop,binding:'PLATFORM_PILOT_DB',
    databaseId:id,databaseMarker:pilotMarker
  }:{
    shopId:addedShop,binding:addedBinding,databaseId:id,
    databaseMarker:addedMarker,schemaRevision:'owner-ready-v1',
    receiptDigest:'d'.repeat(64)
  }),
  ...other
});
const settings=(other={})=>({
  accountId:account,workerName:'shererp',productionBranch:'main',
  deployCommand:'npx wrangler@4.161.0 versions upload --config wrangler.shop-user.jsonc',
  approvedCodeSha:sha,approvedPublisher:'private-provisioner',
  ...other,
});
const guard=(s=settings(),active=release(),candidate=release([a,b,c]))=>
  assertPrivateOwnerDeployOwnership({buildSettings:s,activeRelease:active,candidateRelease:candidate});

test('allows an approved private upload only when every current binding is retained',()=>{
  const out=guard();
  assert.equal(out.allowed,true);
  assert.equal(out.newBindings,1);
  assert.equal(out.retainedBindings,2);
});

test('rejects active Cloudflare Builds deployment before any publication',()=>{
  for(const cmd of [
    'npx wrangler deploy --config wrangler.shop-user.jsonc',
    'npx wrangler versions deploy',
    'npx wrangler versions upload && npx wrangler versions deploy',
    'npx wrangler versions upload; npx wrangler deploy',
    'npx wrangler versions upload | cat',
    'npx wrangler versions upload --config ../../private.jsonc',
    'npx wrangler versions upload --config wrangler.shop-user.jsonc # ignored',
    '',
    null
  ])assert.throws(()=>guard(settings({deployCommand:cmd})),/DEPLOY_OWNERSHIP_DENIED/);
});

test('rejects unknown authority, account, Worker, code SHA and production branch',()=>{
  for(const patch of [
    {accountId:'ffffffffffffffffffffffffffffffff'},
    {workerName:'hisabiq'},
    {productionBranch:'test'},
    {approvedPublisher:'public-builds'},
    {approvedCodeSha:'0'.repeat(40)},
    {approvedCodeSha:undefined},
  ])assert.throws(()=>guard(settings(patch)),/DEPLOY_OWNERSHIP_DENIED/);
  for(const patch of [
    {accountId:'ffffffffffffffffffffffffffffffff'},
    {workerName:'admin'},
    {codeSha:'0'.repeat(40)},
    {codeSha:undefined},
  ])assert.throws(()=>guard(settings(),release(),release([a,b,c],patch)),/DEPLOY_OWNERSHIP_DENIED/);
});

test('rejects deleting, swapping, or reassigning ANY existing D1 binding',()=>{
  for(const candidate of [
    release([a]),
    release([a,c]),
    release([b,a,c]),
    release([a,b,b]),
    release([a,b,c],{bindings:[
      {binding:'CONTROL_DB',databaseId:a},
      {binding:'PLATFORM_PILOT_DB',databaseId:b},
      {binding:'SHOP_1',databaseId:c},
      {binding:'SHOP_1',databaseId:c}
    ]}),
    release([a,b,c],{bindings:[
      {binding:'CONTROL_DB',databaseId:a},
      {binding:'PLATFORM_PILOT_DB',databaseId:b},
      {binding:'UNTRUSTED-NAME',databaseId:c}
    ]})
  ])assert.throws(()=>guard(settings(),release(),candidate),/DEPLOY_OWNERSHIP_DENIED/);
});

test('rejects a missing or invalid protected Control D1 and ambiguous release roster',()=>{
  for(const active of [
    release([a,b],{bindings:[{binding:'PLATFORM_PILOT_DB',databaseId:b}]}),
    release([a,b],{bindings:[]}),
    release([a,b],{bindings:[
      {binding:'CONTROL_DB',databaseId:a},
      {binding:'PLATFORM_PILOT_DB',databaseId:a}
    ]}),
  ])assert.throws(()=>guard(settings(),active,release([a,b,c])),/DEPLOY_OWNERSHIP_DENIED/);
});

test('legacy one-Shop Builds generator is unusable after exclusive private publisher is selected',()=>{
  assert.throws(()=>buildShopUserDeployment({
    SHERERP_DEPLOYMENT_OWNER:'PRIVATE_PROVISIONER',
    WORKERS_CI:'1',
    WORKERS_CI_BRANCH:'main',
    SHERERP_OWNER_LOGIN_RELEASE:'OWNER_LOGIN_ONLY_APPROVED'
  }),/Shop-user deployment/);
});

const oldVersion=initialVersion;
const newVersion='99999999-9999-4999-8999-999999999999';
const nextBinding=addedBinding;
const pilotRole={shopId:pilotShop,binding:'PLATFORM_PILOT_DB',
  databaseId:b,databaseMarker:pilotMarker};
const nextRole={shopId:addedShop,binding:nextBinding,databaseId:c,
  databaseMarker:addedMarker,schemaRevision:'owner-ready-v1',receiptDigest:'d'.repeat(64)};
const fullActive=()=>({...release(),versionId:oldVersion,shops:[{...pilotRole}]});
const fullNext=()=>({...release([a,b,c]),versionId:newVersion,
  bindings:[{binding:'CONTROL_DB',databaseId:a},
    {binding:'PLATFORM_PILOT_DB',databaseId:b},
    {binding:nextBinding,databaseId:c}],shops:[{...pilotRole},{...nextRole}]});

test('live Worker roster must contain matching Shop identities, not just matching D1 bindings',()=>{
  assert.equal(guard(settings(),fullActive(),fullNext()).allowed,true,
    'valid append-only two-Shop release');
  const before=fullActive(),after=fullNext();
  for(const wrong of [
    {...after,shops:[]},
    {...after,shops:[after.shops[1]]},
    {...after,shops:[{...after.shops[0],databaseMarker:addedMarker},after.shops[1]]},
    {...after,shops:[after.shops[0],{...after.shops[1],databaseMarker:pilotMarker}]},
    {...after,shops:[after.shops[0],{...after.shops[1],binding:'PLATFORM_PILOT_DB'}]},
    {...after,shops:[after.shops[0],{...after.shops[1],receiptDigest:'fake'}]}
  ])assert.throws(()=>guard(settings(),before,wrong),
    /DEPLOY_OWNERSHIP_DENIED/,
    'a changed or incomplete Shop identity registry cannot be published');
  assert.throws(()=>guard(settings(),{...before,shops:[]},after),
    /DEPLOY_OWNERSHIP_DENIED/,'actual existing Shop roster cannot be unknown');
});
