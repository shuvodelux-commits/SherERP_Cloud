import assert from 'node:assert/strict';
import {test} from 'node:test';
import {composeCandidateBindingRoster,verifyCompleteBindingRoster}
  from '../../src/provisioning/verified-binding-roster.js';
import {publishShopBinding} from
  '../../src/provisioning/owner-worker-release-publisher.js';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const firstShop='11111111-1111-4111-8111-111111111111';
const newShop='22222222-2222-4222-8222-222222222222';
const control='33333333-3333-4333-8333-333333333333';
const existingDb='44444444-4444-4444-8444-444444444444';
const newDb='55555555-5555-4555-8555-555555555555';
const oldMarker='66666666-6666-4666-8666-666666666666';
const newMarker='77777777-7777-4777-8777-777777777777';
const oldVersion='88888888-8888-4888-8888-888888888888';
const newVersion='99999999-9999-4999-8999-999999999999';
const SHA='a'.repeat(40);
const baseline=()=>({
  accountId:ACCOUNT,workerName:'shererp',versionId:oldVersion,codeSha:SHA,
  bindings:[
    {binding:'CONTROL_DB',databaseId:control},
    {binding:'PLATFORM_PILOT_DB',databaseId:existingDb},
  ],
  shops:[{shopId:firstShop,binding:'PLATFORM_PILOT_DB',
    databaseId:existingDb,databaseMarker:oldMarker}]
});
const placement=()=>({
  accountId:ACCOUNT,shopId:newShop,databaseId:newDb,
  databaseMarker:newMarker,
  receiptDigest:'c'.repeat(64),schemaRevision:'owner-ready-v1',
  verifiedIdentity:true,verifiedMigrations:13
});
const lease=()=>({
  holder:'private-provisioner',
  token:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  expiresAtMs:Date.now()+60000
});

test('candidate retains every existing D1 binding and adds one verified deterministic Shop binding',()=>{
  const candidate=composeCandidateBindingRoster({
    activeRelease:baseline(),placement:placement(),approvedCodeSha:SHA
  });
  assert.equal(candidate.bindings.length,3);
  assert.deepEqual(candidate.bindings.slice(0,2),baseline().bindings);
  assert.equal(candidate.bindings[2].binding,'SHOP_22222222222242228222222222222222');
  assert.equal(candidate.bindings[2].databaseId,newDb);
  assert.equal(candidate.shops.length,2);
  assert.equal(candidate.shops[1].databaseMarker,newMarker);
  assert.equal(candidate.shops[1].schemaRevision,'owner-ready-v1');
  assert.equal(candidate.shops[1].receiptDigest,'c'.repeat(64));
  assert.equal(candidate.codeSha,SHA);
  assert.equal(candidate.versionId,oldVersion,'candidate is not an active version yet');
  assert.equal(verifyCompleteBindingRoster(baseline(),candidate),true);
});

test('rejects a forged placement, wrong schema, cross-account D1 or unsafe binding',()=>{
  for(const patch of [
    {accountId:'ffffffffffffffffffffffffffffffff'},
    {verifiedIdentity:false},
    {verifiedMigrations:12},
    {schemaRevision:'unapproved-v2'},
    {receiptDigest:'not-digest'},
    {databaseId:existingDb},
    {shopId:firstShop},
    {databaseMarker:oldMarker}
  ])assert.throws(()=>composeCandidateBindingRoster({
    activeRelease:baseline(),placement:{...placement(),...patch},
    approvedCodeSha:SHA
  }),/ROSTER_DENIED/);
});

test('rejects losing the old Shop, changing Control D1 or changing Worker source SHA',()=>{
  const candidate=composeCandidateBindingRoster({
    activeRelease:baseline(),placement:placement(),approvedCodeSha:SHA
  });
  for(const modification of [
    {...candidate,bindings:candidate.bindings.slice(1)},
    {...candidate,bindings:candidate.bindings.map((r,i)=>i===0?
      {...r,databaseId:newDb}:r)},
    {...candidate,shops:[candidate.shops[1]]},
    {...candidate,codeSha:'b'.repeat(40)},
    {...candidate,bindings:[...candidate.bindings,candidate.bindings[2]]}
  ])assert.throws(()=>verifyCompleteBindingRoster(baseline(),modification),/ROSTER_DENIED/);
  assert.throws(()=>composeCandidateBindingRoster({
    activeRelease:baseline(),placement:placement(),approvedCodeSha:'b'.repeat(40)
  }),/ROSTER_DENIED/);
});

