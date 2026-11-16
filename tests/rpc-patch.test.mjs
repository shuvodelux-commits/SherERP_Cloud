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


test('RPC HTTP non-JSON and empty response bodies reject with a controlled error',async()=>{
  const patched=patchServerCall(legacy);
  const fn=patched.slice(patched.indexOf('  function serverCall'),patched.indexOf('  // ---------------- 6.'));
  for(const status of [200,503]){
    const call=runInNewContext(fn+';serverCall',{
      fetch:async()=>({
        ok:status===200,
        status,
        json:async()=>{throw new SyntaxError(status===200
          ? 'Unexpected token < in JSON at position 0'
          : 'Unexpected end of JSON input');}
      })
    });
    await assert.rejects(call('getProducts'),{
      name:'Error',
      message:'Server error'
    },'HTTP '+status+' invalid JSON body must not leak parser diagnostics');
  }
});


test('RPC serialization failures return rejected Promises without sending a request',async()=>{
  const html=patchServerCall(legacy);
  const fn=html.slice(html.indexOf('  function serverCall'),html.indexOf('  // ---------------- 6.'));
  let requests=0;
  const call=runInNewContext(fn+';serverCall',{
    fetch:async()=>{requests++;throw new Error('fetch should not run');}
  });
  const circular=[];
  circular.push(circular);
  for(const invalid of [circular,1n]){
    let result;
    assert.doesNotThrow(()=>{
      result=call('getProducts',invalid);
    },'serverCall must return a Promise rather than throw during JSON.stringify');
    assert.equal(typeof result?.then,'function','returned value is Promise-like');
    await assert.rejects(result,{name:'TypeError'});
    assert.equal(requests,0,'invalid JSON must not send any RPC request');
  }
});
