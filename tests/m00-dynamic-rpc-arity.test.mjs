import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditM00DynamicRpcArity,assertM00DynamicRpcAritySnapshot}
  from '../scripts/audit-m00-dynamic-rpc-arity.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const path=fileURLToPath(new URL('../legacy/source/',import.meta.url));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const original=Object.fromEntries(
  readdirSync(path).filter(name=>/\.(gs|html)$/.test(name))
    .map(name=>[name,readFileSync(path+name,'utf8')])
);
const lexicalSnapshot=JSON.parse(readFileSync(root+'docs/baseline/m00-rpc-contract-inventory.json','utf8'));
const dynamicSnapshot=JSON.parse(readFileSync(root+'docs/baseline/m00-dynamic-rpc-closure.json','utf8'));
const audit=sources=>auditM00DynamicRpcArity({sources,sourceCommit,lexicalSnapshot,dynamicSnapshot});
const copy=()=>({...original});

test('all 4 source-pinned dynamic sites pass exactly the 2/3/2/3 GAS positional inputs',()=>{
  const x=audit(original);
  assert.equal(x.formatVersion,1);
  assert.equal(x.sourceCommit,sourceCommit);
  assert.deepEqual(x.counts,{dynamicCallsites:4,possibleTargetPairs:16,matchedTargetPairs:16});
  assert.deepEqual(x.callsites.map(x=>[x.frontendFile,x.line,x.clientArguments]),[
    ['products.html',997,2],
    ['products.html',1030,3],
    ['vendors.html',1062,2],
    ['vendors.html',1153,3]
  ]);
  assert.deepEqual(x.callsites.map(x=>x.targets.length),[2,2,6,6]);
  assert.ok(x.callsites.every(x=>x.targets.every(t=>t.backendArguments===x.clientArguments)));
  assert.match(x.methodology,/not authorization|not an authorization/i);
});

test('one client argument removed from a dynamic product callsite is a hard mismatch',()=>{
  const s=copy();
  s['products.html']=s['products.html'].replace(
    'serverCall(fn, authToken, { name: name })',
    'serverCall(fn, authToken)'
  );
  assert.notEqual(s['products.html'],original['products.html']);
  assert.throws(()=>audit(s),/arity|argument|mismatch/i);
});

test('changed backend GAS formal parameters invalidate every affected dynamic target',()=>{
  const s=copy();
  s['ProductSettings.gs']=s['ProductSettings.gs'].replace(
    'function addProductUnit(token, payload)',
    'function addProductUnit(token)'
  );
  assert.notEqual(s['ProductSettings.gs'],original['ProductSettings.gs']);
  assert.throws(()=>audit(s),/arity|argument|mismatch/i);
});

test('vendor update call is checked against all six possible backend update handlers',()=>{
  const s=copy();
  s['vendors.html']=s['vendors.html'].replace(
    'serverCall(handlers.update, authToken, id, payload)',
    'serverCall(handlers.update, authToken, id)'
  );
  assert.notEqual(s['vendors.html'],original['vendors.html']);
  assert.throws(()=>audit(s),/arity|argument|mismatch/i);
});

test('spread and default formals fail closed instead of guessing positional arity',()=>{
  const client=copy();
  client['vendors.html']=client['vendors.html'].replace(
    'serverCall(handlers.get, authToken, id)',
    'serverCall(handlers.get, authToken, ...untrusted)'
  );
  assert.throws(()=>audit(client),/spread|unsupported|arity/i);
  const backend=copy();
  backend['ProductSettings.gs']=backend['ProductSettings.gs'].replace(
    'function setProductCategoryStatus(token, categoryId, status)',
    'function setProductCategoryStatus(token, categoryId, status = "Active")'
  );
  assert.throws(()=>audit(backend),/unsupported|formal|parameter/i);
});

test('missing or forged dynamic-source snapshot cannot silently change the target set',()=>{
  const forged=structuredClone(dynamicSnapshot);
  forged.callsites[0].targets.pop();
  assert.throws(()=>auditM00DynamicRpcArity({
    sources:original,sourceCommit,lexicalSnapshot,dynamicSnapshot:forged
  }),/drift|snapshot/i);
  assert.throws(()=>auditM00DynamicRpcArity({
    sources:original,sourceCommit:'wrong',lexicalSnapshot,dynamicSnapshot
  }),/source|SHA|invalid/i);
});

test('deterministic checked snapshot and no mutation of the pinned source map',()=>{
  const initial={...original};
  const out=audit(original);
  assert.deepEqual(audit(original),out);
  assert.deepEqual(original,initial);
  assert.equal(assertM00DynamicRpcAritySnapshot(out,structuredClone(out)),true);
  const changed=structuredClone(out);
  changed.callsites[0].targets[0].backendArguments=99;
  assert.throws(()=>assertM00DynamicRpcAritySnapshot(out,changed),/drift/i);
});

test('CLI --check validates frozen M00 arity inventory; unsupported modes fail',()=>{
  const script=root+'scripts/audit-m00-dynamic-rpc-arity.mjs';
  const good=spawnSync(process.execPath,[script,'--check'],{cwd:root,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/dynamic RPC arity.*verified/i);
  const bad=spawnSync(process.execPath,[script,'--unreviewed'],{cwd:root,encoding:'utf8'});
  assert.notEqual(bad.status,0);
});
