import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/remote-d1-staging.yml',import.meta.url),'utf8');

test('remote workflow is manual only, main only, protected environment, confirmation gated',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s+push:|^\s+pull_request:/m);
  assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/cloudflare-staging-db/);
  assert.match(workflow,/APPLY_STAGING_D1_SCHEMA_ONLY/);
});

test('remote migration is never an automatic deploy, restore, or production migration',()=>{
  assert.match(workflow,/d1 migrations apply shererp-staging-db --remote --config wrangler\.staging\.jsonc/);
  assert.match(workflow,/d1 time-travel info shererp-staging-db/);
  assert.doesNotMatch(workflow,/d1 time-travel restore|wrangler\.jsonc(?:\s|$)/);
  assert.doesNotMatch(workflow,/\bwrangler(?:@\S+)? deploy\b/);
  assert.match(workflow,/d1 list --json/);
  assert.match(workflow,/assert-empty/);
  assert.match(workflow,/verify-schema/);
});