test('publisher uploads and activates only a fully read-back verified version',async()=>{
  const current=baseline();
  let live=current;
  const calls=[];
  const provider={
    async readActiveRelease(){calls.push('readActive');return live;},
    async uploadCandidate(candidate){
      calls.push('upload');return {versionId:newVersion};
    },
    async readVersion(id){
      calls.push('readVersion');assert.equal(id,newVersion);
      return {...composeCandidateBindingRoster({
        activeRelease:current,placement:placement(),approvedCodeSha:SHA
      }),versionId:newVersion};
    },
    async promoteVersion({expectedActiveVersionId,versionId}){
      calls.push('promote');assert.equal(expectedActiveVersionId,oldVersion);
      assert.equal(versionId,newVersion);
      live=await provider.readVersion(newVersion);
      return {status:'accepted'};
    }
  };
  const result=await publishShopBinding({
    provider,expectedActive:current,placement:placement(),
    approvedCodeSha:SHA,lease:lease()
  });
  assert.equal(result.status,'published');
  assert.equal(result.versionId,newVersion);
  assert.equal(result.binding,'SHOP_22222222222242228222222222222222');
  assert.equal(calls.filter(c=>c==='upload').length,1);
  assert.equal(calls.filter(c=>c==='promote').length,1);
  assert.ok(calls.indexOf('readVersion')<calls.indexOf('promote'),
    'independent candidate readback before production traffic promotion');
});

test('publisher refuses stale deployment, invalid lease, missing binding and version mismatch',async()=>{
  const current=baseline();
  const wrong={...baseline(),versionId:newVersion};
  for(const patch of [
    {lease:{...lease(),holder:'public-builds'}},
    {lease:{...lease(),expiresAtMs:Date.now()-1}},
    {approvedCodeSha:'b'.repeat(40)}
  ]){
    let calls=0;
    await assert.rejects(publishShopBinding({
      provider:{readActiveRelease:async()=>{calls++;return current;}},
      expectedActive:current,placement:placement(),
      approvedCodeSha:SHA,lease:lease(),...patch
    }),/PUBLISH_DENIED/);
    assert.equal(calls,0,'invalid internal authority cannot invoke provider');
  }
  let uploads=0;
  await assert.rejects(publishShopBinding({
    provider:{
      readActiveRelease:async()=>wrong,
      uploadCandidate:async()=>{uploads++;}
    },
    expectedActive:current,placement:placement(),approvedCodeSha:SHA,lease:lease()
  }),/PUBLISH_DENIED/);
  assert.equal(uploads,0);
});

test('publisher never promotes a candidate when independently read-back bindings changed',async()=>{
  const current=baseline();
  let promotes=0;
  const provider={
    readActiveRelease:async()=>current,
    uploadCandidate:async()=>({versionId:newVersion}),
    readVersion:async()=>({...current,versionId:newVersion}),
    promoteVersion:async()=>{promotes++;}
  };
  await assert.rejects(publishShopBinding({
    provider,expectedActive:current,placement:placement(),
    approvedCodeSha:SHA,lease:lease()
  }),/PUBLISH_DENIED/);
  assert.equal(promotes,0);
});

test('publisher refuses blind retry when upload outcome is unknown',async()=>{
  const current=baseline();
  let uploads=0,promotes=0;
  await assert.rejects(publishShopBinding({
    provider:{
      readActiveRelease:async()=>current,
      async uploadCandidate(){uploads++;throw Error('response lost');},
      readVersion:async()=>{throw Error('no version can be trusted');},
      promoteVersion:async()=>{promotes++;}
    },
    expectedActive:current,placement:placement(),approvedCodeSha:SHA,lease:lease()
  }),/UPLOAD_OUTCOME_UNKNOWN/);
  assert.equal(uploads,1);
  assert.equal(promotes,0);
});

test('rejects two different Shops claiming the same physical D1 binding',()=>{
  const candidate=composeCandidateBindingRoster({
    activeRelease:baseline(),placement:placement(),approvedCodeSha:SHA
  });
  const shared={...candidate,shops:[
    baseline().shops[0],
    {shopId:newShop,binding:'PLATFORM_PILOT_DB',
      databaseId:existingDb,databaseMarker:newMarker}
  ]};
  assert.throws(()=>verifyCompleteBindingRoster(baseline(),shared),/ROSTER_DENIED/);
});

test('promote response loss can resolve only through an independently verified active version',async()=>{
  const original=baseline();
  const candidate=composeCandidateBindingRoster({
    activeRelease:original,placement:placement(),approvedCodeSha:SHA
  });
  let current=original,promotes=0;
  const provider={
    readActiveRelease:async()=>current,
    uploadCandidate:async()=>({versionId:newVersion}),
    readVersion:async()=>({...candidate,versionId:newVersion}),
    async promoteVersion(){
      promotes++;
      current={...candidate,versionId:newVersion};
      throw Error('Cloudflare returned a timeout after promoting');
    }
  };
  const result=await publishShopBinding({
    provider,expectedActive:original,placement:placement(),
    approvedCodeSha:SHA,lease:lease()
  });
  assert.equal(result.status,'published');
  assert.equal(promotes,1,'an unknown response must not trigger another promote');
});
