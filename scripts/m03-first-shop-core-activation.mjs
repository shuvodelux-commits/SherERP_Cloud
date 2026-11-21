#!/usr/bin/env node
/**
 * M03 first hosted Shop: opt-in, CORE-ONLY Worker candidate from the existing
 * verified one-Shop login profile. Never creates D1, runs SQL, uploads,
 * deploys or promotes a Worker. NOT a general multi-Shop publisher.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildLoginOnlyProfileFromLiveVersion} from './m03-first-shop-live-base.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const APPROVAL='FIRST_SHOP_CORE_MVP_TEST_ONLY';
const REFRESH_APPROVAL='FIRST_SHOP_CORE_MVP_REFRESH';
const ORIGIN='https://shererp.hisab.workers.dev';
const ADMIN='https://admin.hisab.workers.dev';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GOOGLE=/^[A-Za-z0-9._-]{4,150}\.apps\.googleusercontent\.com$/;
const requiredFalse=Object.freeze([
  'OWNER_CATALOG_ENABLED',
  'OWNER_CLEAN_PRODUCTS_ENABLED',
  'OWNER_WRITE_GRANTS_ENABLED',
  'OWNER_MVP_PURCHASE_ENABLED',
  'OWNER_MVP_POS_CASH_ENABLED',
  'OWNER_MVP_CASH_RETURN_ENABLED'
]);
const requiredTrue=Object.freeze([
  'OWNER_LOGIN_ENABLED','OWNER_GMAIL_SIGNUP_ENABLED',
  'OWNER_DASHBOARD_BOOTSTRAP_ENABLED'
]);
const coreBlockers=Object.freeze([
  ...requiredFalse.map(name=>name+'_DISABLED'),
  'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED'
]);
const originalSchemaBlockers=Object.freeze([
  ...coreBlockers,
  'SUPPLIER_CASH_MIGRATION_0010_MISSING',
  'SUPPLIER_CASH_RECONCILIATION_0011_MISSING'
]);
const activeCoreBlockers=Object.freeze([
  'OWNER_MVP_CASH_RETURN_ENABLED_DISABLED',
  'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED'
]);
const activeCoreReleaseChecks=Object.freeze([
  'APPROVED_PRIVATE_PUBLISHER_REQUIRED',
  'AUTHENTICATED_TWO_SHOP_E2E_REQUIRED',
  'M10_M11_RESTORE_REHEARSAL_REQUIRED',
  'FULL_ORIGINAL_RPC_PARITY_REQUIRED',
  'INDEPENDENT_ACCOUNTING_SECURITY_REVIEW_REQUIRED'
]);
const invalid=()=>{throw new Error('First-Shop core-only candidate refused: deployment evidence or policy mismatch');};
const uuid=x=>typeof x==='string'&&UUID.test(x);

function validateBase(base){
  if(!base||typeof base!=='object'||base.name!=='shererp'||
     base.main!=='src/m03-owner-redemption-worker.js'||
     base.workers_dev!==true||base.preview_urls!==false||
     base.assets?.directory!=='dist-owner'||base.assets?.binding!=='ASSETS'||
     !Array.isArray(base.d1_databases)||base.d1_databases.length!==2||
     base.d1_databases[0]?.binding!=='CONTROL_DB'||
     base.d1_databases[1]?.binding!=='PLATFORM_PILOT_DB'||
     !uuid(base.d1_databases[0].database_id)||
     !uuid(base.d1_databases[1].database_id)||
     base.d1_databases[0].database_id===base.d1_databases[1].database_id||
     !Array.isArray(base.ratelimits)||base.ratelimits.length!==1||
     base.ratelimits[0]?.name!=='OWNER_INGRESS'||
     !/^[0-9]{1,15}$/.test(base.ratelimits[0]?.namespace_id)|| 
     !base.ratelimits[0]?.simple||
     !base.vars||typeof base.vars!=='object')invalid();
  const v=base.vars;
  if(v.OWNER_AUTH_ORIGIN!==ORIGIN||v.PLATFORM_AUTH_ORIGIN!==ADMIN||
     !GOOGLE.test(v.PLATFORM_OWNER_CLIENT_ID)||
     !uuid(v.PLATFORM_PILOT_SHOP_ID)||!uuid(v.PLATFORM_PILOT_D1_ID)||
     !uuid(v.PLATFORM_PILOT_MARKER)||
     v.PLATFORM_PILOT_D1_ID!==base.d1_databases[1].database_id||
     new Set([v.PLATFORM_PILOT_SHOP_ID,v.PLATFORM_PILOT_D1_ID,v.PLATFORM_PILOT_MARKER]).size!==3)
    invalid();
  if(requiredTrue.some(name=>v[name]!=='true')||
     requiredFalse.some(name=>v[name]!=='false')||
     v.OWNER_REDEMPTION_ENABLED!=='false'||
     v.OWNER_SUPPORT_AUDIT_ENABLED!=='false'||
     !['false',undefined].includes(v.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED))
    invalid();
  // Unknown enabled switches require their own release review.
  const known=new Set([...requiredTrue,...requiredFalse,'OWNER_REDEMPTION_ENABLED',
    'OWNER_SUPPORT_AUDIT_ENABLED','OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED']);
  if(Object.keys(v).some(k=>k.endsWith('_ENABLED')&&!known.has(k)))invalid();
}

function validateEvidence(e){
  // The immutable 13 receipts permit only the pinned 0010+0011 overlay.
  // Neither release profile enables Cash Returns or Supplier Cash Pay.
  const overlay=e?.approvedSupplierOverlayVerified;
  if(overlay!==undefined&&typeof overlay!=='boolean')invalid();
  const expected=overlay===true?coreBlockers:originalSchemaBlockers;
  if(!e||e.status!=='BLOCKED'||e.productionReady!==false||
     e.authConfigured!==true||e.shopIdentityVerified!==true||
     e.baseline13Verified!==true||e.coreReadConfigured!==false||
     e.coreWriteConfigured!==false||e.supplierCashConfigured!==false||
     !Array.isArray(e.blockers)||e.blockers.length!==expected.length||
     new Set(e.blockers).size!==expected.length||
     expected.some(code=>!e.blockers.includes(code)))invalid();
}

/** Already-enabled first Shop uses current live proof, never the old pre-core report. */
function validateActiveCoreRefresh(e){
  if(!e||e.status!=='BLOCKED'||e.productionReady!==false||
     e.authConfigured!==true||e.shopIdentityVerified!==true||
     e.baseline13Verified!==true||e.approvedSupplierOverlayVerified!==true||
     e.coreReadConfigured!==true||e.coreWriteConfigured!==false||
     e.supplierCashConfigured!==false||
     !Array.isArray(e.blockers)||e.blockers.length!==activeCoreBlockers.length||
     new Set(e.blockers).size!==activeCoreBlockers.length||
     activeCoreBlockers.some(code=>!e.blockers.includes(code))||
     !Array.isArray(e.releaseChecks)||
     e.releaseChecks.length!==activeCoreReleaseChecks.length||
     new Set(e.releaseChecks).size!==activeCoreReleaseChecks.length||
     activeCoreReleaseChecks.some(code=>!e.releaseChecks.includes(code)))invalid();
}

