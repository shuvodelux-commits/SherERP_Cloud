import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCloudflareD1Provider} from '../../src/provisioning/cloudflare-d1-provider.js';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const DB_ID='9bc4c0f2-d92c-4c3a-a0c9-a81721d93f81';
const ACTION={
  accountId:ACCOUNT,
  name:'shererp-shop-123456781234423481231234567890ab',
  attemptId:'12345678-1234-4234-8123-1234567890ab:shop-create',
};
const envelope=(result,result_info)=>new Response(JSON.stringify({
  success:true,result,result_info:result_info??undefined,errors:[]
}),{status:200,headers:{'content-type':'application/json'}});

test('provider inspects Cloudflare D1 quota before exactly one authorized create',async()=>{
  const calls=[];
  const provider=createCloudflareD1Provider({
    accountId:ACCOUNT,apiToken:'cf_private_provider_token_example_abcdefghijklmnopqrstuvwxyz',
    maxDatabases:10,
    fetchFn:async(url,init)=>{
      calls.push({url,method:init.method,headers:init.headers,body:init.body});
      if(init.method==='GET')return envelope([],{total_count:2,page:1,per_page:1});
      assert.equal(init.method,'POST');
      return envelope({uuid:DB_ID,name:ACTION.name});
    },
  });
  const before=await provider.inspectAccount();
  assert.deepEqual(before,{accountId:ACCOUNT,usedDatabases:2,maximumDatabases:10});
  const receipt=await provider.createDatabase(ACTION);
  assert.deepEqual(receipt,{
    ...ACTION,id:DB_ID,evidenceRef:'cf-d1:'+DB_ID
  });
  assert.deepEqual(calls.map(c=>c.method),['GET','GET','POST']);
  assert.equal(calls.at(-1).url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database');
  assert.deepEqual(JSON.parse(calls.at(-1).body),{name:ACTION.name});
  assert.equal(calls.at(-1).headers.Authorization.startsWith('Bearer '),true);
  assert.equal(JSON.stringify(receipt).includes('cf_private_provider_token'),false);
  assert.equal(await provider.findCreation(ACTION),null,
    'a D1 name alone cannot attest an interrupted create attempt');
  assert.equal(calls.length,3,'findCreation must not guess via database-name lookup');
});

test('provider blocks quota exhausted and all invalid or caller-selected accounts before POST',async()=>{
  let requests=0;
  const provider=createCloudflareD1Provider({
    accountId:ACCOUNT,apiToken:'cf_private_provider_token_example_abcdefghijklmnopqrstuvwxyz',
    maxDatabases:2,
    fetchFn:async()=>{requests++;return envelope([],{total_count:2,page:1,per_page:1});}
  });
  await assert.rejects(provider.createDatabase(ACTION),/D1_CAPACITY_UNAVAILABLE/);
  assert.equal(requests,1,'capacity check never calls POST');
  for(const bad of [
    {...ACTION,accountId:'ffffffffffffffffffffffffffffffff'},
    {...ACTION,name:'other-tenant'},
    {...ACTION,name:'shererp-shop-evil;DROP TABLE'},
    {...ACTION,attemptId:'some-no-proof'},
    {...ACTION,token:'browser-injected'},
  ])await assert.rejects(provider.createDatabase(bad),/D1_PROVIDER_DENIED/);
  assert.equal(requests,1,'invalid action must not perform any GET or POST');
});

test('provider returns no fabricated receipts on failed POST, timeout or untrusted Cloudflare response',async()=>{
  for(const response of [
    ()=>{throw new Error('network timeout after remote commit');},
    ()=>envelope({uuid:DB_ID,name:'other-database'}),
    ()=>envelope({uuid:'not-a-uuid',name:ACTION.name}),
    ()=>new Response('rate limited',{status:429}),
    ()=>new Response(JSON.stringify({success:false,errors:[{message:'internal secret'}]}),{status:500})
  ]){
    let posts=0;
    const provider=createCloudflareD1Provider({
      accountId:ACCOUNT,apiToken:'cf_private_provider_token_example_abcdefghijklmnopqrstuvwxyz',
      maxDatabases:10,
      fetchFn:async(url,init)=>{
        if(init.method==='GET')return envelope([],{total_count:1,page:1,per_page:1});
        posts++;return response();
      }
    });
    await assert.rejects(provider.createDatabase(ACTION),/D1_CREATE_OUTCOME_UNKNOWN/);
    assert.equal(posts,1);
  }
});

test('provider denies missing secrets, invalid account and unsafe capacity configuration',()=>{
  for(const patch of [
    {apiToken:''},{accountId:'not-account'},{maxDatabases:0},
    {maxDatabases:9999},{fetchFn:null}
  ])assert.throws(()=>createCloudflareD1Provider({
    accountId:ACCOUNT,apiToken:'cf_private_provider_token_example_abcdefghijklmnopqrstuvwxyz',
    maxDatabases:10,fetchFn:async()=>envelope([],{total_count:1}),
    ...patch,
  }),/D1_PROVIDER_DENIED/);
});
