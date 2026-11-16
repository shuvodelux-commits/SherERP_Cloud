#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCloudflarePreviewConfig} from './check-cloudflare-preview.mjs';
import {validateStagingConfig} from './check-staging-d1.mjs';

// Documentary only. This checks externally supplied *aggregates*, not D1
// records, approvals or an actual Worker deployment. It can never grant
// staff import, deployment, traffic switching or production authentication.
const REQUIRED_MIGRATIONS=Object.freeze([
  '0001_core_catalog.sql','0002_party_identity.sql',
  '0003_auth_core.sql','0004_auth_source_provenance.sql'
]);
const REQUIRED_TABLES=Object.freeze([
  'auth_users','auth_roles','auth_sessions',
  'auth_login_throttle','auth_legacy_credentials'
]);
const SOURCE=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const REVIEW=/^review\/[A-Za-z0-9][A-Za-z0-9._/-]{5,127}$/;
const MIGRATION=/^[0-9]{4}_[a-z0-9_]+\.sql$/;
const TABLE=/^[a-z][a-z0-9_]*$/;
const CAUTION='Documentary aggregate check only: independently verify protected source freezes, real D1 schema, staff provenance, owner approvals, private Worker identity and exact deployment. This report never authorizes migration, staff import, deployment or cutover.';

function ownRecord(input,expected){
  try{
    if(!input||typeof input!=='object'||Array.isArray(input)||
       (Object.getPrototypeOf(input)!==Object.prototype &&
        Object.getPrototypeOf(input)!==null))
      return null;
    const descriptors=Object.getOwnPropertyDescriptors(input);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.length!==expected.length||
       keys.some(k=>typeof k!=='string'||!expected.includes(k)))
      return null;
    const result=Object.create(null);
    for(const key of expected){
      const d=descriptors[key];
      if(d?.enumerable!==true||!Object.hasOwn(d,'value'))return null;
      result[key]=d.value;
    }
    return result;
  }catch{
    return null;
  }
}
function stringList(value,pattern){
  try{
    if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
       value.length>100||Reflect.ownKeys(value).length!==value.length+1)
      return null;
    const result=[];
    for(let i=0;i<value.length;i++){
      const d=Object.getOwnPropertyDescriptor(value,String(i));
      if(d?.enumerable!==true||!Object.hasOwn(d,'value')||
         typeof d.value!=='string'||!pattern.test(d.value))
        return null;
      result.push(d.value);
    }
    if(new Set(result).size!==result.length)return null;
    return result;
  }catch{
    return null;
  }
}
function count(value){
  return Number.isSafeInteger(value)&&value>=0;
}
const report=blockers=>Object.freeze({
  documentaryComplete:blockers.length===0,
  authorizesDeployment:false,
  authorizesStaffImport:false,
  authorizesCutover:false,
  blockers:Object.freeze([...blockers]),
  caution:CAUTION
});

/** Read-only, untrusted documentary evidence validation.
 * Never echo source records, identity, credential or custom exception text.
 */
