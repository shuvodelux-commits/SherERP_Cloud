#!/usr/bin/env node
/**
 * M02/M03 coverage *audit*, not a migration or source-to-D1 parity certificate.
 * Only versioned candidate SQL is examined; no D1, GAS or network access.
 */
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {inventorySchema} from './inventory-schema.mjs';

const CATALOG=Object.freeze({
  SETTINGS:'settings',
  PRODUCT_CATEGORIES:'product_categories',
  PRODUCT_UNITS:'product_units',
  EXPENSE_CATEGORIES:'expense_categories'
});
const DIAGNOSTIC=Object.freeze({LOGS:'legacy_error_logs'});
const HISTORICAL_AUDIT=Object.freeze({DELETE_LOG:'legacy_delete_log',SALES_DRAFT_AUDIT:'legacy_sales_draft_audit'});
const PARTY_IDENTITY=Object.freeze({
  CUSTOMERS:'party_legacy_links',
  SUPPLIERS:'party_legacy_links',
  VENDORS:'party_legacy_links',
  FINANCE_PERSONS:'party_legacy_links',
  EXPENSE_PAYEES:'party_legacy_links'
});
const LOCAL_AUTH=Object.freeze({
  USERS:'auth_users',
  ROLES:'auth_roles',
  SESSIONS:'auth_sessions'
});

function createdTables(migrations) {
  if(!migrations || typeof migrations!=='object' || Array.isArray(migrations))
    throw new Error('Missing versioned migration SQL map');
  const names=new Set();
  const files=Object.keys(migrations).sort();
  if(!files.length)throw new Error('Missing versioned migration SQL');
  for(const filename of files) {
    const sql=migrations[filename];
    if(!/^\d{4}(?:_[\w.-]+)?\.sql$/.test(filename) ||
       typeof sql!=='string' || !sql.trim())
      throw new Error('Invalid or empty migration SQL: '+filename);
    // Strip SQL comments before reading CREATE TABLE identifiers. This is a
    // narrow inventory parser, not a SQL interpreter or migration executor.
    const code=sql.replace(/\/\*[\s\S]*?\*\//g,' ')
      .replace(/--[^\n]*/g,'');
    for(const match of code.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/gi))
      names.add(match[1].toLowerCase());
  }
  return names;
}

