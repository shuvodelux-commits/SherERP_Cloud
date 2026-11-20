#!/usr/bin/env node
/**
 * M03 first-Shop deployment diagnostic. Wrangler calls are READ-ONLY.
 * This is never a D1 migration, feature-flag toggler, or release permit.
 */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../src/db/m03-owner-ready-shop-migrations.js';

const requiredFlags=[
  'OWNER_CATALOG_ENABLED','OWNER_CLEAN_PRODUCTS_ENABLED',
  'OWNER_WRITE_GRANTS_ENABLED','OWNER_MVP_PURCHASE_ENABLED',
  'OWNER_MVP_POS_CASH_ENABLED','OWNER_MVP_CASH_RETURN_ENABLED'
];
const coreTables=[
  'products','owner_supplier_master','shop_owner_write_grant',
  'owner_mvp_cash_sessions','owner_mvp_purchase_receipts',
  'owner_mvp_sale_receipts','owner_mvp_sale_return_receipts'
];
const supplierTables=[
  'owner_mvp_supplier_cash_payment_receipts',
  'owner_mvp_supplier_payment_cash_book'
];
const releaseChecks=[
  'APPROVED_PRIVATE_PUBLISHER_REQUIRED',
  'AUTHENTICATED_TWO_SHOP_E2E_REQUIRED',
  'M10_M11_RESTORE_REHEARSAL_REQUIRED',
  'FULL_ORIGINAL_RPC_PARITY_REQUIRED',
  'INDEPENDENT_ACCOUNTING_SECURITY_REVIEW_REQUIRED'
];
const asBindings=version=>{
  const values=version?.resources?.bindings;
  if(!Array.isArray(values)||values.length===0)return null;
  const b=new Map();
  for(const value of values){
    if(!value||typeof value.name!=='string'||b.has(value.name))return null;
    b.set(value.name,value);
  }
  return b;
};
const hasFlag=(b,name)=>b?.get(name)?.text==='true';
const str=(v)=>typeof v==='string'&&v.length>0?v:null;
const checkReceipts=(rows)=>{
  if(!Array.isArray(rows)||rows.length!==OWNER_READY_SHOP_MIGRATION_PLAN.length)return false;
  return rows.every((r,i)=>r?.position===i+1 &&
    r.name===OWNER_READY_SHOP_MIGRATION_PLAN[i].name &&
    r.checksum===OWNER_READY_SHOP_MIGRATION_PLAN[i].checksum);
};

/** Pure, strict, non-authorizing result. Never include database or owner identifiers. */
export function assessLiveOwnerPilot({version,shop}={}){
  const b=asBindings(version),blockers=[];
  const mark=(bad,code)=>{if(bad)blockers.push(code);};
  const ownerEnabled=hasFlag(b,'OWNER_LOGIN_ENABLED');
  const dashboardEnabled=hasFlag(b,'OWNER_DASHBOARD_BOOTSTRAP_ENABLED');
  mark(!ownerEnabled,'OWNER_LOGIN_ENABLED_DISABLED');
  mark(!dashboardEnabled,'OWNER_DASHBOARD_BOOTSTRAP_ENABLED_DISABLED');
  const control=b?.get('CONTROL_DB');
  const db=b?.get('PLATFORM_PILOT_DB');
  mark(!control||control.type!=='d1'||!str(control.id),'CONTROL_D1_BINDING_MISSING');
  mark(!db||db.type!=='d1'||!str(db.id),'SHOP_D1_MISSING');
  const tuple=shop?.identity;
  const shopIdentityVerified=!!tuple&&
    str(tuple.shop_id)===str(b?.get('PLATFORM_PILOT_SHOP_ID')?.text)&&
    str(tuple.database_id)===str(b?.get('PLATFORM_PILOT_D1_ID')?.text)&&
    str(tuple.database_marker)===str(b?.get('PLATFORM_PILOT_MARKER')?.text)&&
    str(tuple.database_id)===str(db?.id)&&
    new Set([tuple.shop_id,tuple.database_id,tuple.database_marker]).size===3;
  mark(!shopIdentityVerified,'SHOP_IDENTITY_MISMATCH');
  const baseline13Verified=checkReceipts(shop?.receipts)&&shop?.baselineSealMatches===true;
  mark(!checkReceipts(shop?.receipts),'BASELINE_13_RECEIPTS_INVALID');
  mark(shop?.baselineSealMatches!==true,'BASELINE_13_SCHEMA_SEAL_DRIFT');
  const tables=new Set(Array.isArray(shop?.tables)?shop.tables:[]);
  const allCoreTables=coreTables.every(table=>tables.has(table));
  mark(!allCoreTables,'CORE_SHOP_SCHEMA_INCOMPLETE');
  for(const flag of requiredFlags)mark(!hasFlag(b,flag),flag+'_DISABLED');
  const supplierPresent=supplierTables.every(table=>tables.has(table));
  mark(!supplierPresent,'SUPPLIER_CASH_MIGRATION_0010_MISSING');
  const supplierSqlReady=supplierPresent &&
    shop?.supplierCloseIncludesPayments===true &&
    Array.isArray(shop?.triggers)&&
    shop.triggers.includes('owner_mvp_cash_close_guard') &&
    !shop.triggers.includes('owner_mvp_supplier_cash_pending_close');
  mark(!supplierSqlReady,'SUPPLIER_CASH_RECONCILIATION_0011_MISSING');
  mark(!hasFlag(b,'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED'),
    'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED');
  const base=ownerEnabled&&dashboardEnabled&&shopIdentityVerified&&
    !!control&&control.type==='d1'&&!!db&&db.type==='d1'&&
    baseline13Verified&&allCoreTables;
  const coreReadConfigured=base&&hasFlag(b,'OWNER_CATALOG_ENABLED');
  const coreWriteConfigured=coreReadConfigured&&
    requiredFlags.every(name=>hasFlag(b,name));
  const supplierCashConfigured=coreWriteConfigured&&supplierSqlReady&&
    hasFlag(b,'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED');
  // These flags are necessary, never sufficient: full accounting/RPC and
  // independent Cloudflare release acceptance MUST happen outside this tool.
  return Object.freeze({
    status:blockers.length?'BLOCKED':'CHECKS_REQUIRED',
    productionReady:false,
    authConfigured:ownerEnabled&&dashboardEnabled,
    shopIdentityVerified,
    baseline13Verified,
    coreReadConfigured,coreWriteConfigured,supplierCashConfigured,
    blockers:Object.freeze(blockers),
    releaseChecks:Object.freeze([...releaseChecks])
  });
}

