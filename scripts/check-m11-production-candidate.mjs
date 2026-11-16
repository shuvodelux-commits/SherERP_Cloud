#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCloudflarePreviewConfig} from './check-cloudflare-preview.mjs';
import {validateStagingConfig} from './check-staging-d1.mjs';
import {assessM11Evidence} from './check-m11-release-evidence.mjs';

/**
 * Offline, documentary topology review only.
 * Supplied health and evidence are NOT independently authenticated.
 * This function never authorizes or performs a production deployment.
 */
const SHA40=/^[a-f0-9]{40}$/i;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const WORKER=/^shererp-[a-z0-9-]{3,60}$/;
const DB_NAME=/^[a-z][a-z0-9-]{2,63}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&
  keys.every(k=>Object.hasOwn(x,k));
const CAUTION='Documentary candidate only: independently verify actual Worker deployment, authenticated health, D1 identity and owner approvals. This check does not authorize deploying, binding D1, migrating data or changing traffic.';

export function assessM11ProductionCandidate(input,options={}) {
  const blockers=new Set();
  const fail=code=>blockers.add(code);
  const report=()=>({
    documentaryComplete:blockers.size===0,
    authorizesDeployment:false,
    blockers:[...blockers],
    caution:CAUTION
  });
  if(!object(input)){
    fail('M11_PROD_INPUT_REQUIRED');
    return report();
  }
  if(!exact(input,['preview','staging','production','observedHealth','releaseEvidence'])){
    fail('M11_PROD_INPUT_INVALID');
  }
  const {preview,staging,production,observedHealth,releaseEvidence}=input;
  const expectedReleaseSha=options?.expectedReleaseSha;
  const expectedSourceSha=options?.expectedSourceSha;
  if(!SHA40.test(expectedReleaseSha??'')||!SHA40.test(expectedSourceSha??'')){
    fail('M11_PROD_PIN_MISMATCH');
  }

  try{
    validateCloudflarePreviewConfig(preview);
    validateStagingConfig(staging,preview);
  }catch{
    // No private values or unexpected source payloads may enter logs.
    fail('M11_PROD_BOUNDARY_INVALID');
  }
  const productionFields=[
    'name','main','compatibility_date','workers_dev','previews','assets','d1_databases'
  ];
  const configValid=exact(production,productionFields)&&
    typeof production.name==='string'&&WORKER.test(production.name)&&
    production.main==='src/index.js'&&
    production.compatibility_date===preview?.compatibility_date&&
    production.workers_dev===false&&
    exact(production.previews,[])&&
    exact(production.assets,['directory','binding','run_worker_first','not_found_handling'])&&
    production.assets.directory==='./dist'&&
    production.assets.binding==='ASSETS'&&
    production.assets.not_found_handling==='single-page-application'&&
    Array.isArray(production.assets.run_worker_first)&&
    production.assets.run_worker_first.length===1&&
    production.assets.run_worker_first[0]==='/api/*'&&
    Array.isArray(production.d1_databases)&&
    production.d1_databases.length===1&&
    exact(production.d1_databases[0],['binding','database_name','database_id','migrations_dir'])&&
    production.d1_databases[0].binding==='DB'&&
    DB_NAME.test(production.d1_databases[0].database_name??'')&&
    UUID.test(production.d1_databases[0].database_id??'')&&
    production.d1_databases[0].migrations_dir==='migrations';
  if(!configValid) fail('M11_PROD_CONFIG_INVALID');

  if(production?.name===preview?.name||
    production?.name===staging?.name||
    production?.d1_databases?.[0]?.database_name===staging?.d1_databases?.[0]?.database_name||
    production?.d1_databases?.[0]?.database_id===staging?.d1_databases?.[0]?.database_id){
    fail('M11_PROD_ISOLATION_VIOLATION');
  }
  const healthValid=exact(observedHealth,['status','service','database','worker','releaseSha'])&&
    observedHealth.status==='ready'&&
    observedHealth.service==='shererp-cloud'&&
    observedHealth.database==='connected'&&
    observedHealth.worker===production?.name&&
    observedHealth.releaseSha===expectedReleaseSha&&
    SHA40.test(observedHealth.releaseSha??'');
  if(!healthValid) fail('M11_PROD_HEALTH_NOT_READY');

  const phase=assessM11Evidence(releaseEvidence,{
    phase:'prepare',expectedReleaseSha,expectedSourceSha
  });
  if(!phase.documentaryComplete){
    fail('M11_PROD_RELEASE_GATE_BLOCKED');
  }
  return report();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [productionFile,healthFile,evidenceFile,releaseSha]=process.argv.slice(2);
  if(!productionFile||!healthFile||!evidenceFile||!releaseSha){
    console.error('Usage: node scripts/check-m11-production-candidate.mjs <PRIVATE_PROPOSED_WRANGLER_JSON> <PRIVATE_OBSERVED_HEALTH_JSON> <PRIVATE_RELEASE_EVIDENCE_JSON> <RELEASE_SHA>');
    process.exitCode=2;
  }else{
    try{
      const json=path=>JSON.parse(readFileSync(resolve(path),'utf8'));
      const preview=json('wrangler.preview.jsonc');
      const staging=json('wrangler.staging.jsonc');
      const source=json('docs/baseline/source-manifest.json');
      const result=assessM11ProductionCandidate({
        preview,staging,
        production:json(productionFile),
        observedHealth:json(healthFile),
        releaseEvidence:json(evidenceFile)
      },{expectedReleaseSha:releaseSha,expectedSourceSha:source.source.commit});
      if(!result.documentaryComplete){
        console.error('M11 production candidate BLOCKED: '+result.blockers.join(', '));
        process.exitCode=1;
      }else{
        console.log('M11 candidate metadata structurally complete. '+result.caution);
      }
    }catch{
      console.error('M11 production candidate BLOCKED: private input unavailable or invalid');
      process.exitCode=1;
    }
  }
}
