#!/usr/bin/env node
/**
 * PORT-00 P1 — local, fail-closed instance validation and profile drafts.
 * No Cloudflare API, authentication, deployment, migration or remote writes.
 * Generated local files are under the existing gitignored .wrangler/ folder.
 * P2/M11 must verify actual resource ownership, authentication and rollback.
 */
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPublicPreviewIsUnbound} from './port-p0-inventory.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ACCOUNT=/^[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SLUG=/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DB_NAME=/^[a-z](?:[a-z0-9_-]{0,61}[a-z0-9])?$/;
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const NAMESPACE=/^[1-9][0-9]{0,15}$/;
export const GOOGLE_TOTP_ADMIN_MODE='google-totp-without-access';
const invalid=()=>{throw new TypeError('Invalid portable instance manifest (no values printed)');};

function record(x,keys){
  if(!x||typeof x!=='object'||Array.isArray(x)||
    (Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null))invalid();
  const own=Reflect.ownKeys(x);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)||
    !Object.hasOwn(Object.getOwnPropertyDescriptors(x)[k],'value')))invalid();
  return x;
}
function testStr(x,re){
  if(typeof x!=='string'||!re.test(x))invalid();
  return x;
}
function distinct(strings){
  if(new Set(strings).size!==strings.length)invalid();
}
const expectedOrigin=(name,namespace)=>'https://'+name+'.'+namespace+'.workers.dev';

export function validatePortableInstance(input){
  const keys=['formatVersion','accountId','workersSubdomain','workers','origins',
    'googleClientId','d1','rateLimits'];
  const hasAuthMode=Object.hasOwn(input??{},'adminAuthMode');
  if(hasAuthMode)keys.push('adminAuthMode');
  const p=record(input,keys);
  if(p.formatVersion!==1)invalid();
  if(hasAuthMode && p.adminAuthMode!=='cloudflare-access' &&
    p.adminAuthMode!==GOOGLE_TOTP_ADMIN_MODE)invalid();
  testStr(p.accountId,ACCOUNT);
  if(/^0+$/.test(p.accountId))invalid();
  const subdomain=testStr(p.workersSubdomain,SLUG);
  const w=record(p.workers,['admin','owner']);
  const names=[testStr(w.admin,SLUG),testStr(w.owner,SLUG)];
  distinct(names);
  if(names.includes('hisabiq'))invalid();
  const o=record(p.origins,['admin','owner']);
  if(o.admin!==expectedOrigin(w.admin,subdomain) ||
    o.owner!==expectedOrigin(w.owner,subdomain))invalid();
  testStr(p.googleClientId,GOOGLE_CLIENT);
  const databases=record(p.d1,['control','pilot']);
  const control=record(databases.control,['name','id']);
  const shop=record(databases.pilot,['name','id','shopId','marker']);
  testStr(control.name,DB_NAME);
  testStr(shop.name,DB_NAME);
  distinct([control.name,shop.name]);
  const uuids=[testStr(control.id,UUID),testStr(shop.id,UUID),
    testStr(shop.shopId,UUID),testStr(shop.marker,UUID)];
  distinct(uuids);
  const limits=record(p.rateLimits,['adminNamespaceId','ownerNamespaceId']);
  distinct([testStr(limits.adminNamespaceId,NAMESPACE),testStr(limits.ownerNamespaceId,NAMESPACE)]);
  // Return an own-data-only structural copy. Keep the source object unmodified.
  return {
    formatVersion:1,accountId:p.accountId,workersSubdomain:subdomain,
    ...(hasAuthMode?{adminAuthMode:p.adminAuthMode}:{}),
    workers:{admin:w.admin,owner:w.owner},
    origins:{admin:o.admin,owner:o.owner},
    googleClientId:p.googleClientId,
    d1:{control:{name:control.name,id:control.id},pilot:{
      name:shop.name,id:shop.id,shopId:shop.shopId,marker:shop.marker
    }},
    rateLimits:{adminNamespaceId:limits.adminNamespaceId,
      ownerNamespaceId:limits.ownerNamespaceId}
  };
}
// Drafts live two directories beneath the repository root.
// Wrangler resolves entry, assets and migrations relative to the config file.
const fromGeneratedConfig=path=>'../../'+path;
const d1=(binding,db,migrationsDir)=>({
  binding,database_name:db.name,database_id:db.id,
  migrations_dir:fromGeneratedConfig(migrationsDir),remote:false
});
const rateLimit=(name,id)=>({
  name,namespace_id:id,simple:{limit:20,period:60}
});

/**
 * Explicitly disabled drafts. workers_dev:false / preview_urls:false keep the
 * private Workers unserved until separately reviewed auth + release setup.
 * No API tokens, TOTP seeds, signing keys, audience/operator ID or live data.
 */
