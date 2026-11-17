import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {auditM11CiDeploymentOwnership} from '../scripts/m11-ci-deployment-ownership.mjs';

const root=new URL('../',import.meta.url);
const workflowDir=new URL('.github/workflows/',root);
const workflows=()=>readdirSync(workflowDir).filter(name=>/\.ya?ml$/.test(name))
  .map(name=>({name,content:readFileSync(new URL(name,workflowDir),'utf8')}));
const preview=()=>JSON.parse(readFileSync(new URL('wrangler.preview.jsonc',root),'utf8'));
const examine=(overrides={})=>auditM11CiDeploymentOwnership({
  workflows:workflows(),previewConfig:preview(),...overrides
});
const added=(name,content)=>[...workflows(),{name,content}];
const checkBlocked=(report,code)=>{
  assert.equal(report.safe,false,JSON.stringify(report.blockers));
  assert.ok(report.blockers.includes(code),JSON.stringify(report.blockers));
  assert.equal(report.authorizesDeployment,false);
  assert.equal(report.authorizesRemoteD1Write,false);
};

test('all present repository CI workflows respect Workers Builds deployment ownership',()=>{
  const result=examine();
  assert.equal(result.safe,true,JSON.stringify(result.blockers));
  assert.deepEqual(result.blockers,[]);
  assert.ok(result.checkedWorkflows>=40);
  assert.equal(result.authorizesDeployment,false);
  assert.equal(result.authorizesRemoteD1Write,false);
});
test('publishing from a pull-request workflow is blocked, even if called with npx',()=>{
  const a=added('m11-unsafe-deploy.yml',
    'on:\n  pull_request:\njobs:\n  deploy:\n    steps:\n      - run: npx --yes wrangler@4.161.0 deploy --config wrangler.preview.jsonc\n');
  checkBlocked(examine({workflows:a}),'M11_CI_DEPLOY_COMMAND_BLOCKED');
});
test('dry-run Wrangler bundle checks remain allowed',()=>{
  const a=added('m11-bundle-only.yml',
    'on:\n  pull_request:\njobs:\n  bundle:\n    steps:\n      - run: npx --yes wrangler@4.161.0 deploy --dry-run --config wrangler.preview.jsonc\n');
  assert.equal(examine({workflows:a}).safe,true);
});
test('a new PR-triggered remote D1 write or read is prohibited',()=>{
  const a=added('m11-remote-write.yml',
    'on:\n  pull_request:\njobs:\n  d1:\n    steps:\n      - run: npx wrangler d1 migrations apply shererp-staging-db --remote --config wrangler.staging.jsonc\n');
  checkBlocked(examine({workflows:a}),'M11_CI_REMOTE_D1_BLOCKED');
});
test('secret expressions in normal PR CI are prohibited',()=>{
  const a=added('m11-remote-secret.yml',
    'on:\n  pull_request:\njobs:\n  test:\n    env:\n      TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}\n');
  const out=examine({workflows:a});
  checkBlocked(out,'M11_CI_SECRET_IN_WORKFLOW');
  assert.doesNotMatch(JSON.stringify(out),/CLOUDFLARE_API_TOKEN/);
});
test('third-party deploy actions cannot bypass direct Wrangler command checks',()=>{
  const a=added('m11-other-deploy.yml',
    'on:\n  pull_request:\njobs:\n  post:\n    steps:\n      - uses: cloudflare/wrangler-action@v3\n');
  checkBlocked(examine({workflows:a}),'M11_CI_DEPLOY_ACTION_BLOCKED');
});
test('manually approved staging workflow cannot be made PR or push-triggered',()=>{
  const a=workflows();
  const manual=a.find(x=>x.name==='remote-d1-staging.yml');
  manual.content=manual.content.replace('on:\n  workflow_dispatch:',
    'on:\n  pull_request:\n  workflow_dispatch:');
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_MANUAL_ONLY');
  const b=workflows(),m=b.find(x=>x.name==='remote-d1-staging.yml');
  m.content=m.content.replace('on:\n  workflow_dispatch:',
    'on:\n  push:\n  workflow_dispatch:');
  checkBlocked(examine({workflows:b}),'M11_CI_STAGING_MANUAL_ONLY');
});
test('manual staging exception requires main guard, environment and human confirmation',()=>{
  const mutation=[
    ['refs/heads/main','refs/heads/feature'],
    ['environment: cloudflare-staging-db','environment: cloudflare-preview'],
    ["inputs.confirmation == 'APPLY_STAGING_D1_SCHEMA_ONLY'",
      "inputs.confirmation == 'ALLOW_ALL_DB_WRITES'"]
  ];
  for(const [original,replacement] of mutation){
    const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
    assert.ok(m.content.includes(original),original);
    m.content=m.content.replace(original,replacement);
    checkBlocked(examine({workflows:a}),'M11_CI_STAGING_GUARD_MISSING');
  }
});
test('staging-only remote D1 operation may not change target database or config',()=>{
  const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
  m.content=m.content.replace('d1 migrations apply shererp-staging-db --remote',
    'd1 migrations apply shererp-production-db --remote');
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_TARGET_INVALID');
});
test('missing approval workflow or duplicate filenames fail closed',()=>{
  const w=workflows().filter(x=>x.name!=='remote-d1-staging.yml');
  checkBlocked(examine({workflows:w}),'M11_CI_REQUIRED_WORKFLOW_MISSING');
  const dup=workflows();dup.push({...dup[0]});
  checkBlocked(examine({workflows:dup}),'M11_CI_WORKFLOW_SET_INVALID');
});
test('public preview database binding and nonempty preview resources are rejected',()=>{
  const a=preview();a.d1_databases=[{binding:'DB',database_name:'prod'}];
  checkBlocked(examine({previewConfig:a}),'M11_CI_PUBLIC_PREVIEW_UNSAFE');
  const b=preview();b.previews={vars:{SECRET:'unsafe'}};
  checkBlocked(examine({previewConfig:b}),'M11_CI_PUBLIC_PREVIEW_UNSAFE');
});
test('CI auditor refuses malformed manifests without leaking source contents',()=>{
  checkBlocked(auditM11CiDeploymentOwnership({}),'M11_CI_WORKFLOW_SET_INVALID');
  const malformed=[{name:'secrets.txt',content:'PRIVATE_USER_VALUE'}];
  const x=auditM11CiDeploymentOwnership({workflows:malformed,previewConfig:preview()});
  checkBlocked(x,'M11_CI_WORKFLOW_SET_INVALID');
  assert.doesNotMatch(JSON.stringify(x),/PRIVATE_USER_VALUE/);
});

