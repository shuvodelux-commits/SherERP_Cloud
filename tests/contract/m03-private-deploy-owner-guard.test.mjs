import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertPrivateOwnerDeployOwnership} from
  '../../scripts/m03-private-deploy-owner-guard.mjs';
import {buildShopUserDeployment} from '../../scripts/build-shop-user-deploy.mjs';

const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const sha='f'.repeat(40);
const account='0123456789abcdef0123456789abcdef';
const release=(bindingIds=[a,b],other={})=>({
  accountId:account,workerName:'shererp',codeSha:sha,
  bindings:[{binding:'CONTROL_DB',databaseId:a},
    ...bindingIds.slice(1).map((id,i)=>({binding:i===0?'PLATFORM_PILOT_DB':'SHOP_'+i,databaseId:id}))],
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
