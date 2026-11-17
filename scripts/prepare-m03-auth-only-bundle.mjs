#!/usr/bin/env node
/**
 * M03 reviewed auth-only migration bundle. Local filesystem preparation only.
 * It never connects to Cloudflare, selects real staff, or grants migration
 * authority. An independent M11-approved operator must control any apply.
 */
import {createHash} from 'node:crypto';
import {
 existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,
 rmSync,writeFileSync,
} from 'node:fs';
import {resolve,dirname,isAbsolute,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO=resolve(fileURLToPath(new URL('../',import.meta.url)));
const DEFAULT_ROOT=join(REPO,'migrations');
const fail=()=>new Error('M03 auth-only migration bundle rejected');
export const AUTH_ONLY_SQL=Object.freeze([
 Object.freeze({name:'0001_core_catalog.sql',sha256:'e15280ba1bc3db2ced97415bad290bbe39fda9a6bc2735e642f6e1a52388029a'}),
 Object.freeze({name:'0002_party_identity.sql',sha256:'9ea71c03a06ba7a5b0325e5aed9ed16dd3f78eb63719c3ed05d074b55b27b3e3'}),
 Object.freeze({name:'0003_auth_core.sql',sha256:'5b676cc734d0ed433e4c4c70765514e456df197ecf1455f0ea7b46b7660c4d7e'}),
 Object.freeze({name:'0004_auth_source_provenance.sql',sha256:'2d9b20b79a2c29c673759ffda1be5a65daa76c2705a9a72e46f1877814045f91'}),
]);
const hash=data=>createHash('sha256').update(data).digest('hex');
const isWithin=(path,root)=>path===root||path.startsWith(root+sep);

/**
 * Creates only 0001-0004 in a newly-created isolated directory, with an
 * independent CLI-only Wrangler config. The original repo's 14-file queue
 * and its protected remote staging workflow are never edited.
 */
export function makeM03AuthOnlyBundle(target,options={}){
 let created=false,destination;
 try{
  if(typeof target!=='string'||target.length<4||target.length>4096||
     !isAbsolute(target)||target.includes('\0'))throw fail();
  if(!options||typeof options!=='object'||Array.isArray(options)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw fail();
  const keys=Reflect.ownKeys(options);
  if(keys.some(k=>k!=='migrationRoot'))throw fail();
  const descriptor=Object.getOwnPropertyDescriptor(options,'migrationRoot');
  const root=descriptor?descriptor.value:DEFAULT_ROOT;
  if(typeof root!=='string')throw fail();
  const source=realpathSync(root);
  if(!lstatSync(source).isDirectory())throw fail();
  destination=resolve(target);
  const parent=realpathSync(dirname(destination));
  if(isWithin(destination,REPO)||isWithin(REPO,destination)||
     isWithin(destination,source)||existsSync(destination)||
     !lstatSync(parent).isDirectory())throw fail();
  const contents=AUTH_ONLY_SQL.map(({name,sha256})=>{
   const pathname=join(source,name);
   if(!lstatSync(pathname).isFile())throw fail();
   const data=readFileSync(pathname);
   if(data.length===0||data.length>256*1024||hash(data)!==sha256)throw fail();
   return {name,data};
  });
  const config={
   name:'shererp-auth-only-schema-migration',
   compatibility_date:'2026-11-14',
   workers_dev:false,
   d1_databases:[{
    binding:'DB',database_name:'shererp-staging-db',
    database_id:'aa04618e-1639-4cb9-bdf5-7b967d8b968b',
    migrations_dir:'migrations',
   }],
  };
  mkdirSync(destination,{mode:0o700});created=true;
  mkdirSync(join(destination,'migrations'),{mode:0o700});
  for(const {name,data} of contents)
   writeFileSync(join(destination,'migrations',name),data,{mode:0o600,flag:'wx'});
  writeFileSync(join(destination,'wrangler.auth-only.jsonc'),
    JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  return Object.freeze({
   migrationBundlePrepared:true,
   migrations:AUTH_ONLY_SQL.map(x=>x.name),
   authMigrationsToApply:2,
   exactStagingDatabaseId:config.d1_databases[0].database_id,
   original14FileMigrationDirectoryUnchanged:true,
   remoteMigrationAuthorized:false,
   staffImportAuthorized:false,
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
  const result=makeM03AuthOnlyBundle(process.argv[2]);
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch{
  process.stderr.write('M03 auth-only migration bundle rejected\n');
  process.exitCode=2;
 }
}
