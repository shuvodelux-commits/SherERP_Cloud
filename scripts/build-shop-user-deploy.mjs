#!/usr/bin/env node
/**
 * M03 Shop-user Cloudflare Builds release profile.
 * Constructs the existing authenticated Owner Worker at the EXISTING
 * shererp.hisab.workers.dev URL. All account/Shop values come from approved
 * Workers Builds variables, not repository fixtures or GitHub secrets.
 *
 * No network requests, remote D1 queries, SQL migrations or deployments.
 * Fail closed unless the production branch and explicit Owner-login-only
 * release gate are both selected. This does not prove hosted readiness.
 */
import {readFile,writeFile,lstat,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildShopUserCandidate} from './port-p5-shop-user-login.mjs';
import {buildFirstShopCoreCandidate,buildFirstShopDevelopmentCandidate}
  from './m03-first-shop-core-activation.mjs';
import {validateCloudflarePreviewConfig} from './check-cloudflare-preview.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ADMIN_ORIGIN='https://admin.hisab.workers.dev';
const SHOP_ORIGIN='https://shererp.hisab.workers.dev';
const TARGET='wrangler.shop-user.jsonc';
// Fixed codes identify a failed protected build gate without printing any
// account, Shop, Google client, release evidence or user-supplied value.
const SAFE_CODES=new Set([
  'RELEASE_OWNED_BY_PRIVATE_PROVISIONER','RELEASE_BUILD_CONTEXT_INVALID',
  'RELEASE_OWNER_LOGIN_APPROVAL_INVALID','RELEASE_CLOUDFLARE_ACCOUNT_MISMATCH',
  'RELEASE_SHOP_MANIFEST_INVALID','RELEASE_GENERATED_CONFIG_INVALID',
  'RELEASE_MODE_INVALID','RELEASE_COMMIT_PIN_INVALID',
  'RELEASE_COMMIT_PIN_MISMATCH','RELEASE_READINESS_JSON_INVALID',
  'RELEASE_READINESS_PROFILE_MISMATCH','RELEASE_MODE_REQUIRED_FOR_CORE',
  'RELEASE_DEVELOPMENT_CONFIRMATION_REQUIRED',
  'RELEASE_POLICY_MISMATCH'
]);
const invalid=(code='RELEASE_POLICY_MISMATCH')=>{
  const error=new TypeError('Shop-user deployment configuration unavailable (values withheld)');
  error.code=SAFE_CODES.has(code)?code:'RELEASE_POLICY_MISMATCH';
  throw error;
};

