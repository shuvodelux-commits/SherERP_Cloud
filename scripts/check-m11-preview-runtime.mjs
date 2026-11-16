#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import workerEntry from '../src/index.js';
import {validateCloudflarePreviewConfig} from './check-cloudflare-preview.mjs';

/**
 * Local request-level smoke of the public preview Worker.
 * No real Cloudflare, GAS/Sheets or D1 access; never a production launch gate.
 */
const ORIGIN='https://m11-preview-smoke.invalid';
const RPC_PROBES=Object.freeze([
  ['login',['00000000000','not-a-real-password'],503],
  ['getAllProducts',[],501],
  ['saveSale',[{operationId:'synthetic-sale'}],501],
  ['savePurchase',[{operationId:'synthetic-purchase'}],501],
  ['saveSalesReturn',[{operationId:'synthetic-return'}],501],
  ['saveBankTransaction',[{operationId:'synthetic-bank'}],501],
  ['updateStock',[{operationId:'synthetic-stock'}],501],
  ['getCashBook',[],501]
]);
const fail=code=>{throw new Error(code);};
const safeHeaders=response=>
  response.headers.get('Cache-Control')==='no-store'&&
  response.headers.get('X-Content-Type-Options')==='nosniff';
const exact=(value,fields)=>value!==null&&typeof value==='object'&&
  !Array.isArray(value)&&Object.keys(value).length===fields.length&&
  fields.every(k=>Object.hasOwn(value,k));
const rpcRequest=payload=>new Request(ORIGIN+'/api/rpc',{
  method:'POST',
  headers:{'Content-Type':'application/json','Origin':ORIGIN},
  body:payload
});

/**
 * Throws a fixed, non-sensitive error code if the preview runtime appears
 * able to post business writes, authenticate, read environment secrets/D1, or
 * present the inert shell as production.
 */
export async function probeM11PreviewRuntime({worker,previewConfig}={}) {
  try{validateCloudflarePreviewConfig(previewConfig);}
  catch{fail('M11_PREVIEW_CONFIG_INVALID');}
  if(!worker||typeof worker.fetch!=='function'){
    fail('M11_PREVIEW_WORKER_INVALID');
  }

  let unexpectedEnvReads=0;
  const env=new Proxy({
    ASSETS:{fetch:async()=>new Response('synthetic static asset',{status:200})}
  },{
    get(target,key){
      if(key!=='ASSETS'){
        unexpectedEnvReads++;
        return undefined;
      }
      return target.ASSETS;
    }
  });
  let checkedRequests=0;
  async function call(request){
    let res;
    try{res=await worker.fetch(request,env);}
    catch{fail('M11_PREVIEW_RUNTIME_ERROR');}
    checkedRequests++;
    // Detect even swallowed DB/secret access by the Worker.
    if(unexpectedEnvReads!==0)fail('M11_PREVIEW_ENV_ACCESS');
    if(!(res instanceof Response))fail('M11_PREVIEW_RUNTIME_ERROR');
    return res;
  }
  async function bodyOrFail(response,code){
    try{return await response.json();}
    catch{fail(code);}
  }

  const health=await call(new Request(ORIGIN+'/api/health'));
  const healthBody=await bodyOrFail(health,'M11_PREVIEW_HEALTH_INVALID');
  if(health.status!==200||!safeHeaders(health)||
    !exact(healthBody,['status','service','database'])||
    healthBody.status!=='foundation'||healthBody.service!=='shererp-cloud'||
    healthBody.database!=='not-connected'){
    fail('M11_PREVIEW_HEALTH_INVALID');
  }

  for(const [name,args,expectedStatus] of RPC_PROBES){
    const res=await call(rpcRequest(JSON.stringify({fnName:name,args})));
    const body=await bodyOrFail(res,'M11_PREVIEW_RPC_UNSAFE');
    if(res.status!==expectedStatus||!safeHeaders(res)||
      !exact(body,['success','message'])||body.success!==false||
      typeof body.message!=='string'||!body.message){
      fail('M11_PREVIEW_RPC_UNSAFE');
    }
  }

  const malformed=await call(rpcRequest('{malformed'));
  const malformedBody=await bodyOrFail(malformed,'M11_PREVIEW_RPC_UNSAFE');
  if(malformed.status!==400||!safeHeaders(malformed)||
    !exact(malformedBody,['success','message'])||
    malformedBody.success!==false)fail('M11_PREVIEW_RPC_UNSAFE');

  const getRpc=await call(new Request(ORIGIN+'/api/rpc'));
  const getBody=await bodyOrFail(getRpc,'M11_PREVIEW_RPC_UNSAFE');
  if(getRpc.status!==405||!safeHeaders(getRpc)||
    !exact(getBody,['success','message'])||getBody.success!==false){
    fail('M11_PREVIEW_RPC_UNSAFE');
  }

  const unknown=await call(new Request(ORIGIN+'/api/unknown'));
  const unknownBody=await bodyOrFail(unknown,'M11_PREVIEW_API_UNSAFE');
  if(unknown.status!==404||!safeHeaders(unknown)||
    !exact(unknownBody,['success','message'])||unknownBody.success!==false){
    fail('M11_PREVIEW_API_UNSAFE');
  }

  const assets=await call(new Request(ORIGIN+'/'));
  if(assets.status!==200||await assets.text()!=='synthetic static asset'){
    fail('M11_PREVIEW_ASSETS_INVALID');
  }
  return {
    previewRuntimeInert:true,
    authorizesProduction:false,
    checkedRequests,
    caution:'Only local synthetic probes were checked; real Cloudflare settings, full RPC attack surface, M10 signoff and production cutover remain unverified.'
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const config=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
    const result=await probeM11PreviewRuntime({worker:workerEntry,previewConfig:config});
    console.log('M11 preview runtime smoke passed ('+result.checkedRequests+
      ' synthetic requests), production authorization=false');
  }catch(error){
    const code=String(error?.message??'');
    console.error(/^M11_PREVIEW_[A-Z_]+$/.test(code)?code:'M11_PREVIEW_RUNTIME_ERROR');
    process.exitCode=1;
  }
}
