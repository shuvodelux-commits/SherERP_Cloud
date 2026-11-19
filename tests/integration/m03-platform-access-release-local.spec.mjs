import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';

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
