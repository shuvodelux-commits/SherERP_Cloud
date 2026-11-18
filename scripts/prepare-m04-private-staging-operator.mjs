#!/usr/bin/env node
/**
 * Prepare private, nondeploying M04 operator files on an authorized machine.
 * This script NEVER contacts Cloudflare, exports staff, or runs an import.
 * The one-use secret stays under a fresh 0700 directory outside GitHub.
 */
import {randomBytes} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const WORKER=realpathSync(fileURLToPath(new URL('../src/auth/m04-private-import-operator.js',import.meta.url)));
const ID='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const NAME='shererp-staging-db';
const fail=()=>new Error('M04 private staging operator preparation rejected');
const within=(path,root)=>path===root||path.startsWith(root+sep);

export function makeM04PrivateStagingOperatorBundle(target){
 let destination,created=false;
 try{
  if(typeof target!=='string'||target.length<4||target.length>4096||
     !isAbsolute(target)||target.includes('\0'))throw fail();
  destination=resolve(target);
  const parent=realpathSync(dirname(destination));
  if(!lstatSync(parent).isDirectory()||existsSync(destination)||
     within(destination,REPO)||within(REPO,destination)||within(destination,WORKER))
   throw fail();
  const secret=randomBytes(32).toString('base64url');
  if(secret.length<40)throw fail();
  const config={
   name:'shererp-m04-private-one-shot',
   main:WORKER,
   compatibility_date:'2026-11-14',
   workers_dev:false,
   vars:{
    M04_PRIVATE_SCOPE:'private-staging-one-shot',
    M04_D1_UUID:ID,
   },
   d1_databases:[{
    binding:'DB',
    database_name:NAME,
    database_id:ID,
    remote:true,
   }],
  };
  mkdirSync(destination,{mode:0o700});created=true;
  writeFileSync(join(destination,'wrangler.private.jsonc'),JSON.stringify(config,null,2)+'\n',
   {mode:0o600,flag:'wx'});
  writeFileSync(join(destination,'.dev.vars'),'M04_IMPORT_TOKEN='+secret+'\n',
   {mode:0o600,flag:'wx'});
  return Object.freeze({
   prepared:true,
   bindingCount:1,
   databaseName:NAME,
   databaseId:ID,
   localOnlyTransportRequired:true,
   rootPublicWorkerUnmodified:true,
   credentialsIncludedInResponse:false,
   remoteImportAuthorized:false,
   publicAuthenticationEnabled:false,
   productionReady:false,
  });
 }catch{
  if(created&&destination)rmSync(destination,{recursive:true,force:true});
  throw fail();
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw fail();
  process.stdout.write(JSON.stringify(makeM04PrivateStagingOperatorBundle(process.argv[2]))+'\n');
 }catch{
  process.stderr.write('M04 private staging operator preparation rejected\n');
  process.exitCode=2;
 }
}
