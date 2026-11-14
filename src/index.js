import {handleRpc} from './rpc/handler.js';

const json=(status, value, extraHeaders={}) => Response.json(value, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extraHeaders}});

export default {
  async fetch(request, env) {
    const path=new URL(request.url).pathname;
    if (path==='/api/health') {
      if (request.method!=='GET') return json(405,{success:false,message:'GET required'},{Allow:'GET'});
      return json(200,{status:'foundation',service:'shererp-cloud',database:'not-connected'});
    }
    if (path==='/api/rpc') return handleRpc(request);
    if (path==='/api' || path.startsWith('/api/')) return json(404,{success:false,message:'API route not found'});
    if (!env?.ASSETS || typeof env.ASSETS.fetch!=='function') return json(503,{success:false,message:'Static assets binding unavailable'});
    return env.ASSETS.fetch(request);
  },
};
