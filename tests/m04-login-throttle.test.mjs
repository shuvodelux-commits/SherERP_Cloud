import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  LEGACY_LOGIN_LIMITS,
  transitionLoginThrottle,
} from '../src/auth/login-throttle-policy.js';

const NOW=1_800_000_000_000;
const {failureLimit,lockoutMs,resetAfterMs}=({failureLimit:5,lockoutMs:15*60_000,resetAfterMs:60*60_000});
const fail=(prior,now)=>transitionLoginThrottle(prior,'failure',now);
const inspect=(prior,now)=>transitionLoginThrottle(prior,'inspect',now);
const succeed=(prior,now)=>transitionLoginThrottle(prior,'success',now);

test('pinned GAS source defines 5 attempts, 15-minute lock and one-hour cache TTL',()=>{
  const gas=readFileSync(new URL('../legacy/source/Auth.gs',import.meta.url),'utf8');
  assert.match(gas,/const LOGIN_FAILURE_LIMIT_\s*=\s*5\s*;/);
  assert.match(gas,/const LOGIN_LOCKOUT_MS_\s*=\s*15 \* 60 \* 1000\s*;/);
  assert.match(gas,/const LOGIN_THROTTLE_CACHE_SECONDS_\s*=\s*60 \* 60\s*;/);
  assert.match(gas,/if \(state\.lockedUntil > Date\.now\(\)\)/);
  assert.deepEqual(LEGACY_LOGIN_LIMITS,{failureLimit,lockoutMs,resetAfterMs});
  assert.equal(Object.isFrozen(LEGACY_LOGIN_LIMITS),true);
});

test('confirmed missing row is unlocked; 4 failures keep unlocked; 5th starts lockout',()=>{
  assert.deepEqual(inspect(null,NOW),{blocked:false,state:null});
  let current=null;
  for(let i=1;i<=5;i++) {
    const result=fail(current,NOW+i*1000);
    assert.equal(result.blocked,i===5);
    assert.equal(result.state.failureCount,i);
    assert.equal(result.state.lastFailureAtMs,NOW+i*1000);
    assert.equal(result.state.resetAtMs,NOW+i*1000+resetAfterMs);
    assert.equal(result.state.lockedUntilMs,i===5?NOW+i*1000+lockoutMs:0);
    current=result.state;
  }
  assert.equal(inspect(current,NOW+5000).blocked,true);
});

test('locked account cannot increment, extend lock or clear by a reported success',()=>{
  let row=null;
  for(let i=0;i<failureLimit;i++)row=fail(row,NOW+i*1000).state;
  const untouched=structuredClone(row);
  for(const event of ['inspect','failure','success']){
    const got=transitionLoginThrottle(row,event,NOW+200_000);
    assert.equal(got.blocked,true);
    assert.deepEqual(got.state,untouched);
  }
  assert.deepEqual(row,untouched);
});

test('at exact 15-minute lock expiry: unlocked and next failure starts fresh counter',()=>{
  let row=null;
  for(let i=0;i<5;i++)row=fail(row,NOW+i).state;
  const boundary=row.lockedUntilMs;
  assert.equal(inspect(row,boundary-1).blocked,true);
  assert.deepEqual(inspect(row,boundary),{blocked:false,state:null});
  const after=fail(row,boundary);
  assert.equal(after.blocked,false);
  assert.equal(after.state.failureCount,1);
  assert.equal(after.state.lockedUntilMs,0);
});

test('one-hour cache TTL expires: exact boundary clears failed attempts',()=>{
  const first=fail(null,NOW).state;
  assert.equal(inspect(first,NOW+resetAfterMs-1).state.failureCount,1);
  assert.deepEqual(inspect(first,NOW+resetAfterMs),{blocked:false,state:null});
  const after=fail(first,NOW+resetAfterMs);
  assert.equal(after.blocked,false);
  assert.equal(after.state.failureCount,1);
  assert.equal(after.state.resetAtMs,NOW+2*resetAfterMs);
});

test('successful authentication clears only an unlocked counter',()=>{
  const row=fail(null,NOW).state;
  const result=succeed(row,NOW+100);
  assert.deepEqual(result,{blocked:false,state:null});
  assert.deepEqual(succeed(null,NOW),{blocked:false,state:null});
  assert.equal(fail(result.state,NOW+200).state.failureCount,1);
});

test('validation refuses missing, malformed and inherited persisted throttle state',()=>{
  const row=fail(null,NOW).state;
  for(const bad of [
    undefined,{},[],false,'',0,
    {...row,failureCount:0},
    {...row,failureCount:6},
    {...row,failureCount:1.5},
    {...row,failureCount:'1'},
    {...row,resetAtMs:Infinity},
    {...row,resetAtMs:NOW},
    {...row,lockedUntilMs:NOW+lockoutMs},
    {...row,lastFailureAtMs:NOW+1},
    {...row,resetAtMs:NOW+resetAfterMs+1},
    {...row,failureCount:5},
    Object.assign(Object.create({failureCount:1}),{
      lockedUntilMs:row.lockedUntilMs,
      lastFailureAtMs:row.lastFailureAtMs,
      resetAtMs:row.resetAtMs,
    }),
  ]) assert.throws(()=>inspect(bad,NOW),{name:'TypeError'});
  const accessor={...row};
  Object.defineProperty(accessor,'failureCount',{get(){throw new Error('executed getter')},enumerable:true});
  assert.throws(()=>inspect(accessor,NOW),{name:'TypeError'});
  const proxy=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('proxy!')}});
  assert.throws(()=>inspect(proxy,NOW),{name:'TypeError'});
});

test('only explicit server-owned event and epoch may transition state',()=>{
  for(const event of [undefined,null,'login','reset','FAILURE','failure ',{},5])
    assert.throws(()=>transitionLoginThrottle(null,event,NOW),{name:'TypeError'});
  for(const now of [undefined,null,-1,1.2,NaN,Infinity,'1800000000000',Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>inspect(null,now),{name:'TypeError'});
  const future=fail(null,NOW+100).state;
  assert.throws(()=>inspect(future,NOW),{name:'TypeError'});
});

test('near safe-integer clock overflow, never create invalid lock or reset timestamps',()=>{
  const extreme=Number.MAX_SAFE_INTEGER-5;
  assert.throws(()=>fail(null,extreme),{name:'RangeError'});
  assert.deepEqual(inspect(null,extreme),{blocked:false,state:null});
});

test('policy is pure and remains unregistered as public RPC and Worker route',()=>{
  const source=readFileSync(new URL('../src/auth/login-throttle-policy.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Date\.now\(|Math\.random\(|console\.|\.prepare\(|\bfetch\(/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/login-throttle-policy|transitionLoginThrottle/);
  assert.doesNotMatch(worker,/login-throttle-policy|transitionLoginThrottle/);
});
