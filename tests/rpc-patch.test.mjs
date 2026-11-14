import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {patchServerCall} from '../scripts/patch-rpc.mjs';

const legacy = `BEFORE\n  function serverCall(fnName) {\n    var args=[];\n    var runner=google.script.run;\n    runner[fnName].apply(runner,args);\n  }\n\n  // ---------------- 6. Shared across every page ----------------\nAFTER`;

test('replaces only the legacy wrapper while preserving surrounding HTML and order',()=>{
  const patched=patchServerCall(legacy);
  assert.ok(patched.startsWith('BEFORE\n'));
  assert.ok(patched.endsWith('\nAFTER'));
  assert.ok(patched.includes("fetch('/api/rpc'"));
  assert.ok(!patched.includes('runner[fnName].apply'));
});

test('browser RPC fetch transport preserves legacy data unwrapping and argument order',async()=>{
  const source=patchServerCall(legacy);
  const fn=source.slice(source.indexOf('  function serverCall'), source.indexOf('  // ---------------- 6.'));
  let sent;
  const ctx={fetch:async(path,options)=>{
    sent={path,options};return {ok:true,json:async()=>({success:true,data:{invoice:'S-001'}})};
  }};
  const call=runInNewContext(fn+';serverCall',ctx);
  assert.deepEqual(await call('completeSale','token',{total:150}),{invoice:'S-001'});
  assert.equal(sent.path,'/api/rpc');
  assert.equal(sent.options.credentials,'same-origin');
  assert.deepEqual(JSON.parse(sent.options.body),{fnName:'completeSale',args:['token',{total:150}]});
});

test('RPC rejection uses server message on 501 or success=false, no false success',async()=>{
  const source=patchServerCall(legacy);
  const fn=source.slice(source.indexOf('  function serverCall'),source.indexOf('  // ---------------- 6.'));
  const call=runInNewContext(fn+';serverCall', {fetch:async()=>({ok:false,status:501,json:async()=>({success:false,message:'RPC method not migrated'})})});
  await assert.rejects(call('completeSale'),/RPC method not migrated/);
});

test('refuses unknown or duplicate legacy wrapper instead of silently skipping patch',()=>{
  assert.throws(()=>patchServerCall('hello'),/wrapper/i);
  assert.throws(()=>patchServerCall(legacy+'\n'+legacy),/duplicate|multiple/i);
});
