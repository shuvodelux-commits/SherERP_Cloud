import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFullyResolvedRpcValue} from '../src/rpc/awaited-response-boundary.js';

test('fully awaited source-compatible envelopes preserve exact data without normalization',()=>{
  const envelope={success:true,data:{
    shopName:'নবাবী',currencySymbol:'৳',count:0,enabled:false,
    navItems:[{key:'pos',children:[{key:'posv2',label:'POS V2'}]}],
    extras:null,permissions:Object.assign(Object.create(null),{dashboard:{view:true}})
  }};
  assert.equal(assertFullyResolvedRpcValue(envelope),true);
  assert.deepEqual(envelope.data.navItems[0].children,[{key:'posv2',label:'POS V2'}]);
  assert.equal(Object.getPrototypeOf(envelope.data.permissions),null);
});

test('a nested D1 Promise must never be silently serialized to JSON as an empty object',()=>{
  const p=Promise.resolve('available');
  for(const invalid of [
    p,
    {success:true,data:p},
    {success:true,data:{rows:[{value:p}]}},
    {success:true,data:{modules:['Sales',Promise.resolve('Purchase')]}},
    {success:true,data:{future:{value:new Promise(()=>{})}}}
  ])assert.throws(()=>assertFullyResolvedRpcValue(invalid),/unresolved|Promise|RPC.*response|awaited/i);
  assert.deepEqual(JSON.parse(JSON.stringify({result:p})),{result:{}},
    'JSON.stringify silently conceals an unawaited Promise without the new gate');
});

test('thenables, accessors and non-plain D1 result classes fail without invoking custom code',()=>{
  let invoked=0;
  const accessor=Object.defineProperty({},'shopName',{
    enumerable:true,get(){invoked++;throw Error('SECRET_D1_SQL');}
  });
  const inherited=Object.create({then(){invoked++;}});
  inherited.row='A';
  const thenable={then(){invoked++;},value:'A'};
  for(const invalid of [
    accessor,inherited,thenable,
    {source:new Date('2026-11-17T00:00:00Z')},
    {source:new Map([['key','private']])},
    Object.defineProperty({},'hidden',{value:'SECRET',enumerable:false}),
    Object.assign({},JSON.parse('{"__proto__":"injected"}'))
  ])assert.throws(()=>assertFullyResolvedRpcValue(invalid),/unresolved|invalid|unsupported|RPC.*response/i);
  assert.equal(invoked,0,'transport cannot run an accessor or a thenable');
});

test('sparse arrays, circular references, undefined, NaN, Infinity, BigInt and functions cannot be serialized',()=>{
  const cycle={success:true};cycle.self=cycle;
  const sparse=[0,,2];
  const bad=[cycle,sparse,{data:undefined},{data:NaN},{data:Infinity},
    {data:1n},{data:()=>true},{data:Symbol('hidden')},[1,undefined]];
  for(const value of bad){
    assert.throws(()=>assertFullyResolvedRpcValue(value),/unresolved|invalid|unsupported|RPC.*response/i);
  }
});

test('transport rejects excessive depth and too many nodes to avoid recursion and response amplification',()=>{
  const deep={};let next=deep;
  for(let i=0;i<45;i++){next.child={};next=next.child;}
  assert.throws(()=>assertFullyResolvedRpcValue(deep),/invalid|unresolved|depth|RPC.*response/i);
  assert.throws(()=>assertFullyResolvedRpcValue({items:Array.from({length:10001},(_,i)=>i)}),
    /invalid|unresolved|large|RPC.*response/i);
});

test('own data fields can be shared across branches but cycles still fail',()=>{
  const shared={value:'same'};
  assert.equal(assertFullyResolvedRpcValue({one:shared,two:shared}),true);
  const a={child:{}};
  a.child.parent=a;
  assert.throws(()=>assertFullyResolvedRpcValue(a),/invalid|unresolved|cycle|RPC.*response/i);
});

test('private source transport remains registered against zero public financial RPC methods',async()=>{
  const {rpcRegistry}=await import('../src/rpc/registry.js');
  assert.deepEqual(Object.keys(rpcRegistry),[]);
  assert.equal(assertFullyResolvedRpcValue({success:false,message:'RPC method not migrated'}),true);
});
