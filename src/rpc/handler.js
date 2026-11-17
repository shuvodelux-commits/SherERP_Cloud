import {rpcRegistry} from './registry.js';
import {buildSourceAppShellData} from '../modules/source-app-shell-reader.js';
import {assertFullyResolvedRpcValue} from './awaited-response-boundary.js';

const MAX_RPC_BYTES = 65_536;
const MAX_ARGS = 20;
const RPC_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

// Internal opt-in only: these are the entire reviewed legacy auth transport
// surface. The public Worker never passes an authAdapter.
const AUTH_ARGS = Object.freeze({login:2,validateSession:1,logout:1});

const APP_SHELL_RPC='getAppShellData';
const APP_SHELL_UNAVAILABLE='Application shell unavailable or access denied.';
const APP_SHELL_TOKEN=/^[0-9a-f]{64}$/;
const SOURCE_SHELL_NAV=buildSourceAppShellData({shopName:'',currencySymbol:''}).data.navItems;

const DAY_BOOK_RPC='getDayBookBootstrap';
const DAY_BOOK_TOKEN=/^[0-9a-f]{64}$/;
const DAY_BOOK_UNAVAILABLE='Day Book is unavailable or access denied.';
const DAY_BOOK_MODULES=Object.freeze([
  'Sales','Sales Return','Purchase','Purchase Return',
  'Customer Payment','Customer Advance Refund','Supplier Payment','Expense','Finance',
  'Bank','Bank Transfer','Stock Adjustment'
]);

function validAuthArguments(name,args) {
  if(args.length!==AUTH_ARGS[name]) return false;
  if(args.some(value=>typeof value!=='string' || value.length===0)) return false;
  if(name==='login') return args[0].length<=64 && args[1].length<=1024;
  return args[0].length<=128;
}
// The trusted M04 bridge's response is not an arbitrary JSON payload:
// a second guard keeps new/accidental private D1 columns out of HTTP.
const AUTH_TOKEN=/^[0-9a-f]{64}$/;
const AUTH_MOBILE=/^01[3-9][0-9]{8}$/;
const AUTH_MODULES=new Set([
  'dashboard','pos','sales','returns','purchase','suppliers','vendors',
  'products','customers','bank','expense','finance','daybook',
  'cashReconciliation','reports','settings','users','roles',
  'openingBalance','settlementDiscount','posCost',
]);
// Source Auth.gs DELETE_WINDOW_OPTIONS; management delete is Boolean.
const AUTH_PERMISSION_WINDOWS=new Set(['disabled','same','1','3','7','15','30','unlimited']);
const AUTH_MANAGEMENT_MODULES=new Set(['users','roles']);
const AUTH_FAILURE_MESSAGES=new Set([
  'Invalid mobile number or password.',
  'Session expired. Please sign in again.',
  'Sign-in role configuration is unavailable.',
]);
function plainRecord(value) {
  return value && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
     Object.getPrototypeOf(value)===null);
}
function ownFields(value,fields) {
  if(!plainRecord(value)) return false;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length ||
     keys.some(key=>typeof key!=='string'||!fields.includes(key))) return false;
  return fields.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?.enumerable===true && Object.hasOwn(descriptor,'value');
  });
}
function validRoleMetadata(profile) {
  if(profile.user.role==='Administrator')
    return profile.allowedModules===null && profile.permissions===null;
  const modules=profile.allowedModules;
  const permissions=profile.permissions;
  if(!Array.isArray(modules) || Object.getPrototypeOf(modules)!==Array.prototype ||
     modules.length>AUTH_MODULES.size ||
     Reflect.ownKeys(modules).length!==modules.length+1 ||
     modules.some(name=>typeof name!=='string'||!AUTH_MODULES.has(name)) ||
     new Set(modules).size!==modules.length || !plainRecord(permissions))
    return false;
  const moduleKeys=Reflect.ownKeys(permissions);
  if(moduleKeys.length>AUTH_MODULES.size) return false;
  for(const moduleName of moduleKeys){
    if(typeof moduleName!=='string'||!AUTH_MODULES.has(moduleName)) return false;
    const descriptor=Object.getOwnPropertyDescriptor(permissions,moduleName);
    if(!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) return false;
    const actions=descriptor.value;
    if(!plainRecord(actions)) return false;
    for(const action of Reflect.ownKeys(actions)){
      if(typeof action!=='string')return false;
      const d=Object.getOwnPropertyDescriptor(actions,action);
      if(!d?.enumerable || !Object.hasOwn(d,'value'))return false;
      if(action==='delete'){
        if(AUTH_MANAGEMENT_MODULES.has(moduleName)){
          if(typeof d.value!=='boolean')return false;
        }else if(!AUTH_PERMISSION_WINDOWS.has(d.value))return false;
      }else if(action==='backdate'){
        if(!AUTH_PERMISSION_WINDOWS.has(d.value))return false;
      }else if(['view','add','edit'].includes(action)){
        if(typeof d.value!=='boolean')return false;
      }else return false;
    }
  }
  return true;
}
function validAuthProfile(data) {
  if(!ownFields(data,['token','user','allowedModules','permissions']) ||
     typeof data.token!=='string'||!AUTH_TOKEN.test(data.token) ||
     !ownFields(data.user,['id','name','mobile','role'])) return false;
  const user=data.user;
  if(typeof user.id!=='string'||!user.id.trim()||user.id.length>128 ||
     typeof user.name!=='string'||!user.name.trim()||user.name.length>256 ||
     typeof user.mobile!=='string'||!AUTH_MOBILE.test(user.mobile) ||
     typeof user.role!=='string'||!user.role.trim()||user.role.length>100)
    return false;
  return validRoleMetadata(data);
}
function validAuthEnvelope(result,method) {
  if(!plainRecord(result))return false;
  const success=Object.getOwnPropertyDescriptor(result,'success');
  if(!success?.enumerable || !Object.hasOwn(success,'value') ||
     typeof success.value!=='boolean')return false;
  if(success.value===false){
    return ownFields(result,['success','message']) &&
      typeof result.message==='string' &&
      AUTH_FAILURE_MESSAGES.has(result.message);
  }
  return ownFields(result,['success','data']) &&
    (method==='logout' ? result.data==='logged out' : validAuthProfile(result.data));
}

