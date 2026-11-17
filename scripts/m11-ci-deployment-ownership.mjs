#!/usr/bin/env node
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCloudflarePreviewConfig} from './check-cloudflare-preview.mjs';

/**
 * Offline M11-owned workflow source audit, not a YAML executor, GitHub policy
 * oracle, Cloudflare control-plane query or production authorization.
 * Cloudflare Workers Builds remains the only public preview deploy owner.
 */
const FILE=/^[a-z0-9][a-z0-9._-]*\.ya?ml$/;
const SECRET=/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
const DEPLOY_ACTION=/\b(?:cloudflare\/(?:wrangler-action|pages-action)|wrangler-action@|pages-action@)/i;
const WRANGLER_DEPLOY=/\bwrangler(?:@[a-z0-9._-]+)?\s+deploy\b[^\r\n]*/gi;
// Alternative publish verbs must not create a second GitHub deployment owner.
// Unlike Worker `deploy --dry-run`, these methods have no approved CI exception.
const ALT_WRANGLER_PUBLISH=/\bwrangler(?:@[a-z0-9._-]+)?\s+(?:pages\s+(?:deploy|publish)|versions\s+(?:deploy|upload)|publish)\b/i;
const MANUAL='remote-d1-staging.yml';
// Reviewed Git blob on main before M11-13. Any change requires a new M11 owner review.
const APPROVED_STAGING_BLOB='cd8ef338cf2e532f43c12fffc01654452917fe60';
const blobSha=content=>createHash('sha1')
  .update('blob '+Buffer.byteLength(content,'utf8')+String.fromCharCode(0),'utf8')
  .update(content,'utf8').digest('hex');
const EXPECTED=new Set(['cloudflare-preview.yml',MANUAL]);
const ALLOWED_STAGING_SECRETS=new Set([
  'CLOUDFLARE_D1_STAGING_TOKEN','CLOUDFLARE_ACCOUNT_ID'
]);
const CAUTION='Static source check only: GitHub permissions, protected environments, live Cloudflare bindings, M10 approval and production cutover remain independently unverified. This check never deploys Workers or runs D1 operations.';
const setCode=(set,code)=>set.add(code);
const lines=content=>content.split(/\r?\n/);

function manualTriggersOnly(content) {
  // Exactly one indented workflow_dispatch trigger. No push/PR/schedule event
  // may be used to bypass the reviewed, environment-scoped staging operation.
  const block=content.match(/^on:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m);
  if(!block)return false;
  const triggers=block[1].split(/\r?\n/)
    .filter(x=>/^ {2}[a-z_]+:/.test(x))
    .map(x=>x.trim().split(':')[0]);
  return triggers.length===1&&triggers[0]==='workflow_dispatch';
}
function readStagingAudit(content,block) {
  if(!manualTriggersOnly(content)){
    setCode(block,'M11_CI_STAGING_MANUAL_ONLY');
  }
  const guards=[
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    "inputs.operation == 'inspect'",
    "inputs.operation == 'apply'",
    "inputs.confirmation == 'APPLY_STAGING_D1_SCHEMA_ONLY'",
    'environment: cloudflare-staging-db',
    'EXPECTED_REMOTE_MIGRATION_COUNT=2',
    'guard-remote-staging.mjs assert-empty',
    'guard-remote-staging.mjs verify-identity'
  ];
  if(guards.some(g=>!content.includes(g)))setCode(block,'M11_CI_STAGING_GUARD_MISSING');
  const secrets=[...content.matchAll(SECRET)].map(x=>x[1]);
  if(ALLOWED_STAGING_SECRETS.size!==new Set(secrets).size||
    secrets.some(name=>!ALLOWED_STAGING_SECRETS.has(name))){
    setCode(block,'M11_CI_STAGING_GUARD_MISSING');
  }
  if(!content.includes('--remote')){
    setCode(block,'M11_CI_STAGING_GUARD_MISSING');
  }
  for(const line of lines(content)){
    if(!line.includes('--remote'))continue;
    if(!/\bwrangler(?:@[a-z0-9._-]+)?\s+d1\s+/i.test(line)||
      !line.includes('shererp-staging-db')||
      !line.includes('--config wrangler.staging.jsonc')){
      setCode(block,'M11_CI_STAGING_TARGET_INVALID');
    }
  }
}
function checkOrdinaryWorkflow(content,block) {
  if(SECRET.test(content))setCode(block,'M11_CI_SECRET_IN_WORKFLOW');
  SECRET.lastIndex=0;
  if(/--remote\b/i.test(content))setCode(block,'M11_CI_REMOTE_D1_BLOCKED');
}
function checkSharedWorkflow(content,block) {
  if(!/on:\s*\r?\n\s+pull_request:/m.test(content)||
    !content.includes('npm test')||
    !content.includes('node scripts/check-cloudflare-preview.mjs wrangler.preview.jsonc')||
    !content.includes('node scripts/check-m11-preview-runtime.mjs')||
    !/\bwrangler(?:@[a-z0-9._-]+)?\s+deploy\s+--dry-run\b/i.test(content)){
    setCode(block,'M11_CI_PREVIEW_GATE_MISSING');
  }
}

