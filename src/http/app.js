import {Hono} from 'hono';
import {handleRpc} from '../rpc/handler.js';

const json=(status,value,extraHeaders={})=>Response.json(value,{
  status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extraHeaders},
});

export function createHonoApp(healthStatus){
  const app=new Hono({getPath:request=>new URL(request.url).pathname});
  app.onError(error=>{throw error;});
  app.all('/api/health',({req})=>{
    if(req.raw.method!=='GET')return json(405,{success:false,message:'GET required'},{Allow:'GET'});
    return json(200,healthStatus);
  });
  app.all('/api/rpc',({req})=>handleRpc(req.raw));
  app.on('ALL',['/api','/api/*'],()=>json(404,{success:false,message:'API route not found'}));
  app.notFound(({req,env})=>{
    if(typeof env?.ASSETS?.fetch!=='function')return json(503,{success:false,message:'Static assets binding unavailable'});
    return env.ASSETS.fetch(req.raw);
  });
  return app;
}
