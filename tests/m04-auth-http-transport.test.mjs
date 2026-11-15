import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRpc} from '../src/rpc/handler.js';
import worker from '../src/index.js';

const ORIGIN='https://shererp.test.invalid';
const authAdapter=Object.freeze({
  async login(mobile,password){
    assert.equal(mobile,'01710000101');
    assert.equal(password,'test-secret');
    return {success:true,data:{token:'a'.repeat(64),user:{id:'USR-A',name:'Test',mobile,role:'Administrator'},allowedModules:null,permissions:null}};
  },
  async validateSession(token){
    assert.equal(token,'a'.repeat(64));
    return {success:true,data:{token,user:{id:'USR-A',name:'Test',mobile:'01710000101',role:'Administrator'},allowedModules:null,permissions:null}};
  },
  async logout(token){
    assert.equal(token,'a'.repeat(64));
    return {success:true,data:'logged out'};
  },
});
const user={};
function request(fnName,args,opts={}){
  const headers={'Content-Type':'application/json',Origin:ORIGIN,...(opts.headers||{})};
  return new Request(ORIGIN+'/api/rpc',{
    method:opts.method||'POST',headers,
    body:(opts.method==='GET')?undefined:JSON.stringify({fnName,args}),
  });
}
async function invoke(fnName,args,options={authAdapter}){
  const response=await handleRpc(request(fnName,args),options);
  return {status:response.status,headers:response.headers,body:await response.json()};
}
test('explicit trusted auth adapter carries original login/validate/logout result envelopes',async()=>{
  const login=await invoke('login',['01710000101','test-secret']);
  assert.equal(login.status,200);
  assert.equal(login.headers.get('Cache-Control'),'no-store');
  assert.equal(login.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(login.body,{
    success:true,data:{token:'a'.repeat(64),
      user:{id:'USR-A',name:'Test',mobile:'01710000101',role:'Administrator'},
      allowedModules:null,permissions:null}
  });
  assert.deepEqual((await invoke('validateSession',['a'.repeat(64)])).body,login.body);
  assert.deepEqual((await invoke('logout',['a'.repeat(64)])).body,{success:true,data:'logged out'});
});
test('auth adapter never enables staff mutations, private helpers or arbitrary method execution',async()=>{
  for(const method of ['getUsersBootstrap','updateUser','getRolesBootstrap','deleteRole',
    'completeSale','getAppShellData','createFirstAdmin_','constructor']){
    const response=await invoke(method,[]);
    assert.equal(response.status,501,method);
    assert.equal(response.body.success,false);
  }
});
test('auth methods enforce exact arity and bounded string arguments before calling trusted adapter',async()=>{
  for(const [name,args] of [
    ['login',[]],['login',['01710000101']],['login',['01710000101','test-secret','extra']],
    ['login',['01710000101',{}]],['login',['x'.repeat(65),'test-secret']],
    ['login',['01710000101','x'.repeat(1025)]],
    ['validateSession',[]],['validateSession',[{token:'fake'}]],
    ['logout',[123]],['logout',['x'.repeat(129)]],
  ]){
    const response=await invoke(name,args);
    assert.equal(response.status,400,name+': '+JSON.stringify(args).slice(0,85));
    assert.equal(response.body.success,false);
  }
});
test('original request safety checks still precede trusted auth dispatch',async()=>{
  const requestOptions=[
    {headers:{Origin:'https://evil.invalid'}},
    {headers:{'Content-Type':'text/plain'}},
    {method:'GET'},
  ];
  for(const opts of requestOptions){
    const response=await handleRpc(request('login',['01710000101','test-secret'],opts),{authAdapter});
    assert.notEqual(response.status,200);
  }
});
test('backend failures and malformed backend results fail closed without returning secrets',async()=>{
  const secret='unprintable-secret';
  const cases=[
    {async login(){throw new Error(secret)}},
    {async login(){return {success:true,data:{user:'bad'},debug:secret}}},
    {async login(){return {success:false,message:'no',secret}}},
    {async login(){return null}},
    {login:'not callable'}
  ];
  for(const adapter of cases){
    const response=await invoke('login',['01710000101','test-secret'],{authAdapter:adapter});
    assert.equal(response.status,503);
    const body=JSON.stringify(response.body);
    assert.equal(body.includes(secret),false);
    assert.equal(body.includes('test-secret'),false);
    assert.equal(body.includes('01710000101'),false);
  }
});
test('public Worker remains disabled even when request sends fake auth adapter fields',async()=>{
  const direct=await worker.fetch(new Request(ORIGIN+'/api/rpc',{
    method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'login',args:['01710000101','test-secret'],
      authAdapter:{login:'allow'},role:'Administrator',nowMs:1})
  }),{});
  assert.equal(direct.status,503);
  assert.deepEqual(await direct.json(),{
    success:false,message:'Sign-in is unavailable because server authentication is not configured yet.'
  });
  const other=await worker.fetch(request('validateSession',['a'.repeat(64)]),{});
  assert.equal(other.status,501);
});
