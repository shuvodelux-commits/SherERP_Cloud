#!/usr/bin/env node
/**
 * M03/PORT-P2 hosted Control Center preflight — NO MUTATING API METHODS.
 *
 * This operator tool is not imported by an active Worker. It reuses P1/P2
 * account checks, verifies existing private Worker D1 bindings via GET-only
 * Cloudflare API, and hashes the merged six-step local Owner-ready manifest.
 *
 * IMPORTANT: passing this check is NOT deployment authorization, and it
 * cannot create D1, apply SQL, upload Worker versions or activate an Owner.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePortableInstance} from './port-p1-instance.mjs';
import {verifyBootstrapReadOnly} from './port-p2-bootstrap-preflight.mjs';
import {
  OWNER_READY_SHOP_MIGRATION_PLAN,isOwnerReadyShopMigrationPlan
} from '../src/db/m03-owner-ready-shop-migrations.js';

const CF_ORIGIN='https://api.cloudflare.com/client/v4';
const TOKEN=/^[A-Za-z0-9._~-]{10,512}$/;
const denied=()=>new Error('Hosted Control Center preflight denied');
const sixSteps=()=>isOwnerReadyShopMigrationPlan(OWNER_READY_SHOP_MIGRATION_PLAN)
  ?OWNER_READY_SHOP_MIGRATION_PLAN:undefined;
const remainingGates=Object.freeze([
  'independent-security-review',
  'cloudflare-access-and-google-origin-review',
  'private-installer-operation-journal',
  'new-shop-d1-create-and-recovery-approval',
  'six-migration-d1-remote-execution-approval',
  'worker-version-binding-promotion',
  'm10-recovery',
  'm11-private-worker-release',
  'owner-deployment-approval',
  'hosted-owner-login-and-product-smoke'
]);
const permissions=Object.freeze({
  allowCreateDatabase:false,
  allowRemoteWrites:false,
  allowRemoteMigrations:false,
  allowDeploy:false,
  allowOwnerActivation:false
});

/** Sanitized, deterministic offline draft; does not touch Cloudflare. */
export function planHostedControlCenterDryRun(instance){
  validatePortableInstance(instance);
  const steps=sixSteps();
  if(!steps)throw denied();
  return {
    formatVersion:1,mode:'offline-dry-run',resourceVerification:'not-checked',
    migrationFilesVerified:false,ownerReadyMigrationCount:steps.length,remoteQueries:0,
    ...permissions,remainingGates:[...remainingGates]
  };
}

/** Read exact six on-disk SQL bytes; a drift must be rejected before any GET. */
export async function verifyOwnerReadyMigrationFiles({readFileFn=readFile}={}){
  const steps=sixSteps();
  if(!steps||typeof readFileFn!=='function')throw denied();
  try{
    for(const {name,checksum} of steps){
      const file=new URL('../'+name,import.meta.url);
      const bytes=await readFileFn(file);
      if(createHash('sha256').update(bytes).digest('hex')!==checksum)throw denied();
    }
  }catch{
    throw denied();
  }
  return {verified:true,migrationCount:steps.length};
}

function assertExactBindings(settings,required){
  if(!settings || typeof settings!=='object' || Array.isArray(settings) ||
     !Array.isArray(settings.bindings))throw denied();
  const names=new Set(),matched=new Set();
  for(const binding of settings.bindings){
    if(!binding || typeof binding!=='object' || Array.isArray(binding) ||
       typeof binding.name!=='string' || !binding.name || names.has(binding.name) ||
       typeof binding.type!=='string')throw denied();
    names.add(binding.name);
    if(binding.type!=='d1')continue;
    const expected=required[binding.name];
    if(!expected || binding.database_id!==expected || matched.has(binding.name))throw denied();
    matched.add(binding.name);
  }
  if(matched.size!==Object.keys(required).length)throw denied();
}

async function readWorkerSettings(instance,name,fetchFn,token){
  const url=CF_ORIGIN+'/accounts/'+instance.accountId+'/workers/scripts/'+name+'/settings';
  let response;
  try{
    response=await fetchFn(url,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
    if(response?.ok!==true || typeof response.json!=='function')throw denied();
    const envelope=await response.json();
    if(envelope?.success!==true)throw denied();
    return envelope.result;
  }catch{
    throw denied();
  }
}

/**
 * Six GETs maximum: account, namespace, two existing D1 identities, then the
 * private Admin and Owner Worker settings. No SQL query or mutation.
 */
export async function verifyHostedControlCenterReadOnly(instance,{token,fetchFn=globalThis.fetch}={}){
  const p=validatePortableInstance(instance);
  if(typeof token!=='string'||!TOKEN.test(token)||typeof fetchFn!=='function')throw denied();
  await verifyOwnerReadyMigrationFiles();
  try{
    await verifyBootstrapReadOnly(p,{token,fetchFn});
    const admin=await readWorkerSettings(p,p.workers.admin,fetchFn,token);
    assertExactBindings(admin,{CONTROL_DB:p.d1.control.id});
    const owner=await readWorkerSettings(p,p.workers.owner,fetchFn,token);
    assertExactBindings(owner,{
      CONTROL_DB:p.d1.control.id,
      PLATFORM_PILOT_DB:p.d1.pilot.id
    });
  }catch{
    throw denied();
  }
  return {
    formatVersion:1,mode:'cloudflare-read-only',resourceVerification:'verified',
    migrationFilesVerified:true,ownerReadyMigrationCount:OWNER_READY_SHOP_MIGRATION_PLAN.length,
    remoteQueries:6,verified:[
      'cloudflare-account','workers-subdomain','control-d1','pilot-d1',
      'admin-worker-d1-bindings','owner-worker-d1-bindings','owner-ready-migration-files'
    ],...permissions,remainingGates:[...remainingGates]
  };
}

async function cli(){
  const [mode,filename,...extra]=process.argv.slice(2);
  if(extra.length||!filename||!['--dry-run','--verify-readonly'].includes(mode))throw denied();
  const instance=JSON.parse(await readFile(resolve(filename),'utf8'));
  const result=mode==='--dry-run'
    ?planHostedControlCenterDryRun(instance)
    :await verifyHostedControlCenterReadOnly(instance,{token:process.env.CLOUDFLARE_API_TOKEN});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  cli().catch(()=>{
    process.stderr.write('Hosted Control Center preflight denied; no remote changes performed\n');
    process.exitCode=1;
  });
}
