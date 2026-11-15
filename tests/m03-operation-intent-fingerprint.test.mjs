import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hashCanonicalOperationIntent} from '../src/db/operation-intent-fingerprint.js';

const BASE=()=>({
  tenantId:'tenant-1',
  actorId:'staff-1',
  operationType:'sales.post',
  payload:{items:[{sku:'PIPE',quantity:'1.000'}],total:'120.00'}
});

test('canonical digest equals independently constructed SHA-256 over versioned, sorted UTF-8 JSON',async()=>{
  const expectedJson='{"actorId":"staff-1","operationType":"sales.post","payload":{"items":[{"quantity":"1.000","sku":"PIPE"}],"total":"120.00"},"tenantId":"tenant-1"}';
  const expected=createHash('sha256').update('SherERP:operation-intent:v1\n'+expectedJson,'utf8').digest('hex');
  assert.equal(await hashCanonicalOperationIntent(BASE()),expected);
  assert.match(expected,/^[a-f0-9]{64}$/);
});

test('nested object property order never alters fingerprint while array order remains significant',async()=>{
  const baseline=BASE();
  const reordered={payload:{total:'120.00',items:[{quantity:'1.000',sku:'PIPE'}]},
    operationType:'sales.post',actorId:'staff-1',tenantId:'tenant-1'};
  const original=await hashCanonicalOperationIntent(baseline);
  assert.equal(await hashCanonicalOperationIntent(reordered),original);
  const another=BASE(); another.payload.items.push({sku:'WIRE',quantity:'2'});
  const rotated=BASE(); rotated.payload.items.unshift({sku:'WIRE',quantity:'2'});
  assert.notEqual(await hashCanonicalOperationIntent(another),await hashCanonicalOperationIntent(rotated));
});

test('same payload but changed tenant, actor, operation type, or amount yields different digest',async()=>{
  const baseline=await hashCanonicalOperationIntent(BASE());
  for(const change of [
    {tenantId:'tenant-2'}, {actorId:'staff-2'}, {operationType:'purchase.post'},
    {payload:{items:[{sku:'PIPE',quantity:'1.000'}],total:'120.01'}}
  ]){
    assert.notEqual(await hashCanonicalOperationIntent({...BASE(),...change}),baseline);
  }
});

test('preserves UTF-8 and exact Unicode rather than applying lossy normalization',async()=>{
  const raw=BASE();raw.payload.note='বাংলা — café 😀';
  const expected='{"actorId":"staff-1","operationType":"sales.post","payload":{"items":[{"quantity":"1.000","sku":"PIPE"}],"note":"বাংলা — café 😀","total":"120.00"},"tenantId":"tenant-1"}';
  assert.equal(await hashCanonicalOperationIntent(raw),
    createHash('sha256').update('SherERP:operation-intent:v1\n'+expected,'utf8').digest('hex'));
  const decomposed=BASE(); decomposed.payload.note='cafe\u0301';
  assert.notEqual(await hashCanonicalOperationIntent(raw),await hashCanonicalOperationIntent(decomposed));
});

test('rejects floating point amounts, unsafe numbers, nonfinite and negative zero instead of JSON-coercing',async()=>{
  for(const bad of [0.1,0.5,NaN,Infinity,-Infinity,-0,Number.MAX_SAFE_INTEGER+1,1e21]){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),payload:{quantity:bad}}),
      /invalid|integer|number|unsupported/i);
  }
  const a=await hashCanonicalOperationIntent({...BASE(),payload:{quantity:1}});
  const b=await hashCanonicalOperationIntent({...BASE(),payload:{quantity:'1'}});
  assert.notEqual(a,b);
});

test('rejects unsupported JSON values and custom objects instead of silently omitting them',async()=>{
  for(const payload of [
    {value:undefined}, {value:()=>1}, {value:Symbol('x')}, {value:1n},
    {value:new Date('2026-11-15T00:00:00Z')}, {value:new Map([['a',1]])},
    {value:new Set([1])}, {value:/a/}, {value:Buffer.from('secret')},
  ]){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),payload}),
      /invalid|unsupported|plain|json|object|value/i);
  }
});

test('rejects sparse or decorated arrays, accessors, symbol keys and prototype-pollution keys',async()=>{
  const sparse=[];sparse[1]=1;
  const decorated=[1];decorated.extra=true;
  const accessor={};Object.defineProperty(accessor,'value',{enumerable:true,get(){throw new Error('getter executed');}});
  const nonenumerable={};Object.defineProperty(nonenumerable,'secret',{value:1,enumerable:false});
  const symbol={[Symbol('secret')]:1};
  for(const object of [
    {value:sparse},{value:decorated},{value:accessor},{value:nonenumerable},
    {value:symbol},{['__proto__']:123},{constructor:1},{prototype:1}
  ]){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),payload:object}),
      /invalid|unsupported|key|property|plain|array|accessor/i);
  }
});

test('rejects circular objects, excessive nesting and excessive UTF-8 payload bytes',async()=>{
  const cyc={name:'cycle'};cyc.self=cyc;
  const nested={};let ptr=nested;for(let i=0;i<30;i++){ptr.next={};ptr=ptr.next;}
  for(const payload of [cyc,nested,{text:'x'.repeat(34000)}]){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),payload}),
      /invalid|unsupported|cycle|depth|size|large|limit/i);
  }
});

test('rejects malformed surrogate strings and keys to avoid identical U+FFFD hashes',async()=>{
  for(const payload of [
    {value:'\uD800'}, {value:'\uDC00'}, {['\uD800']:'broken'},
  ]){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),payload}),
      /invalid|unicode|surrogate|string|key/i);
  }
});

test('invalid context, untrusted extra keys and non-object payload fail before any digest',async()=>{
  const bad=[
    {tenantId:''},{tenantId:' tenant-1'},{tenantId:'tenant 1'},
    {tenantId:'T'.repeat(130)},{actorId:''},{actorId:' staff-1'},
    {operationType:'Sales.Post'}, {operationType:'s'}, {operationType:'sales post'},
    {operationType:undefined}, {payload:null},{payload:[]},{payload:'raw JSON'},
    {extra:'UNTRUSTED'}
  ];
  for(const changes of bad){
    await assert.rejects(()=>hashCanonicalOperationIntent({...BASE(),...changes}),
      /invalid|context|payload|operation|tenant|actor|key|field/i);
  }
  for(const badInput of [null,[],{},'raw string',Object.create(Date.prototype)]){
    await assert.rejects(()=>hashCanonicalOperationIntent(badInput),
      /invalid|context|payload|operation|tenant|actor|key|field/i);
  }
});

test('valid canonicalization never mutates the source input or inserts defaults',async()=>{
  const input=BASE();
  const before=structuredClone(input);
  await hashCanonicalOperationIntent(input);
  assert.deepEqual(input,before);
  const nullPrototype=Object.create(null);nullPrototype.sku='PIPE';
  assert.match(await hashCanonicalOperationIntent({...BASE(),payload:nullPrototype}),/^[a-f0-9]{64}$/);
});
