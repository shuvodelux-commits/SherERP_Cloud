import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {buildM03RpcReadiness} from '../scripts/audit-m03-rpc-readiness.mjs';
import {rpcRegistry} from '../src/rpc/registry.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const closure={
  sourceCommit:PIN,sourceFiles:47,counts:{impactedFunctions:2},
  affected:[
    {name:'login',file:'Auth.gs',readPath:['login','getAllRows_'],writePath:[]},
    {name:'logout',file:'Auth.gs',readPath:['logout','getAllRows_'],writePath:[]}
  ]
};
const create=(htmlFiles)=>buildM03RpcReadiness({
  sourceCommit:PIN,htmlFiles,closure,registry:Object.freeze(Object.create(null))
});

test('counts executable global RPC only, excluding HTML, comments, strings, regex, declaration and member calls',()=>{
  const page=[
    '<div onclick="serverCall(\'attributeOnly\')"></div>',
    '<script>',
    "  // serverCall('commentOnly')",
    "  /* serverCall('blockOnly') */",
    '  const sample = "serverCall(\'stringOnly\')";',
    "  const re = /serverCall\\('regexOnly'\\)/;",
    "  const template = `serverCall('templateOnly')`;",
    '  function serverCall(fnName) { return fnName; }',
    "  serverCall('login');",
    '  serverCall(fnName);',
    "  window.serverCall('memberOnly');",
    "  function dispatch() { return serverCall('getAppShellData'); }",
    '</script>'
  ].join('\n');
  const report=create({'page.html':page});
  assert.deepEqual(report.methods,[
    {name:'getAppShellData',htmlFiles:['page.html'],literalCallSites:1,
     asyncSourceImpact:false,publicState:'blocked'},
    {name:'login',htmlFiles:['page.html'],literalCallSites:1,
     asyncSourceImpact:true,publicState:'blocked'}
  ]);
  assert.deepEqual(report.dynamicSites,[{file:'page.html',line:10}]);
  assert.deepEqual(report.summary,{
    htmlFiles:1,literalMethods:2,literalCallSites:2,dynamicCallSites:1,
    asyncImpactedFunctions:2,publicHandlers:0
  });
});

test('keeps calls inside template interpolation, but not inert template text or template method names',()=>{
  const page=[
    '<script>',
    "const selected = `selected ${serverCall('logout')}`;",
    "const example = `serverCall('notExecutable')`;",
    'serverCall(`selectedMethod`);',
    '</script>'
  ].join('\n');
  const result=create({'page.html':page});
  assert.deepEqual(result.methods,[{
    name:'logout',htmlFiles:['page.html'],literalCallSites:1,
    asyncSourceImpact:true,publicState:'blocked'
  }]);
  assert.deepEqual(result.dynamicSites,[{file:'page.html',line:4}]);
});

test('preserves physical HTML line offsets and duplicate actual calls across script files',()=>{
  const report=create({
    'b.html':"<div></div>\n<script>\nserverCall('login');\n</script>",
    'a.html':"serverCall('login');\nserverCall(variable);"
  });
  assert.equal(report.summary.literalCallSites,2);
  assert.equal(report.summary.dynamicCallSites,1);
  assert.deepEqual(report.methods,[{
    name:'login',htmlFiles:['a.html','b.html'],literalCallSites:2,
    asyncSourceImpact:true,publicState:'blocked'
  }]);
  assert.deepEqual(report.dynamicSites,[{file:'a.html',line:2}]);
});

test('fails closed on an unclosed script block or invalid JavaScript token stream',()=>{
  assert.throws(()=>create({'broken.html':"<script>\nserverCall('login');"}),/script|block|markup|HTML/i);
  assert.throws(()=>create({'broken.html':"<script>\nserverCall('login);\n</script>"}),/script|parse|token|syntax|unterminated/i);
});

test('original 37-file source excludes comment-only someFunction while preserving real auth and product calls',async()=>{
  const root=new URL('../',import.meta.url);
  const names=(await readdir(new URL('legacy/source/',root))).filter(x=>x.endsWith('.html')).sort();
  const htmlFiles=Object.fromEntries(await Promise.all(names.map(async name=>[
    name,await readFile(new URL('legacy/source/'+name,root),'utf8')
  ])));
  const frozen=JSON.parse(await readFile(new URL('docs/baseline/m03-async-caller-closure.json',root),'utf8'));
  const report=buildM03RpcReadiness({
    sourceCommit:PIN,htmlFiles,closure:frozen,registry:rpcRegistry
  });
  assert.equal(report.summary.htmlFiles,37);
  assert.equal(report.summary.asyncImpactedFunctions,394);
  assert.equal(report.methods.some(x=>x.name==='someFunction'),false,
    'documented example in javascript.html is not an executable RPC');
  for(const name of ['login','logout','getAppShellData','getProductsBootstrap']){
    assert.equal(report.methods.some(x=>x.name===name),true,name);
  }
  assert(report.methods.every(x=>x.publicState==='blocked'));
});
