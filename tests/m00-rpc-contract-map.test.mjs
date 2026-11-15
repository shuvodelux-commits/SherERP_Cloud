import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {auditM00RpcContracts,assertM00RpcSnapshot} from '../scripts/audit-m00-rpc.mjs';

const sha='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sample=()=>({
  'index.html': `<script>
  function serverCall(fnName) { return fnName; }
  serverCall('getStock', token);
  serverCall(
    "updateStock",
    token, 4
  );
  // serverCall('inComment');
  /* serverCall('inBlock'); */
  const inert = "serverCall('inString')";
  serverCall(methodName, token);
  </script>`,
  'extra.html': `<script>serverCall('getStock', token); serverCall('missingReport', token);</script>`,
  'Stock.gs': `function getStock(token) { return [] };
function updateStock(token) { return true; }`
});
const audit=(sources=sample())=>auditM00RpcContracts({sources,sourceCommit:sha});
const rpc=(s,name)=>s.rpcs.find(x=>x.name===name);

test('finds literal and multiline browser RPCs and their original backend owners',()=>{
  const out=audit();
  assert.equal(out.formatVersion,1);
  assert.equal(out.sourceCommit,sha);
  assert.deepEqual(out.counts,{frontendFiles:2,backendFiles:1,literalCallsites:4,dynamicCallsites:1,unresolvedNames:1});
  assert.deepEqual(out.rpcs.map(x=>x.name),['getStock','missingReport','updateStock']);
  assert.deepEqual(rpc(out,'getStock').frontendFiles,['extra.html','index.html']);
  assert.equal(rpc(out,'getStock').callCount,2);
  assert.equal(rpc(out,'getStock').backendFile,'Stock.gs');
  assert.equal(rpc(out,'getStock').status,'DEFINED');
  assert.equal(rpc(out,'updateStock').status,'DEFINED');
  assert.equal(rpc(out,'missingReport').backendFile,null);
  assert.equal(rpc(out,'missingReport').status,'UNRESOLVED');
  assert.deepEqual(out.dynamicCallsites,[{frontendFile:'index.html',line:11}]);
  assert.ok(out.methodology.includes('not authorization'));
});

test('not fooled by commented-out or quoted serverCall text',()=>{
  const sources=sample();
  sources['extra.html']=`<script>
// serverCall('fake');
const t="serverCall('fake2')";
/* serverCall('fake3') */
serverCall(handlers.get, token);
</script>`;
  const out=audit(sources);
  assert.equal(out.counts.dynamicCallsites,2);
  assert.ok(!out.rpcs.some(x=>x.name.startsWith('fake')));
});

test('reports unresolved RPC names, not silently exposing them',()=>{
  const sources=sample();
  sources['Stock.gs']=sources['Stock.gs'].replace('function updateStock(','function updateStockOther(');
  const out=audit(sources);
  assert.equal(rpc(out,'updateStock').status,'UNRESOLVED');
  assert.equal(out.counts.unresolvedNames,2);
});

test('duplicate backend definitions for a browser RPC fail closed',()=>{
  const sources=sample();
  sources['Duplicate.gs']='function getStock(token) { return null; }';
  assert.throws(()=>audit(sources),/duplicate.*getStock/i);
});

test('snapshot is deterministic and detects changed browser RPC contract',()=>{
  const old=audit();
  assert.deepEqual(old,audit());
  assert.doesNotThrow(()=>assertM00RpcSnapshot(old,structuredClone(old)));
  const changed=sample();
  changed['index.html']=changed['index.html'].replace("serverCall('getStock', token);","serverCall('getNewStock', token);");
  assert.throws(()=>assertM00RpcSnapshot(audit(changed),old),/drift/i);
});

test('CLI --check matches pinned source snapshot and disallows unsupported args',()=>{
  const script=fileURLToPath(new URL('../scripts/audit-m00-rpc.mjs',import.meta.url));
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const good=spawnSync(process.execPath,[script,'--check'],{cwd,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/M00 RPC contracts verified/);
  const bad=spawnSync(process.execPath,[script,'--not-real'],{cwd,encoding:'utf8'});
  assert.equal(bad.status,1);
});