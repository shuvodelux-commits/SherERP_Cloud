import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/staging-d1-local.yml',import.meta.url),'utf8');

test('staging CI never modifies remote D1 or deploys a public Worker',()=>{
  assert.match(workflow,/pull_request:/);
  assert.doesNotMatch(workflow,/\s+push:/);
  assert.doesNotMatch(workflow,/secrets\.|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow,/--remote\b|d1\s+create|migrations\s+apply.*--remote/);
  assert.match(workflow,/migrations apply shererp-staging-db --local/);
  assert.match(workflow,/--persist-to/);
  assert.match(workflow,/deploy --dry-run --config wrangler\.staging\.jsonc/);
});
test('staging CI verifies local schema state after migrations',()=>{
  assert.match(workflow,/--command.*sqlite_master/);
  assert.match(workflow,/--json/);
  assert.match(workflow,/local-d1-schema-check\.mjs/);
});