export function assessM04LoginStagingEvidence(input,options={}){
  const blockers=[];
  const fail=code=>{if(!blockers.includes(code))blockers.push(code);};
  const root=ownRecord(input,['preview','staging','observed','staffFreeze','approvals']);
  if(!root){
    fail('M04_DOCUMENT_INPUT_INVALID');
    return report(blockers);
  }
  let stagingResourceId,stagingWorkerName;
  try{
    validateCloudflarePreviewConfig(root.preview);
    validateStagingConfig(root.staging,root.preview);
    stagingResourceId=root.staging.d1_databases[0].database_id;
    stagingWorkerName=root.staging.name;
  }catch{
    fail('M04_CONFIG_ISOLATION_INVALID');
  }

  const pin=ownRecord(options,['expectedSourceSha','expectedReleaseSha']);
  if(!pin||!SOURCE.test(pin.expectedSourceSha)||
     !SOURCE.test(pin.expectedReleaseSha))
    fail('M04_EXPECTED_PINS_INVALID');

  const observed=ownRecord(root.observed,[
    'databaseId','workerName','releaseSha','migrationNames','authTables',
    'userCount','roleCount','activeAdministratorCount','legacyPendingCount'
  ]);
  if(!observed)fail('M04_OBSERVED_SCHEMA_INVALID');

  const migrations=observed
    ?stringList(observed.migrationNames,MIGRATION):null;
  const tables=observed?stringList(observed.authTables,TABLE):null;
  if(observed && (!migrations||!tables))
    fail('M04_OBSERVED_SCHEMA_INVALID');

  if(!observed||typeof observed.databaseId!=='string'||
     observed.databaseId!==stagingResourceId||
     observed.workerName!==stagingWorkerName||
     !pin||observed.releaseSha!==pin.expectedReleaseSha)
    fail('M04_PRIVATE_WORKER_UNVERIFIED');
  if(!migrations || REQUIRED_MIGRATIONS.some(name=>!migrations.includes(name)))
    fail('M04_REMOTE_AUTH_MIGRATIONS_UNPROVEN');
  if(!tables||REQUIRED_TABLES.some(name=>!tables.includes(name)))
    fail('M04_REMOTE_AUTH_TABLES_UNPROVEN');

  const aggregatesValid=observed &&
    count(observed.userCount)&&observed.userCount>0 &&
    count(observed.roleCount)&&observed.roleCount>0 &&
    count(observed.activeAdministratorCount)&&
    observed.activeAdministratorCount>=1 &&
    observed.activeAdministratorCount<=observed.userCount &&
    count(observed.legacyPendingCount)&&
    observed.legacyPendingCount<=observed.userCount;
  if(!aggregatesValid)fail('M04_STAFF_AGGREGATES_INVALID');

  const frozen=ownRecord(root.staffFreeze,[
    'sourceSha','firstSha256','secondSha256',
    'reconciledUserCount','reconciledRoleCount',
    'reconciledActiveAdministratorCount','reconciledLegacyPendingCount'
  ]);
  const freezeValid=!!(frozen&&pin&&
    frozen.sourceSha===pin.expectedSourceSha&&
    DIGEST.test(frozen.firstSha256)&&
    frozen.firstSha256===frozen.secondSha256);
  if(!freezeValid)fail('M04_STAFF_FREEZE_UNPROVEN');
  if(!frozen||!aggregatesValid||
    !count(frozen.reconciledUserCount)||
    !count(frozen.reconciledRoleCount)||
    !count(frozen.reconciledActiveAdministratorCount)||
    !count(frozen.reconciledLegacyPendingCount)||
    frozen.reconciledUserCount!==observed.userCount||
    frozen.reconciledRoleCount!==observed.roleCount||
    frozen.reconciledActiveAdministratorCount!==observed.activeAdministratorCount||
    frozen.reconciledLegacyPendingCount!==observed.legacyPendingCount)
    fail('M04_STAFF_RECONCILIATION_UNPROVEN');

  const approvals=ownRecord(root.approvals,[
    'schemaReviewRef','staffReviewRef','privateDeploymentReviewRef'
  ]);
  if(!approvals||
     !['schemaReviewRef','staffReviewRef','privateDeploymentReviewRef']
       .every(k=>typeof approvals[k]==='string'&&REVIEW.test(approvals[k])))
    fail('M04_OWNER_REVIEWS_MISSING');

  return report(blockers);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [privateEvidenceFile,expectedReleaseSha,expectedSourceSha]=process.argv.slice(2);
  if(!privateEvidenceFile||!expectedReleaseSha||!expectedSourceSha){
    console.error('M04 login staging BLOCKED: private aggregate evidence file and pinned release/source commits required');
    process.exitCode=1;
  }else{
    try{
      const json=path=>JSON.parse(readFileSync(resolve(path),'utf8'));
      const evidence=json(privateEvidenceFile);
      const result=assessM04LoginStagingEvidence({
        preview:json('wrangler.preview.jsonc'),
        staging:json('wrangler.staging.jsonc'),
        observed:evidence.observed,
        staffFreeze:evidence.staffFreeze,
        approvals:evidence.approvals
      },{expectedReleaseSha,expectedSourceSha});
      if(result.documentaryComplete){
        console.log('M04 documentary metadata structurally complete; independent remote evidence, owner approval and staging deployment remain required. No activation authorized.');
      }else{
        console.error('M04 login staging BLOCKED: '+result.blockers.join(', '));
        process.exitCode=1;
      }
    }catch{
      console.error('M04 login staging BLOCKED: private aggregate evidence unavailable or invalid');
      process.exitCode=1;
    }
  }
}
