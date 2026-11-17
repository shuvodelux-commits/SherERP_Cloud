import {requireD1Binding} from '../db/d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {tokenFingerprint} from '../auth/d1-legacy-rpc.js';
import {buildSourceAppShellData} from './source-app-shell-reader.js';

// M04 PRIVATE one-business login shell. Navigation is presentation only.
// Unlike privileged Settings map reads, the original UI.gs shell is available
// to any current authenticated source user, including a Cashier without
// settings.view. Every protected module RPC needs its own authorization.
const TOKEN=/^[0-9a-f]{64}$/;
const SAFE_KEYS=new Set(['Shop Name','Currency Symbol']);
const DEFAULT_APP_NAME='Hardware Store ERP';
const SQL_READ=[
  'WITH authorized AS (',
  'SELECT 1 AS allowed FROM auth_sessions AS s',
  'JOIN auth_users AS u ON u.user_id=s.user_id',
  'LEFT JOIN auth_roles AS r ON r.role_name=u.role_name',
  'WHERE s.token_hash=?',
  'AND s.revoked_at_ms IS NULL',
  'AND s.created_at_ms<=? AND s.expires_at_ms>?',
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?',
  "AND u.status='Active' AND u.credential_state='Modern'",
  'AND u.auth_version=s.user_auth_version',
  'AND u.credential_version=s.credential_version',
  'AND ((u.role_name=\'Administrator\' AND s.role_auth_version IS NULL)',
  'OR (u.role_name<>\'Administrator\' AND r.status=\'Active\'',
  'AND r.auth_version=s.role_auth_version))',
  'LIMIT 1)',
  'SELECT v.key,v.value FROM authorized AS a',
  "LEFT JOIN settings AS v ON v.key IN ('Shop Name','Currency Symbol')",
  'ORDER BY v.row_id ASC LIMIT 3'
].join(' ');

const denied=()=>new Error('Authenticated app shell unavailable or access denied');

function validRequest(req){
  if(!req||typeof req!=='object'||Array.isArray(req) ||
     (Object.getPrototypeOf(req)!==Object.prototype &&
      Object.getPrototypeOf(req)!==null))
    throw denied();
  const props=Object.getOwnPropertyDescriptors(req);
  const keys=Reflect.ownKeys(props);
  if(keys.length!==2 || keys.some(k=>typeof k!=='string'||
    (k!=='token'&&k!=='nowMs')) ||
    !['token','nowMs'].every(k=>props[k]?.enumerable===true &&
      Object.hasOwn(props[k],'value')))
    throw denied();
  const token=props.token.value,nowMs=props.nowMs.value;
  if(typeof token!=='string'||!TOKEN.test(token)||
     !Number.isSafeInteger(nowMs)||nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs))
    throw denied();
  return {token,nowMs};
}

function onlyOwnData(record){
  if(!record||typeof record!=='object'||Array.isArray(record))
    throw denied();
  const descriptors=Object.getOwnPropertyDescriptors(record);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==2 || keys.some(k=>typeof k!=='string' ||
     (k!=='key'&&k!=='value')) ||
     !['key','value'].every(k=>descriptors[k]?.enumerable===true &&
       Object.hasOwn(descriptors[k],'value')))
    throw denied();
  return {key:descriptors.key.value,value:descriptors.value.value};
}

function decode(rows){
  if(rows.length<1||rows.length>2)throw denied();
  const output=Object.create(null);
  if(rows.length===1){
    const only=onlyOwnData(rows[0]);
    if(only.key===null && only.value===null)
      return {shopName:DEFAULT_APP_NAME,currencySymbol:''};
  }
  for(const item of rows){
    const {key,value}=onlyOwnData(item);
    if(typeof key!=='string'||!SAFE_KEYS.has(key)||
       typeof value!=='string'||Object.hasOwn(output,key))
      throw denied();
    output[key]=value;
  }
  return {
    shopName:output['Shop Name']||DEFAULT_APP_NAME,
    currencySymbol:output['Currency Symbol']||''
  };
}

/** One fixed SQL read binds the current M04 session epoch and two public keys.
 * No generic Settings access, no caches or cross-statement auth preflight.
 */
export function createM04LoginShellReader(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async getAppShellData(request){
      const {token,nowMs}=validRequest(request);
      try{
        const digest=await tokenFingerprint(token);
        if(!digest)throw denied();
        const response=await DB.prepare(SQL_READ).bind(
          digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
        ).all();
        if(response?.success!==true||!Array.isArray(response.results) ||
           response.results.length>2)
          throw denied();
        return buildSourceAppShellData(decode(response.results));
      }catch{
        throw denied();
      }
    }
  });
}
