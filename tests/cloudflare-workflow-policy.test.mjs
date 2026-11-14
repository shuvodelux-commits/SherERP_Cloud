import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/cloudflare-preview.yml', import.meta.url), 'utf8');

test('PR job is test-only and never receives Cloudflare secrets', () => {
  const validate = workflow.split('  validate:')[1].split('  deploy-preview:')[0];
  assert.match(validate, /npx --yes wrangler@4\.161\.0 deploy --dry-run --config wrangler\.preview\.jsonc/);
  assert.doesNotMatch(validate, /secrets\.|environment: cloudflare-preview|wrangler-action/);
});

test('deploy job requires a manual main-branch confirmation and preview environment', () => {
  const deploy = workflow.split('  deploy-preview:')[1];
  assert.match(deploy, /github\.event_name == 'workflow_dispatch'/);
  assert.match(deploy, /github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /inputs\.confirmation == 'DEPLOY_PREVIEW_ONLY'/);
  assert.match(deploy, /environment: cloudflare-preview/);
  assert.match(deploy, /command: deploy --config wrangler\.preview\.jsonc/);
  assert.doesNotMatch(deploy, /command: deploy --config wrangler\.jsonc/);
});

test('no automatic production deployment or D1 migration is enabled', () => {
  assert.doesNotMatch(workflow, /^  push:/m);
  assert.doesNotMatch(workflow, /migrations apply|d1 databases create|database_id:/i);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
});
