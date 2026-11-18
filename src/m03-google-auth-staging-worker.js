import {createStagingGoogleLoginApp} from './auth/staging-google-login.js';
import passwordStagingWorker from './m03-auth-staging-worker.js';
import {rpcRegistry} from './rpc/registry.js';

const STAGING_DB='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const CLIENT_ID=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const response=(status,message)=>Response.json({success:false,message},{
  status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
});
const unavailable=()=>response(503,'Staging Google sign-in is unavailable');

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.origin!==env?.M03_GOOGLE_AUTH_ORIGIN)
      return response(403,'Staging origin forbidden');
    if(env.M03_GOOGLE_AUTH_SCOPE!=='reviewed-google-staging-auth-only' ||
       env.M03_AUTH_D1_UUID!==STAGING_DB ||
       typeof env.DB?.prepare!=='function' || typeof env.DB?.batch!=='function' ||
       Reflect.ownKeys(rpcRegistry).length!==0)return unavailable();

    const path=url.pathname;
    if(path==='/api/auth/google' || path.startsWith('/api/auth/google/')){
      if(typeof env.GOOGLE_CLIENT_ID!=='string' || !CLIENT_ID.test(env.GOOGLE_CLIENT_ID))
        return unavailable();
      const app=createStagingGoogleLoginApp({
        db:env.DB,origin:env.M03_GOOGLE_AUTH_ORIGIN,clientId:env.GOOGLE_CLIENT_ID,
      });
      return app.fetch(request,env,ctx);
    }
    return passwordStagingWorker.fetch(request,env,ctx);
  },
};