test('approved exact manual staging workflow is sealed against second remote SQL commands',()=>{
  const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
  assert.ok(m);
  m.content=m.content.replace(
    'npx --yes wrangler@4.161.0 d1 migrations apply shererp-staging-db --remote --config wrangler.staging.jsonc',
    'npx --yes wrangler@4.161.0 d1 migrations apply shererp-staging-db --remote --config wrangler.staging.jsonc\n          npx --yes wrangler@4.161.0 d1 execute shererp-staging-db --remote --config wrangler.staging.jsonc --command "DELETE FROM parties"'
  );
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_UNREVIEWED_CHANGE');
});

test('staging owner approval may not be bypassed with a true-OR expression',()=>{
  const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
  const condition="inputs.confirmation == 'APPLY_STAGING_D1_SCHEMA_ONLY'";
  assert.ok(m.content.includes(condition));
  m.content=m.content.replace(condition,'true || '+condition);
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_UNREVIEWED_CHANGE');
});

test('staging main-branch restriction may not be bypassed while keeping its token present',()=>{
  const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
  const condition="github.ref == 'refs/heads/main'";
  assert.ok(m.content.includes(condition));
  m.content=m.content.replace(condition,'true || '+condition);
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_UNREVIEWED_CHANGE');
});

test('manual staging migration count cannot be changed by retaining an old value in a comment',()=>{
  const a=workflows(),m=a.find(x=>x.name==='remote-d1-staging.yml');
  const approved='EXPECTED_REMOTE_MIGRATION_COUNT=2';
  assert.ok(m.content.includes(approved));
  m.content=m.content.replace(approved,
    'EXPECTED_REMOTE_MIGRATION_COUNT=3\n          # '+approved);
  checkBlocked(examine({workflows:a}),'M11_CI_STAGING_UNREVIEWED_CHANGE');
});
