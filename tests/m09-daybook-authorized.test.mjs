import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const TOKEN='a'.repeat(64);
const NOW=1_800_000_000_000;
const module=await import('../src/modules/m09-authorized-daybook-bootstrap.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
const request=(changes={})=>({token:TOKEN,nowMs:NOW,...changes});
function reader(env){
  assert.equal(typeof module?.createM09AuthorizedDayBookBootstrapReader,'function',
    'M09 authorized Day Book reader not implemented');
  return module.createM09AuthorizedDayBookBootstrapReader(env);
}
function mock(rows,{response,throwError}={}){
  const log={sql:[],params:[]};
  const env={DB:{prepare(sql){
    log.sql.push(sql);
    return {bind(...params){
      log.params.push(params);
      return {all:async()=>{
        if(throwError)throw Error('Simulated D1 outage');
        return response??{success:true,results:rows};
      }};
    }};
  }}};
  return {env,log};
}
const payload=[
  {role_name:'Administrator',key:'Currency Symbol',value:'৳'},
  {role_name:'Administrator',key:'Day Book Editable Days',value:'3'}
];

test('one D1 statement authorizes literal daybook.view and returns source-shaped Administrator response',async()=>{
  const {env,log}=mock(payload);
  const result=await reader(env).getBootstrap(request());
  assert.deepEqual(result,{
    currencySymbol:'৳',editableDays:3,
    modules:['Sales','Sales Return','Purchase','Purchase Return','Customer Payment',
      'Customer Advance Refund','Supplier Payment','Expense','Finance',
      'Bank','Bank Transfer','Stock Adjustment'],
    isAdmin:true
  });
  assert.deepEqual(Object.keys(result),['currencySymbol','editableDays','modules','isAdmin']);
  assert.equal(log.sql.length,1,'authorization and Settings projection must be one D1 read');
  const sql=log.sql[0];
  assert.match(sql,/FROM auth_sessions/i);
  assert.match(sql,/JOIN auth_users/i);
  assert.match(sql,/auth_roles/i);
  assert.match(sql,/daybook\.view/i);
  assert.match(sql,/json_type/i);
  assert.match(sql,/revoked_at_ms IS NULL/i);
  assert.match(sql,/u\.role_name/i);
  assert.match(sql,/Currency Symbol/);
  assert.match(sql,/Day Book Editable Days/);
  assert.doesNotMatch(sql,/allowed_modules/i,'navigation metadata is not permission');
  assert.equal(log.params.length,1);
  assert.equal(log.params[0].length,5);
  assert.equal(log.params[0][0],createHash('sha256').update(Buffer.from(TOKEN,'hex')).digest('hex'));
  assert.notEqual(log.params[0][0],TOKEN);
});

test('read returns non-Administrator flag from D1 role, never from caller',async()=>{
  const {env}=mock([
    {role_name:'Cashier',key:'Currency Symbol',value:'৳'},
    {role_name:'Cashier',key:'Day Book Editable Days',value:'0'}
  ]);
  assert.equal((await reader(env).getBootstrap(request())).isAdmin,false);
  assert.equal((await reader(env).getBootstrap(request())).editableDays,0);
});

test('authorized actor with zero Settings rows receives source-safe fallbacks',async()=>{
  const {env}=mock([{role_name:'Cashier',key:null,value:null}]);
  const result=await reader(env).getBootstrap(request());
  assert.equal(result.currencySymbol,'');
  assert.equal(result.editableDays,0);
  assert.equal(result.isAdmin,false);
  assert.equal(result.modules.length,12);
});

test('no authorized rows, missing role or poisoned D1 Settings fail closed',async()=>{
  const bad=[
    [],[{role_name:null,key:null,value:null}],
    [{role_name:'Cashier',key:'JWT_SECRET',value:'leak'}],
    [{role_name:'Cashier',key:'Currency Symbol',value:'৳'},
      {role_name:'Administrator',key:'Day Book Editable Days',value:'3'}],
    [{role_name:'Cashier',key:'Currency Symbol',value:'৳'},
      {role_name:'Cashier',key:'Currency Symbol',value:'BDT'}],
    [{role_name:'Cashier',key:'Day Book Editable Days',value:{value:3}}],
    [{role_name:'Cashier',key:null,value:'should be null'}],
    [{role_name:'Cashier',key:'Currency Symbol',value:'৳'},
      {role_name:'Cashier',key:'Day Book Editable Days',value:'3'},
      {role_name:'Cashier',key:'Phone 1',value:'private'}]
  ];
  for(const rows of bad){
    await assert.rejects(()=>reader(mock(rows).env).getBootstrap(request()),
      /Denied|invalid|malformed|NEEDS_REVIEW|trusted|Settings/i);
  }
});

test('strict server-owned request rejects forged actor/permission and invalid bearer/time before D1',async()=>{
  const {env,log}=mock(payload),read=reader(env);
  for(const req of [
    null,{},[],Promise.resolve(request()),
    request({actor:'Administrator'}),request({role:'Administrator'}),
    request({permission:'daybook.view'}),request({tenantId:'fake'}),
    request({token:'A'.repeat(64)}),request({token:'not-hex'}),
    request({nowMs:NaN}),request({nowMs:-1}),request({nowMs:'1800000000000'}),
    request({nowMs:Number.MAX_SAFE_INTEGER}),
    Object.assign(Object.create({token:TOKEN}),{nowMs:NOW}),
    Object.defineProperty({token:TOKEN},'nowMs',{get(){throw Error('GETTER CALLED');},enumerable:true})
  ]){
    await assert.rejects(()=>read.getBootstrap(req),/invalid|trusted|request/i);
  }
  assert.equal(log.sql.length,0,'invalid requests must not reach D1');
});

test('D1 failure and invalid API results cannot return partial Day Book payloads',async()=>{
  for(const options of [
    {throwError:true},
    {response:{success:false,results:payload}},
    {response:{success:true,results:null}},
    {response:{success:true,results:[{role_name:'Administrator',key:'Currency Symbol',value:'৳',extra:1}]}}
  ]){
    await assert.rejects(()=>reader(mock(payload,options).env).getBootstrap(request()),
      /NEEDS_REVIEW|unavailable|malformed|invalid/i);
  }
});

test('reader remains internal; RPC registry, original UI and public preview unchanged',()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const original=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(original,/serverCall\('getDayBookBootstrap', authToken\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.doesNotMatch(registry+worker,/m09-authorized-daybook-bootstrap/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof module?.createM09AuthorizedDayBookBootstrapReader,'function',
    'M09 authorized Day Book reader not implemented');
});
