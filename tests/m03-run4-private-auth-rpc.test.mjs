import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleRpc} from '../src/rpc/handler.js';
import {createM03PrivateProductMasterBridge}
  from '../src/rpc/m03-private-product-master-bridge.js';

const TOKEN='a'.repeat(64);
const request=(fnName,args,headers={})=>new Request('https://shererp.test/api/rpc',{
  method:'POST',headers:{'Content-Type':'application/json',...headers},
  body:JSON.stringify({fnName,args})
});
const getResult=async (name,args,opts)=> {
  const res=await handleRpc(request(name,args),opts);
  return {status:res.status,body:await res.json()};
};
const data=(name,operationId='OP-TEST')=>({name,operationId});
const goodBridge=Object.freeze({
  async invoke(x){
    assert.deepEqual(Object.keys(x).sort(),['fnName','name','operationId','token']);
    assert.equal(x.token,TOKEN);
    return {success:true,data:{
      id:x.fnName==='addProductCategory'?'PCAT-000017':'PUNT-000008',
      name:x.name
    }};
  }
});

test('Run 4 public handler stays 501 without explicit trusted private bridge',async()=>{
  assert.deepEqual(await getResult('addProductCategory',[TOKEN,data('Tools')]),{
    status:501,body:{success:false,message:'RPC method not migrated'}
  });
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m03-private-product-master-bridge'),false);
  assert.equal(live.includes('m04-authorized-product-master-create'),false);
});

test('private allowlist accepts only original category/unit RPC methods',async()=>{
  for(const [fnName,prefix] of [
    ['addProductCategory','PCAT'],['addProductUnit','PUNT']
  ]){
    const result=await getResult(fnName,[TOKEN,data('Tools')],{
      productMasterBridge:goodBridge
    });
    assert.equal(result.status,200);
    assert.equal(result.body.data.id,prefix+'-'+(prefix==='PCAT'?'000017':'000008'));
    assert.equal(result.body.data.name,'Tools');
  }
  assert.equal((await getResult('createProduct',[TOKEN,data('Tools')],{
    productMasterBridge:goodBridge
  })).status,501);
});

test('transport denies untrusted actor, time, business, action and unknown fields',async()=>{
  const extra=[
    {name:'Tools',operationId:'OP-TEST',nowMs:9000000000000},
    {name:'Tools',operationId:'OP-TEST',actorId:'ADMIN'},
    {name:'Tools',operationId:'OP-TEST',businessId:'BUS-B'},
    {name:'Tools',operationId:'OP-TEST',permission:'products.add'},
    {name:'Tools',operationId:'OP-TEST',sql:'DROP TABLE'},
    {name:'Tools'}, {name:'Tools',operationId:'bad value'},
    {name:'Tools',operationId:'OP-TEST',role:'Administrator'},
    {name:1,operationId:'OP-TEST'}, null, [],'Tools'
  ];
  let invoked=0;
  const bridge={invoke(){invoked++;return {success:true,data:{id:'PCAT-000017',name:'Tools'}};}};
  for(const value of extra){
    const result=await getResult('addProductCategory',[TOKEN,value],{
      productMasterBridge:bridge
    });
    assert.equal(result.status,400,JSON.stringify(value));
    assert.equal(result.body.success,false);
  }
  for(const args of [[],[TOKEN],[TOKEN,data('Tools'),'ADMIN'],
    ['bad-token',data('Tools')],[TOKEN,null]]) {
    assert.equal((await getResult('addProductCategory',args,{
      productMasterBridge:bridge
    })).status,400);
  }
  assert.equal(invoked,0);
});

test('original required-name failures retain their source envelope without a source ID',async()=>{
  const expected={success:false,message:'Category name is required.'};
  const x=await getResult('addProductCategory',[TOKEN,data('   ')],{
    productMasterBridge:{invoke:()=>expected}
  });
  assert.deepEqual(x,{status:200,body:expected});
});

test('private transport returns generic failure for invalid/secret or unresolved output',async()=>{
  for(const output of [
    null,{success:true,data:{id:'PCAT-000017',name:'Tools',secret:'private'}},
    {success:true,data:{id:'INV-000017',name:'Tools'}},
    {success:false,message:'SELECT password_hash FROM auth_users'},
    {success:true,data:{id:'PCAT-000017',name:Promise.resolve('Tools')}},
    {success:true,data:{id:'PCAT-000017',name:'Tools'},token:TOKEN}
  ]){
    const result=await getResult('addProductCategory',[TOKEN,data('Tools')],{
      productMasterBridge:{invoke:()=>output}
    });
    assert.equal(result.status,503);
    assert.equal(result.body.success,false);
    assert.equal(JSON.stringify(result.body).includes(TOKEN),false);
  }
});

test('RPC never invokes a getter hidden in an untrusted private bridge result',async()=>{
  let hits=0;
  const hostile=Object.create(null);
  Object.defineProperty(hostile,'success',{
    enumerable:true,get(){hits++;return true;}
  });
  Object.defineProperty(hostile,'data',{
    enumerable:true,value:{id:'PCAT-000017',name:'Tools'}
  });
  const result=await getResult('addProductCategory',[TOKEN,data('Tools')],{
    productMasterBridge:{invoke:()=>hostile}
  });
  assert.equal(result.status,503);
  assert.equal(hits,0);
});

test('private bridge rejects rogue operation and invalid server clock without DB I/O',async()=>{
  let queried=0;
  const env={DB:{prepare(){queried++;throw Error('MUST_NOT_QUERY');}}};
  for(const businessId of ['',undefined,'../BUS-B',{},'bus a']){
    assert.throws(()=>createM03PrivateProductMasterBridge(env,{
      businessId,now:()=>1_800_000_000_000
    }),/business|trusted|invalid/i);
  }
  const bridge=createM03PrivateProductMasterBridge(env,{
    businessId:'BUS-A',now:()=>NaN
  });
  for(const bad of [
    {fnName:'postSale',token:TOKEN,operationId:'OP-1',name:'Tools'},
    {fnName:'addProductCategory',token:TOKEN,operationId:'OP-1',name:'Tools',
      nowMs:9_000_000_000_000},
    {fnName:'addProductCategory',token:TOKEN,operationId:'OP-1',name:'Tools',
      actorId:'ADMIN'}
  ])await assert.rejects(()=>bridge.invoke(bad),/invalid|unapproved|argument|method/i);
  await assert.rejects(()=>bridge.invoke({
    fnName:'addProductCategory',token:TOKEN,operationId:'OP-1',name:'Tools'
  }),/clock|time|invalid/i);
  assert.equal(queried,0);
});
