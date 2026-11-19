import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {buildOwnerFrontend} from '../../scripts/build-owner-frontend.mjs';
import './m03-owner-erp-frontend-workerd.spec.mjs';
import './m03-clean-shop-product-workerd.spec.mjs';

test('bundled assets and API fail closed without native Access in local Workerd',async()=>{
  const configPath='./wrangler.m03-platform-auth-access-staging.jsonc';
  const cfg=JSON.parse(await readFile(configPath,'utf8'));
  assert.equal(cfg.d1_databases.length,1);
  assert.equal(cfg.d1_databases[0].remote,false);
  assert.equal(cfg.assets,undefined);
  assert.equal(cfg.preview_urls,false);
  const harness=createTestHarness({workers:[{configPath,vars:{
    PLATFORM_ACCESS_AUDIENCE:'a'.repeat(64),PLATFORM_ACCESS_EMAIL:'operator@example.test',
    PLATFORM_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  }}]});
  try{
    await harness.listen();
    const worker=harness.getWorker('admin-hisabiq');
    await worker.applyD1Migrations('CONTROL_DB');
    const {CONTROL_DB:db}=await worker.getEnv();
    const origin=cfg.vars.PLATFORM_AUTH_ORIGIN;
    for(const path of ['/','/index.html','/platform-auth.js','/platform-auth.css','/api/platform/auth/session']){
      const response=await worker.fetch(origin+path);
      assert.equal(response.status,403,path);
      assert.deepEqual(await response.json(),{error:'Access required'});
    }
    const unauthenticated=await worker.fetch(origin+'/api/platform/auth/challenge',{method:'POST',headers:{Origin:origin}});
    assert.equal(unauthenticated.status,403);
    assert.equal(unauthenticated.headers.has('Set-Cookie'),false);
    const alias=await worker.fetch('https://preview.example.test/platform-auth.js');
    assert.equal(alias.status,403);
    const challenges=await db.prepare('SELECT count(*) AS n FROM platform_login_challenges').first();
    assert.equal(challenges.n,0);
  }finally{
    await harness.close();
  }
});

test('Owner release candidate gates all assets and rejects alternate origins in Workerd',async()=>{
  await buildOwnerFrontend();
  const configPath='./wrangler.m03-owner-auth-staging.jsonc';
  const cfg=JSON.parse(await readFile(configPath,'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.preview_urls,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.vars,undefined);
  assert.equal(cfg.assets.run_worker_first,true);
  assert.ok(cfg.d1_databases.every(binding=>binding.remote===false));
  const origin='https://owner.example.test';
  const vars={OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com'};
  for(const enabled of [false,true]){
    const harness=createTestHarness({workers:[{configPath,vars:enabled?{...vars,OWNER_LOGIN_ENABLED:'true'}:vars}]});
    try{
      await harness.listen();
      const worker=harness.getWorker(cfg.name);
      for(const path of ['/','/owner-auth.js','/owner-auth.css']){
        assert.equal((await worker.fetch(origin+path)).status,enabled?200:404,path);
      }
      assert.equal((await worker.fetch(origin+'/index.html')).status,404);
      assert.equal((await worker.fetch('https://unexpected.example.test/')).status,enabled?403:404);
      if(enabled){
        const html=await (await worker.fetch(origin+'/')).text();
        assert.doesNotMatch(html,/<body data-redemption="enabled">/);
        assert.match(html,/Shop Owner sign-in/);
      }
    }finally{
      await harness.close();
    }
  }
});
