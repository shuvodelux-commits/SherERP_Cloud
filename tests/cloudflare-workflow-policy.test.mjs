import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../.github/workflows/cloudflare-preview.yml',import.meta.url),'utf8');
const setup=readFileSync(new URL('../docs/CLOUDFLARE_GITHUB_SETUP.md',import.meta.url),'utf8');

test('GitHub PR checks have no deploy permissions or secrets',()=>{
  assert.match(workflow,/^on:\s*\n  pull_request:/m);
  assert.doesNotMatch(workflow,/workflow_dispatch:|^\s+push:/m);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/npm run verify:source/);
  assert.match(workflow,/npm run build:frontend/);
  assert.match(workflow,/wrangler@4\.161\.0 deploy --dry-run --config wrangler\.preview\.jsonc/);
  assert.doesNotMatch(workflow,/secrets\.|CLOUDFLARE_API_TOKEN|environment: cloudflare-preview|wrangler-action|deploy-preview:/i);
});

test('only Cloudflare Workers Builds may publish this Worker',()=>{
  assert.doesNotMatch(workflow,/cloudflare\/wrangler-action|deployment-url|command:\s*deploy\b/);
  assert.doesNotMatch(workflow,/migrations apply|--remote|d1 databases create/);
  assert.match(setup,/Enable Preview Builds/);
  assert.match(setup,/wrangler@4\.161\.0 preview --config wrangler\.preview\.jsonc/);
  assert.match(setup,/wrangler@4\.161\.0 deploy --config wrangler\.preview\.jsonc/);
});

test('main auto-deploy is not confused with a production-ready ERP',()=>{
  assert.match(setup,/main/);
  assert.match(setup,/shererp-cloud-preview/);
  assert.match(setup,/not.*production-ready|not.*production ERP/i);
});
