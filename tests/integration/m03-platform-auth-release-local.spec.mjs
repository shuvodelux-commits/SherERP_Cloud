import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import publicWorker from '../../src/index.js';

test('private platform assets and isolated Control D1 migrations run together in local Workerd',async()=>{
  const configPath='./wrangler.m03-platform-auth-local-test.jsonc';
  const config=JSON.parse(await readFile(configPath,'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.assets.run_worker_first,true);
  assert.equal(config.d1_databases.length,1);
  assert.equal(config.d1_databases[0].remote,false);
  assert.equal(config.d1_databases[0].migrations_dir,'staging-migrations/platform-auth');
  const harness=createTestHarness({workers:[{configPath}]});
  try{
    await harness.listen();
    const worker=harness.getWorker(config.name);
    await worker.applyD1Migrations('CONTROL_DB');
    const {CONTROL_DB:db}=await worker.getEnv();
    const {results}=await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all();
    assert.deepEqual(results.map(row=>row.name),['0001_platform_bootstrap.sql','0002_platform_sessions.sql']);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_first_superadmin').first()).n,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM platform_admin_sessions').first()).n,0);

    const origin=config.vars.PLATFORM_AUTH_ORIGIN;
    const page=await worker.fetch(origin+'/');
    assert.equal(page.status,200);
    assert.match(await page.text(),/Platform sign-in/);
    assert.match(page.headers.get('Content-Security-Policy'),/script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
    assert.equal(page.headers.get('Cache-Control'),'no-store');
    assert.equal(page.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
    const script=await worker.fetch(origin+'/platform-auth.js');
    assert.match(script.headers.get('Content-Type'),/javascript/);
    assert.equal((await worker.fetch(origin+'/api/platform/auth/session')).status,401);
    assert.equal((await worker.fetch(origin+'/index.html')).status,404);
    assert.equal((await worker.fetch('https://another.example.test/')).status,403);
    assert.equal((await publicWorker.fetch(new Request(origin+'/platform-auth.js'),{})).status,404);
  }finally{
    await harness.close();
  }
});
