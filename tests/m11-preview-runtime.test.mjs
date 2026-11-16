import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {probeM11PreviewRuntime} from '../scripts/check-m11-preview-runtime.mjs';

const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
const goodConfig=()=>structuredClone(preview);
const probe=(entry=worker,config=goodConfig())=>
  probeM11PreviewRuntime({worker:entry,previewConfig:config});

test('actual preview Worker is inert across synthetic health, business-RPC and API probes',async()=>{
  const r=await probe();
  assert.equal(r.previewRuntimeInert,true);
  assert.equal(r.authorizesProduction,false);
  assert.ok(r.checkedRequests>=10);
});

test('health cannot accidentally claim a connected production database',async()=>{
  const fake={fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/health'){
      return Response.json({status:'ready',service:'shererp-cloud',database:'connected'},{
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
      });
    }
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_HEALTH_INVALID/);
});

test('a POST sale RPC returning success fails the preview probe',async()=>{
  const fake={fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/rpc'&&req.method==='POST'){
      const body=await req.clone().json();
      if(body.fnName==='saveSale')return Response.json({success:true,data:{saleId:'synthetic'}},{
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
      });
    }
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_RPC_UNSAFE/);
});

test('public login success is prohibited before the private auth release gate',async()=>{
  const fake={fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/rpc'&&req.method==='POST'){
      const body=await req.clone().json();
      if(body.fnName==='login')return Response.json({success:true,data:{token:'fake'}},{
        headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
      });
    }
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_RPC_UNSAFE/);
});

test('even swallowed attempts to read an unbound D1 property are detected',async()=>{
  const fake={fetch:async(req,env)=>{
    try {void env.DB;} catch {}
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_ENV_ACCESS/);
});

test('other unexpected environment property access is detected, not just DB',async()=>{
  const fake={fetch:async(req,env)=>{
    void env.SECRET_KEY;
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_ENV_ACCESS/);
});

test('health requires no-store and nosniff headers',async()=>{
  const fake={fetch:async(req,env)=>{
    const res=await worker.fetch(req,env);
    if(new URL(req.url).pathname==='/api/health'){
      return Response.json(await res.json());
    }
    return res;
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_HEALTH_INVALID/);
});

test('unexpected successful unknown API route is blocked',async()=>{
  const fake={fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/unknown'){
      return Response.json({success:true});
    }
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_API_UNSAFE/);
});

test('public preview Wrangler D1 binding is always rejected before probing',async()=>{
  const config=goodConfig();
  config.d1_databases=[{binding:'DB',database_name:'test',database_id:'00000000-0000-4000-8000-000000000000'}];
  await assert.rejects(probe(worker,config),/M11_PREVIEW_CONFIG_INVALID/);
});

test('nonempty preview resource configuration is rejected',async()=>{
  const config=goodConfig();
  config.previews={vars:{DANGEROUS:'yes'}};
  await assert.rejects(probe(worker,config),/M11_PREVIEW_CONFIG_INVALID/);
});

test('malformed request response cannot return an RPC success body',async()=>{
  const fake={fetch:async(req,env)=>{
    if(new URL(req.url).pathname==='/api/rpc'&&req.method==='POST'){
      const clone=req.clone();
      if((await clone.text())==='{malformed')return Response.json({success:true});
    }
    return worker.fetch(req,env);
  }};
  await assert.rejects(probe(fake),/M11_PREVIEW_RPC_UNSAFE/);
});

test('missing Worker module and malformed config fail closed',async()=>{
  await assert.rejects(probe(null),/M11_PREVIEW_WORKER_INVALID/);
  await assert.rejects(probe(worker,{}),/M11_PREVIEW_CONFIG_INVALID/);
});
