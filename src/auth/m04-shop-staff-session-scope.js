/**
 * M04 local-only business-scoped staff session adapter.
 * No public endpoint or Cloudflare deployment. M03 must select the trusted
 * physical Shop D1 binding before calling this module; browser Shop IDs only
 * request that *already selected* Shop and cannot select a database.
 *
 * Delegates password PBKDF2, D1 session epochs, idle/absolute expiry and
 * login-throttle semantics to the existing M04 d1-auth-core.js. Never use
 * Party role/phone as staff credentials, and never auto-link two businesses.
 */
import {normalizeLegacyStaffPhoneSearch} from './staff-phone-identity.js';
import {loginWithD1,validateSessionWithD1,revokeSessionWithD1}
  from './d1-auth-core.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const PHONE=/^01[3-9][0-9]{8}$/;
const deny=()=>({authenticated:false});
const noRevoke=()=>({revoked:false});

/** User-entered +880, 880, 01, 1 and Bangla-digit mobile spellings only. */
export function canonicalStaffLoginPhone(input){
  if(typeof input!=='string')return null;
  const s=input.trim();
  if(s.length<10||s.length>40||!/^[+()0-9০-৯\s-]+$/u.test(s))
    return null;
  const key=normalizeLegacyStaffPhoneSearch(s);
  return PHONE.test(key)?key:null;
}

/** Reject accessors, extra role/actor claims and nonplain input before D1. */
export function requestValues(value,expected){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  try{
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==null)return null;
    const desc=Object.getOwnPropertyDescriptors(value);
    const keys=Reflect.ownKeys(desc);
    if(keys.length!==expected.length || keys.some(key=>
       typeof key!=='string'||!expected.includes(key)||
       !desc[key].enumerable||!Object.hasOwn(desc[key],'value')))
      return null;
    return Object.fromEntries(expected.map(key=>[key,desc[key].value]));
  }catch{return null;}
}
function scopeValues(scope){
  try{
    if(!scope||typeof scope!=='object'||typeof scope.shopDb?.prepare!=='function'||
       ![scope.shopId,scope.databaseId,scope.databaseMarker].every(v=>typeof v==='string'&&UUID.test(v)))
      return null;
    return scope;
  }catch{return null;}
}

/**
 * Only immutable Shop D1 identity can attest the physical binding. This
 * lookup is not a browser-controlled tenant directory or a cross-Shop query.
 */
export async function trustedShop(scope,selected){
  const checked=scopeValues(scope);
  if(!checked||typeof selected!=='string'||!UUID.test(selected)||
     selected!==checked.shopId)return null;
  try{
    const row=await checked.shopDb.prepare(
      'SELECT shop_id,database_id,database_marker FROM shop_identity WHERE singleton=1'
    ).first();
    if(row?.shop_id!==checked.shopId||row?.database_id!==checked.databaseId||
       row?.database_marker!==checked.databaseMarker)return null;
    return checked;
  }catch{return null;}
}

export async function loginStaffForShop(scope,input){
  const parsed=requestValues(input,['selectedShopId','mobile','password']);
  if(!parsed)return deny();
  const phoneKey=canonicalStaffLoginPhone(parsed.mobile);
  if(!phoneKey||typeof parsed.password!=='string'||
     parsed.password.length<1||parsed.password.length>1024)return deny();
  const checked=await trustedShop(scope,parsed.selectedShopId);
  if(!checked)return deny();
  try{
    const logged=await loginWithD1(checked.shopDb,{
      phoneKey,password:parsed.password,nowMs:Date.now()
    });
    if(logged.authenticated!==true||!TOKEN.test(logged.token)||!logged.user)
      return deny();
    return {authenticated:true,shopId:checked.shopId,token:logged.token,
      user:logged.user};
  }catch{return deny();}
}

export async function validateStaffForShop(scope,input){
  const parsed=requestValues(input,['selectedShopId','token']);
  if(!parsed||typeof parsed.token!=='string'||!TOKEN.test(parsed.token))return deny();
  const checked=await trustedShop(scope,parsed.selectedShopId);
  if(!checked)return deny();
  try{
    const current=await validateSessionWithD1(checked.shopDb,{
      token:parsed.token,nowMs:Date.now()
    });
    return current.authenticated===true&&current.user?
      {authenticated:true,shopId:checked.shopId,user:current.user}:deny();
  }catch{return deny();}
}

export async function revokeStaffForShop(scope,input){
  const parsed=requestValues(input,['selectedShopId','token']);
  if(!parsed||typeof parsed.token!=='string'||!TOKEN.test(parsed.token))
    return noRevoke();
  const checked=await trustedShop(scope,parsed.selectedShopId);
  if(!checked)return noRevoke();
  try{
    return await revokeSessionWithD1(checked.shopDb,{
      token:parsed.token,nowMs:Date.now()
    });
  }catch{return noRevoke();}
}
