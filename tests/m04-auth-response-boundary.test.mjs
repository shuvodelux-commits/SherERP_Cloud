import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRpc} from '../src/rpc/handler.js';
import worker from '../src/index.js';

const ORIGIN='https://auth-boundary.invalid';
const TOKEN='a'.repeat(64);
const PHONE='01710000101';
const PASSWORD='synthetic-test-only';
function profile(role='Administrator'){
  return {
    token:TOKEN,
    user:{id:'USR-101',name:'Synthetic Tester',mobile:PHONE,role},
    allowedModules:role==='Administrator'?null:['sales','pos'],
    permissions:role==='Administrator'?null:{
      sales:{view:true,add:true,edit:false,delete:'7'},
      pos:{view:true}
    },
  };
}
async function rpc(method,response,args=method==='login'?[PHONE,PASSWORD]:[TOKEN]){
  const request=new Request(ORIGIN+'/api/rpc',{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:ORIGIN},
    body:JSON.stringify({fnName:method,args}),
  });
  const authAdapter={
    login:()=>response,validateSession:()=>response,logout:()=>response,
  };
  const result=await handleRpc(request,{authAdapter});
  return {status:result.status,headers:result.headers,body:await result.json()};
}
test('source-shaped Administrator and Cashier auth profiles remain byte-shape-compatible',async()=>{
  for(const role of ['Administrator','Cashier']){
    for(const method of ['login','validateSession']){
      const data=profile(role);
      const result=await rpc(method,{success:true,data});
      assert.equal(result.status,200,role+'/'+method);
      assert.deepEqual(result.body,{success:true,data});
      assert.equal(result.headers.get('Cache-Control'),'no-store');
      assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
    }
  }
  const logout=await rpc('logout',{success:true,data:'logged out'});
  assert.equal(logout.status,200);
  assert.deepEqual(logout.body,{success:true,data:'logged out'});
  for(const [method,message] of [
    ['login','Invalid mobile number or password.'],
    ['login','Sign-in role configuration is unavailable.'],
    ['validateSession','Session expired. Please sign in again.'],
    ['logout','Session expired. Please sign in again.'],
  ]){
    const result=await rpc(method,{success:false,message});
    assert.equal(result.status,200);
    assert.deepEqual(result.body,{success:false,message});
  }
});