export function buildPortableProfiles(input){
  const p=validatePortableInstance(input);
  const googleTotp=p.adminAuthMode===GOOGLE_TOTP_ADMIN_MODE;
  const base={
    account_id:p.accountId,
    compatibility_date:'2026-11-14',
    workers_dev:false,
    preview_urls:false,
    keep_vars:false
  };
  const admin={
    ...base,
    name:p.workers.admin,
    main:fromGeneratedConfig(googleTotp
      ?'src/auth/m04-accessless-platform-admin-worker.js'
      :'src/m03-access-platform-auth-worker.js'),
    vars:{
      ...(googleTotp?{PLATFORM_AUTH_MODE:GOOGLE_TOTP_ADMIN_MODE}:{}),
      PLATFORM_AUTH_SCOPE:'private-platform-auth',
      PLATFORM_AUTH_ORIGIN:p.origins.admin,
      PLATFORM_CLIENT_ID:p.googleClientId,
      PLATFORM_SHOP_RESERVATION_ENABLED:'false',
      PLATFORM_SHOP_BINDING_ENABLED:'false',
      PLATFORM_OWNER_INVITATION_ENABLED:'false'
    },
    rules:[{
      type:'Text',globs:[
        '**/platform-auth/index.html',
        '**/platform-auth/platform-auth.css',
        '**/platform-auth/platform-auth.js'
      ],fallthrough:true
    }],
    d1_databases:[d1('CONTROL_DB',p.d1.control,'staging-migrations/platform-auth')],
    ratelimits:[rateLimit('PLATFORM_INGRESS',p.rateLimits.adminNamespaceId)]
  };
  const owner={
    ...base,
    name:p.workers.owner,
    main:fromGeneratedConfig('src/m03-owner-redemption-worker.js'),
    vars:{
      PLATFORM_AUTH_ORIGIN:p.origins.admin,
      OWNER_AUTH_ORIGIN:p.origins.owner,
      PLATFORM_OWNER_CLIENT_ID:p.googleClientId,
      PLATFORM_PILOT_SHOP_ID:p.d1.pilot.shopId,
      PLATFORM_PILOT_D1_ID:p.d1.pilot.id,
      PLATFORM_PILOT_MARKER:p.d1.pilot.marker,
      OWNER_REDEMPTION_ENABLED:'false',
      OWNER_LOGIN_ENABLED:'false',
      OWNER_CLEAN_PRODUCTS_ENABLED:'false',
      OWNER_WRITE_GRANTS_ENABLED:'false'
    },
    assets:{
      directory:fromGeneratedConfig('dist-owner'),binding:'ASSETS',
      run_worker_first:true,html_handling:'none'
    },
    d1_databases:[
      d1('CONTROL_DB',p.d1.control,'staging-migrations/platform-onboarding'),
      d1('PLATFORM_PILOT_DB',p.d1.pilot,'staging-migrations/shop-identity')
    ],
    ratelimits:[rateLimit('OWNER_INGRESS',p.rateLimits.ownerNamespaceId)]
  };
  return {admin,owner};
}

/**
 * Check existing drafts before writing either. Repeated identical generation
 * is safe; changed instance config must be reviewed rather than overwritten.
 */
export async function writePortableInstanceConfigs(input,root=ROOT){
  const profiles=buildPortableProfiles(input);
  const directory=join(resolve(root),'.wrangler','portable-instance');
  const files=[
    ['admin',join(directory,'admin.generated.jsonc')],
    ['owner',join(directory,'owner.generated.jsonc')]
  ];
  const contents=Object.fromEntries(files.map(([key])=>
    [key,JSON.stringify(profiles[key],null,2)+'\n']));
  await mkdir(directory,{recursive:true,mode:0o700});
  const existing=new Set();
  for(const [key,path] of files){
    try{
      const st=await lstat(path);
      if(!st.isFile()||st.isSymbolicLink())invalid();
      const current=await readFile(path,'utf8');
      if(current!==contents[key])
        throw new Error('Refusing existing local instance config override');
      existing.add(key);
    }catch(error){
      if(error.code==='ENOENT')continue;
      throw error;
    }
  }
  for(const [key,path] of files){
    if(existing.has(key))continue;
    try{
      await writeFile(path,contents[key],{flag:'wx',mode:0o600});
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      if(await readFile(path,'utf8')!==contents[key])
        throw new Error('Refusing existing local instance config override');
    }
  }
  return {adminPath:files[0][1],ownerPath:files[1][1]};
}

async function main(){
  // Avoid accidental remote/cloud operations: exactly one explicit mode.
  const args=process.argv.slice(2);
  if(args.length!==2||!['--check','--generate'].includes(args[0]))
    throw new Error('Usage: node scripts/port-p1-instance.mjs --check|--generate <manifest-json>');
  const manifest=JSON.parse(await readFile(resolve(args[1]),'utf8'));
  validatePortableInstance(manifest);
  const preview=await readFile(join(ROOT,'wrangler.preview.jsonc'),'utf8');
  verifyPublicPreviewIsUnbound(preview);
  if(args[0]==='--check'){
    process.stdout.write('P1 local manifest valid; deployment, authentication and Cloudflare account verification pending\n');
  }else{
    await writePortableInstanceConfigs(manifest,ROOT);
    process.stdout.write('P1 ignored local config drafts generated; no deploy or resource changes\n');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    process.stderr.write('P1 local configuration validation or generation failed; no values disclosed\n');
    process.exitCode=1;
  });
}
