import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const ORIGIN='https://shererp-preview.invalid';
const MESSAGE='Sign-in is unavailable because server authentication is not configured yet.';
const call=(fnName,args=[],options={})=>worker.fetch(new Request(ORIGIN+'/api/rpc',{
  method:'POST',
  headers:{'Content-Type':'application/json',Origin:options.origin??ORIGIN},
  body:JSON.stringify({fnName,args}),
}),{});

test('unconfigured login returns actionable 503 instead of an internal RPC migration error',async()=>{
  const response=await call('login',['01700000000','synthetic-test-only']);
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{success:false,message:MESSAGE});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('set-cookie'),null);
});

test('login error never reflects sensitive input or issues a login receipt',async()=>{
  const mobile='01799999999';
  const password='NOT-A-REAL-CREDENTIAL-PRIVATE';
  const response=await call('login',[mobile,password]);
  const body=await response.text();
  assert.equal(response.status,503);
  for(const secret of [mobile,password,'token','allowedModules','permissions']){
    assert.equal(body.includes(secret),false);
  }
});

test('pre-auth login input guard rejects cross-origin calls before revealing auth availability',async()=>{
  const response=await call('login',['synthetic','synthetic'],{origin:'https://attacker.invalid'});
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{success:false,message:'Cross-origin RPC forbidden'});
});

test('unsupported and privileged RPC methods are still unavailable, never default allowed',async()=>{
  for(const name of ['validateSession','logout','createFirstAdmin_','getUsersBootstrap','completeSale']){
    const response=await call(name,['synthetic']);
    assert.equal(response.status,501,name);
    assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'},name);
  }
});