/** All statuses are deliberately partial, regardless of test/synthetic D1 existence. */
export function buildMigrationCoverage({
  schema,migrations,sourceCommit,asyncImpactedFunctions
}={}) {
  if(!/^[0-9a-f]{40}$/.test(sourceCommit||''))throw new Error('Invalid pinned source commit');
  if(!schema || schema.formatVersion!==1 || !Array.isArray(schema.tables) ||
     schema.tables.length===0)throw new Error('Missing/invalid source group inventory');
  if(!Number.isSafeInteger(asyncImpactedFunctions)||asyncImpactedFunctions<0)
    throw new Error('Invalid source async impacted function count');

  const tables=createdTables(migrations);
  const seen=new Set();
  const summary={
    sourceGroups:0,catalogSchemaOnly:0,diagnosticSchemaOnly:0,auditSchemaOnly:0,partyIdentityOnly:0,authLocalOnly:0,
    unmapped:0,fullyReconciled:0,asyncImpactedFunctions
  };
  const rows=schema.tables.map(source=>{
    const {sheetKey,sheetName,columns}=source||{};
    if(typeof sheetKey!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(sheetKey)||
       typeof sheetName!=='string'||!sheetName.trim()||
       !Array.isArray(columns)||columns.length===0||
       columns.some(x=>typeof x!=='string'||!x.trim())||
       new Set(columns).size!==columns.length)
      throw new Error('Invalid source group inventory row');
    if(seen.has(sheetKey))throw new Error('Duplicate source group '+sheetKey);
    seen.add(sheetKey);
    let status='unmapped',targetTable=null;
    if(Object.hasOwn(CATALOG,sheetKey)){
      status='catalog-schema-only';targetTable=CATALOG[sheetKey];
      summary.catalogSchemaOnly++;
    }else if(Object.hasOwn(DIAGNOSTIC,sheetKey)){
      status='diagnostic-schema-only';targetTable=DIAGNOSTIC[sheetKey];
      summary.diagnosticSchemaOnly++;
    }else if(Object.hasOwn(HISTORICAL_AUDIT,sheetKey)){
      status='audit-schema-only';targetTable=HISTORICAL_AUDIT[sheetKey];
      summary.auditSchemaOnly++;
    }else if(Object.hasOwn(PARTY_IDENTITY,sheetKey)){
      status='party-identity-only';targetTable=PARTY_IDENTITY[sheetKey];
      summary.partyIdentityOnly++;
    }else if(Object.hasOwn(LOCAL_AUTH,sheetKey)){
      status='auth-local-only';targetTable=LOCAL_AUTH[sheetKey];
      summary.authLocalOnly++;
    }else summary.unmapped++;
    if(targetTable && !tables.has(targetTable))
      throw new Error('Missing mapped D1 table '+targetTable+' for '+sheetKey);
    return {
      sheetKey,sheetName,sourceColumnCount:columns.length,
      status,targetTable,sourceImportReconciled:false
    };
  });
  summary.sourceGroups=rows.length;
  return {
    formatVersion:1,sourceCommit,
    limitations:'Versioned D1 table presence is not source import or async conversion proof; Party identities exclude gross accounts; local auth is not public authentication; all financial posting and full source row reconciliation remain gated',
    summary,rows
  };
}

async function main() {
  const mode=process.argv[2];
  if(!['--check','--json'].includes(mode)||process.argv.length!==3)
    throw new Error('Usage: node scripts/audit-migration-coverage.mjs --check|--json');
  const root=new URL('../',import.meta.url);
  const readJson=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
  const baseline=await readJson('docs/baseline/schema-inventory.json');
  const source=inventorySchema(await readFile(new URL('legacy/source/Config.gs',root),'utf8'));
  if(JSON.stringify(source)!==JSON.stringify(baseline))
    throw new Error('Frozen source Config schema inventory drift');
  const manifest=await readJson('docs/baseline/source-manifest.json');
  const closure=await readJson('docs/baseline/m03-async-caller-closure.json');
  if(closure.sourceCommit!==manifest.source?.commit)
    throw new Error('M03 async closure source pin differs from manifest');
  const dir=new URL('migrations/',root);
  const files=(await readdir(dir)).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
  const migrations=Object.fromEntries(await Promise.all(files.map(async filename=>
    [filename,await readFile(new URL('migrations/'+filename,root),'utf8')]
  )));
  const report=buildMigrationCoverage({
    schema:source,migrations,sourceCommit:manifest.source.commit,
    asyncImpactedFunctions:closure.counts.impactedFunctions
  });
  // Explicit current-baseline gate; adding future migrations/groups requires
  // source/schema review, not silent promotion to a production-ready status.
  const s=report.summary;
  if(files.length!==8||s.sourceGroups!==49||s.catalogSchemaOnly!==4||
     s.diagnosticSchemaOnly!==1||s.auditSchemaOnly!==2||
     s.partyIdentityOnly!==5||s.authLocalOnly!==3||
     s.unmapped!==34||s.fullyReconciled!==0||
     s.asyncImpactedFunctions!==394)
    throw new Error('M02/M03 coverage baseline changed; review source/schema mapping');
  if(mode==='--json')process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else process.stdout.write('M02/M03 coverage verified: '+s.sourceGroups+
    ' source groups, '+s.fullyReconciled+' fully reconciled; '+
    s.asyncImpactedFunctions+' source async-impacted functions (not migration proof)\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('M02/M03 coverage failed: '+error.message);process.exitCode=1;});
