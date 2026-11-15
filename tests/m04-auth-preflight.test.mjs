import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const ORIGIN='https://shererp-preview.invalid';
const AUTH_RPC_NAMES=[
  'login','logout','validateSession',
  'getUsersBootstrap','createUser','updateUser','resetPassword','setUserStatus','deleteUser',
  'getRolesBootstrap','addRole','updateRole','setRoleStatus','deleteRole'
];

function call(name,args) {
  return worker.fetch(new Request(ORIGIN+'/api/rpc',{
    method:'POST',
    headers:{Origin:ORIGIN,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:name,args}),
  }),{});
}

test('every legacy M04 auth/user/role RPC remains disabled before D1-backed auth review',async()=>{
  for(const name of AUTH_RPC_NAMES) {
    const values=name==='login'?['01700000000','example-secret']:['unauthorized-token'];
    const response=await call(name,values);
    assert.equal(response.status,501,name);
    assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'},name);
    assert.equal(response.headers.get('Cache-Control'),'no-store',name);
    assert.equal(response.headers.get('set-cookie'),null,name);
  }
});

test('authentication error never reflects passwords or tokens and does not access missing D1 binding',async()=>{
  const secret='never-echo-this-secret-password';
  const result=await call('login',['01700000000',secret]);
  const body=await result.text();
  assert.equal(result.status,501);
  assert.equal(body.includes(secret),false);
  assert.equal(body.includes('01700000000'),false);
});

test('first-administrator GAS helper is not accessible as a public RPC',async()=>{
  const r=await call('createFirstAdmin_',[]);
  assert.equal(r.status,501);
});

test('unauthenticated getAppShellData stays disabled until an explicit sanitized M04 allowlist exists',async()=>{
  const r=await call('getAppShellData',[]);
  assert.equal(r.status,501);
  assert.equal((await r.json()).success,false);
});
