#!/usr/bin/env node
/**
 * One-time, operator-reviewed installation profile for a PRIVATE provisioner.
 * Produces a closed Worker with Control D1 only. Never embeds secrets.
 * Installation, secret binding and release activation require separate approval.
 */
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ACCOUNT=/^[0-9a-f]{32}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME=/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BAD=()=>{throw Error('PRIVATE_PROVISIONER_CONFIG_DENIED');};

export function buildPrivateProvisionerProfile(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).length!==4||
    !ACCOUNT.test(input.accountId)||!UUID.test(input.controlDbId)||
    !NAME.test(input.controlDbName)||!Number.isSafeInteger(input.maxDatabases)||
    input.maxDatabases<1||input.maxDatabases>1000)BAD();
  return {
    name:'shererp-provisioner',
    account_id:input.accountId,
    main:'../src/m03-private-shop-provisioner-worker.js',
    compatibility_date:'2026-11-14',
    workers_dev:false,preview_urls:false,keep_vars:false,
    vars:{
      PROVISIONER_RELEASE_ENABLED:'false',
      PROVISIONER_ALLOWED_ACCOUNT_ID:input.accountId,
      PROVISIONER_MAX_DATABASES:String(input.maxDatabases)
    },
    d1_databases:[{
      binding:'CONTROL_DB',database_name:input.controlDbName,
      database_id:input.controlDbId,
      migrations_dir:'../staging-migrations/platform-onboarding',
      remote:false
    }]
  };
}

export async function writePrivateProvisionerProfile(input,root=ROOT){
  const path=join(resolve(root),'.wrangler','private-provisioner.jsonc');
  const config=buildPrivateProvisionerProfile(input);
  await mkdir(join(resolve(root),'.wrangler'),{recursive:true,mode:0o700});
  const body=JSON.stringify(config,null,2)+'\n';
  const existing=await lstat(path).catch(error=>error.code==='ENOENT'?null:BAD());
  if(existing){
    if(!existing.isFile()||existing.isSymbolicLink()||
      await readFile(path,'utf8')!==body)BAD();
    return path;
  }
  await writeFile(path,body,{mode:0o600,flag:'wx'});
  return path;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,settings]=process.argv.slice(2);
  if(command!=='--generate'||!settings||process.argv.length!==4)BAD();
  try{
    const input=JSON.parse(await readFile(resolve(settings),'utf8'));
    const file=await writePrivateProvisionerProfile(input);
    console.log('Prepared a fail-closed PRIVATE provisioner profile: '+file);
    console.log('No Cloudflare API call, live D1 write or Worker deployment performed.');
  }catch{
    console.error('Private provisioner profile unavailable; no Cloudflare changes');
    process.exitCode=1;
  }
}
