import {rpcRegistry} from './registry.js';

const MAX_RPC_BYTES = 65_536;
const MAX_ARGS = 20;
const RPC_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

// Internal opt-in only: these are the entire reviewed legacy auth transport
// surface. The public Worker never passes an authAdapter.
const AUTH_ARGS = Object.freeze({login:2,validateSession:1,logout:1});
function validAuthArguments(name,args) {
  if(args.length!==AUTH_ARGS[name]) return false;
  if(args.some(value=>typeof value!=='string' || value.length===0)) return false;
  if(name==='login') return args[0].length<=64 && args[1].length<=1024;
  return args[0].length<=128;
}
function validAuthEnvelope(result) {
  if(!result || typeof result!=='object' || Array.isArray(result) ||
      (Object.getPrototypeOf(result)!==Object.prototype &&
       Object.getPrototypeOf(result)!==null)) return false;
  const keys=Reflect.ownKeys(result);
  if(keys.length!==2 || typeof keys[0]!=='string' || typeof keys[1]!=='string') return false;
  const success=Object.getOwnPropertyDescriptor(result,'success');
  if(!success || !Object.hasOwn(success,'value') ||
      typeof success.value!=='boolean') return false;
  const name=success.value?'data':'message';
  const field=Object.getOwnPropertyDescriptor(result,name);
  if(!field || !Object.hasOwn(field,'value')) return false;
  if(success.value===false &&
     (typeof field.value!=='string' || field.value.length===0 ||
      field.value.length>256)) return false;
  return keys.every(key=>key==='success'||key===name);
}

function rpcError(status, message, headers = {}) {
  return Response.json({success:false, message}, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}

async function boundedBody(request) {
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_RPC_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks=[];
  let size=0;
  while (true) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size > MAX_RPC_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const full=new Uint8Array(size);
  let offset=0;
  for (const chunk of chunks) {full.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(full);
}

export async function handleRpc(request, {authAdapter}={}) {
  if (request.method !== 'POST') return rpcError(405,'POST required',{'Allow':'POST'});
  const origin=request.headers.get('Origin');
  if (origin && origin!==new URL(request.url).origin) return rpcError(403,'Cross-origin RPC forbidden');
  const type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if (type!=='application/json') return rpcError(415,'JSON request required');

  let raw;
  try { raw=await boundedBody(request); }
  catch { return rpcError(400,'Invalid request encoding'); }
  if(raw===null) return rpcError(413,'RPC request too large');
  let payload;
  try {payload=JSON.parse(raw);} catch {return rpcError(400,'Invalid JSON');}
  if (!payload || typeof payload!=='object' || Array.isArray(payload) ||
      typeof payload.fnName!=='string' || !RPC_NAME.test(payload.fnName) ||
      !Array.isArray(payload.args) || payload.args.length>MAX_ARGS) {
    return rpcError(400,'Invalid RPC payload');
  }
  if (authAdapter!==undefined && Object.hasOwn(AUTH_ARGS,payload.fnName)) {
    if(!validAuthArguments(payload.fnName,payload.args))
      return rpcError(400,'Invalid authentication arguments');
    try {
      // Never dispatch an unreviewed method or take a handler name from a
      // request beyond AUTH_ARGS. The adapter is trusted server context.
      const method=Object.getOwnPropertyDescriptor(authAdapter,payload.fnName)?.value;
      if(typeof method!=='function')
        return rpcError(503,'Authentication backend unavailable');
      const result=await method(...payload.args);
      if(!validAuthEnvelope(result))
        return rpcError(503,'Authentication backend unavailable');
      return Response.json(result,{headers:{
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
      }});
    } catch {
      // Never expose credentials, D1 errors, SQL, or exception messages.
      return rpcError(503,'Authentication backend unavailable');
    }
  }
  if (!Object.hasOwn(rpcRegistry,payload.fnName)) {
    if (payload.fnName === 'login') {
      return rpcError(503,'Sign-in is unavailable because server authentication is not configured yet.');
    }
    return rpcError(501,'RPC method not migrated');
  }
  // No handlers are registered until the authenticated authorization layer (M04).
  return rpcError(501,'RPC method not migrated');
}
