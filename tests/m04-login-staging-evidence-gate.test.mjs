import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assessM04LoginStagingEvidence}
  from '../scripts/check-m04-login-staging.mjs';

const sourceSha='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const releaseSha='a'.repeat(40);
const freezeSha='b'.repeat(64);
const options=()=>({expectedSourceSha:sourceSha,expectedReleaseSha:releaseSha});
const config=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
function sample(){
  return {
    preview:config('wrangler.preview.jsonc'),
    staging:config('wrangler.staging.jsonc'),
    observed:{
      databaseId:'aa04618e-1639-4cb9-bdf5-7b967d8b968b',
      workerName:'shererp-cloud-staging',
      releaseSha,
      migrationNames:[
        '0001_core_catalog.sql','0002_party_identity.sql',
        '0003_auth_core.sql','0004_auth_source_provenance.sql'
      ],
      authTables:[
        'auth_users','auth_roles','auth_sessions',
        'auth_login_throttle','auth_legacy_credentials'
      ],
      userCount:3,roleCount:2,activeAdministratorCount:1,
      legacyPendingCount:3
    },
    staffFreeze:{
      sourceSha,firstSha256:freezeSha,secondSha256:freezeSha,
      reconciledUserCount:3,reconciledRoleCount:2,
      reconciledActiveAdministratorCount:1,reconciledLegacyPendingCount:3
    },
    approvals:{
      schemaReviewRef:'review/M04-auth-schema-1234',
      staffReviewRef:'review/M04-staff-freeze-1234',
      privateDeploymentReviewRef:'review/M04-staging-1234'
    }
  };
}
const assess=(input=sample(),opts=options())=>assessM04LoginStagingEvidence(input,opts);
const has=(report,code)=>assert(report.blockers.includes(code),
  'Expected blocker '+code+' in '+report.blockers.join(','));

test('empty or unverified report is blocked with stable safe codes and never grants import/deploy/cutover',()=>{
  for(const input of [null,undefined,{},'SECRET_PASSWORD',[],{observed:'SECRET_PASSWORD'}]){
    const report=assessM04LoginStagingEvidence(input,options());
    assert.equal(report.documentaryComplete,false);
    assert.equal(report.authorizesDeployment,false);
    assert.equal(report.authorizesStaffImport,false);
    assert.equal(report.authorizesCutover,false);
    assert(report.blockers.length>0);
    assert.doesNotMatch(JSON.stringify(report),/SECRET_PASSWORD|PRIVATE|0171000|password_hash/i);
  }
});

test('synthetic complete aggregate can be documentary-complete but never grants actual activation',()=>{
  const report=assess();
  assert.deepEqual(report.blockers,[]);
  assert.equal(report.documentaryComplete,true);
  assert.equal(report.authorizesDeployment,false);
  assert.equal(report.authorizesStaffImport,false);
  assert.equal(report.authorizesCutover,false);
  assert.match(report.caution,/independent|documentary|verify/i);
});

test('preview/staging isolation must match current checked-in DB-free preview and isolated staging',()=>{
  const leaked=sample();
  leaked.preview.d1_databases=[{binding:'DB',database_id:'PUBLIC-LEAK'}];
  has(assess(leaked),'M04_CONFIG_ISOLATION_INVALID');
  const renamed=sample();
  renamed.staging.d1_databases[0].database_id='11111111-1111-1111-1111-111111111111';
  has(assess(renamed),'M04_CONFIG_ISOLATION_INVALID');
});

test('real remote D1 may still have just two approved migrations; this cannot activate authentication',()=>{
  const input=sample();
  input.observed.migrationNames=input.observed.migrationNames.slice(0,2);
  has(assess(input),'M04_REMOTE_AUTH_MIGRATIONS_UNPROVEN');
  const missing=sample();
  missing.observed.authTables=missing.observed.authTables.filter(x=>x!=='auth_sessions');
  has(assess(missing),'M04_REMOTE_AUTH_TABLES_UNPROVEN');
});