/**
 * Pure source-only check. Use exact fixed blocker codes to avoid exposing
 * configuration values, credentials or raw workflow lines in CI logs.
 */
export function auditM11CiDeploymentOwnership({workflows,previewConfig}={}) {
  const blockers=new Set();
  const result=(count=0)=>({
    safe:blockers.size===0,checkedWorkflows:count,
    authorizesDeployment:false,authorizesRemoteD1Write:false,
    blockers:[...blockers].sort(),caution:CAUTION
  });
  if(!Array.isArray(workflows)||workflows.length<2){
    setCode(blockers,'M11_CI_WORKFLOW_SET_INVALID');
    return result();
  }
  const files=new Map();
  for(const wf of workflows){
    if(wf===null||typeof wf!=='object'||Array.isArray(wf)||
      Reflect.ownKeys(wf).length!==2||
      !Object.hasOwn(wf,'name')||!Object.hasOwn(wf,'content')||
      typeof wf.name!=='string'||!FILE.test(wf.name)||
      typeof wf.content!=='string'||files.has(wf.name)){
      setCode(blockers,'M11_CI_WORKFLOW_SET_INVALID');
      continue;
    }
    files.set(wf.name,wf.content);
  }
  for(const required of EXPECTED){
    if(!files.has(required))setCode(blockers,'M11_CI_REQUIRED_WORKFLOW_MISSING');
  }
  try{validateCloudflarePreviewConfig(previewConfig);}
  catch{setCode(blockers,'M11_CI_PUBLIC_PREVIEW_UNSAFE');}

  for(const [name,content] of files){
    // No other GitHub Action may publish Workers or use cloud deployment
    // actions. A complete Wrangler command line must explicitly say dry-run.
    if(DEPLOY_ACTION.test(content))setCode(blockers,'M11_CI_DEPLOY_ACTION_BLOCKED');
    if(ALT_WRANGLER_PUBLISH.test(content)){
      setCode(blockers,'M11_CI_DEPLOY_COMMAND_BLOCKED');
    }
    for(const command of content.matchAll(WRANGLER_DEPLOY)){
      if(!/(?:^|\s)--dry-run(?:\s|$)/.test(command[0])){
        setCode(blockers,'M11_CI_DEPLOY_COMMAND_BLOCKED');
      }
    }
    if(name===MANUAL){
      // Existing syntax/token checks cannot see a bypass hidden behind a
      // retained comment or a second shell command. Seal the *whole* approved
      // manual staging workflow, including executable approval and SQL steps.
      if(blobSha(content)!==APPROVED_STAGING_BLOB){
        setCode(blockers,'M11_CI_STAGING_UNREVIEWED_CHANGE');
      }
      readStagingAudit(content,blockers);
    }else{
      checkOrdinaryWorkflow(content,blockers);
      if(name==='cloudflare-preview.yml')checkSharedWorkflow(content,blockers);
    }
  }
  return result(files.size);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=new URL('../',import.meta.url);
    const workflowDir=new URL('.github/workflows/',root);
    const workflows=readdirSync(workflowDir)
      .filter(name=>/\.ya?ml$/.test(name))
      .map(name=>({name,content:readFileSync(new URL(name,workflowDir),'utf8')}));
    const previewConfig=JSON.parse(readFileSync(new URL('wrangler.preview.jsonc',root),'utf8'));
    const report=auditM11CiDeploymentOwnership({workflows,previewConfig});
    console.log('M11 GitHub deployment-owner audit: '+(report.safe?'SAFE_SOURCE':'BLOCKED')+
      ' ('+report.checkedWorkflows+' workflow files checked)');
    if(report.blockers.length)console.error('Fixed blocker codes: '+report.blockers.join(', '));
    console.log(report.caution);
    if(!report.safe)process.exitCode=1;
  }catch{
    console.error('M11 GitHub deployment-owner audit: BLOCKED (input unavailable or invalid)');
    process.exitCode=1;
  }
}
