import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';

/**
 * Local-only M01 browser fixture. It deliberately rejects every RPC call,
 * does not impersonate an authenticated Worker or attach a D1 database.
 */
export async function serveCompiledUi() {
  const temp=await mkdtemp(join(tmpdir(),'shererp-m01-browser-'));
  let server;
  try {
    const {outputPath}=await buildFrontend({
      sourceDir:new URL('../legacy/source/',import.meta.url).pathname,
      outputDir:temp
    });
    const html=patchServerCall(await readFile(outputPath,'utf8'));
    server=createServer((request,response)=>{
      response.setHeader('Cache-Control','no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      const path=new URL(request.url,'http://localhost').pathname;
      if(path==='/api/rpc'){
        response.writeHead(501,{'Content-Type':'application/json; charset=utf-8'});
        response.end(JSON.stringify({success:false,message:'RPC method not migrated'}));
      }else if(path==='/api/health'){
        response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
        response.end(JSON.stringify({status:'foundation',service:'shererp-cloud',database:'not-connected'}));
      }else if(path==='/' || path==='/index.html'){
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        response.end(html);
      }else{
        response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
        response.end('Not Found');
      }
    });
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    const address=server.address();
    return {
      url:'http://127.0.0.1:'+address.port+'/',
      close:async()=>{
        await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
        await rm(temp,{recursive:true,force:true});
      }
    };
  }catch(error){
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    await rm(temp,{recursive:true,force:true});
    throw error;
  }
}