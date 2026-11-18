#!/usr/bin/env node
/**
 * M04 owner-controlled staff archive client. Do not deploy or import into RPC.
 * Read private original SQLite in read-only mode and invoke only the local
 * loopback-only M04 operator Worker, after distinct M03/M04/M11 approvals.
 * This helper never prints source rows, credentials, tokens, or SQL errors.
 */
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractPrivateLegacyStaffFromArchive} from '../src/auth/legacy-archive-staff-extract.js';
import {provisionallyConvertLegacyStaffExcelDates} from '../src/auth/legacy-archive-staff-time.js';
import {prepareAdminFirstLegacyStaffEnrollment} from '../src/auth/m04-admin-first-enrollment.js';

const ROOT=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const TARGET='http://127.0.0.1:8787/_private/m04/staff-import-once';
const MAX_BYTES=64*1024;
const deny=()=>new Error('M04 private client rejected');
const within=(path,root)=>path===root||path.startsWith(root+sep);
function requirePrivateFile(filename,maxBytes){
 if(typeof filename!=='string'||filename.length<5||filename.length>4096||
    !isAbsolute(filename)||filename.includes('\0'))throw deny();
 const p=resolve(filename);
 if(within(p,ROOT))throw deny();
 const stat=lstatSync(p);
 if(!stat.isFile()||stat.size<1||stat.size>maxBytes||
    (stat.mode&0o077)!==0 ||
    (typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw deny();
 if(realpathSync(p)!==p)throw deny();
 return p;
}
function readOneArchive(filename){
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  db.exec('PRAGMA query_only=ON');
  const source=extractPrivateLegacyStaffFromArchive(db);
  const dated=provisionallyConvertLegacyStaffExcelDates(source.snapshot,{
   workbookEpoch:1900,scriptTimeZone:'Asia/Dhaka',
  });
  if(source.report.users!==3||source.report.roles!==2||
     dated.report.spreadsheetTimezoneVerified!==false)throw deny();
  return dated.snapshot;
 }finally{db.close();}
}

/** This validates two distinct in-memory captures; it cannot attest their source independence. */
export function makePrivateM04StaffIntent(first,confirmation){
 try{
  const checked=prepareAdminFirstLegacyStaffEnrollment(first,confirmation);
  const report={
   originalUsers:checked.report.originalUsers,
   importableUsers:checked.report.importableUsers,
   originalRoles:checked.report.sourceRoles,
   deferredOwnerUsers:checked.report.deferredOwnerUsers,
   originalSourceChanged:false,
   independentlyCapturedSourceAttested:false,
   originalSpreadsheetTimezoneAttested:false,
   remoteImportAuthorized:false,
  };
  if(report.originalUsers!==3||report.importableUsers!==2||
     report.originalRoles!==2||report.deferredOwnerUsers!==1)throw deny();
  return {first,confirmation,report};
 }catch{throw deny();}
}

/**
 * Two fresh read-only connections to the SAME frozen source archive.
 * This proves archive-content consistency, NOT two independent source exports
 * or Google Spreadsheet timezone provenance; those require operator review.
 */
export function readVerifiedPrivateM04ArchiveTwoPass(archivePath){
 try{
  const p=requirePrivateFile(archivePath,200*1024*1024);
  return makePrivateM04StaffIntent(readOneArchive(p),readOneArchive(p));
 }catch{throw deny();}
}

function requireManualApproval(a){
 const keys=[
  'scope','reviewedOperator','independentlyCapturedSourceApproved',
  'originalSpreadsheetTimezoneAttested','currentStagingBackupRestoreVerified',
  'freshTimeTravelBookmarkSecured','singleStagingWriterConfirmed',
 ];
 if(!a||typeof a!=='object'||Array.isArray(a)||
    Object.getPrototypeOf(a)!==Object.prototype||
    Reflect.ownKeys(a).length!==keys.length||
    keys.some(k=>!Object.hasOwn(a,k))||
    a.scope!=='private-staging-staff-import-only'||
    keys.slice(1).some(k=>a[k]!==true))throw deny();
 // A caller assertion is NOT independent proof. The operator must retain
 // the external M03/M11 backup, provenance and human approval evidence.
}
function readToken(filename){
 const p=requirePrivateFile(filename,2048);
 const text=readFileSync(p,'utf8');
 const m=/^M04_IMPORT_TOKEN=([A-Za-z0-9_-]{40,256})\n$/.exec(text);
 if(!m)throw deny();
 return m[1];
}

/**
 * Call only after independently verified human approval; no automatic retry.
 * 'transport' injection exists for synthetic tests; live default is fetch.
 */
export async function submitApprovedPrivateM04StaffImport({
 first,confirmation,tokenFile,approval,transport=fetch,
}={}){
 try{
  requireManualApproval(approval);
  const checked=makePrivateM04StaffIntent(first,confirmation);
  const token=readToken(tokenFile);
  if(typeof transport!=='function')throw deny();
  const body=JSON.stringify({first,confirmation});
  if(new TextEncoder().encode(body).length>MAX_BYTES)throw deny();
  const response=await transport(TARGET,{
   method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body,redirect:'error',cache:'no-store',
  });
  if(!response||response.status!==200||
     response.headers?.get('content-type')!=='application/json')throw deny();
  const text=await response.text();
  if(typeof text!=='string'||new TextEncoder().encode(text).length>1024)throw deny();
  const result=JSON.parse(text);
  const expected={
   imported:true,
   originalUsers:checked.report.originalUsers,
   importedUsers:checked.report.importableUsers,
   importedRoles:checked.report.originalRoles,
   pendingLegacyCredentials:checked.report.importableUsers,
   deferredOwnerUsers:checked.report.deferredOwnerUsers,
   sourceTwoPassMatch:true,
   readbackMatch:true,
   publicAuthenticationEnabled:false,
   productionReady:false,
  };
  if(!result||typeof result!=='object'||Array.isArray(result)||
     Object.keys(result).length!==Object.keys(expected).length||
     Object.entries(expected).some(([key,value])=>result[key]!==value))throw deny();
  return expected;
 }catch{
  // An uncertain network response may have committed. Never auto-retry.
  throw deny();
 }
}

// Audit-only CLI. Deliberately NO --apply command: remote writes are a
// separately reviewed M03/M11 operator action, not a generic terminal flag.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--verify-archive')throw deny();
  const intent=readVerifiedPrivateM04ArchiveTwoPass(process.argv[3]);
  process.stdout.write(JSON.stringify(intent.report)+'\n');
 }catch{
  process.stderr.write('M04 private client rejected (source values withheld)\n');
  process.exitCode=2;
 }
}
