import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {buildLegacyAsyncCallGraph} from '../scripts/audit-m03-async-graph.mjs';

const find=(graph,file,name)=>{
  const row=graph.functions.find(f=>f.id===file+':'+name);
  assert.ok(row,'Missing '+file+':'+name);
  return row;
};
const dependencies=files=>buildLegacyAsyncCallGraph(files);

test('AST tracks cross-file synchronous Sheet dependency through transitive helper calls',()=>{
  const g=dependencies({
    'A.gs':"function sale(){ return read(); }",
    'B.gs':"function read(){ return lookup(); }",
    'C.gs':"function lookup(){ return getAllRows_('PRODUCTS'); }"
  });
  assert.deepEqual(find(g,'A.gs','sale').pathToBoundary,
    ['A.gs:sale','B.gs:read','C.gs:lookup']);
  assert.deepEqual(find(g,'B.gs','read').pathToBoundary,
    ['B.gs:read','C.gs:lookup']);
  assert.deepEqual(find(g,'C.gs','lookup').directBoundaries,['getAllRows_']);
  assert.deepEqual(find(g,'A.gs','sale').calls,['B.gs:read']);
  assert.equal(g.summary.functions,3);
  assert.equal(g.summary.direct,1);
  assert.equal(g.summary.indirect,2);
});

test('member methods and inert text are never global call edges; direct range method is marked',()=>{
  const g=dependencies({
    'A.gs':[
      "function parse(){ const str='getAllRows_()'; /* appendRow_(); */",
      " const x={read(){return 4;}}; return x.read(); }",
      "function read(){ return 42; }",
      "function format(){ return data.getValues(); }",
      "function safe(){ const text='LockService';return text; }"
    ].join('\n')
  });
  assert.deepEqual(find(g,'A.gs','parse').calls,[]);
  assert.equal(find(g,'A.gs','parse').pathToBoundary,null);
  assert.equal(find(g,'A.gs','safe').pathToBoundary,null);
  assert.deepEqual(find(g,'A.gs','format').directBoundaries,['getValues']);
  assert.equal(find(g,'A.gs','format').pathToBoundary?.length,1);
  assert.equal(find(g,'A.gs','read').pathToBoundary,null);
});

test('GAS service member roots and ID issuing are recorded as awaited migration boundaries',()=>{
  const g=dependencies({
    'Core.gs':[
      "function make(){return generateId_('SALES');}",
      "function record(){const lock=LockService.getScriptLock();return make();}",
      "function view(){return Session.getScriptTimeZone();}",
      "function update(){return sheet.getRange(2,1).setValue(123);}"
    ].join('\n')
  });
  assert.deepEqual(find(g,'Core.gs','make').directBoundaries,['generateId_']);
  assert(find(g,'Core.gs','record').directBoundaries.includes('LockService'));
  assert.deepEqual(find(g,'Core.gs','view').directBoundaries,['Session']);
  assert(find(g,'Core.gs','update').directBoundaries.includes('getRange'));
  assert(find(g,'Core.gs','update').directBoundaries.includes('setValue'));
});

test('top-level const arrow functions and nested callback dependencies are conservatively included',()=>{
  const g=dependencies({'M.gs':[
    "const show=()=>helper();",
    "const helper=function(){return [1,2].map(x=>getAllRows_('ITEMS').length);};",
    "function pure(){return 7;}"
  ].join('\n')});
  assert.deepEqual(find(g,'M.gs','show').pathToBoundary,['M.gs:show','M.gs:helper']);
  assert(find(g,'M.gs','helper').directBoundaries.includes('getAllRows_'));
  assert.equal(find(g,'M.gs','pure').pathToBoundary,null);
});

test('cyclic helper calls terminate, preserving shortest route to first DB boundary',()=>{
  const g=dependencies({'Loops.gs':[
    "function one(){return two();}",
    "function two(){one();return db();}",
    "function db(){return getSheet_('SALES');}"
  ].join('\n')});
  assert.deepEqual(find(g,'Loops.gs','one').pathToBoundary,
    ['Loops.gs:one','Loops.gs:two','Loops.gs:db']);
  assert.deepEqual(find(g,'Loops.gs','two').pathToBoundary,
    ['Loops.gs:two','Loops.gs:db']);
  assert.equal(g.summary.indirect,2);
});

test('duplicate global definitions are disclosed, and all candidates are traversed',()=>{
  const g=dependencies({
    'A.gs':"function same(){return getAllRows_('SALES');}",
    'B.gs':"function same(){return 8;}",
    'C.gs':"function pos(){return same();}"
  });
  assert.deepEqual(g.ambiguousNames,[{name:'same',definitions:['A.gs:same','B.gs:same']}]);
  assert.deepEqual(find(g,'C.gs','pos').calls,['A.gs:same','B.gs:same']);
  assert.deepEqual(find(g,'C.gs','pos').pathToBoundary,['C.gs:pos','A.gs:same']);
});

test('file insertion order does not affect digest, edges, cycle result or summary',()=>{
  const a=dependencies({'B.gs':"function b(){return a();}",'A.gs':"function a(){return getAllRows_('X');}"});
  const b=dependencies({'A.gs':"function a(){return getAllRows_('X');}",'B.gs':"function b(){return a();}"});
  assert.deepEqual(a,b);
  assert.match(a.sourceDigestSha256,/^[a-f0-9]{64}$/);
});

test('unparseable sources, unknown filenames, malformed records and collisions fail loudly',()=>{
  for(const source of [42,null,{},[]]){
    assert.throws(()=>dependencies({'A.gs':source}),/source|text|invalid/i);
  }
  assert.throws(()=>dependencies({'../A.gs':"function x(){}"}),/filename|invalid/i);
  assert.throws(()=>dependencies({'A.gs':"function cannot( {"}),/parse|syntax|unexpected|A\.gs/i);
  assert.throws(()=>dependencies({'A.gs':"function x(){};function x(){}"}),/duplicate|ambiguous|function/i);
  assert.throws(()=>dependencies(null),/files/i);
});

test('full frozen 47-file source parses, matches original SHA and exposes completeSale async path',()=>{
  const sourceDir=new URL('../legacy/source/',import.meta.url);
  const names=readdirSync(sourceDir).filter(n=>n.endsWith('.gs')).sort();
  const sources=Object.fromEntries(names.map(name=>[
    name,readFileSync(new URL('../legacy/source/'+name,import.meta.url),'utf8')
  ]));
  const g=dependencies(sources);
  const pinned=JSON.parse(readFileSync(
    new URL('../docs/baseline/m03-direct-call-inventory.json',import.meta.url),'utf8'));
  assert.equal(g.sourceFiles,47);
  assert.equal(g.sourceDigestSha256,pinned.sourceDigestSha256);
  assert(g.summary.functions>200);
  assert(g.summary.direct>25);
  assert(g.summary.indirect>25);
  const complete=g.functions.filter(f=>f.name==='completeSale');
  assert(complete.length>=1,'Frozen Sales.gs completeSale required');
  assert(complete.some(row=>Array.isArray(row.pathToBoundary) && row.pathToBoundary.length>=1),
    'completeSale must have a resolvable migration-boundary path');
});
