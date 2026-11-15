import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditM00LiteralRpcSession,assertM00LiteralRpcSessionSnapshot}
  from '../scripts/audit-m00-literal-rpc-session.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=fileURLToPath(new URL('../legacy/source/',import.meta.url));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sources=Object.fromEntries(
  readdirSync(dir).filter(x=>/\.(gs|html)$/.test(x))
    .map(file=>[file,readFileSync(dir+file,'utf8')])
);
const lexicalSnapshot=JSON.parse(readFileSync(root+'docs/baseline/m00-rpc-contract-inventory.json','utf8'));
const run=s=>auditM00LiteralRpcSession({sources:s,sourceCommit,lexicalSnapshot});

test('all 204 AST literal RPC calls are source-audited with only four reviewed authentication-phase exceptions',()=>{
  const report=run(sources);
  assert.equal(report.sourceCommit,sourceCommit);
  assert.deepEqual(report.counts,{
    literalCallsites:204,lexicalCallsites:172,missingFromLexical:32,
    tokenFirstCallsites:200,exceptionCallsites:4,
    distinctMethods:155,lexicalMethods:129
  });
  assert.equal(report.coverageGaps.reduce((n,g)=>n+g.missing,0),32);
  assert.equal(report.coverageGaps.filter(g=>g.indexed===0).length,26);
  assert.ok(report.coverageGaps.some(x=>x.name==='getBankAccountsBootstrap'&&
    x.indexed===0&&x.missing===1));
  assert.deepEqual(report.exceptions.map(x=>[x.name,x.frontendFile,x.clientFirstArgument,x.backendFirstParameter]),[
    ['getAppShellData','javascript.html',null,null],
    ['login','javascript.html','mobile','mobile'],
    ['logout','javascript.html','token','token'],
    ['validateSession','javascript.html','saved','token']
  ]);
  assert.match(report.methodology,/not authentication|not authorization/i);
});

test('authenticated literal browser calls cannot replace authToken with an actor ID',()=>{
  const changed={...sources};
  changed['dashboard.html']=changed['dashboard.html'].replace(
    "serverCall('getDashboardStats', authToken)",
    "serverCall('getDashboardStats', callerId)"
  );
  assert.notEqual(changed['dashboard.html'],sources['dashboard.html']);
  assert.throws(()=>run(changed),/token|session|first/i);
});

test('backend token-first handler cannot change its first formal to an untrusted actor',()=>{
  const changed={...sources};
  changed['Dashboard.gs']=changed['Dashboard.gs'].replace(
    'function getDashboardStats(token)', 'function getDashboardStats(actorId)'
  );
  assert.notEqual(changed['Dashboard.gs'],sources['Dashboard.gs']);
  assert.throws(()=>run(changed),/token|first|backend/i);
});

test('login positional argument order is pinned without misclassifying login as authenticated',()=>{
  const changed={...sources};
  changed['javascript.html']=changed['javascript.html'].replace(
    "serverCall('login', mobile, password)",
    "serverCall('login', password, mobile)"
  );
  assert.notEqual(changed['javascript.html'],sources['javascript.html']);
  assert.throws(()=>run(changed),/login|pre.?session|order|argument/i);
});

test('extra unauthenticated shell bootstrap or reused login call outside the reviewed site is blocked',()=>{
  for(const extra of [
    "serverCall('getAppShellData');",
    "serverCall('login', mobile, password);"
  ]){
    const changed={...sources};
    changed['dashboard.html']=changed['dashboard.html'].replace(
      '<script>', '<script>\n'+extra+'\n'
    );
    assert.notEqual(changed['dashboard.html'],sources['dashboard.html']);
    assert.throws(()=>run(changed),/exception|review|unauth|source|drift|token/i);
  }
});

test('source analysis is deterministic, redacted, immutable and snapshot drift fails',()=>{
  const before={...sources};
  const original=run(sources);
  assert.deepEqual(run(sources),original);
  assert.deepEqual(sources,before);
  assert.doesNotMatch(JSON.stringify(original),/017[0-9]{8}|password_hash|SENSITIVE_PERSON/);
  assert.equal(assertM00LiteralRpcSessionSnapshot(original,structuredClone(original)),true);
  const altered=structuredClone(original);altered.counts.tokenFirstCallsites--;
  assert.throws(()=>assertM00LiteralRpcSessionSnapshot(original,altered),/drift/i);
});

test('untrusted source SHA and incorrect lexical snapshot fail closed',()=>{
  assert.throws(()=>auditM00LiteralRpcSession({
    sources,sourceCommit:'bad',lexicalSnapshot
  }),/invalid|source|SHA/i);
  const forged=structuredClone(lexicalSnapshot);
  forged.counts.literalCallsites--;
  assert.throws(()=>auditM00LiteralRpcSession({
    sources,sourceCommit,lexicalSnapshot:forged
  }),/drift|snapshot/i);
});

test('CLI --check validates frozen M00 literal session contract; unknown modes fail',()=>{
  const file=root+'scripts/audit-m00-literal-rpc-session.mjs';
  const good=spawnSync(process.execPath,[file,'--check'],{cwd:root,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/literal RPC session.*verified/i);
  const bad=spawnSync(process.execPath,[file,'--enable-rpc'],{cwd:root,encoding:'utf8'});
  assert.notEqual(bad.status,0);
});