test('source-valid custom staff delete and backdate windows survive trusted HTTP auth envelopes',async()=>{
  // Exact SourceRole metadata is also seeded in the real M04 Workerd/D1 fixture.
  const data={
    ...profile('Cashier'),
    user:{...profile('Cashier').user,role:'SourceRole'},
    allowedModules:['sales','roles'],
    permissions:{
      sales:{view:true,add:false,edit:true,delete:'same',backdate:'7'},
      roles:{view:true,add:false,edit:false,delete:false,backdate:'same'},
      users:{view:false,add:false,edit:false,delete:true,backdate:'unlimited'},
      openingBalance:{view:false,add:false,edit:true,delete:'disabled',backdate:'unlimited'},
    }
  };
  for(const method of ['login','validateSession']){
    const response=await rpc(method,{success:true,data});
    assert.equal(response.status,200,method);
    assert.deepEqual(response.body,{success:true,data});
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  // Validation is not a generic object sanitizer: invalid role permission
  // types or unknown windows must still fail closed.
  for(const broken of [
    {...data,permissions:{...data.permissions,users:{delete:'unlimited'}}},
    {...data,permissions:{...data.permissions,sales:{delete:'365'}}},
    {...data,permissions:{...data.permissions,sales:{backdate:'365'}}},
    {...data,permissions:{...data.permissions,sales:{delete:true}}},
  ]){
    const response=await rpc('login',{success:true,data:broken});
    assert.equal(response.status,503);
    assert.deepEqual(response.body,{success:false,message:'Authentication backend unavailable'});
  }
});
test('nested credential and unexpected identity fields never cross the M04 HTTP boundary',async()=>{
  const forbidden=[
    {...profile(),passwordHash:'SECRET-CREDENTIAL'},
    {...profile(),passwordSalt:'SECRET-SALT'},
    {...profile(),lastLogin:'private timestamp'},
    {...profile(),user:{...profile().user,passwordHash:'SECRET-HASH'}},
    {...profile(),user:{...profile().user,passwordSalt:'SECRET-SALT'}},
    {...profile(),user:{...profile().user,status:'Inactive'}},
    {...profile(),token:'plain bearer token'},
    {...profile(),token:'A'.repeat(64)},
    {...profile(),user:{...profile().user,mobile:'0171SECRET'}},
    {...profile(),user:{...profile().user,id:''}},
    {...profile(),allowedModules:['sales','sales'],permissions:{sales:{view:true}}},
    {...profile(),allowedModules:['sales','secretKey'],permissions:{sales:{view:true}}},
    {...profile(),allowedModules:['sales'],permissions:{sales:{view:true,apiKey:'SECRET'}}},
    {...profile(),allowedModules:['sales'],permissions:{sales:{view:'true'}}},
    {...profile(),allowedModules:['sales'],permissions:{sales:{delete:'unrestricted'}}},
    {...profile(),allowedModules:null,permissions:{sales:{view:true}}},
    {...profile('Cashier'),allowedModules:null},
    {...profile('Cashier'),permissions:null},
    {...profile('Cashier'),permissions:{sales:{view:true,privateSecret:'SECRET'}}},
  ];
  for(const [i,data] of forbidden.entries()){
    const result=await rpc('login',{success:true,data});
    assert.equal(result.status,503,'invalid profile '+i);
    assert.deepEqual(result.body,{success:false,message:'Authentication backend unavailable'},'invalid profile '+i);
    assert.equal(JSON.stringify(result.body).includes('SECRET'),false);
  }
});
test('misleading logout success and arbitrary untrusted auth errors are never reflected',async()=>{
  const bad=[
    ['logout',{success:true,data:{token:TOKEN}}],
    ['logout',{success:true,data:profile()}],
    ['logout',{success:true,data:'SECRET'}],
    ['login',{success:true,data:'logged out'}],
    ['validateSession',{success:true,data:{success:true}}],
    ['login',{success:false,message:'Invalid '+PHONE+' '+PASSWORD}],
    ['login',{success:false,message:'SECRET unknown DB error'}],
    ['validateSession',{success:false,message:'role lookup: private@example.com'}],
  ];
  for(const [method,value] of bad){
    const result=await rpc(method,value);
    assert.equal(result.status,503,method);
    assert.deepEqual(result.body,{success:false,message:'Authentication backend unavailable'});
  }
});
test('nested getters, custom serializers and symbols fail closed without invoking them',async()=>{
  let invoked=false;
  const getter=profile();
  Object.defineProperty(getter.user,'passwordHash',{enumerable:true,get(){invoked=true;return 'SECRET';}});
  const serializer=profile();
  Object.defineProperty(serializer.user,'toJSON',{enumerable:false,value(){invoked=true;return {token:TOKEN,secret:'SECRET'};}});
  const symbol=profile();
  symbol[Symbol('private')]='SECRET';
  const roleGetter=profile('Cashier');
  Object.defineProperty(roleGetter.permissions.sales,'apiKey',{enumerable:true,get(){invoked=true;return 'SECRET';}});
  for(const value of [getter,serializer,symbol,roleGetter]){
    const result=await rpc('login',{success:true,data:value});
    assert.equal(result.status,503);
    assert.equal(JSON.stringify(result.body).includes('SECRET'),false);
  }
  assert.equal(invoked,false,'malicious profile serializers/accessors must never run');
});
test('production Worker and public registry stay disabled despite test-only trusted adapters',async()=>{
  const request=new Request(ORIGIN+'/api/rpc',{
    method:'POST',
    headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'login',args:[PHONE,PASSWORD]}),
  });
  const result=await worker.fetch(request,{});
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{
    success:false,message:'Sign-in is unavailable because server authentication is not configured yet.'
  });
});
