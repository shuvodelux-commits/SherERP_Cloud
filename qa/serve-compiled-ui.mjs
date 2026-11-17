import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import {patchPosV2HiddenVisibility} from '../scripts/patch-posv2-visibility.mjs';
import {patchM01Accessibility} from '../scripts/patch-m01-a11y.mjs';
import worker from '../src/index.js';
import {handleRpc} from '../src/rpc/handler.js';

/**
 * Local-only M01 browser fixture. By default all API calls use the actual
 * inert public Worker. Only explicitly supplied test callbacks opt this
 * loopback server into the existing reviewed M03 Day Book or M04 auth HTTP
 * handlers and isolated D1. The deployed Worker never imports this fixture.
 */
export async function serveCompiledUi({internalDayBookRpc,internalAuthAdapter}={}) {
  const temp=await mkdtemp(join(tmpdir(),'shererp-m01-browser-'));
  let server;
  try {
    const {outputPath}=await buildFrontend({
      sourceDir:new URL('../legacy/source/',import.meta.url).pathname,
      outputDir:temp
    });
    const html=patchM01Accessibility(patchPosV2HiddenVisibility(
      patchServerCall(await readFile(outputPath,'utf8'))));
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
          // The opt-in test route must use exactly the reviewed HTTP
          // protections: Origin, MIME, size, allowlist and payload validation.
          // No deployable Worker or public RPC registry imports this callback.
          const rpcRequest=new Request(url,init);
          const hasDayBook=typeof internalDayBookRpc==='function';
          const hasAuth=internalAuthAdapter!==undefined;
          // Both options are trusted, test-provided dependencies only.
          // The request body cannot activate either one.
          const localOptions={};
          if(hasDayBook)localOptions.dayBookBridge={invoke:internalDayBookRpc};
          if(hasAuth)localOptions.authAdapter=internalAuthAdapter;
          const result=path==='/api/rpc' && (hasDayBook||hasAuth)
            ? await handleRpc(rpcRequest,localOptions)
            : await worker.fetch(rpcRequest,{});
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
