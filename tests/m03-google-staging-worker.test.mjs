import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
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
