/**
 * M04 private-only staff login smoke on Workerd/D1.
 *
 * NEVER import this into src/index.js or the public RPC registry.
 * This is an owner-operated localhost harness, not a deployable sign-in API.
 * The public Worker intentionally remains without D1/auth bindings.
 */
import {handleRpc} from '../rpc/handler.js';
import {rpcRegistry} from '../rpc/registry.js';
import {createD1LegacyAuthRpc} from './d1-legacy-rpc.js';
import {normalizeLegacyStaffPhoneSearch} from './staff-phone-identity.js';

const STAGING_ID='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const TEST_ID='00000000-0000-0000-0000-000000000022';
const PATH='/_private/m04/auth-rpc';

const deny=()=>new Response('',{
 status:404,headers:{'Cache-Control':'no-store'},
});

function sameSecret(value,expected){
 if(typeof value!=='string'||typeof expected!=='string'||
    expected.length<40||expected.length>256||value.length>256)return false;
 let delta=value.length^expected.length;
 for(let i=0;i<expected.length;i++)
  delta|=(value.charCodeAt(i)||0)^expected.charCodeAt(i);
 return delta===0;
}

function acceptedScope(env){
 if(!env?.DB||typeof env.DB.prepare!=='function'||
    typeof env.DB.batch!=='function')return false;
 return (env.M04_PRIVATE_AUTH_SCOPE==='synthetic-workerd-only' &&
          env.M04_D1_UUID===TEST_ID) ||
        (env.M04_PRIVATE_AUTH_SCOPE==='private-staging-smoke-only' &&
          env.M04_D1_UUID===STAGING_ID);
}

function localAuthRequest(request){
 try{
  const url=new URL(request.url);
  return request.method==='POST'&&
    url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port==='8787'&&
    url.pathname===PATH&&url.search===''&&
    request.headers.get('origin')===null&&
    request.headers.get('cookie')===null&&
    request.headers.get('content-type')==='application/json';
 }catch{return false;}
}

/**
 * Only the original, source-shaped login/validateSession/logout adapter is
 * opt-in. All other RPCs remain unavailable. No credentials are logged.
 */
export async function handlePrivateM04AuthSmoke(request,env){
 // This private harness may never inherit later public business handlers.
 // If M03 activates any registry method, stop this old operator and require
 // a fresh reviewed private auth-only adapter rather than widening its scope.
 if(Reflect.ownKeys(rpcRegistry).length!==0)return deny();
 if(!acceptedScope(env)||!localAuthRequest(request))return deny();
 if(!sameSecret(request.headers.get('x-m04-operator-key'),
                env.M04_OPERATOR_TOKEN))return deny();
 try{
  const authAdapter=createD1LegacyAuthRpc(env.DB,{
   normalizeMobile:normalizeLegacyStaffPhoneSearch,
  });
  return await handleRpc(request,{authAdapter});
 }catch{return Response.json(
  {success:false,message:'Private sign-in unavailable.'},
  {status:503,headers:{'Cache-Control':'no-store'}});
 }
}

export default {fetch:handlePrivateM04AuthSmoke};