const SQL=Object.freeze({
 identity:"SELECT shop_id,database_id,database_marker FROM shop_identity WHERE singleton=1",
 receipts:"SELECT position,name,checksum FROM port_p2_shop_migrations ORDER BY position",
 seal:`SELECT CASE WHEN
   (SELECT schema_snapshot FROM port_p2_shop_migrations WHERE position=13)=
   (SELECT json_group_array(json_array(type,name,tbl_name,sql))
     FROM (SELECT type,name,tbl_name,sql FROM sqlite_schema
       WHERE name NOT GLOB 'sqlite_*' AND tbl_name<>'port_p2_shop_migrations'
       ORDER BY type,name)) THEN 1 ELSE 0 END AS matches`,
 schema:"SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','trigger')"
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const namePattern=/^[a-z0-9][a-z0-9_-]{0,62}$/;
function wrangler(args){
  const binary=fileURLToPath(new URL('../node_modules/.bin/wrangler',import.meta.url));
  try{return JSON.parse(execFileSync(binary,args,{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    encoding:'utf8',timeout:35000,maxBuffer:4*1024*1024
  }));}
  catch{throw Error('Cloudflare read-only preflight unavailable; no changes performed');}
}
function d1Read(database,sql){
  const result=wrangler(['d1','execute',database,'--remote','--json','--command',sql]);
  if(!Array.isArray(result)||result.length!==1||result[0].success!==true||
     !Array.isArray(result[0].results))throw Error('D1 read-only checkpoint unavailable');
  return result[0].results;
}
export function parseLiveOwnerArgs(args){
  if(args.length!==4||args[0]!=='--version'||args[2]!=='--shop-db'||
     !uuid.test(args[1])||!namePattern.test(args[3]))
    throw Error('Usage: node scripts/m03-live-owner-readiness.mjs --version <uuid> --shop-db <D1-name>');
  return {versionId:args[1],shopDbName:args[3]};
}
export function extractShopEvidence({identity,receipts,seal,schema}){
  if(!Array.isArray(identity)||identity.length!==1||!Array.isArray(receipts)||
     !Array.isArray(seal)||seal.length!==1||!Array.isArray(schema))
    throw Error('Shop evidence missing or ambiguous');
  return {
    identity:identity[0],receipts,baselineSealMatches:seal[0]?.matches===1,
    tables:schema.filter(r=>r?.type==='table').map(r=>r.name),
    triggers:schema.filter(r=>r?.type==='trigger').map(r=>r.name),
    supplierCloseIncludesPayments:schema.some(r=>r?.type==='trigger'&&
      r.name==='owner_mvp_cash_close_guard'&&typeof r.sql==='string'&&
      r.sql.includes('owner_mvp_supplier_payment_cash_book'))
  };
}
async function main(){
  const {versionId,shopDbName}=parseLiveOwnerArgs(process.argv.slice(2));
  const version=wrangler(['versions','view',versionId,'--name','shererp','--json']);
  const evidence=Object.fromEntries(Object.entries(SQL).map(([key,sql])=>[
    key,d1Read(shopDbName,sql)
  ]));
  const report=assessLiveOwnerPilot({
    version,shop:extractShopEvidence(evidence)
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write('Owner operational preflight: '+error.message+'\n');
    process.exitCode=1;
  });
}
