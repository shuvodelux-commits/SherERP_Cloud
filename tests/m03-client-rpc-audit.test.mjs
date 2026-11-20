import test from 'node:test';
import assert from 'node:assert/strict';
import {auditInlineRpcCallsites} from '../scripts/audit-m03-client-rpc.mjs';

const closure={
  sourceCommit:'29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2',
  affected:[
    {name:'createPurchase',file:'Purchase.gs',
      readPath:['createPurchase','getAllRows_'],
      writePath:['createPurchase','appendRow_']},
    {name:'getPosBootstrap',file:'Sales.gs',
      readPath:['getPosBootstrap','getAllRows_'],writePath:[]}
  ]
};

test('maps literal client RPCs to pinned source async read and write paths',()=>{
  const result=auditInlineRpcCallsites({
    htmlFiles:{
      'purchase.html':"<script>\nfunction create(){ return serverCall('createPurchase', {token:'private'}); }\nserverCall(\"getPosBootstrap\");\nserverCall(dynamicMethod, 1);\n</script>"
    },
    closure
  });
  assert.equal(result.scanKind,'html-inline-script-static-rpc');
  assert.deepEqual(result.counts,{
    htmlFiles:1,scriptBlocks:1,staticSites:2,dynamicSites:1,
    parseFailures:0,affectedSites:2,notInAffectedClosure:0
  });
  assert.deepEqual(result.staticCalls.map(item=>item.method),
    ['createPurchase','getPosBootstrap']);
  assert.deepEqual(result.staticCalls[0].readPath,
    ['createPurchase','getAllRows_']);
  assert.deepEqual(result.staticCalls[0].writePath,
    ['createPurchase','appendRow_']);
  assert.equal(result.staticCalls[0].gasFile,'Purchase.gs');
  assert.equal(result.staticCalls[0].classification,'source-async-impacted');
  assert.deepEqual(result.dynamicCalls,[{file:'purchase.html',scriptIndex:1}]);
  assert.match(result.limitations,/not.*runtime|not.*complete/i);
  assert.equal(JSON.stringify(result).includes('private'),false);
});

test('never classifies absent affected names as safe, already ported or authorized',()=>{
  const result=auditInlineRpcCallsites({
    htmlFiles:{'a.html':'<script>serverCall("getNonSheetPureFunction");</script>'},
    closure
  });
  assert.equal(result.counts.notInAffectedClosure,1);
  assert.equal(result.staticCalls[0].classification,'not-in-affected-closure');
  assert.equal(result.staticCalls[0].gasFile,null);
  assert.deepEqual(result.staticCalls[0].readPath,[]);
  assert.deepEqual(result.staticCalls[0].writePath,[]);
});

test('ignores strings, JS comments, HTML comments and non-JS script tags',()=>{
  const result=auditInlineRpcCallsites({
    htmlFiles:{'safe.html':"<!-- <script>serverCall('inHtmlComment')</script> -->\n<script type=\"application/json\">{\"fake\":\"serverCall('jsonText')\"}</script>\n<script>\n// serverCall('lineComment')\n/* serverCall('blockComment') */\nconst text=\"serverCall('insideString')\";\nserverCall('getPosBootstrap');\n</script>"},
    closure
  });
  assert.equal(result.counts.staticSites,1);
  assert.equal(result.counts.parseFailures,0);
  assert.equal(result.counts.scriptBlocks,1);
  assert.equal(result.staticCalls[0].method,'getPosBootstrap');
});

test('reports invalid inline JS as an unresolved review item, never a safe pass',()=>{
  const result=auditInlineRpcCallsites({
    htmlFiles:{'broken.html':'<script>const x = ; serverCall("createPurchase")</script>'},
    closure
  });
  assert.equal(result.counts.parseFailures,1);
  assert.equal(result.counts.staticSites,0);
  assert.deepEqual(result.parseFailures,[{file:'broken.html',scriptIndex:1}]);
});

test('sorts filenames before reporting sites; repeated calls remain separate sites',()=>{
  const htmlFiles={
    'z.html':'<script>serverCall("getPosBootstrap");</script>',
    'a.html':'<script>serverCall("createPurchase");serverCall("createPurchase");</script>'
  };
  const a=auditInlineRpcCallsites({htmlFiles,closure});
  const b=auditInlineRpcCallsites({
    htmlFiles:Object.fromEntries(Object.entries(htmlFiles).reverse()),
    closure
  });
  assert.deepEqual(a,b);
  assert.deepEqual(a.staticCalls.map(item=>item.file),
    ['a.html','a.html','z.html']);
});

test('rejects invalid filenames, content, and untrusted closure shapes',()=>{
  assert.throws(()=>auditInlineRpcCallsites({htmlFiles:[],closure}));
  assert.throws(()=>auditInlineRpcCallsites({
    htmlFiles:{'../../outside.html':'<script />'},closure
  }));
  assert.throws(()=>auditInlineRpcCallsites({
    htmlFiles:{'index.html':12},closure
  }));
  assert.throws(()=>auditInlineRpcCallsites({
    htmlFiles:{'index.html':'<script></script>'},closure:{affected:[]}
  }));
});
