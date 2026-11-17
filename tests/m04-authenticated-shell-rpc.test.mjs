import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRpc} from '../src/rpc/handler.js';
import {buildSourceAppShellData} from '../src/modules/source-app-shell-reader.js';
import {createM04LoginShellReader} from '../src/modules/m04-login-shell-reader.js';
import {createM04AppShellRpcBridge} from '../src/rpc/internal-m04-shell-bridge.js';

const ORIGIN='https://internal.local';
const TOKEN='a'.repeat(64);
const body=(fnName,args,extras={})=>JSON.stringify({fnName,args,...extras});
const request=(fnName,args,extras={},headers={})=>new Request(ORIGIN+'/api/rpc',{
  method:'POST',
  headers:{'Content-Type':'application/json',Origin:ORIGIN,...headers},
  body:body(fnName,args,extras)
});
const safe=()=>buildSourceAppShellData({shopName:'শেরERP',currencySymbol:'৳'});
const bridge={async invoke({token}) {
  assert.equal(token,TOKEN);
  return safe();
}};
const call=async(fnName,args,extra={},context={appShellBridge:bridge})=>{
  const response=await handleRpc(request(fnName,args,extra),context);
  return {status:response.status,body:await response.json(),headers:response.headers};
};

test('public Worker contract stays fail-closed: no auth or shell bridge gives login 503 and shell 501',async()=>{
  const login=await call('login',['01710000801','password'],{},{});
  assert.equal(login.status,503);
  assert.equal(login.body.message,
    'Sign-in is unavailable because server authentication is not configured yet.');
  const shell=await call('getAppShellData',[TOKEN],{},{});
  assert.equal(shell.status,501);
  assert.deepEqual(shell.body,{success:false,message:'RPC method not migrated'});
});

test('opt-in private M04 shell returns only source NAV and two public branding values',async()=>{
  const result=await call('getAppShellData',[TOKEN]);
  assert.equal(result.status,200);
  assert.deepEqual(result.body,safe());
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
  assert(result.body.data.navItems.some(item=>item.key==='pos' && item.landingKey==='posv2'));
  assert.equal(JSON.stringify(result.body).includes('password_hash'),false);
});

test('no implicit unauthenticated shell; wrong args and client clock/actor are refused',async()=>{
  for(const args of [[],[TOKEN,TOKEN],[null],['x'],['A'.repeat(64)],[123]]){
    const res=await call('getAppShellData',args);
    assert.equal(res.status,400,JSON.stringify(args));
    assert.equal(res.body.success,false);
  }
  for(const extra of [{nowMs:123},{actor:'Admin'},{sql:'SELECT * FROM users'},
    {authAdapter:{login:'bypass'}}]){
    const res=await call('getAppShellData',[TOKEN],extra);
    assert.equal(res.status,400,JSON.stringify(extra));
  }
  assert.equal((await call('unknownFutureMethod',[TOKEN])).status,501);
});

test('malformed bridge/private keys/modified NAV reject with redacted 503 before response',async()=>{
  const extras=[
    {success:true,data:{...safe().data,password_hash:'leak'}},
    {success:true,data:{...safe().data,navItems:[{key:'injected',label:'Admin'}]}},
    {success:true,data:{...safe().data,shopName:42}},
    {success:true,data:{...safe().data,currencySymbol:null}},
    {success:true,data:{...safe().data,navItems:'no'}},
    {success:false,message:'SECRET_USER'},
  ];
  for(const malformed of extras){
    const res=await call('getAppShellData',[TOKEN],{},{appShellBridge:{invoke:async()=>malformed}});
    assert.equal(res.status,503);
    assert.equal(JSON.stringify(res.body).includes('leak'),false);
    assert.equal(JSON.stringify(res.body).includes('SECRET_USER'),false);
  }
  const thrown=await call('getAppShellData',[TOKEN],{},{
    appShellBridge:{invoke(){throw Error('PRIVATE_D1_FAILURE')}}
  });
  assert.equal(thrown.status,503);
  assert.equal(JSON.stringify(thrown.body).includes('PRIVATE_D1_FAILURE'),false);
  const missing=await call('getAppShellData',[TOKEN],{},{appShellBridge:{}});
  assert.equal(missing.status,503);
});

test('same-origin and method/content-type guards remain before bridge invocation',async()=>{
  let called=0;
  const auth={appShellBridge:{invoke:async()=>{called++;return safe();}}};
  const cross=await handleRpc(request('getAppShellData',[TOKEN],{},
    {Origin:'https://attacker.invalid'}),auth);
  assert.equal(cross.status,403);
  const wrongType=await handleRpc(request('getAppShellData',[TOKEN],{},
    {'Content-Type':'text/plain'}),auth);
  assert.equal(wrongType.status,415);
  const get=await handleRpc(new Request(ORIGIN+'/api/rpc',{method:'GET'}),auth);
  assert.equal(get.status,405);
  assert.equal(called,0);
});

test('private bridge rejects missing D1 and invalid server-owned clock; client cannot select SQL',async()=>{
  assert.throws(()=>createM04LoginShellReader({}),/D1|binding/i);
  const DB={prepare(){throw Error('PRIVATE_SQL')}};
  const bad=createM04AppShellRpcBridge({DB},{now:()=>NaN});
  await assert.rejects(()=>bad.invoke({token:TOKEN}),/unavailable|invalid|denied/i);
  const safeBridge=createM04AppShellRpcBridge({DB},{now:()=>1_800_400_000_000});
  await assert.rejects(()=>safeBridge.invoke({token:TOKEN}),error=>
    error instanceof Error && !String(error).includes('PRIVATE_SQL'));
});
