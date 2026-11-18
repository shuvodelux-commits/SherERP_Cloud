/**
 * M03 integration: an isolated, auth-only *staging candidate*, NOT the public
 * ERP Worker. Deployment/route attachment requires separate M11 approval.
 *
 * Never expose arbitrary business RPCs or trust UI-supplied actor, role, clock,
 * normalized phone or permissions. Preserve public src/index.js fail-closed.
 */
import publicWorker from './index.js';
import {handleRpc} from './rpc/handler.js';
import {createM04AppShellRpcBridge} from './rpc/internal-m04-shell-bridge.js';
import {rpcRegistry} from './rpc/registry.js';
import {createD1LegacyAuthRpc} from './auth/d1-legacy-rpc.js';
import {normalizeLegacyStaffPhoneSearch} from './auth/staff-phone-identity.js';

const STAGING_D1='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const SYNTHETIC_D1='00000000-0000-0000-0000-000000000022';
const error=()=>Response.json({
 success:false,message:'Sign-in is unavailable because server authentication is not configured yet.'
},{status:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

function stagingAuthOnly(env){
 if(!env || typeof env!=='object' ||
    typeof env.DB?.prepare!=='function' ||
    typeof env.DB?.batch!=='function')return false;
 return (env.M03_AUTH_SCOPE==='reviewed-staging-auth-only' &&
         env.M03_AUTH_D1_UUID===STAGING_D1) ||
        (env.M03_AUTH_SCOPE==='synthetic-workerd-only' &&
         env.M03_AUTH_D1_UUID===SYNTHETIC_D1);
}

export default {
 async fetch(request,env,ctx){
  const pathname=new URL(request.url).pathname;
  if(pathname==='/api/rpc'){
   // If shared M03 adds business methods, this old auth-only candidate
   // must stop rather than inherit a broader RPC surface.
   if(Reflect.ownKeys(rpcRegistry).length!==0 || !stagingAuthOnly(env))
    return error();
   try{
    const authAdapter=createD1LegacyAuthRpc(env.DB,{
     normalizeMobile:normalizeLegacyStaffPhoneSearch,
    });
    const appShellBridge=createM04AppShellRpcBridge(env);
    // Auth/session and bearer-protected source app-shell ONLY. All other
    // business RPCs remain 501 because the public registry stays empty.
    return await handleRpc(request,{authAdapter,appShellBridge});
   }catch{
    return error();
   }
  }
  if(pathname==='/api/health'&&stagingAuthOnly(env)){
   return Response.json({
    status:'auth-staging',service:'shererp-cloud',database:'auth-only'
   },{status:200,headers:{'Cache-Control':'no-store'}});
  }
  return publicWorker.fetch(request,env,ctx);
 }
};