/**
 * A second transport-side output guard deliberately rejects accidental
 * extra D1 columns, getters and Promises even from a trusted bridge. The
 * 12 source DAY_BOOK_MODULES are presentation labels, not auth grants.
 */
function validDayBookEnvelope(result) {
  if(!ownFields(result,['success','data']) || result.success!==true ||
     !ownFields(result.data,['currencySymbol','editableDays','modules','isAdmin']))
    return false;
  const data=result.data;
  if(typeof data.currencySymbol!=='string' || data.currencySymbol.length>32 ||
     typeof data.editableDays!=='number' || !Number.isFinite(data.editableDays) ||
     typeof data.isAdmin!=='boolean')
    return false;
  const modules=data.modules;
  if(!Array.isArray(modules) ||
     Object.getPrototypeOf(modules)!==Array.prototype ||
     modules.length!==DAY_BOOK_MODULES.length ||
     Reflect.ownKeys(modules).length!==DAY_BOOK_MODULES.length+1)
    return false;
  return DAY_BOOK_MODULES.every((module,i)=>{
    const field=Object.getOwnPropertyDescriptor(modules,String(i));
    return field?.enumerable===true && Object.hasOwn(field,'value') &&
      field.value===module;
  });
}

/**
 * Reject additional/private NAV columns, getters and permission mutations
 * even when a trusted backend bridge accidentally returns a bad shape.
 * The source tree is static presentation metadata, NOT an auth grant.
 */
