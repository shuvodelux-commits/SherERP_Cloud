import {rpcRegistry} from './registry.js';

const MAX_RPC_BYTES = 65_536;
const MAX_ARGS = 20;
const RPC_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

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

export async function handleRpc(request) {
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
  if (!Object.hasOwn(rpcRegistry,payload.fnName)) return rpcError(501,'RPC method not migrated');
  // No handlers are registered until the authenticated authorization layer (M04).
  return rpcError(501,'RPC method not migrated');
}
