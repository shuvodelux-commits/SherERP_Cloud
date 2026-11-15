import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditM00DynamicRpc,assertM00DynamicRpcSnapshot} from '../scripts/audit-m00-dynamic-rpc.mjs';

const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const productMethods=['addProductCategory','addProductUnit','setProductCategoryStatus','setProductUnitStatus'];
const vendorGet=['getVendorPaymentForEdit','getVendorReturnForEdit','getVendorSourcingForEdit',
  'getVendorIssueForEdit','getVendorReceiptForEdit','getVendorReturnReceivedForEdit'];
const vendorUpdate=['updateVendorPayment','updateVendorReturn','updateVendorSourcing',
  'updateVendorIssue','updateVendorReceipt','updateVendorReturnReceived'];
const vendorMap=()=>[
  ['Payment','getVendorPaymentForEdit','updateVendorPayment','deleteVendorPayment'],
  ['Return','getVendorReturnForEdit','updateVendorReturn','deleteVendorReturn'],
  ['Sourcing','getVendorSourcingForEdit','updateVendorSourcing','deleteVendorSourcing'],
  ['Issue','getVendorIssueForEdit','updateVendorIssue','deleteVendorIssue'],
  ['Receipt','getVendorReceiptForEdit','updateVendorReceipt','deleteVendorReceipt'],
  ['Return Received','getVendorReturnReceivedForEdit','updateVendorReturnReceived','deleteVendorReturnReceived']
].map(([key,get,update,del])=>`'${key}': {get:'${get}',update:'${update}',del:'${del}'}`).join(',\n');
const sample=()=>({
  'products.html':`<div>Example</div><script>
  function p(){
    var fn = mode === 'category' ? 'addProductCategory' : 'addProductUnit';
    serverCall(fn, token);
    var fn2 = 'literal';
    var mode = 'category';
    var fn = mode === 'category' ? 'setProductCategoryStatus' : 'setProductUnitStatus';
    runConfirmedAction({}, function(){ return serverCall(fn, token); });
  }
  </script>`,
  'vendors.html':`<script>
  function vendorNativeTxnHandlers_(type) {
    var map = {${vendorMap()}};
    return map[type] || null;
  }
  function edit(type){
    var handlers = vendorNativeTxnHandlers_(type);
    if(!handlers)return;
    serverCall(handlers.get, token);
  }
  function save(type){
    var handlers = vendorNativeTxnHandlers_(type);
    if(!handlers)return;
    runConfirmedAction({}, function(){ return serverCall(handlers.update, token); });
  }
  </script>`,
  'backend.gs': [...productMethods,...vendorGet,...vendorUpdate]
    .map(name=>`function ${name}(token){return null;}`).join('\n')
});
const audit=(sources=sample(),lexicalSnapshot)=>auditM00DynamicRpc({sources,sourceCommit,lexicalSnapshot});
const site=(out,file,argumentSyntax)=>out.callsites.find(x=>x.frontendFile===file&&x.argumentSyntax===argumentSyntax);

test('resolves four original source-shaped sites with exactly 2/2/6/6 possible method targets',()=>{
  const out=audit();
  assert.equal(out.sourceCommit,sourceCommit);
  assert.deepEqual(out.counts,{dynamicCallsites:4,resolvedCallsites:4,totalTargetAppearances:16,distinctTargets:16});
  assert.deepEqual(out.callsites.map(x=>x.frontendFile),['products.html','products.html','vendors.html','vendors.html']);
  assert.deepEqual(out.callsites.map(x=>x.argumentSyntax),['fn','fn','handlers.get','handlers.update']);
  assert.deepEqual(out.callsites.map(x=>x.targets.length),[2,2,6,6]);
  assert.deepEqual(out.callsites[0].targets.map(x=>x.name),['addProductCategory','addProductUnit']);
  assert.deepEqual(out.callsites[1].targets.map(x=>x.name),['setProductCategoryStatus','setProductUnitStatus']);
  assert.deepEqual(site(out,'vendors.html','handlers.get').targets.map(x=>x.name),[...vendorGet].sort());
  assert.deepEqual(site(out,'vendors.html','handlers.update').targets.map(x=>x.name),[...vendorUpdate].sort());
  assert.ok(out.callsites.every(c=>c.targets.every(t=>t.backendFile==='backend.gs')));
  assert.match(out.methodology,/not an authorization|not authorization/i);
});

