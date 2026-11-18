import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../',import.meta.url);
const read = p => readFileSync(new URL(p,root),'utf8');

test('dedicated Worker-runtime test configuration cannot target remote or public resources',()=>{
  const cfg=JSON.parse(read('wrangler.m03-test.jsonc'));
  assert.equal(cfg.name,'shererp-m03-workerd-test');
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.main,'tests/fixtures/m03-readonly-worker.mjs');
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.assets,undefined);
  assert.equal(cfg.previews,undefined);
  assert.equal(cfg.d1_databases.length,1);
  assert.deepEqual(cfg.d1_databases[0],{
    binding:'DB',database_name:'shererp-m03-workerd-local',
    database_id:'00000000-0000-0000-0000-000000000001',
    migrations_dir:'migrations'
  });
});

test('runtime test workflow is PR-only, local-only, secret-free and excludes deploy',()=>{
  const yml=read('.github/workflows/m03-d1-workerd.yml');
  assert.match(yml,/^on:\n  pull_request:/m);
  assert.doesNotMatch(yml,/workflow_dispatch:|^  push:/m);
  assert.doesNotMatch(yml,/secrets\.|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|--remote\b|wrangler deploy|--config wrangler\.staging\.jsonc/i);
  assert.match(yml,/npm install --no-save --package-lock=false wrangler@4\.161\.0/);
  const legacySingleRunner=/node --test tests\/integration\/m03-workerd\.spec\.mjs/.test(yml);
  if(!legacySingleRunner){
    // The alternative is accepted ONLY when all old M03 files are enumerated
    // once and each local-D1 shard plus full source policy must pass.
    assert.match(yml,/node --test --test-concurrency=1 \$\{\{ matrix\.specs \}\}/);
    assert.match(yml,/workerd-shards:/);
    assert.equal((yml.match(/- group: shard-[1-6]/g)||[]).length,6);
    assert.match(yml,/needs: \[verify-repo, workerd-shards\]/);
    assert.match(yml,/if: always\(\)/);
    assert.match(yml,/needs\.verify-repo\.result/);
    assert.match(yml,/needs\.workerd-shards\.result/);
    assert.match(yml,/npm test/);
    assert.match(yml,/name: Test read-only adapters against local workerd and D1/);
    const coverage=read('tests/m03-workerd-ci-sharding.test.mjs');
    assert.match(coverage,/listed\.sort\(\),expected/);
    assert.match(coverage,/the matrix must enumerate the complete existing M03 suite/);
    assert.match(read('tests/integration/m03-workerd.spec.mjs'),/import '\.\/m03-workerd-core\.spec\.mjs'/);
  }
  assert.equal(read('tests/integration/m03-workerd.spec.mjs').includes("import './m03-catalog-append-workerd.spec.mjs'"),true);
});

test('production and PR-preview config retain their original DB-free status',()=>{
  const cfg=JSON.parse(read('wrangler.preview.jsonc'));
  assert.equal(cfg.name,'shererp-cloud-preview');
  assert.equal(cfg.d1_databases,undefined);
  assert.deepEqual(cfg.previews,{});
  assert.match(read('src/index.js'),/database:'not-connected'/);
  assert.doesNotMatch(read('src/index.js')+read('src/http/app.js'),
    /m03-readonly-worker|createCatalogReader|resolveLegacyPartyId/);
});

test('separate catalog write fixture is local-only and isolated from deployed Worker',()=>{
  const cfg=JSON.parse(read('wrangler.m03-write-test.jsonc'));
  assert.equal(cfg.name,'shererp-m03-write-workerd-test');
  assert.equal(cfg.main,'tests/fixtures/m03-write-worker.mjs');
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.assets,undefined);
  assert.equal(cfg.previews,undefined);
  assert.deepEqual(cfg.d1_databases,[{
    binding:'DB',database_name:'shererp-m03-write-workerd-local',
    database_id:'00000000-0000-0000-0000-000000000002',
    migrations_dir:'migrations'
  }]);
  const live=read('src/index.js')+read('src/http/app.js')+read('src/rpc/registry.js')+read('wrangler.preview.jsonc');
  assert.doesNotMatch(live,/m03-write-worker|legacy-catalog-append|__m03_write_test__|shererp-m03-write-workerd-test/);
});