test('private binding and tested release commit must match isolated staging resource',()=>{
  const input=sample();
  input.observed.databaseId='b1111111-1111-1111-1111-111111111111';
  has(assess(input),'M04_PRIVATE_WORKER_UNVERIFIED');
  const change=sample();
  change.observed.releaseSha='c'.repeat(40);
  has(assess(change),'M04_PRIVATE_WORKER_UNVERIFIED');
  has(assess(sample(),{expectedSourceSha:'not-sha',expectedReleaseSha:releaseSha}),
    'M04_EXPECTED_PINS_INVALID');
});

test('real staff totals and at least one active administrator cannot be substituted by test users',()=>{
  const noStaff=sample();
  noStaff.observed.userCount=0;
  noStaff.observed.activeAdministratorCount=0;
  has(assess(noStaff),'M04_STAFF_AGGREGATES_INVALID');
  const noAdmin=sample();
  noAdmin.observed.activeAdministratorCount=0;
  has(assess(noAdmin),'M04_STAFF_AGGREGATES_INVALID');
  const noRoles=sample();
  noRoles.observed.roleCount=0;
  has(assess(noRoles),'M04_STAFF_AGGREGATES_INVALID');
  const morePending=sample();
  morePending.observed.legacyPendingCount=999;
  has(assess(morePending),'M04_STAFF_AGGREGATES_INVALID');
});

test('two-pass frozen source snapshot must match both SHA-256 digests and trusted source commit',()=>{
  const first=sample();
  first.staffFreeze.secondSha256='c'.repeat(64);
  has(assess(first),'M04_STAFF_FREEZE_UNPROVEN');
  const second=sample();
  second.staffFreeze.sourceSha='d'.repeat(40);
  has(assess(second),'M04_STAFF_FREEZE_UNPROVEN');
  const notHash=sample();
  notHash.staffFreeze.firstSha256='SECRET_PASSWORD';
  has(assess(notHash),'M04_STAFF_FREEZE_UNPROVEN');
  assert.doesNotMatch(JSON.stringify(assess(notHash)),/SECRET_PASSWORD/);
});

test('source-to-D1 aggregate row reconciliation must agree exactly with frozen protected staff',()=>{
  const input=sample();
  input.staffFreeze.reconciledUserCount++;
  has(assess(input),'M04_STAFF_RECONCILIATION_UNPROVEN');
  const pending=sample();
  pending.staffFreeze.reconciledLegacyPendingCount=0;
  has(assess(pending),'M04_STAFF_RECONCILIATION_UNPROVEN');
  const admin=sample();
  admin.staffFreeze.reconciledActiveAdministratorCount=2;
  has(assess(admin),'M04_STAFF_RECONCILIATION_UNPROVEN');
});

test('owner review references are required but never considered actual authorization',()=>{
  const input=sample();
  input.approvals.staffReviewRef='';
  has(assess(input),'M04_OWNER_REVIEWS_MISSING');
  const secret=sample();
  secret.approvals.schemaReviewRef='SECRET_PLAINTEXT_PASSWORD';
  assert.equal(assess(secret).authorizesDeployment,false);
  assert.doesNotMatch(JSON.stringify(assess(secret)),/SECRET_PLAINTEXT_PASSWORD/);
});

test('unknown, private and getter-bearing fields are refused without executing sensitive accessors',()=>{
  const extra=sample();
  extra.observed.password_hash='SECRET_PRIVATE_HASH';
  const report=assess(extra);
  has(report,'M04_OBSERVED_SCHEMA_INVALID');
  assert.doesNotMatch(JSON.stringify(report),/SECRET_PRIVATE_HASH/);

  const getter=sample();
  Object.defineProperty(getter.staffFreeze,'sourceSha',{
    enumerable:true,get(){throw Error('SECRET_SOURCE_EXPORT')}
  });
  const result=assess(getter);
  assert.equal(result.documentaryComplete,false);
  assert.doesNotMatch(JSON.stringify(result),/SECRET_SOURCE_EXPORT/);
});

test('CLI with no private manifest fails closed with redacted usage and no remote write',()=>{
  const cli=fileURLToPath(new URL('../scripts/check-m04-login-staging.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[cli],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/M04|staging|blocked|usage/i);
  assert.doesNotMatch(r.stdout+r.stderr,/password|token|salt|credential/i);
});