/** Pure: no network, no Cloudflare credentials, no D1 write, no IO. */
export function buildFirstShopCoreCandidate(base,evidence,approval){
  if(approval!==APPROVAL&&approval!==REFRESH_APPROVAL)invalid();
  validateBase(base);
  if(approval===REFRESH_APPROVAL)validateActiveCoreRefresh(evidence);
  else validateEvidence(evidence);
  const candidate=structuredClone(base);
  // Enable only reviewed core. Cash Return and Supplier Cash Pay stay OFF
  // even when the independently verified 0010+0011 schema overlay is present.
  for(const name of requiredFalse.slice(0,5))candidate.vars[name]='true';
  candidate.vars.OWNER_MVP_CASH_RETURN_ENABLED='false';
  candidate.vars.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED='false';
  candidate.vars.OWNER_SUPPORT_AUDIT_ENABLED='false';
  candidate.vars.OWNER_REDEMPTION_ENABLED='false';
  return candidate;
}

export async function prepareFirstShopCoreCandidate(base,evidence,approval,root=ROOT){
  const config=buildFirstShopCoreCandidate(base,evidence,approval);
  const directory=resolve(root,'.wrangler','first-shop-activation');
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'owner.core-only.candidate.jsonc');
  // Wrangler resolves entry, asset and D1 migration paths from the config
  // directory. The generated login-only profile uses repo-root paths.
  const toPrivateRelative=source=>{
    if(typeof source!=='string'||!source||source.startsWith('/')||
       source.includes('..')||!/^[-A-Za-z0-9_/.]+$/.test(source))invalid();
    return '../../'+source;
  };
  const deploy={
    ...config,main:toPrivateRelative(config.main),
    assets:{...config.assets,directory:toPrivateRelative(config.assets.directory)},
    d1_databases:config.d1_databases.map(db=>({
      ...db,...(db.migrations_dir
        ?{migrations_dir:toPrivateRelative(db.migrations_dir)}:{})
    }))
  };
  const contents=JSON.stringify(deploy,null,2)+'\n';
  await writeFile(path,contents,{flag:'wx',mode:0o600});
  return path;
}


if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==3||!['--prepare','--prepare-from-version','--check-from-version'].includes(args[0])){
    console.error('Usage: node scripts/m03-first-shop-core-activation.mjs --prepare-from-version <private-wrangler-version.json> <read-only-live-readiness.json>');
    process.exitCode=1;
  }else{
    try{
      const [source,evidence]=await Promise.all(args.slice(1).map(async path=>
        JSON.parse(await readFile(resolve(path),'utf8'))));
      const base=args[0]!=='--prepare'
        ?buildLoginOnlyProfileFromLiveVersion(source,process.env.SHERERP_ACCOUNT_ID,{
          allowActiveCoreRefresh:process.env.SHERERP_FIRST_SHOP_CORE_APPROVAL===
            REFRESH_APPROVAL
        })
        :source;
      if(args[0]==='--check-from-version'){
        buildFirstShopCoreCandidate(base,evidence,
          process.env.SHERERP_FIRST_SHOP_CORE_APPROVAL);
        console.log('First-Shop core-only release evidence verified (NOT deployed).');
      }else{
        await prepareFirstShopCoreCandidate(base,evidence,
          process.env.SHERERP_FIRST_SHOP_CORE_APPROVAL);
        console.log('Private first-Shop core-only candidate prepared (NOT deployed).');
      }
    }catch{
      console.error('First-Shop candidate refused. No D1 or Worker changed.');
      process.exitCode=1;
    }
  }
}
