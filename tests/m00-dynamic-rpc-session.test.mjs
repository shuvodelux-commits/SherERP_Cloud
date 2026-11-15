import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditM00DynamicRpcSessionFirst,assertM00DynamicRpcSessionSnapshot}
  from '../scripts/audit-m00-dynamic-rpc-session.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDir=fileURLToPath(new URL('../legacy/source/',import.meta.url));
const SHA='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sources=Object.fromEntries(readdirSync(sourceDir)
  .filter(x=>/\.(gs|html)$/.test(x))
  .map(x=>[x,readFileSync(sourceDir+x,'utf8')]));
const snapshot=name=>JSON.parse(readFileSync(root+'docs/baseline/'+name+'.json','utf8'));
const lexicalSnapshot=snapshot('m00-rpc-contract-inventory');
const dynamicSnapshot=snapshot('m00-dynamic-rpc-closure');
const aritySnapshot=snapshot('m00-dynamic-rpc-arity');
const audit=copy=>auditM00DynamicRpcSessionFirst({
  sources:copy,sourceCommit:SHA,lexicalSnapshot,dynamicSnapshot,aritySnapshot
});

test('all four reviewed dynamic RPC browser sites supply authToken first to sixteen token-first GAS targets',()=>{
  const result=audit(sources);
  assert.equal(result.sourceCommit,SHA);
  assert.deepEqual(result.counts,{dynamicCallsites:4,checkedTargets:16});
  assert.deepEqual(result.callsites.map(c=>[c.frontendFile,c.line,c.clientFirstArgument,c.targets.length]),[
    ['products.html',997,'authToken',2],
    ['products.html',1030,'authToken',2],
    ['vendors.html',1062,'authToken',6],
    ['vendors.html',1153,'authToken',6]
  ]);
  assert.ok(result.callsites.every(c=>c.targets.every(t=>t.firstBackendParameter==='token')));
  assert.match(result.methodology,/not authentication|not authorization/i);
});

test('product add refuses replacing the token with an untrusted id without changing arity',()=>{
  const source={...sources};
  source['products.html']=source['products.html'].replace(
    'serverCall(fn, authToken, { name: name })',
    'serverCall(fn, currentUserId, { name: name })'
  );
  assert.notEqual(source['products.html'],sources['products.html']);
  assert.throws(()=>audit(source),/token|first|session/i);
});

test('vendor update rejects swapping a source id into the first token argument position',()=>{
  const source={...sources};
  source['vendors.html']=source['vendors.html'].replace(
    'serverCall(handlers.update, authToken, id, payload)',
    'serverCall(handlers.update, id, authToken, payload)'
  );
  assert.notEqual(source['vendors.html'],sources['vendors.html']);
  assert.throws(()=>audit(source),/token|first|session/i);
});

test('GAS dynamic backend first formal renamed from token to caller-supplied actor fails closed',()=>{
  const source={...sources};
  source['DeleteEngine.gs']=source['DeleteEngine.gs'].replace(
    'function getVendorPaymentForEdit(token, ledgerId)',
    'function getVendorPaymentForEdit(actorId, ledgerId)'
  );
  assert.notEqual(source['DeleteEngine.gs'],sources['DeleteEngine.gs']);
  assert.throws(()=>audit(source),/token|first|formal|backend/i);
});

test('checked snapshot rejects modified token position and does not mutate original sources',()=>{
  const saved={...sources};
  const result=audit(sources);
  assert.deepEqual(sources,saved);
  assert.equal(assertM00DynamicRpcSessionSnapshot(result,structuredClone(result)),true);
  const forged=structuredClone(result);
  forged.callsites[1].clientFirstArgument='actorId';
  assert.throws(()=>assertM00DynamicRpcSessionSnapshot(result,forged),/drift/i);
});

test('audited dynamic/arity inventory must be exact before checking token position',()=>{
  const forged=structuredClone(dynamicSnapshot);
  forged.callsites[0].targets.pop();
  assert.throws(()=>auditM00DynamicRpcSessionFirst({
    sources,sourceCommit:SHA,lexicalSnapshot,
    dynamicSnapshot:forged,aritySnapshot
  }),/drift|snapshot/i);
  assert.throws(()=>auditM00DynamicRpcSessionFirst({
    sources,sourceCommit:'bad',lexicalSnapshot,dynamicSnapshot,aritySnapshot
  }),/source|invalid|SHA/i);
});

test('source-pinned CLI --check succeeds and unsupported modes fail without writing data',()=>{
  const script=root+'scripts/audit-m00-dynamic-rpc-session.mjs';
  const good=spawnSync(process.execPath,[script,'--check'],{cwd:root,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/session token.*verified/i);
  const bad=spawnSync(process.execPath,[script,'--enable-rpc'],{cwd:root,encoding:'utf8'});
  assert.notEqual(bad.status,0);
});
