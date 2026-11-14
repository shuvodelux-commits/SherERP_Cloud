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
  assert.match(yml,/node --test tests\/integration\/m03-workerd\.spec\.mjs/);
});

test('production and PR-preview config retain their original DB-free status',()=>{
  const cfg=JSON.parse(read('wrangler.preview.jsonc'));
  assert.equal(cfg.name,'shererp-cloud-preview');
  assert.equal(cfg.d1_databases,undefined);
  assert.deepEqual(cfg.previews,{});
  assert.match(read('src/index.js'),/database:'not-connected'/);
  assert.doesNotMatch(read('src/index.js'),/m03-readonly-worker|createCatalogReader|resolveLegacyPartyId/);
});
