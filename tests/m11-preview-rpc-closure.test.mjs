import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {probeM11PreviewRuntime} from '../scripts/check-m11-preview-runtime.mjs';
import {listM11PreviewRpcNames} from '../scripts/m11-preview-rpc-closure.mjs';

const load=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const literal=load('docs/baseline/m00-rpc-contract-inventory.json');
const dynamic=load('docs/baseline/m00-dynamic-rpc-closure.json');
const preview=load('wrangler.preview.jsonc');
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const list=(a=literal,b=dynamic,pin=SOURCE)=>
  listM11PreviewRpcNames({literalInventory:a,dynamicClosure:b,expectedSourceSha:pin});
const mutate=(name)=>({
  fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/rpc'&&req.method==='POST'){
      const payload=await req.clone().json();
      if(payload.fnName===name){
        return Response.json({success:true,data:{posted:true}},{headers:{
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
        }});
      }
    }
    return worker.fetch(req,env);
  }
});

test('all frozen original frontend RPC targets appear exactly once including dynamic-only vendor calls',()=>{
  const names=list();
  assert.equal(names.length,145);
  assert.equal(new Set(names).size,names.length);
  assert.ok(names.includes('addBankManualEntry'));
  assert.ok(names.includes('login'));
  assert.ok(names.includes('validateSession'));
  assert.ok(names.includes('addProductCategory'));
  assert.ok(names.includes('updateVendorSourcing'));
  assert.deepEqual(names,[...names].sort());
});

test('actual public Worker refuses all 145 pinned frontend RPC targets',async()=>{
  const p=await probeM11PreviewRuntime({worker,previewConfig:preview});
  assert.equal(p.previewRuntimeInert,true);
  assert.equal(p.authorizesProduction,false);
  assert.ok(p.checkedRequests>=145+5);
});

test('previously unprobed literal bank write cannot succeed on public preview',async()=>{
  await assert.rejects(
    probeM11PreviewRuntime({worker:mutate('addBankManualEntry'),previewConfig:preview}),
    /M11_PREVIEW_RPC_UNSAFE/
  );
});

test('dynamic-only source method cannot become a hidden public write path',async()=>{
  await assert.rejects(
    probeM11PreviewRuntime({worker:mutate('addProductCategory'),previewConfig:preview}),
    /M11_PREVIEW_RPC_UNSAFE/
  );
});

test('public registry must remain empty even if fake registered handler rejects probe inputs',async()=>{
  await assert.rejects(
    probeM11PreviewRuntime({worker,previewConfig:preview,registry:{addProduct:()=>({success:false})}}),
    /M11_PREVIEW_REGISTRY_UNSAFE/
  );
});

test('missing or wrong pinned source SHA fails closed',()=>{
  assert.throws(()=>list(undefined,undefined,'0'.repeat(40)),/M11_PREVIEW_INVENTORY_INVALID/);
  const m=structuredClone(literal);m.sourceCommit='f'.repeat(40);
  assert.throws(()=>list(m),/M11_PREVIEW_INVENTORY_INVALID/);
});

test('unreviewed or deleted literal method cannot reduce the number of probes',()=>{
  const m=structuredClone(literal);m.rpcs.pop();
  assert.throws(()=>list(m),/M11_PREVIEW_INVENTORY_INVALID/);
  const q=structuredClone(literal);q.rpcs[0].status='UNRESOLVED';
  assert.throws(()=>list(q),/M11_PREVIEW_INVENTORY_INVALID/);
});

test('invalid method names and duplicate source name are blocked',()=>{
  const x=structuredClone(literal);x.rpcs[0].name='__proto__';
  assert.throws(()=>list(x),/M11_PREVIEW_INVENTORY_INVALID/);
  const y=structuredClone(literal);y.rpcs[1].name=y.rpcs[0].name;
  assert.throws(()=>list(y),/M11_PREVIEW_INVENTORY_INVALID/);
});

test('dynamic target closure cannot be silently omitted or swapped with a literal name',()=>{
  const x=structuredClone(dynamic);x.callsites[3].targets.pop();
  assert.throws(()=>list(literal,x),/M11_PREVIEW_INVENTORY_INVALID/);
  const y=structuredClone(dynamic);y.callsites[0].targets[0].name=literal.rpcs[0].name;
  assert.throws(()=>list(literal,y),/M11_PREVIEW_INVENTORY_INVALID/);
});

test('malformed counters, callsite metadata and injected fields fail closed',()=>{
  const x=structuredClone(literal);x.counts.literalCallsites=171;
  assert.throws(()=>list(x),/M11_PREVIEW_INVENTORY_INVALID/);
  const y=structuredClone(dynamic);y.callsites[0].line=-1;
  assert.throws(()=>list(literal,y),/M11_PREVIEW_INVENTORY_INVALID/);
  const z=structuredClone(literal);z.rpcs[0].credentials='unreviewed';
  assert.throws(()=>list(z),/M11_PREVIEW_INVENTORY_INVALID/);
});
