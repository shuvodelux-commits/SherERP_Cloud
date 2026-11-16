import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {buildM03RpcReadiness} from '../scripts/audit-m03-rpc-readiness.mjs';
import worker from '../src/index.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const REGISTRY=Object.freeze(Object.create(null));
const fakeClosure={
  sourceCommit:PIN,
  sourceFiles:47,
  counts:{impactedFunctions:1},
  affected:[{name:'login',file:'Auth.gs',readPath:['login','getAllRows_'],writePath:[]}]
};

test('records literal browser RPC names and isolates dynamic call sites without calling them',()=>{
  const report=buildM03RpcReadiness({
    sourceCommit:PIN,closure:fakeClosure,registry:REGISTRY,
    htmlFiles:{
      'javascript.html':"function serverCall(fnName,...args) {}\nserverCall('login','01700000000','pw');\nserverCall(fnName);",
      'products.html':'serverCall("getProductsBootstrap",token);\nserverCall("getProductsBootstrap",token);'
    }
  });
  assert.equal(report.sourceCommit,PIN);
  assert.deepEqual(report.summary,{
    htmlFiles:2,literalMethods:2,literalCallSites:3,dynamicCallSites:1,
    asyncImpactedFunctions:1,publicHandlers:0
  });
  assert.deepEqual(report.methods,[
    {name:'getProductsBootstrap',htmlFiles:['products.html'],literalCallSites:2,
     asyncSourceImpact:false,publicState:'blocked'},
    {name:'login',htmlFiles:['javascript.html'],literalCallSites:1,
     asyncSourceImpact:true,publicState:'blocked'}
  ]);
  assert.deepEqual(report.dynamicSites,[{file:'javascript.html',line:3}]);
  assert.match(report.limitations,/lexical|not proof|not verified/i);
});

test('rejects source-pin drift, broken async closure, and unreviewed public registry entries',()=>{
  const args={
    sourceCommit:PIN,closure:fakeClosure,registry:REGISTRY,
    htmlFiles:{'products.html':"serverCall('getProductsBootstrap',token);"}
  };
  assert.throws(()=>buildM03RpcReadiness({...args,sourceCommit:'f'.repeat(40)}),/source|pin|commit/i);
  assert.throws(()=>buildM03RpcReadiness({...args,closure:{
    ...fakeClosure,counts:{impactedFunctions:2}
  }}),/closure|count|function/i);
  assert.throws(()=>buildM03RpcReadiness({...args,registry:{
    getProductsBootstrap:()=>({success:true,data:{}})
  }}),/public|review|handler|allowlist/i);
  assert.throws(()=>buildM03RpcReadiness({...args,htmlFiles:{}}),/HTML|source|empty/i);
});

test('frozen 37-file browser audit reports blocked RPC and 394 source async impacts only',async()=>{
  const root=new URL('../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
  const closure=JSON.parse(await readFile(new URL('docs/baseline/m03-async-caller-closure.json',root),'utf8'));
  const htmlNames=(await readdir(new URL('legacy/source/',root))).filter(x=>x.endsWith('.html')).sort();
  const htmlFiles=Object.fromEntries(await Promise.all(htmlNames.map(async file=>
    [file,await readFile(new URL('legacy/source/'+file,root),'utf8')]
  )));
  const {rpcRegistry}=await import('../src/rpc/registry.js');
  const report=buildM03RpcReadiness({
    sourceCommit:manifest.source.commit,closure,registry:rpcRegistry,htmlFiles
  });
  assert.equal(manifest.source.commit,PIN);
  assert.equal(report.summary.htmlFiles,37);
  assert.equal(report.summary.asyncImpactedFunctions,394);
  assert.equal(report.summary.publicHandlers,0);
  for(const name of ['getAppShellData','login','logout','getProductsBootstrap']){
    assert(report.methods.some(x=>x.name===name),name);
  }
  assert(report.methods.every(x=>x.publicState==='blocked'));
  assert(report.summary.literalMethods>10);
  assert(report.summary.dynamicCallSites>=1,'unresolved dynamic RPC call sites must be recorded');
});

test('CLI frozen audit runs without D1 or network and fails closed on unknown mode',()=>{
  const command=process.execPath;
  const args=['scripts/audit-m03-rpc-readiness.mjs'];
  const root=new URL('../',import.meta.url);
  const ok=spawnSync(command,[...args,'--check'],{cwd:new URL(root),encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
  assert.match(ok.stdout,/blocked|not activated/i);
  const bad=spawnSync(command,[...args,'--enable-public'],{cwd:new URL(root),encoding:'utf8'});
  assert.notEqual(bad.status,0);
});

test('production Worker still blocks source business RPC even if an environment has a D1-like binding',async()=>{
  let touched=false;
  const env={DB:{prepare(){touched=true;throw new Error('must not touch D1');}}};
  for(const fnName of ['getProductsBootstrap','addProductCategory','getAppShellData']){
    const response=await worker.fetch(new Request('https://shererp.example/api/rpc',{
      method:'POST',headers:{'Origin':'https://shererp.example','Content-Type':'application/json'},
      body:JSON.stringify({fnName,args:['untrusted']})
    }),env);
    assert.equal(response.status,501,fnName);
    assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  }
  assert.equal(touched,false,'public requests must not bypass the empty registry into D1');
});
