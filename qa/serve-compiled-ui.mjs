import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import worker from '../src/index.js';

/**
 * Local-only M01 browser fixture. All API requests use the actual inert
 * public Worker router; no D1 binding or trusted authentication adapter exists.
 */
export async function serveCompiledUi({internalDayBookRpc}={}) {
  const temp=await mkdtemp(join(tmpdir(),'shererp-m01-browser-'));
  let server;
  try {
    const {outputPath}=await buildFrontend({
      sourceDir:new URL('../legacy/source/',import.meta.url).pathname,
      outputDir:temp
    });
    const html=patchServerCall(await readFile(outputPath,'utf8'));
    server=createServer((request,response)=>{
      void (async()=>{
        response.setHeader('Cache-Control','no-store');
        response.setHeader('X-Content-Type-Options','nosniff');
        const path=new URL(request.url,'http://localhost').pathname;
        if(path==='/api' || path.startsWith('/api/')){
          const chunks=[];
          for await(const chunk of request)chunks.push(chunk);
          const body=Buffer.concat(chunks);
          const url=new URL(request.url,'http://127.0.0.1:'+server.address().port);
          const init={method:request.method,headers:request.headers};
          if(request.method!=='GET' && request.method!=='HEAD' && body.length) init.body=body;
          // Opt-in QA-only bridge for one reviewed internal Day Book read.
          // No runtime Worker, public registry or deployment path imports it.
          let result;
          if(path==='/api/rpc' && request.method==='POST' &&
             typeof internalDayBookRpc==='function'){
            let payload;
            try{payload=JSON.parse(body.toString('utf8'));}catch{payload=null;}
            if(payload?.fnName==='getDayBookBootstrap'){
              const envelope=await internalDayBookRpc(payload);
              result=Response.json(envelope,{
                status:envelope.success===true?200:403,
                headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
              });
            }
          }
          if(!result)result=await worker.fetch(new Request(url,init),{});
          response.writeHead(result.status,Object.fromEntries(result.headers));
          response.end(Buffer.from(await result.arrayBuffer()));
        }else if(path==='/' || path==='/index.html'){
          response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
          response.end(html);
        }else{
          response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});
          response.end('Not Found');
        }
      })().catch(()=>{
        if(!response.headersSent)response.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
        response.end('Internal fixture error');
      });
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