function exactShellNavigation(actual,expected) {
  if(Array.isArray(expected)){
    if(!Array.isArray(actual)||Object.getPrototypeOf(actual)!==Array.prototype||
       actual.length!==expected.length ||
       Reflect.ownKeys(actual).length!==expected.length+1)
      return false;
    return expected.every((item,i)=>{
      const d=Object.getOwnPropertyDescriptor(actual,String(i));
      return d?.enumerable===true && Object.hasOwn(d,'value') &&
        exactShellNavigation(d.value,item);
    });
  }
  if(expected && typeof expected==='object'){
    if(!plainRecord(actual))return false;
    const wanted=Object.keys(expected);
    const actualKeys=Reflect.ownKeys(actual);
    if(actualKeys.length!==wanted.length||
       actualKeys.some(k=>typeof k!=='string'||!wanted.includes(k)))
      return false;
    return wanted.every(k=>{
      const d=Object.getOwnPropertyDescriptor(actual,k);
      return d?.enumerable===true && Object.hasOwn(d,'value') &&
        exactShellNavigation(d.value,expected[k]);
    });
  }
  return actual===expected;
}

function validAppShellEnvelope(result){
  if(!ownFields(result,['success','data'])||result.success!==true ||
     !ownFields(result.data,['shopName','currencySymbol','navItems']))
    return false;
  const data=result.data;
  return typeof data.shopName==='string' && data.shopName.length<=256 &&
    typeof data.currencySymbol==='string' && data.currencySymbol.length<=32 &&
    exactShellNavigation(data.navItems,SOURCE_SHELL_NAV);
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

export async function handleRpc(request, {authAdapter,dayBookBridge,appShellBridge}={}) {
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
      if(!validAuthEnvelope(result,payload.fnName))
        return rpcError(503,'Authentication backend unavailable');
      assertFullyResolvedRpcValue(result);
      return Response.json(result,{headers:{
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
      }});
    } catch {
      // Never expose credentials, D1 errors, SQL, or exception messages.
      return rpcError(503,'Authentication backend unavailable');
    }
  }

  if(appShellBridge!==undefined && payload.fnName===APP_SHELL_RPC) {
    // Internal-only trusted M04 composition, never imported by src/index.js.
    // The original pre-login call is denied; an issued bearer is required.
    if(!ownFields(payload,['fnName','args'])||payload.args.length!==1 ||
       typeof payload.args[0]!=='string'||!APP_SHELL_TOKEN.test(payload.args[0]))
      return rpcError(400,'Invalid RPC arguments');
    try{
      const invoke=Object.getOwnPropertyDescriptor(appShellBridge,'invoke')?.value;
      if(typeof invoke!=='function')
        return rpcError(503,APP_SHELL_UNAVAILABLE);
      const result=await invoke.call(appShellBridge,{token:payload.args[0]});
      if(!validAppShellEnvelope(result))
        return rpcError(503,APP_SHELL_UNAVAILABLE);
      assertFullyResolvedRpcValue(result);
      return Response.json(result,{headers:{
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
      }});
    }catch{
      return rpcError(503,APP_SHELL_UNAVAILABLE);
    }
  }

  if(dayBookBridge!==undefined && payload.fnName===DAY_BOOK_RPC) {
    // A trusted server-only opt-in. src/index.js never supplies this
    // bridge; passing dayBookBridge/actor/nowMs in JSON cannot activate it.
    if(!ownFields(payload,['fnName','args']) || payload.args.length!==1 ||
       typeof payload.args[0]!=='string' ||
       !DAY_BOOK_TOKEN.test(payload.args[0]))
      return rpcError(400,'Invalid RPC arguments');
    try {
      const method=Object.getOwnPropertyDescriptor(dayBookBridge,'invoke')?.value;
      if(typeof method!=='function')
        return rpcError(503,DAY_BOOK_UNAVAILABLE);
      const result=await method.call(dayBookBridge,payload);
      if(!validDayBookEnvelope(result))
        return rpcError(503,DAY_BOOK_UNAVAILABLE);
      assertFullyResolvedRpcValue(result);
      return Response.json(result,{headers:{
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
      }});
    }catch{
      // SQL, underlying exceptions and raw credential material never leak.
      return rpcError(503,DAY_BOOK_UNAVAILABLE);
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
