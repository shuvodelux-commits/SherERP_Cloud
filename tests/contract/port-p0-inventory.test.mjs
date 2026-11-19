/**
 * PORT-00 P0: read-only repository-wide instance configuration inventory.
 * No secret values, customer records, remote APIs, provisioning or D1 writes.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {
  selectTrackedPortabilityPaths,
  scanInstanceConfigurationSources,
  verifyPublicPreviewIsUnbound,
  collectTrackedPortabilitySources,
} from '../../scripts/port-p0-inventory.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));

test('selects all tracked deploy profiles, runtime source, workflows and operator docs, not legacy or test artifacts',()=>{
  const paths=[
    'tests/integration/m03-auth.spec.mjs',
    'docs/installation/START_HERE.md',
    'wrangler.preview.jsonc',
    'legacy/source/Config.gs',
    '.github/workflows/cloudflare-preview.yml',
    'src/auth/platform-shop-binding.js',
    'docs/runbooks/M03_PLATFORM_AUTH_STAGING.md',
    'scripts/create-cloudflare-instance.mjs',
    'frontend/platform-auth/platform-auth.js',
    'src/index.js',
    'dist/index.html',
    'wrangler.m03-platform-auth-access-staging.jsonc',
  ];
  assert.deepEqual(selectTrackedPortabilityPaths(paths),[
    '.github/workflows/cloudflare-preview.yml',
    'docs/installation/START_HERE.md',
    'docs/runbooks/M03_PLATFORM_AUTH_STAGING.md',
    'frontend/platform-auth/platform-auth.js',
    'scripts/create-cloudflare-instance.mjs',
    'src/auth/platform-shop-binding.js',
    'src/index.js',
    'wrangler.m03-platform-auth-access-staging.jsonc',
    'wrangler.preview.jsonc',
  ]);
});

test('detects instance resources, fixed worker hosts and credential KEY names without exposing their VALUES',()=>{
  const fakeAccount='abcd'.repeat(8);
  const fakeDatabase='11111111-2222-3333-4444-555555555555';
  const fakeHost='https://private-example.invalidname.workers.dev';
  const fakeToken='SECRET_TOKEN_VALUE_MUST_NEVER_BE_PRINTED';
  const files={
    'wrangler.m03-platform-auth-access-staging.jsonc':[
      '{','  "name": "private-example",',
      '  "account_id": "'+fakeAccount+'",',
      '  "vars": {"PLATFORM_AUTH_ORIGIN": "'+fakeHost+'"},',
      '  "d1_databases": [{"binding":"CONTROL_DB","database_id":"'+fakeDatabase+'"}],',
      '  "ratelimits": [{"namespace_id":"123456"}]',
      '}'
    ].join('\n'),
    'src/m03-access-platform-auth-worker.js':
      "const ADMIN_ORIGIN='"+fakeHost+"'; const CF_API_TOKEN='"+fakeToken+"';\n"+
      "const clientId=env.PLATFORM_CLIENT_ID; const token=env.JWT_SECRET;\n",
    '.github/workflows/cloudflare-preview.yml':
      'env:\n  CLOUDFLARE_API_TOKEN: '+fakeToken+'\n'
  };
  const report=scanInstanceConfigurationSources(files);
  assert.equal(report.formatVersion,1);
  assert.equal(report.scannedFileCount,3);
  assert.deepEqual(report.pathsScanned,Object.keys(files).sort());
  const kinds=new Set(report.findings.flatMap(f=>f.kinds));
  for(const kind of ['account_id','database_id','d1_binding','worker_name',
    'literal_worker_origin','origin_config','rate_limit_namespace',
    'oauth_client','credential_key']){
    assert.ok(kinds.has(kind),'missing '+kind);
  }
  for(const finding of report.findings){
    assert.ok(Object.hasOwn(files,finding.path));
    assert.ok(Number.isSafeInteger(finding.line)&&finding.line>=1);
    assert.deepEqual(finding.kinds,[...new Set(finding.kinds)].sort());
    assert.deepEqual(Object.keys(finding).sort(),['kinds','line','path']);
  }
  const output=JSON.stringify(report);
  for(const sensitive of [fakeAccount,fakeDatabase,fakeHost,fakeToken,
    'private-example', '123456']){
    assert.equal(output.includes(sensitive),false,'Leaked a source VALUE');
  }
  assert.deepEqual(report,scanInstanceConfigurationSources(Object.fromEntries(Object.entries(files).reverse())),
    'deterministic report regardless of read order');
});

test('public preview refuses a D1 binding or unsafe nested preview binding',()=>{
  const safe='{"name":"hisabiq","previews":{},"assets":{"directory":"./dist"}}';
  assert.doesNotThrow(()=>verifyPublicPreviewIsUnbound(safe));
  for(const unsafe of [
    '{"d1_databases":[{"binding":"DB"}],"previews":{}}',
    '{"previews":{"d1_databases":[{"binding":"DB"}]}}',
    '{"vars":{"PLATFORM_PILOT_DB":"injected"},"previews":{}}',
    '{"previews":{"vars":{"JWT_SECRET":"injected"}}}',
  ]){
    assert.throws(()=>verifyPublicPreviewIsUnbound(unsafe),/Preview isolation violation/);
  }
});

test('actual tracked repository inventory covers the current P0 hotspots and never emits their values',async()=>{
  const sources=await collectTrackedPortabilitySources(ROOT);
  const report=scanInstanceConfigurationSources(sources);
  for(const path of [
    'wrangler.preview.jsonc',
    'wrangler.staging.jsonc',
    'wrangler.m03-platform-auth-access-staging.jsonc',
    'src/m03-access-platform-auth-worker.js',
    'src/auth/platform-shop-binding.js',
    'src/m03-owner-redemption-worker.js',
    'docs/runbooks/M03_PLATFORM_AUTH_STAGING.md',
  ]){
    assert.ok(report.pathsScanned.includes(path),'missing tracked source '+path);
  }
  assert.ok(report.pathsScanned.some(p=>p.startsWith('.github/workflows/')));
  assert.ok(report.findings.some(f=>f.path==='src/m03-access-platform-auth-worker.js'&&f.kinds.includes('literal_worker_origin')));
  assert.ok(report.findings.some(f=>f.path==='wrangler.m03-platform-auth-access-staging.jsonc'&&f.kinds.includes('account_id')));
  verifyPublicPreviewIsUnbound(sources['wrangler.preview.jsonc']);
  assert.equal(JSON.stringify(report).includes('ac66126a5dc7c2f21ae5c146341a5dfb'),false);
});
