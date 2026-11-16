/**
 * M09 INTERNAL authorized Dashboard currency setting read.
 * The entire Dashboard is NOT migrated: product/finance/sales read models
 * and public RPC/tenant authorization remain separate gated work.
 *
 * Frozen source: Dashboard.gs::getDashboardStats currencySymbol field.
 * M04 dashboard.view and one Settings value are checked/read in ONE D1
 * SELECT. This is single-business test-schema only, never a public RPC.
 */
import {requireD1Binding} from '../db/d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

const TOKEN=/^[0-9a-f]{64}$/;
const SQL="WITH authorized AS (\n  SELECT 1 AS allowed\n  FROM auth_sessions AS s\n  JOIN auth_users AS u ON u.user_id=s.user_id\n  LEFT JOIN auth_roles AS r ON r.role_name=u.role_name\n  WHERE s.token_hash=?\n    AND s.revoked_at_ms IS NULL\n    AND s.created_at_ms<=? AND s.expires_at_ms>?\n    AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?\n    AND u.status='Active' AND u.credential_state='Modern'\n    AND u.auth_version=s.user_auth_version\n    AND u.credential_version=s.credential_version\n    AND (\n      (u.role_name='Administrator' AND s.role_auth_version IS NULL)\n      OR (\n        u.role_name<>'Administrator' AND r.status='Active'\n        AND r.auth_version=s.role_auth_version\n        AND length(r.permissions_json)<=65536\n        AND CASE WHEN json_valid(r.permissions_json) THEN\n          json_type(r.permissions_json)='object'\n          AND json_type(r.permissions_json,'$.dashboard')='object'\n          AND json_type(r.permissions_json,'$.dashboard.view')='true'\n        ELSE 0 END\n      )\n    )\n  LIMIT 1\n)\nSELECT v.value AS currency_symbol\nFROM authorized AS a\nLEFT JOIN settings AS v ON v.key='Currency Symbol'\nLIMIT 1";

function validate(request){
  try{
    if(!request || typeof request!=='object' || Array.isArray(request) ||
       (Object.getPrototypeOf(request)!==Object.prototype &&
        Object.getPrototypeOf(request)!==null))
      throw new TypeError('Invalid Dashboard currency request');
    const keys=Reflect.ownKeys(request);
    if(keys.length!==2 || keys.some(k=>k!=='token' && k!=='nowMs'))
      throw new TypeError('Invalid Dashboard currency request fields');
    const tokenField=Object.getOwnPropertyDescriptor(request,'token');
    const nowField=Object.getOwnPropertyDescriptor(request,'nowMs');
    if(!tokenField?.enumerable || !nowField?.enumerable ||
       !Object.hasOwn(tokenField,'value') || !Object.hasOwn(nowField,'value'))
      throw new TypeError('Invalid Dashboard currency request descriptor');
    const token=tokenField.value,nowMs=nowField.value;
    if(typeof token!=='string' || !TOKEN.test(token) ||
       !Number.isSafeInteger(nowMs) || nowMs<0 ||
       !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs))
      throw new TypeError('Invalid Dashboard currency bearer or clock');
    return {token,nowMs};
  }catch{
    throw new TypeError('Invalid Dashboard currency request');
  }
}

async function digestBearer(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('NEEDS_REVIEW: Web Crypto unavailable');
  const bytes=new Uint8Array(32);
  for(let i=0;i<bytes.length;i++)
    bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
  const hashed=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hashed,b=>b.toString(16).padStart(2,'0')).join('');
}

function currencyValue(response){
  if(response?.success!==true || !Array.isArray(response.results) ||
     response.results.length>1)
    throw new Error('NEEDS_REVIEW: invalid authorized Dashboard read');
  if(response.results.length===0)
    throw new Error('Denied: Dashboard view permission unavailable');
  const row=response.results[0];
  if(!row || typeof row!=='object' || Array.isArray(row) ||
     Reflect.ownKeys(row).length!==1)
    throw new Error('NEEDS_REVIEW: malformed Dashboard currency row');
  const descriptor=Object.getOwnPropertyDescriptor(row,'currency_symbol');
  if(!descriptor || !Object.hasOwn(descriptor,'value') ||
     (descriptor.value!==null && typeof descriptor.value!=='string'))
    throw new Error('NEEDS_REVIEW: malformed Dashboard currency value');
  // Original Dashboard.gs uses Settings Currency Symbol or empty string.
  return descriptor.value||'';
}

export function createM09AuthorizedDashboardCurrencyReader(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getCurrencySymbol(request){
      const {token,nowMs}=validate(request);
      const digest=await digestBearer(token);
      let result;
      try{
        result=await DB.prepare(SQL).bind(
          digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
        ).all();
      }catch(cause){
        throw new Error('NEEDS_REVIEW: Dashboard authorization read unavailable',{cause});
      }
      return currencyValue(result);
    }
  });
}
