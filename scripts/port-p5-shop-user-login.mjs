#!/usr/bin/env node
/**
 * M03 / PORT-P5 — prepare the EXISTING Shop Owner Worker for the approved
 * shop-user workers.dev URL. This is an inert, local release candidate:
 * no Cloudflare calls, no remote D1 writes, no deployment, no admin changes.
 */
import {readFile,mkdir,lstat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPortableProfiles,validatePortableInstance} from './port-p1-instance.mjs';
import {verifyPublicPreviewIsUnbound} from './port-p0-inventory.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const invalid=()=>{throw new TypeError('Invalid Shop-user candidate (no identities disclosed)');};

/**
 * The Owner entrypoint already implements same-origin Google ID-token
 * verification, D1-backed sessions, an authenticated /app, and logout.
 * Reuse it at the existing shop-user URL. Never enable a public RPC.
 *
 * Important: This profile is NOT a release permit. The account's actual
 * database migrations, approved Owner Gmail, Worker ownership, rate limits,
 * assets, backup and independent security/tenant checks must pass first.
 */
export function buildShopUserCandidate(input,expectedOrigin){
  let manifest,owner;
  try{
    manifest=validatePortableInstance(input);
    owner=buildPortableProfiles(manifest).owner;
  }catch{invalid();}
  if(typeof expectedOrigin!=='string'||
    expectedOrigin!==manifest.origins.owner ||
    owner.name!==manifest.workers.owner ||
    owner.name===manifest.workers.admin ||
    owner.name==='hisabiq' ||
    owner.main!=='../../src/m03-owner-redemption-worker.js' ||
    owner.assets?.directory!=='../../dist-owner' ||
    owner.workers_dev!==false ||
    owner.preview_urls!==false)invalid();

  return {
    ...owner,
    // The generated candidate is served ONLY after a separate security and
    // release GO. No application file or live Wrangler profile is changed.
    workers_dev:true,
    preview_urls:false,
    vars:{
      ...owner.vars,
      // Reuse the existing Owner Google challenge, approved-Gmail first login,
      // D1 session, secure host-only cookie and protected legacy ERP /app.
      OWNER_LOGIN_ENABLED:'true',
      OWNER_GMAIL_SIGNUP_ENABLED:'true',
      OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_REDEMPTION_ENABLED:'false',
      // Keep every operational writer off until independent release approval.
      OWNER_CATALOG_ENABLED:'false',
      OWNER_CLEAN_PRODUCTS_ENABLED:'false',
      OWNER_WRITE_GRANTS_ENABLED:'false',
      OWNER_MVP_PURCHASE_ENABLED:'false',
      OWNER_MVP_POS_CASH_ENABLED:'false',
      OWNER_MVP_CASH_RETURN_ENABLED:'false',
      OWNER_SUPPORT_AUDIT_ENABLED:'false'
    }
  };
}

/** Write one ignored private candidate, never the public preview or Admin. */
export async function writeShopUserCandidate(input,expectedOrigin,root=ROOT){
  const profile=buildShopUserCandidate(input,expectedOrigin);
  const directory=join(resolve(root),'.wrangler','portable-instance');
  const path=join(directory,'shop-user.candidate.jsonc');
  const contents=JSON.stringify(profile,null,2)+'\n';
  await mkdir(directory,{recursive:true,mode:0o700});
  try{
    const st=await lstat(path);
    if(!st.isFile()||st.isSymbolicLink() ||
       await readFile(path,'utf8')!==contents){
      throw new Error('Refusing to overwrite existing Shop-user candidate');
    }
    return path;
  }catch(error){
    if(error.code!=='ENOENT')throw error;
  }
  try{
    await writeFile(path,contents,{flag:'wx',mode:0o600});
  }catch(error){
    if(error.code!=='EEXIST'||
      await readFile(path,'utf8')!==contents)
      throw new Error('Refusing to overwrite existing Shop-user candidate');
  }
  return path;
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length!==3||!['--check','--generate'].includes(args[0]))
    throw new Error('Usage: node scripts/port-p5-shop-user-login.mjs --check|--generate <private-manifest.json> <exact-owner-https-origin>');
  const instance=JSON.parse(await readFile(resolve(args[1]),'utf8'));
  buildShopUserCandidate(instance,args[2]);
  // Keep the inert public Preview isolated even when preparing a new
  // authenticated Worker under the separately chosen shop-user name.
  verifyPublicPreviewIsUnbound(await readFile(join(ROOT,'wrangler.preview.jsonc'),'utf8'));
  if(args[0]==='--generate'){
    await writeShopUserCandidate(instance,args[2]);
    process.stdout.write('Shop-user candidate written privately; deployment and release approval still pending\n');
  }else{
    process.stdout.write('Shop-user login candidate valid; hosted Owner and Shop D1 checks still pending\n');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    process.stderr.write('Shop-user candidate preparation failed; no identifiers printed\n');
    process.exitCode=1;
  });
}
