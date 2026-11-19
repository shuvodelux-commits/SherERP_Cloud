#!/usr/bin/env node
/**
 * PORT-00 P0: audit tracked instance-specific settings without emitting any
 * source values, secrets, personal data or D1/customer records.
 * Conservative lexical discovery, NOT a runtime/permission/security proof.
 * This script never invokes Cloudflare, D1, Wrangler deploy or any writer.
 */
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const execFile=promisify(execFileCallback);
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SCOPES=[
  /^wrangler(?:[.\w-]*)\.(?:jsonc|json|toml)$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^src\/.+\.(?:js|mjs|ts)$/,
  /^scripts\/[^/]+\.mjs$/,
  /^frontend\/platform-auth\/[^/]+\.(?:js|mjs)$/,
  /^docs\/(?:installation|runbooks)\/.+\.md$/,
];

// Only finding categories are exported. NEVER export matching text or value.
const RULES=[
  ['account_id',/(?:["']account_id["']|\baccount_id\b)\s*[:=]|\bCLOUDFLARE_ACCOUNT_ID\b/i],
  ['database_id',/(?:["']database_id["']|\bdatabase_id\b)\s*[:=]|\bPLATFORM_PILOT_D1_ID\b/i],
  ['d1_binding',/\b(?:d1_databases|CONTROL_DB|HISTORY_ARCHIVE|PLATFORM_PILOT_DB|SHOP_DB)\b/],
  ['literal_worker_origin',/https:\/\/[a-z0-9.-]+\.workers\.dev\b/i],
  ['origin_config',/\b(?:PLATFORM_AUTH_ORIGIN|OWNER_AUTH_ORIGIN|PUBLIC_ERP_ORIGIN|ADMIN_ORIGIN|ALLOWED_ORIGIN|WORKER_ORIGIN)\b/],
  ['oauth_client',/\b(?:PLATFORM_CLIENT_ID|PLATFORM_OWNER_CLIENT_ID|GOOGLE_CLIENT_ID|GOOGLE_OAUTH_CLIENT_ID)\b|\.apps\.googleusercontent\.com\b/i],
  ['access_policy',/\b(?:PLATFORM_ACCESS_AUDIENCE|ACCESS_AUDIENCE|CLOUDFLARE_ACCESS|access\.dev)\b/i],
  ['rate_limit_namespace',/\b(?:namespace_id|PLATFORM_INGRESS|OWNER_INGRESS|ratelimits)\b/i],
  ['credential_key',/\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|JWT_SECRET|[A-Z][A-Z0-9_]*_SECRET|TOTP_SECRET|PLATFORM_ACCESS_EMAIL|OAUTH_CLIENT_SECRET|API_KEY)\b/],
  ['uuid_literal',/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i],
];

const isSafeRelativePath=path=>
  typeof path==='string' && path.length>0 && !path.startsWith('/') &&
  !path.includes('\\') && path.split('/').every(part=>part&&part!=='.'&&part!=='..');

export function selectTrackedPortabilityPaths(paths){
  if(!Array.isArray(paths))throw new TypeError('Invalid tracked path collection');
  return [...new Set(paths.filter(path=>isSafeRelativePath(path)&&
    SCOPES.some(re=>re.test(path))))].sort();
}

/** Deterministic sanitized lexical report. No matched values are returned. */
export function scanInstanceConfigurationSources(files){
  if(!files||typeof files!=='object'||Array.isArray(files))
    throw new TypeError('Invalid tracked source collection');
  const paths=selectTrackedPortabilityPaths(Object.keys(files));
  const findings=[];
  for(const path of paths){
    const raw=files[path];
    if(typeof raw!=='string')throw new TypeError('Invalid tracked source content');
    raw.split(/\r?\n/).forEach((line,index)=>{
      const kinds=RULES.filter(([kind,pattern])=>pattern.test(line)).map(([kind])=>kind);
      if(path.startsWith('wrangler') && /["']name["']\s*:/.test(line))
        kinds.push('worker_name');
      if(kinds.length)findings.push({path,line:index+1,kinds:[...new Set(kinds)].sort()});
    });
  }
  const kinds={};
  for(const {kinds:found} of findings){
    for(const key of found)kinds[key]=(kinds[key]||0)+1;
  }
  return {
    formatVersion:1,
    scanKind:'tracked-source-lexical-instance-config',
    scannedFileCount:paths.length,
    pathsScanned:paths,
    findingCount:findings.length,
    kindCounts:Object.fromEntries(Object.entries(kinds).sort(([a],[b])=>a.localeCompare(b))),
    findings
  };
}

/** The public preview must stay D1-free, secret-free and have no nested preview overrides. */
export function verifyPublicPreviewIsUnbound(source){
  if(typeof source!=='string' ||
    !/["']previews["']\s*:\s*\{\s*\}/.test(source) ||
    /\b(?:d1_databases|CONTROL_DB|PLATFORM_PILOT_DB|HISTORY_ARCHIVE|JWT_SECRET|CF_API_TOKEN|CLOUDFLARE_API_TOKEN)\b/.test(source))
    throw new Error('Preview isolation violation');
  return true;
}

/**
 * Read only Git-tracked relevant text, not untracked local instance config.
 * Avoid reading .env, secrets, archived source exports, installed dependencies
 * or any tenant database. Caller may choose a cloned repository directory.
 */
export async function collectTrackedPortabilitySources(root=ROOT){
  const cwd=resolve(root);
  const {stdout}=await execFile('git',['ls-files','--cached','-z'],{
    cwd,encoding:'utf8',maxBuffer:16*1024*1024
  });
  const tracked=stdout.split('\0').filter(Boolean);
  const paths=selectTrackedPortabilityPaths(tracked);
  const files=Object.create(null);
  for(const path of paths)files[path]=await readFile(resolve(cwd,path),'utf8');
  return files;
}

async function main(){
  const files=await collectTrackedPortabilitySources(ROOT);
  verifyPublicPreviewIsUnbound(files['wrangler.preview.jsonc']);
  const report=scanInstanceConfigurationSources(files);
  // A future refactor must not silently drop the critical baseline locations.
  const required=[
    'wrangler.preview.jsonc',
    'wrangler.staging.jsonc',
    'wrangler.m03-platform-auth-access-staging.jsonc',
    'src/m03-access-platform-auth-worker.js',
    'src/auth/platform-shop-binding.js',
    'src/m03-owner-redemption-worker.js',
    'docs/runbooks/M03_PLATFORM_AUTH_STAGING.md'
  ];
  if(required.some(path=>!report.pathsScanned.includes(path)) ||
     !report.pathsScanned.some(path=>path.startsWith('.github/workflows/')) ||
     !report.findings.some(row=>row.path==='src/m03-access-platform-auth-worker.js'&&
       row.kinds.includes('literal_worker_origin')))
    throw new Error('PORT-00 required source coverage unavailable');
  if(process.argv.includes('--check')){
    process.stdout.write('PORT-00 P0: '+report.scannedFileCount+
      ' tracked relevant files inspected; '+report.findingCount+
      ' value-redacted findings; public preview D1-free (no P1/deploy approval)\n');
  }else{
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    process.stderr.write('PORT-00 instance inventory unavailable or preview isolation violated\n');
    process.exitCode=1;
  });
}
