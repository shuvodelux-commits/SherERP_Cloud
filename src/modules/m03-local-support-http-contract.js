/**
 * LOCAL TEST-ONLY Support Mode HTTP contract — deliberately NOT registered on
 * the hosted Control Center, any public Worker or the ERP RPC registry.
 *
 * A separately trusted caller must inject SUPPORT_TEST_SHOPS with physical
 * Shop D1 bindings. Shop IDs from requests never create or select bindings.
 * Production use needs independent Cloudflare Access, cross-D1 race and
 * release reviews; SUPPORT_TEST_MODE_ENABLED must never be used as a prod flag.
 */
import {issueLocalSupportReadGrant,revokeLocalSupportReadGrant}
  from './m03-local-support-read-grants.js';
import {inspectLocalSupportShop} from './m03-local-support-shop-diagnostics.js';

const ROOT='/__m03_support_local__/';
const ORIGIN=/^https:\/\/[a-z0-9.-]+$/;
const COOKIE='__Host-shererp-platform-session';
const TOKEN=/^[0-9a-f]{64}$/;
const MAX_BYTES=2048;
const FIELDS=Object.freeze({
  start:['shopId','operationId','reason'],
  diagnostics:['shopId','eventId','supportToken'],
  end:['shopId','operationId'],
});
const HEADERS=Object.freeze({
  'Cache-Control':'no-store',
  'Content-Type':'application/json; charset=utf-8',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const deny=()=>reply(403,{error:'Denied'});
const invalid=()=>reply(400,{error:'Invalid request'});

/** Duplicate/conflicting cookies are rejected; never consume arbitrary headers. */
function readAdminSession(request){
  const cookies=request.headers.get('Cookie')||'';
  const matches=cookies.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
  if(matches.length!==1)return null;
  const value=matches[0].slice(COOKIE.length+1);
  return TOKEN.test(value)?value:null;
}

async function readBoundedBody(request){
  const length=request.headers.get('Content-Length');
  if(length!==null && (!/^\d+$/.test(length)||Number(length)>MAX_BYTES))
    return {tooLarge:true};
  if(!request.body)return {};
  const reader=request.body.getReader();
  const chunks=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){
        await reader.cancel();
        return {tooLarge:true};
      }
      chunks.push(value);
    }
  }finally{
    reader.releaseLock();
  }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;
  try{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    body=JSON.parse(text);
  }catch{
    return {};
  }
  return {body};
}

function properBody(body,fields){
  return body!==null && typeof body==='object' && !Array.isArray(body) &&
    Object.keys(body).length===fields.length &&
    fields.every(field=>Object.hasOwn(body,field) && typeof body[field]==='string');
}

function trustedScope(env,shopId){
  if(!Array.isArray(env.SUPPORT_TEST_SHOPS)||env.SUPPORT_TEST_SHOPS.length<1 ||
     env.SUPPORT_TEST_SHOPS.length>10)return null;
  const matches=env.SUPPORT_TEST_SHOPS.filter(s=>s && s.shopId===shopId);
  if(matches.length!==1)return null;
  const scope=matches[0];
  if(typeof scope.shopDb?.prepare!=='function' ||
     ![scope.databaseId,scope.databaseMarker].every(s=>typeof s==='string'))return null;
  return scope;
}

/**
 * Dispatch a browser-like HTTP Request through local Workerd-backed D1.
 * This is ONLY a contract/proof, not a Worker fetch handler in production.
 * All successful operations are rechecked in existing Control D1 SQL.
 */
export async function handleLocalSupportHttpRequest(request,env){
  if(env?.SUPPORT_TEST_MODE_ENABLED!==true)
    return reply(404,{error:'Not found'});
  try{
    if(typeof env.SUPPORT_TEST_ORIGIN!=='string' ||
       !ORIGIN.test(env.SUPPORT_TEST_ORIGIN) ||
       new URL(request.url).origin!==env.SUPPORT_TEST_ORIGIN ||
       request.headers.get('Origin')!==env.SUPPORT_TEST_ORIGIN)return deny();

    const url=new URL(request.url);
    const action=url.pathname.startsWith(ROOT)?url.pathname.slice(ROOT.length):'';
    if(!Object.hasOwn(FIELDS,action))return reply(404,{error:'Not found'});
    if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
    if(url.search)return invalid();
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
      return reply(415,{error:'Unsupported media type'});

    const sessionToken=readAdminSession(request);
    if(!sessionToken)return reply(401,{error:'Authentication required'});

    const parsed=await readBoundedBody(request);
    if(parsed.tooLarge)return reply(413,{error:'Request too large'});
    if(!properBody(parsed.body,FIELDS[action]))return invalid();
    const body=parsed.body;
    const scope=trustedScope(env,body.shopId);
    if(!scope || typeof env.CONTROL_DB?.prepare!=='function')return deny();

    let result;
    if(action==='start'){
      result=await issueLocalSupportReadGrant(env.CONTROL_DB,scope,{
        operationId:body.operationId,reason:body.reason,sessionToken,
      });
      if(result.status==='created')return reply(201,result);
      if(result.status==='replayed')return reply(200,{status:'replayed'});
    }else if(action==='diagnostics'){
      result=await inspectLocalSupportShop(env.CONTROL_DB,scope,{
        eventId:body.eventId,sessionToken,supportToken:body.supportToken,
      });
      if(result.status==='ok'||result.status==='schema-incomplete')return reply(200,result);
    }else{
      result=await revokeLocalSupportReadGrant(env.CONTROL_DB,scope,{
        operationId:body.operationId,sessionToken,
      });
      if(result.status==='revoked')return reply(200,{status:'revoked'});
    }
    return result?.status==='invalid'?invalid():deny();
  }catch{
    // No SQL errors, Admin identity, Shop metadata or secrets in responses.
    return reply(503,{error:'Support unavailable'});
  }
}