export function buildShopUserDeployment(env){
  // Once the private multi-Shop publisher owns the Worker, the legacy
  // single-Shop Builds generator must never upload a stale binding roster.
  // This flag is a one-time operator setting, not browser-controlled.
  if(env?.SHERERP_DEPLOYMENT_OWNER==='PRIVATE_PROVISIONER')invalid('RELEASE_OWNED_BY_PRIVATE_PROVISIONER');
  if(!env||env.WORKERS_CI!=='1'||env.WORKERS_CI_BRANCH!=='main')
    invalid('RELEASE_BUILD_CONTEXT_INVALID');
  if(env.SHERERP_OWNER_LOGIN_RELEASE!=='OWNER_LOGIN_ONLY_APPROVED')
    invalid('RELEASE_OWNER_LOGIN_APPROVAL_INVALID');
  if(typeof env.CLOUDFLARE_ACCOUNT_ID==='string'&&env.CLOUDFLARE_ACCOUNT_ID.length>0&&
     env.CLOUDFLARE_ACCOUNT_ID!==env.SHERERP_ACCOUNT_ID)
    invalid('RELEASE_CLOUDFLARE_ACCOUNT_MISMATCH');

  // The portable instance validator provides strict shape, UUID, origin,
  // account, Google-client and namespace checks; no new auth mechanism.
  const manifest={
    formatVersion:1,
    accountId:env.SHERERP_ACCOUNT_ID,
    workersSubdomain:'hisab',
    workers:{admin:'admin',owner:'shererp'},
    origins:{admin:ADMIN_ORIGIN,owner:SHOP_ORIGIN},
    googleClientId:env.SHERERP_OWNER_GOOGLE_CLIENT_ID,
    d1:{
      control:{name:env.SHERERP_CONTROL_DB_NAME,id:env.SHERERP_CONTROL_DB_ID},
      pilot:{
        name:env.SHERERP_SHOP_DB_NAME,
        id:env.SHERERP_SHOP_DB_ID,
        shopId:env.SHERERP_SHOP_ID,
        marker:env.SHERERP_SHOP_MARKER
      }
    },
    rateLimits:{
      // Separate reserved namespace for Admin, never bound in this profile.
      adminNamespaceId:env.SHERERP_OWNER_RATE_LIMIT_NAMESPACE==='1'?'2':'1',
      ownerNamespaceId:env.SHERERP_OWNER_RATE_LIMIT_NAMESPACE
    }
  };
  let candidate;
  try{candidate=buildShopUserCandidate(manifest,SHOP_ORIGIN);}
  catch{invalid('RELEASE_SHOP_MANIFEST_INVALID');}

  // The P5 draft lives under .wrangler/portable-instance; the generated
  // production profile is at repo root. Convert ONLY known relative paths.
  const rootPath=path=>{
    if(typeof path!=='string'||!path.startsWith('../../')||
      path.includes('..',6))invalid('RELEASE_GENERATED_CONFIG_INVALID');
    return path.slice(6);
  };
  const config={
    ...candidate,
    main:rootPath(candidate.main),
    assets:{...candidate.assets,directory:rootPath(candidate.assets.directory)},
    d1_databases:candidate.d1_databases.map(db=>({
      ...db,migrations_dir:rootPath(db.migrations_dir)
    }))
  };
  if(config.name!=='shererp'||
    config.main!=='src/m03-owner-redemption-worker.js'||
    config.assets.directory!=='dist-owner'||
    config.vars.OWNER_LOGIN_ENABLED!=='true'||
    config.vars.OWNER_GMAIL_SIGNUP_ENABLED!=='true'||
    config.vars.OWNER_DASHBOARD_BOOTSTRAP_ENABLED!=='true'||
    config.d1_databases.length!==2||
    config.d1_databases[0].binding!=='CONTROL_DB'||
    config.d1_databases[1].binding!=='PLATFORM_PILOT_DB'||
    config.ratelimits.length!==1||
    config.ratelimits[0].name!=='OWNER_INGRESS')
    invalid('RELEASE_GENERATED_CONFIG_INVALID');

  // Workers Builds is still the ONLY deploy owner for the one-Shop pilot.
  // An approved core release (first activation OR current-core refresh) is
  // pinned to one exact main SHA and fresh, read-only LIVE D1 proof. A merge
  // cannot silently redeploy login-only or enable an unreviewed feature.
  if(env.SHERERP_FIRST_SHOP_CORE_RELEASE===undefined){
    // Incomplete protected refresh metadata must NEVER silently produce a
    // login-only profile and reset an already-enabled Shop's core flags.
    if(env.SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT!==undefined||
       env.SHERERP_FIRST_SHOP_CORE_READINESS_JSON!==undefined||
       env.SHERERP_DEVELOPMENT_CORE_CONFIRMATION!==undefined)
      invalid('RELEASE_MODE_REQUIRED_FOR_CORE');
    return config;
  }
  // This is a one-time operator opt-in for an already-activated development
  // Shop. Stale production SHA/report inputs are intentionally not consulted:
  // the five pre-approved core flags remain identical across main commits.
  // Owner/Shop identity and main-only Cloudflare Builds gates above still apply.
  if(env.SHERERP_FIRST_SHOP_CORE_RELEASE==='DEVELOPMENT_AUTO'){
    if(env.SHERERP_DEVELOPMENT_CORE_CONFIRMATION!==
       'EXISTING_SHOP_CORE_VERIFIED')
      invalid('RELEASE_DEVELOPMENT_CONFIRMATION_REQUIRED');
    try{return buildFirstShopDevelopmentCandidate(config,
      env.SHERERP_DEVELOPMENT_CORE_CONFIRMATION);}
    catch{invalid('RELEASE_READINESS_PROFILE_MISMATCH');}
  }
  const sha=/^[a-f0-9]{40}$/;
  if(!['FIRST_SHOP_CORE_MVP_TEST_ONLY','FIRST_SHOP_CORE_MVP_REFRESH']
       .includes(env.SHERERP_FIRST_SHOP_CORE_RELEASE))
    invalid('RELEASE_MODE_INVALID');
  if(!sha.test(env.WORKERS_CI_COMMIT_SHA)||
     !sha.test(env.SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT))
    invalid('RELEASE_COMMIT_PIN_INVALID');
  if(env.WORKERS_CI_COMMIT_SHA!==env.SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT)
    invalid('RELEASE_COMMIT_PIN_MISMATCH');
  if(typeof env.SHERERP_FIRST_SHOP_CORE_READINESS_JSON!=='string'||
     env.SHERERP_FIRST_SHOP_CORE_READINESS_JSON.length>4000)
    invalid('RELEASE_READINESS_JSON_INVALID');
  let evidence;
  try{evidence=JSON.parse(env.SHERERP_FIRST_SHOP_CORE_READINESS_JSON);}
  catch{invalid('RELEASE_READINESS_JSON_INVALID');}
  try{
    return buildFirstShopCoreCandidate(config,evidence,
      env.SHERERP_FIRST_SHOP_CORE_RELEASE);
  }catch{invalid('RELEASE_READINESS_PROFILE_MISMATCH');}
}

/** Create the ignored root config without ever replacing a different file. */
export async function writeShopUserDeployment(env,root=ROOT){
  const config=buildShopUserDeployment(env);
  const path=join(resolve(root),TARGET);
  const contents=JSON.stringify(config,null,2)+'\n';
  try{
    const st=await lstat(path);
    if(!st.isFile()||st.isSymbolicLink()||await readFile(path,'utf8')!==contents)
      throw new Error('Refusing to overwrite existing shop-user configuration');
    return path;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try{
    await writeFile(path,contents,{flag:'wx',mode:0o600});
  }catch(error){
    if(error.code!=='EEXIST' || await readFile(path,'utf8')!==contents)
      throw new Error('Refusing to overwrite existing shop-user configuration');
  }
  return path;
}

async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--generate')invalid();
  // A build-only profile cannot silently turn the public PR Preview into a
  // financial Worker even if a shared build script changes later.
  const preview=JSON.parse(await readFile(join(ROOT,'wrangler.preview.jsonc'),'utf8'));
  validateCloudflarePreviewConfig(preview);
  // Require the unchanged Owner frontend build BEFORE preparing a deploy.
  for(const name of ['index.html','owner-erp.html']){
    if(!(await stat(join(ROOT,'dist-owner',name))).isFile())invalid();
  }
  await writeShopUserDeployment(process.env);
  process.stdout.write('Shop-user deployment profile prepared; hosted Cloudflare/Owner identity verification is still required\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    const code=SAFE_CODES.has(error?.code)?error.code:'RELEASE_POLICY_MISMATCH';
    process.stderr.write('Shop-user deployment blocked ['+code+']: check protected Builds configuration and approved release evidence (values withheld)\n');
    process.exitCode=1;
  });
}
