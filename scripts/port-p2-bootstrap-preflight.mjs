#!/usr/bin/env node
/**
 * PORT-00 P2 Run 1: fail-closed Cloudflare account bootstrap preflight.
 * This file performs only GET requests against Cloudflare's fixed API origin.
 * No D1 queries, remote mutations, secrets/config writes or deployments.
 */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePortableInstance} from './port-p1-instance.mjs';
import {verifyPublicPreviewIsUnbound} from './port-p0-inventory.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CLOUD_API='https://api.cloudflare.com/client/v4';
const tokenPattern=/^[A-Za-z0-9._~-]{10,512}$/;
const denied=()=>new Error('PORT-P2 read-only verification failed (resource or permission mismatch)');
const tasks=Object.freeze([
  'cloudflare-identity','shop-binding-topology','cloudflare-access',
  'google-oauth','secrets','migration-backup','worker-builds','release-review'
]);

/** No user-supplied ID, hostname, email or token is included in this report. */
export function planBootstrapDryRun(instance){
  validatePortableInstance(instance);
  return {
    formatVersion:1,
    mode:'offline-dry-run',
    remoteQueries:0,
    resourceVerification:'not-checked',
    verified:[],
    allowDeploy:false,
    allowRemoteMigrations:false,
    remainingGates:[...tasks],
    requiredOrder:[
      'validate-instance',
      'verify-cloudflare-readonly',
      'review-shop-binding-topology',
      'configure-access-and-google',
      'configure-protected-secrets',
      'review-backups-and-migration-plan',
      'review-worker-builds-and-github-deploy-owner',
      'obtain-m10-m11-owner-release-approval'
    ]
  };
}

export async function verifyBootstrapReadOnly(instance,{token,fetchFn=globalThis.fetch}={}){
  const p=validatePortableInstance(instance);
  if(typeof token!=='string'||!tokenPattern.test(token)||typeof fetchFn!=='function')
    throw denied();
  const resourceChecks=[
    {path:'/accounts/'+p.accountId,
      matches:r=>r.id===p.accountId,kind:'cloudflare-account'},
    {path:'/accounts/'+p.accountId+'/workers/subdomain',
      matches:r=>r.subdomain===p.workersSubdomain,kind:'workers-subdomain'},
    {path:'/accounts/'+p.accountId+'/d1/database/'+p.d1.control.id,
      matches:r=>r.uuid===p.d1.control.id&&r.name===p.d1.control.name,kind:'control-d1'},
    {path:'/accounts/'+p.accountId+'/d1/database/'+p.d1.pilot.id,
      matches:r=>r.uuid===p.d1.pilot.id&&r.name===p.d1.pilot.name,kind:'pilot-d1'}
  ];
  for(const check of resourceChecks){
    let matched=false;
    try{
      const response=await fetchFn(CLOUD_API+check.path,{
        method:'GET',redirect:'error',cache:'no-store',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        signal:AbortSignal.timeout(10000)
      });
      if(response?.ok===true && typeof response.json==='function'){
        const envelope=await response.json();
        matched=envelope?.success===true && envelope?.result!=null &&
          typeof envelope.result==='object' && !Array.isArray(envelope.result) &&
          check.matches(envelope.result);
      }
    }catch{
      // Do not leak Cloudflare error bodies or raw network messages.
      matched=false;
    }
    if(!matched)throw denied();
  }
  return {
    formatVersion:1,
    mode:'cloudflare-read-only',
    remoteQueries:resourceChecks.length,
    resourceVerification:'verified',
    verified:resourceChecks.map(c=>c.kind),
    allowDeploy:false,
    allowRemoteMigrations:false,
    remainingGates:tasks.filter(x=>x!=='cloudflare-identity')
  };
}

async function main(){
  const [action,filename,...extra]=process.argv.slice(2);
  if(extra.length||!filename||!['--dry-run','--verify-readonly'].includes(action))
    throw new Error('Invalid PORT-P2 preflight invocation');
  const instance=JSON.parse(await readFile(resolve(filename),'utf8'));
  validatePortableInstance(instance);
  verifyPublicPreviewIsUnbound(await readFile(resolve(ROOT,'wrangler.preview.jsonc'),'utf8'));
  const result=action==='--dry-run'
    ? planBootstrapDryRun(instance)
    : await verifyBootstrapReadOnly(instance,{token:process.env.CLOUDFLARE_API_TOKEN});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    process.stderr.write('PORT-P2 preflight denied; check local manifest or read-only Cloudflare permissions\n');
    process.exitCode=1;
  });
}
