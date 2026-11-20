/**
 * Option A — private service-bound provisioning entry point.
 *
 * NOT a public Admin/Owner route. Production must deploy with workers_dev=false,
 * preview_urls=false, no route/custom domain, one narrow Cloudflare D1 API
 * token as a Worker secret and an internal shared key in both Workers.
 * Only the Admin Worker may call this through a Cloudflare service binding.
 *
 * This milestone reserves an immutable Shop and creates its D1 (no Ready).
 * Migration, Worker release publication and Owner routing are separate gates.
 */
import {createCloudflareD1Provider} from './provisioning/cloudflare-d1-provider.js';
import {reserveHostedShop,advanceHostedShopCreate,readHostedShopCreate}
  from './provisioning/hosted-shop-create.js';
import {validatePlatformSuperAdminSession}
  from './auth/platform-superadmin-session.js';

const ORIGIN='https://provisioner.internal';
const ACCOUNT=/^[a-f0-9]{32}$/;
const INTERNAL_KEY=/^[A-Za-z0-9_-]{64}$/;
const ROUTES=Object.freeze({
  '/internal/shops/reserve':['operationId','displayName','ownerEmail'],
  '/internal/shops/advance':['operationId'],
  '/internal/shops/status':['operationId'],
});
const deny=(status,error='Provisioning unavailable')=>Response.json(
  {error},{status,headers:{'Cache-Control':'no-store'}}
);

// For an exact-length shared secret, accumulate differences instead of
// exposing early byte mismatches; it is never stored in D1 or sent to UI.
function sameSecret(a,b){
  if(typeof a!=='string'||typeof b!=='string'||
    a.length!==b.length||!INTERNAL_KEY.test(b))return false;
  let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
const validPayload=(payload,keys)=>payload&&typeof payload==='object'&&
  !Array.isArray(payload)&&Object.keys(payload).length===keys.length&&
  keys.every(key=>Object.hasOwn(payload,key)&&typeof payload[key]==='string');

export function createPrivateShopProvisioner({
  providerFactory=({accountId,apiToken,maxDatabases})=>
    createCloudflareD1Provider({accountId,apiToken,maxDatabases})
}={}){
  if(typeof providerFactory!=='function')throw Error('PROVISIONER_UNAVAILABLE');

  return {
    async fetch(request,env){
      let url;
      try{url=new URL(request.url);}
      catch{return deny(404);}
      if(url.origin!==ORIGIN||url.search||request.method!=='POST'||
        !Object.hasOwn(ROUTES,url.pathname))return deny(404);
      if(env?.PROVISIONER_RELEASE_ENABLED!=='true'||!env.CONTROL_DB?.prepare||
        !ACCOUNT.test(env.PROVISIONER_ALLOWED_ACCOUNT_ID)||
        !INTERNAL_KEY.test(env.PROVISIONER_INTERNAL_KEY))return deny(404);
      if(request.headers.has('Origin')||request.headers.has('Cookie'))
        return deny(403);
      if(!sameSecret(request.headers.get('x-provisioner-key'),
        env.PROVISIONER_INTERNAL_KEY))return deny(403);
      if(request.headers.get('content-type')!=='application/json')
        return deny(400,'Invalid request');
      const sessionToken=request.headers.get('x-platform-admin-session');
      // Independent Control D1 session and factor-version verification,
      // even though the request came through a private service binding.
      if(!await validatePlatformSuperAdminSession(env.CONTROL_DB,sessionToken))
        return deny(401,'Admin authentication required');
      let payload;
      try{
        const raw=await request.text();
        if(raw.length>2048)throw Error('Oversize request');
        payload=JSON.parse(raw);
      }catch{return deny(400,'Invalid request');}
      const keys=ROUTES[url.pathname];
      if(!validPayload(payload,keys))return deny(400,'Invalid request');
      try{
        let result;
        if(url.pathname==='/internal/shops/reserve'){
          result=await reserveHostedShop(env.CONTROL_DB,sessionToken,payload,{
            accountId:env.PROVISIONER_ALLOWED_ACCOUNT_ID
          });
        }else if(url.pathname==='/internal/shops/status'){
          result=await readHostedShopCreate(env.CONTROL_DB,sessionToken,
            payload.operationId);
        }else{
          const max=Number(env.PROVISIONER_MAX_DATABASES);
          if(typeof env.CLOUDFLARE_API_TOKEN!=='string'||
            !Number.isSafeInteger(max)||max<1||max>1000)
            return deny(503);
          // Never constructs provider or touches Cloudflare before MFA.
          const provider=providerFactory({
            accountId:env.PROVISIONER_ALLOWED_ACCOUNT_ID,
            apiToken:env.CLOUDFLARE_API_TOKEN,maxDatabases:max
          });
          result=await advanceHostedShopCreate(env.CONTROL_DB,sessionToken,
            payload.operationId,provider);
        }
        return Response.json(result.body??{error:'Invalid request'},{
          status:result.code,headers:{'Cache-Control':'no-store'}
        });
      }catch{return deny(503);}
    }
  };
}

export default createPrivateShopProvisioner();
