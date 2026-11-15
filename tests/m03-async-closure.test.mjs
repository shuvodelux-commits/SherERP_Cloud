import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildM03AsyncClosure,assertM03AsyncClosureSnapshot} from '../scripts/audit-m03-async-closure.mjs';

const pin='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const fixture=()=>({
  'Database.gs': `function getAllRows_(group) { return []; }
function appendRow_(group, row) { return row; }`,
  'Sales.gs': `function leaf() { return getAllRows_('SALES'); }
function middle() { return leaf(); }
function entry() { return middle(); }
function writeLeaf() { return appendRow_('SALES', {}); }
function mixed() { writeLeaf(); return entry(); }
function loopA() { return loopB(); }
function loopB() { loopA(); return leaf(); }
function unused() {
  // appendRow_('SALES', {});
  const text = "getAllRows_('SALES')";
  return text;
}`
});
const scan=(sources=fixture())=>buildM03AsyncClosure({sources,sourceCommit:pin});
const fn=(report,name)=>report.affected.find(f=>f.name===name);

test('traces shortest named read caller chain from an upstream operation to legacy sheet primitive',()=>{
  const a=scan();
  assert.equal(a.formatVersion,1);
  assert.equal(a.sourceCommit,pin);
  assert.equal(a.counts.totalFunctions,10);
  assert.equal(a.counts.directReadFunctions,1);
  assert.deepEqual(fn(a,'leaf').directReads,['getAllRows_']);
  assert.deepEqual(fn(a,'leaf').readPath,['leaf','getAllRows_']);
  assert.deepEqual(fn(a,'middle').readPath,['middle','leaf','getAllRows_']);
  assert.deepEqual(fn(a,'entry').readPath,['entry','middle','leaf','getAllRows_']);
  assert.deepEqual(fn(a,'mixed').readPath,['mixed','entry','middle','leaf','getAllRows_']);
  assert.equal(fn(a,'entry').file,'Sales.gs');
});

test('tracks direct writes and mixed read/write callers without inventing a transaction boundary',()=>{
  const a=scan();
  assert.deepEqual(fn(a,'writeLeaf').writePath,['writeLeaf','appendRow_']);
  assert.deepEqual(fn(a,'mixed').writePath,['mixed','writeLeaf','appendRow_']);
  assert.equal(fn(a,'mixed').readPath.length,5);
  assert.deepEqual(fn(a,'mixed').directReads,[]);
  assert.deepEqual(fn(a,'mixed').directWrites,[]);
  assert.match(a.limitations,/not.*async|not.*proof/i);
});

test('handles cycles and does not invent dependencies from comments and string literals',()=>{
  const a=scan();
  assert.deepEqual(fn(a,'loopA').readPath,['loopA','loopB','leaf','getAllRows_']);
  assert.deepEqual(fn(a,'loopB').readPath,['loopB','leaf','getAllRows_']);
  assert.equal(fn(a,'unused'),undefined);
  assert.equal(fn(a,'getAllRows_'),undefined);
  assert.equal(fn(a,'appendRow_'),undefined);
  assert.equal(a.counts.impactedFunctions,7);
});

test('selects deterministic shorter path over lexical order and ignores dead nested identifiers',()=>{
  const sources=fixture();
  sources['Sales.gs']+=`
function short() { return getAllRows_('STOCK_LOTS'); }
function choose() { middle(); return short(); }
function commentOnly() { /* middle() */ return "short()"; }`;
  const a=scan(sources);
  assert.deepEqual(fn(a,'choose').readPath,['choose','short','getAllRows_']);
  assert.equal(fn(a,'commentOnly'),undefined);
  assert.deepEqual(a,scan(sources));
});

test('fails closed on duplicate top-level function names; valid unlinked functions remain excluded',()=>{
  const duplicate=fixture();
  duplicate['Other.gs']='function middle() { return 0; }';
  assert.throws(()=>scan(duplicate),/duplicate.*middle/i);
  const noSource=fixture();
  noSource['Other.gs']='function isolated() { doSomethingExternal(); }';
  assert.equal(fn(scan(noSource),'isolated'),undefined);
});

test('rejects drifted snapshot, invalid source SHA, or missing pinned input',()=>{
  const a=scan();
  assert.doesNotThrow(()=>assertM03AsyncClosureSnapshot(a,structuredClone(a)));
  const changed=fixture();
  changed['Sales.gs']=changed['Sales.gs'].replace('return middle();','return getAllRows_(\'SALES\');');
  assert.throws(()=>assertM03AsyncClosureSnapshot(scan(changed),a),/drift/i);
  assert.throws(()=>buildM03AsyncClosure({sources:fixture(),sourceCommit:'bad'}),/source|commit/i);
  assert.throws(()=>buildM03AsyncClosure({sources:{},sourceCommit:pin}),/source|file|empty/i);
});

test('CLI --check accepts frozen snapshot but rejects unsupported flags',()=>{
  const cli=fileURLToPath(new URL('../scripts/audit-m03-async-closure.mjs',import.meta.url));
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const pass=spawnSync(process.execPath,[cli,'--check'],{cwd,encoding:'utf8'});
  assert.equal(pass.status,0,pass.stderr);
  assert.match(pass.stdout,/M03 async caller closure verified/i);
  const fail=spawnSync(process.execPath,[cli,'--surprise'],{cwd,encoding:'utf8'});
  assert.equal(fail.status,1);
});

test('parses all frozen GAS modules including regex literals without executing scripts',()=>{
  const sourcePath=fileURLToPath(new URL('../legacy/source/',import.meta.url));
  const files=readdirSync(sourcePath).filter(x=>x.endsWith('.gs'));
  const sources=Object.fromEntries(files.map(name=>[
    name,readFileSync(fileURLToPath(new URL('../legacy/source/'+name,import.meta.url)),'utf8')
  ]));
  const report=scan(sources);
  assert.equal(report.sourceFiles,47);
  assert.equal(report.counts.totalFunctions,614);
  assert.equal(report.counts.impactedFunctions,394);
  assert.deepEqual(fn(report,'getDashboardStats').readPath,
    ['getDashboardStats','activeRows_','getAllRows_']);
  assert.deepEqual(fn(report,'generateId_').readPath,['generateId_','getSheet_']);
});