test('never mistakes commented/string literal serverCall for callable site',()=>{
  const s=sample();
  s['products.html']=s['products.html'].replace('<script>','<script>\n// serverCall(fake, token);\nconst text="serverCall(fake, token)";\n');
  assert.equal(audit(s).counts.dynamicCallsites,4);
});

test('missing or duplicate backend target definition fails closed',()=>{
  const missing=sample();
  missing['backend.gs']=missing['backend.gs'].replace('function updateVendorIssue(','function updateVendorIssueMissing(');
  assert.throws(()=>audit(missing),/undefined|missing.*updateVendorIssue/i);
  const dupe=sample();
  dupe['duplicate.gs']='function addProductCategory(){}';
  assert.throws(()=>audit(dupe),/duplicate.*addProductCategory/i);
});

test('rejects any variable mutation or unconstrained fn initializer',()=>{
  const mutation=sample();
  mutation['products.html']=mutation['products.html'].replace('serverCall(fn, token);','fn = arbitraryInput; serverCall(fn, token);');
  assert.throws(()=>audit(mutation),/reassign|mutat|unsafe/i);
  const input=sample();
  input['products.html']=input['products.html'].replace("'addProductUnit'","window.userInput");
  assert.throws(()=>audit(input),/literal|unsafe|unresolved/i);
});

test('rejects altered or nonliteral vendor method mapping and unsafe helper return',()=>{
  const dynamic=sample();
  dynamic['vendors.html']=dynamic['vendors.html'].replace("get:'getVendorPaymentForEdit'","get:window.handler");
  assert.throws(()=>audit(dynamic),/literal|unsafe|mapping/i);
  const spread=sample();
  spread['vendors.html']=spread['vendors.html'].replace("var map = {","var map = {...window.injected,");
  assert.throws(()=>audit(spread),/unsafe|mapping|spread/i);
  const altered=sample();
  altered['vendors.html']=altered['vendors.html'].replace('return map[type] || null','return map[window.location.hash] || null');
  assert.throws(()=>audit(altered),/unsafe|return|mapping/i);
});

test('new browser dynamic callsite or changed first-argument target requires snapshot review',()=>{
  const good=audit();
  assert.equal(assertM00DynamicRpcSnapshot(good,structuredClone(good)),true);
  const extra=sample();
  extra['products.html']=extra['products.html'].replace('  </script>',"  serverCall(window.anyMethod, token);\n  </script>");
  assert.throws(()=>audit(extra),/unsafe|unresolved/i);
  const altered=sample();
  altered['products.html']=altered['products.html'].replace("'addProductCategory'","'addProductCategoryRenamed'");
  altered['backend.gs']+='\nfunction addProductCategoryRenamed(){}';
  assert.throws(()=>assertM00DynamicRpcSnapshot(audit(altered),good),/drift/i);
});

test('lexical dynamic site inventory must match exactly and cannot silently reduce coverage',()=>{
  const result=audit();
  const lexical={sourceCommit,dynamicCallsites:result.callsites.map(x=>({frontendFile:x.frontendFile,line:x.line}))};
  assert.equal(audit(sample(),lexical).counts.dynamicCallsites,4);
  const drift={...lexical,dynamicCallsites:lexical.dynamicCallsites.slice(1)};
  assert.throws(()=>audit(sample(),drift),/lexical.*drift/i);
});

test('CLI --check confirms source-pinned four-site snapshot; unknown mode rejected',()=>{
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  const script=fileURLToPath(new URL('../scripts/audit-m00-dynamic-rpc.mjs',import.meta.url));
  const good=spawnSync(process.execPath,[script,'--check'],{cwd,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/dynamic.*verified/i);
  const bad=spawnSync(process.execPath,[script,'--untrusted'],{cwd,encoding:'utf8'});
  assert.equal(bad.status,1);
});

test('vendor handler map cannot be reassigned through nested properties or Object.assign',()=>{
  const nested=sample();
  nested['vendors.html']=nested['vendors.html'].replace('return map[type] || null;',
    "map.Payment.get = window.dynamicName; return map[type] || null;");
  assert.throws(()=>audit(nested),/mutat|unsafe|reassign/i);
  const assign=sample();
  assign['vendors.html']=assign['vendors.html'].replace('return map[type] || null;',
    "Object.assign(map, window.dynamicMethods); return map[type] || null;");
  assert.throws(()=>audit(assign),/mutat|unsafe|reassign/i);
});
