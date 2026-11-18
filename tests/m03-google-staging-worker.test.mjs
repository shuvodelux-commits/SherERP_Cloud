import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {SmartRouter} from 'hono/router/smart-router';
import worker from '../src/m03-google-auth-staging-worker.js';
import publicWorker from '../src/index.js';

const config=JSON.parse(readFileSync(new URL('../wrangler.m03-google-auth-staging.jsonc',import.meta.url)));
const origin='https://shererp-cloud-google-staging-candidate.agnishuvo.workers.dev';
const request=(base=origin)=>new Request(base+'/api/auth/google/challenge',{
  method:'POST',headers:{Origin:base},
});

test('Google staging is unrouted and its credentials and schema stay outside public preview',async()=>{
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.vars.GOOGLE_CLIENT_ID,undefined);
  assert.equal(config.d1_databases.length,1);
  assert.equal(config.d1_databases[0].database_name,'shererp-staging-db');
  assert.equal(config.d1_databases[0].migrations_dir,'staging-migrations/google-auth');
  assert.equal((await publicWorker.fetch(request(),{})).status,404);
});

test('the staging Worker denies unknown hosts and incomplete setup before D1',async()=>{
  const db={
    prepare(){assert.fail('D1 must not receive an unconfigured or wrong-host request');},
    batch(){assert.fail('D1 must not receive an unconfigured or wrong-host request');},
  };
  const env={DB:db,...config.vars};
  assert.equal((await worker.fetch(request(),env)).status,503);
  assert.equal((await worker.fetch(request('https://another.example'),{
    ...env,GOOGLE_CLIENT_ID:'123456-fixture.apps.googleusercontent.com',
  })).status,403);
});

test('warm Google requests reuse the router and keep D1 and client configuration request-scoped',async t=>{
  const database=()=>({
    writes:0,
    prepare(){return {bind(){return {};}};},
    async batch(){
      this.writes++;
      return [{success:true},{success:true,meta:{changes:1}}];
    },
  });
  const first={...config.vars,DB:database(),GOOGLE_CLIENT_ID:'123456-first.apps.googleusercontent.com'};
  const second={...config.vars,DB:database(),GOOGLE_CLIENT_ID:'123456-second.apps.googleusercontent.com',
    M03_GOOGLE_AUTH_ORIGIN:'https://other-staging.example'};
  const firstResponse=await worker.fetch(request(),first);
  assert.equal(firstResponse.status,200);
  assert.equal((await firstResponse.json()).data.clientId,first.GOOGLE_CLIENT_ID);
  const routes=t.mock.method(SmartRouter.prototype,'add');
  const secondResponse=await worker.fetch(request(second.M03_GOOGLE_AUTH_ORIGIN),second);
  assert.equal(secondResponse.status,200);
  assert.equal((await secondResponse.json()).data.clientId,second.GOOGLE_CLIENT_ID);
  assert.equal(first.DB.writes,1);
  assert.equal(second.DB.writes,1);
  assert.equal(routes.mock.callCount(),0,'warm requests must not register Hono routes again');
});
