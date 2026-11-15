import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isSessionWithinPolicy} from '../src/auth/session-validity.js';

const NOW=1_800_000_000_000;
const TEN_MIN=10*60_000;
const ONE_HOUR=60*60_000;
const policy=()=>({maxLifetimeMs:2*ONE_HOUR,maxIdleMs:15*60_000});
const session=()=>({
  createdAtMs:NOW-ONE_HOUR,
  lastActivityAtMs:NOW-TEN_MIN,
  expiresAtMs:NOW+ONE_HOUR,
  revokedAtMs:null,
});

test('pinned GAS has Never-expiring sessions, but M04 must not treat Never as active',()=>{
  const source=readFileSync(new URL('../legacy/source/Auth.gs',import.meta.url),'utf8');
  assert.match(source,/SESSION_NEVER_EXPIRES_\s*=\s*["']Never["']/);
  assert.match(source,/function isSessionExpiryValid_\(expiresAt\)/);
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:'Never'},policy(),NOW),false);
});

test('valid synthetic server session respects explicit policy, without mutation',()=>{
  const s=session(),p=policy();
  const oldS=structuredClone(s),oldP=structuredClone(p);
  assert.equal(isSessionWithinPolicy(s,p,NOW),true);
  assert.deepEqual(s,oldS);
  assert.deepEqual(p,oldP);
});

test('absolute expiry is strict: at expiry or one millisecond later denies',()=>{
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:NOW},policy(),NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:NOW-1},policy(),NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:NOW+1},policy(),NOW),true);
});

test('idle timeout is strict and measured from last activity',()=>{
  const p=policy();
  assert.equal(isSessionWithinPolicy({...session(),lastActivityAtMs:NOW-p.maxIdleMs},p,NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),lastActivityAtMs:NOW-p.maxIdleMs+1},p,NOW),true);
  assert.equal(isSessionWithinPolicy({...session(),lastActivityAtMs:NOW+1},p,NOW),false);
});

test('absolute max lifetime is enforced independently of expiresAtMs',()=>{
  const p=policy();
  assert.equal(isSessionWithinPolicy({...session(),createdAtMs:NOW-p.maxLifetimeMs},p,NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),createdAtMs:NOW-p.maxLifetimeMs+1},p,NOW),false); // expiry exceeds allowed lifetime
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:NOW+ONE_HOUR+1},p,NOW),false);
  assert.equal(isSessionWithinPolicy(session(),p,NOW),true);
});

test('revoked, missing, forged or inherited revocation state always denies',()=>{
  for(const value of [NOW-1000,NOW+1000,0,false,'',undefined,'Never'])
    assert.equal(isSessionWithinPolicy({...session(),revokedAtMs:value},policy(),NOW),false);
  const {revokedAtMs, ...withoutRevocation}=session();
  assert.equal(isSessionWithinPolicy(withoutRevocation,policy(),NOW),false);
  const inherited=Object.create({revokedAtMs:null});
  Object.assign(inherited,withoutRevocation);
  assert.equal(isSessionWithinPolicy(inherited,policy(),NOW),false);
});

test('missing/invalid policy does not become an unlimited duration',()=>{
  for(const p of [undefined,null,{},[],{maxIdleMs:1}, {maxLifetimeMs:1},
    {maxIdleMs:0,maxLifetimeMs:2*ONE_HOUR},
    {maxIdleMs:15*60_000,maxLifetimeMs:0},
    {maxIdleMs:'unlimited',maxLifetimeMs:2*ONE_HOUR},
    {maxIdleMs:Infinity,maxLifetimeMs:2*ONE_HOUR},
    {maxIdleMs:15.5,maxLifetimeMs:2*ONE_HOUR},
    {maxIdleMs:15*60_000,maxLifetimeMs:Number.MAX_SAFE_INTEGER+1},
  ]) assert.equal(isSessionWithinPolicy(session(),p,NOW),false);
  const inherited=Object.create(policy());
  assert.equal(isSessionWithinPolicy(session(),inherited,NOW),false);
});

test('timestamp fields require nonnegative safe-integer millisecond values',()=>{
  for(const field of ['createdAtMs','lastActivityAtMs','expiresAtMs']){
    for(const invalid of [undefined,null,'2026-11-15T00:00:00Z','Never',
      -1,Infinity,NaN,1.5,Number.MAX_SAFE_INTEGER+1]){
      assert.equal(isSessionWithinPolicy({...session(),[field]:invalid},policy(),NOW),false,`${field}=${String(invalid)}`);
    }
  }
  for(const invalidNow of [undefined,null,'now',-1,NaN,Infinity,1.25,Number.MAX_SAFE_INTEGER+1])
    assert.equal(isSessionWithinPolicy(session(),policy(),invalidNow),false);
});

test('out of order server timestamps deny: activity before creation or expiry before creation',()=>{
  assert.equal(isSessionWithinPolicy({...session(),lastActivityAtMs:NOW-ONE_HOUR-1},policy(),NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),expiresAtMs:NOW-ONE_HOUR},policy(),NOW),false);
  assert.equal(isSessionWithinPolicy({...session(),createdAtMs:NOW+1},policy(),NOW),false);
});

test('accessor and proxy inputs cannot grant a session without evaluation',()=>{
  const trap={...session()};
  Object.defineProperty(trap,'revokedAtMs',{get(){throw new Error('getter called')},enumerable:true});
  assert.equal(isSessionWithinPolicy(trap,policy(),NOW),false);
  const p={...policy()};
  Object.defineProperty(p,'maxIdleMs',{get(){throw new Error('getter called')},enumerable:true});
  assert.equal(isSessionWithinPolicy(session(),p,NOW),false);
  assert.equal(isSessionWithinPolicy(new Proxy({},{
    getOwnPropertyDescriptor(){throw new Error('proxy trap')},
  }),policy(),NOW),false);
});

test('session predicate is internal and auth RPCs remain unavailable',async()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/session-validity|isSessionWithinPolicy/);
  assert.doesNotMatch(worker,/session-validity|isSessionWithinPolicy/);
  const {default:app}=await import('../src/index.js');
  const origin='https://shererp-preview.invalid';
  const response=await app.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'validateSession',args:['synthetic-token']}),
  }),{});
  assert.equal(response.status,501);
  assert.equal((await response.json()).success,false);
});
