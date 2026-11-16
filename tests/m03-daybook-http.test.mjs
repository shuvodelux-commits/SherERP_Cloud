import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRpc} from '../src/rpc/handler.js';
import publicWorker from '../src/index.js';

const ORIGIN='https://m03-daybook-http.test.invalid';
const TOKEN='a'.repeat(64);
const MODULES=[
  'Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
  'Customer Advance Refund','Supplier Payment','Expense','Finance',
  'Bank','Bank Transfer','Stock Adjustment'
];
const SUCCESS={success:true,data:{
  currencySymbol:'৳',editableDays:3,modules:MODULES,isAdmin:false
}};
const call=(args=[TOKEN],extras={})=>({
  fnName:'getDayBookBootstrap',args,...extras
});
function request(payload=call(),opts={}){
  const headers={
    Origin:ORIGIN,'Content-Type':'application/json',...(opts.headers||{})
  };
  return new Request(ORIGIN+'/api/rpc',{
    method:opts.method||'POST',headers,
    body:opts.method==='GET'?undefined:
      (opts.raw!==undefined?opts.raw:JSON.stringify(payload))
  });
}
async function post(payload=call(),bridge,opts={}){
  const response=await handleRpc(request(payload,opts),{dayBookBridge:bridge});
  return {
    status:response.status,
    cache:response.headers.get('Cache-Control'),
    nosniff:response.headers.get('X-Content-Type-Options'),
    body:await response.json()
  };
}
function authorizedBridge(){
  let count=0;
  return {bridge:Object.freeze({async invoke(payload){
    count++;
    assert.deepEqual(payload,call());
    return structuredClone(SUCCESS);
  }}),count:()=>count};
}

test('HTTP source-shaped Day Book RPC success awaits only the exact server-approved four-field projection',async()=>{
  const a=authorizedBridge();
  const result=await post(call(),a.bridge);
  assert.deepEqual(result,{
    status:200,cache:'no-store',nosniff:'nosniff',body:SUCCESS
  });
  assert.equal(a.count(),1);
  assert.equal(result.body.data.then,undefined);
});

test('internal transport cannot be activated by request body or D1-like public Worker environment',async()=>{
  const a=authorizedBridge();
  const response=await handleRpc(request(call([TOKEN],{
    dayBookBridge:{invoke:'authorized'},actor:'Administrator',nowMs:1800000000000
  })));
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{
    success:false,message:'RPC method not migrated'
  });
  let touched=false;
  const publicResult=await publicWorker.fetch(request(call()),{
    DB:{prepare(){touched=true;throw new Error('DB forbidden');}}
  });
  assert.equal(publicResult.status,501);
  assert.equal(touched,false);
  assert.equal(a.count(),0);
});

test('HTTP validation blocks extra fields, arity, invalid bearer and unknown methods before calling bridge',async()=>{
  const a=authorizedBridge();
  for(const payload of [
    call([TOKEN,'extra']),
    call([]),
    call(['A'.repeat(64)]),
    call(['x']),
    call([123]),
    call([TOKEN],{role:'Administrator'}),
    call([TOKEN],{nowMs:1800000000000}),
    call([TOKEN],{sql:'SELECT * FROM auth_users'})
  ]){
    const result=await post(payload,a.bridge);
    assert.equal(result.status,400,JSON.stringify(payload));
    assert.deepEqual(result.body,{success:false,message:'Invalid RPC arguments'});
    assert.equal(result.cache,'no-store');
    assert.equal(result.nosniff,'nosniff');
  }
  for(const name of ['completeSale','getSettingsMap_','getDayBookTransactions']){
    const result=await post({fnName:name,args:[TOKEN]},a.bridge);
    assert.equal(result.status,501,name);
  }
  // Preserve the preexisting public auth-unconfigured fallback.
  assert.equal((await post({fnName:'login',args:[TOKEN]},a.bridge)).status,503);
  assert.equal(a.count(),0);
});

test('HTTP safety gates run before the trusted D1 bridge',async()=>{
  const a=authorizedBridge();
  for(const [opts,status] of [
    [{method:'GET'},405],
    [{headers:{Origin:'https://evil.test.invalid'}},403],
    [{headers:{'Content-Type':'text/plain'}},415],
    [{raw:'not-json'},400],
    [{raw:'x'.repeat(65537)},413]
  ]){
    const result=await post(call(),a.bridge,opts);
    assert.equal(result.status,status,JSON.stringify(opts).slice(0,55));
    assert.equal(result.body.success,false);
    assert.equal(result.cache,'no-store');
    assert.equal(result.nosniff,'nosniff');
  }
  assert.equal(a.count(),0);
});

test('bad trusted bridge results cannot leak private keys or serialize nested Promises',async()=>{
  const invalid=[
    null,
    {success:true,data:{...SUCCESS.data,secret:'DATABASE_PASSWORD'}},
    {success:true,data:{...SUCCESS.data,currencySymbol:123}},
    {success:true,data:{...SUCCESS.data,modules:['Unauthorized']}},
    {success:true,data:{...SUCCESS.data,isAdmin:'Administrator'}},
    {success:true,data:Promise.resolve(SUCCESS.data)},
    {success:true,data:{...SUCCESS.data,editableDays:Number.POSITIVE_INFINITY}},
    {success:false,message:'Sensitive SQL error with password 017'},
    {success:true,get data(){throw Error('PRIVATE_GETTER_SQL')}}
  ];
  for(const invalidResult of invalid){
    const result=await post(call(),{async invoke(){return invalidResult;}});
    assert.equal(result.status,503);
    assert.deepEqual(result.body,{
      success:false,message:'Day Book is unavailable or access denied.'
    });
    assert.doesNotMatch(JSON.stringify(result.body),/Sensitive|SQL|PRIVATE|PASSWORD|017/);
  }
});

test('trusted reader denial and exceptions are mapped to safe HTTP errors',async()=>{
  for(const bridge of [
    {async invoke(){return {success:false,message:'Day Book is unavailable or access denied.'};}},
    {async invoke(){throw new Error('private-SQL-and-token');}},
    {invoke:'missing'}
  ]){
    const result=await post(call(),bridge);
    assert.equal(result.status,503);
    assert.deepEqual(result.body,{
      success:false,message:'Day Book is unavailable or access denied.'
    });
  }
});
