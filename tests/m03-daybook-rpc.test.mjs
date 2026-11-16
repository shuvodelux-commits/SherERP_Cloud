import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM03DayBookRpcBridge}
  from '../src/rpc/internal-daybook-bootstrap.js';

const TOKEN='a'.repeat(64),NOW=1_800_000_000_000;
const spy=()=>{
  let readCount=0;
  const env={DB:{prepare(){
    readCount++;
    throw new Error('SENTINEL_PRIVATE_D1_EXCEPTION_WITH_SQL');
  }}};
  return {env,reads:()=>readCount};
};
const call=(token=TOKEN)=>({fnName:'getDayBookBootstrap',args:[token]});

test('unknown RPCs are denied before attempting D1 and do not fall through to other exports',async()=>{
  const s=spy(),rpc=createM03DayBookRpcBridge(s.env,{now:()=>NOW});
  for(const fnName of ['getDayBookTransactions','getSettingsMap_','login','__proto__','constructor','completeSale']){
    assert.deepEqual(await rpc.invoke({fnName,args:[TOKEN]}),{
      success:false,message:'RPC method not migrated'
    });
  }
  assert.equal(s.reads(),0);
});

test('strict original source arguments reject extra actor/time/SQL and malformed bearer without D1 reads',async()=>{
  const s=spy(),rpc=createM03DayBookRpcBridge(s.env,{now:()=>NOW});
  for(const payload of [
    null,undefined,[],{},
    {fnName:'getDayBookBootstrap',args:[]},
    {fnName:'getDayBookBootstrap',args:[TOKEN,TOKEN]},
    {fnName:'getDayBookBootstrap',args:['a'.repeat(63)]},
    {fnName:'getDayBookBootstrap',args:['A'.repeat(64)]},
    {fnName:'getDayBookBootstrap',args:[123]},
    {fnName:'getDayBookBootstrap',args:[TOKEN],role:'Administrator'},
    {fnName:'getDayBookBootstrap',args:[TOKEN],nowMs:NOW},
    {fnName:'getDayBookBootstrap',args:[TOKEN],sql:'SELECT * FROM auth_users'},
    Object.assign(Object.create({isAdmin:true}),call()),
    Object.defineProperty({args:[TOKEN]},'fnName',{
      enumerable:true,get(){throw new Error('UNTRUSTED_ACCESSOR');}
    })
  ]){
    const result=await rpc.invoke(payload);
    assert.deepEqual(result,{success:false,message:'Invalid RPC arguments'});
  }
  assert.equal(s.reads(),0);
});

test('invalid trusted server clock fails closed without using D1',async()=>{
  const s=spy(),rpc=createM03DayBookRpcBridge(s.env,{now:()=>Number.NaN});
  const result=await rpc.invoke(call());
  assert.deepEqual(result,{success:false,message:'Day Book is unavailable or access denied.'});
  assert.equal(s.reads(),0);
});

test('D1 errors are sanitized without a leaked Promise, SQL or credential',async()=>{
  const s=spy(),rpc=createM03DayBookRpcBridge(s.env,{now:()=>NOW});
  const output=rpc.invoke(call());
  assert.equal(typeof output.then,'function','async bridge must return awaited envelope Promise');
  const response=await output;
  assert.deepEqual(response,{success:false,message:'Day Book is unavailable or access denied.'});
  assert.equal(s.reads(),1);
  assert.doesNotMatch(JSON.stringify(response),/SENTINEL|SQL|PRIVATE|aaaaaaaaaa/);
});

test('production Worker still advertises no internal Day Book or D1 exposure',()=>{
  const publicCode=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(publicCode.includes('internal-daybook-bootstrap'),false);
  assert.equal(registry.includes('getDayBookBootstrap'),false);
  assert.equal(publicCode.includes('daybook-rpc-workerd'),false);
});
