#!/usr/bin/env node
/**
 * M02-safe offline count/digest source-freeze evidence.
 * Every result is a non-authoritative local rehearsal, NOT real D1 parity.
 * Private full exports never leave the calling machine through this tool.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewOfflineSourceParity} from './dry-run-source-parity.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const INVENTORY=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const SOURCE_COMMIT=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const REQUIRED_MANIFEST_KEYS=Object.freeze([
 'formatVersion','sourceCommit','scope','fullyCoveredGroups','totalRows',
 'fingerprint','sourceApproved','d1Verified','productionReady','groups'
]);
const REQUIRED_ENTRY_KEYS=Object.freeze(['sourceGroup','declaredRows','sourceDigest']);
const SAFE_SHA=/^[a-f0-9]{64}$/;
function reject(code){throw new Error('M02 freeze rejected: '+code);}
function plainRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function hasExactKeys(object,keys){
 return plainRecord(object)&&Object.keys(object).length===keys.length&&
  keys.every(key=>Object.hasOwn(object,key));
}
function safeCount(n){return Number.isSafeInteger(n)&&n>=0;}
function checksum(sourceCommit,groups){
 return createHash('sha256').update(JSON.stringify([
  'SherERP_M02_offline_freeze_evidence_v1',sourceCommit,
  groups.map(g=>[g.sourceGroup,g.declaredRows,g.sourceDigest])
 ])).digest('hex');
}
function validateDeclaredCounts(declared,columns){
 const keys=columns.map(g=>g.sheetKey);
 if(!hasExactKeys(declared,keys)||
    keys.some(key=>!safeCount(declared[key])))
  reject('DECLARED_SOURCE_COUNTS_INVALID');
}
function validEvidence(evidence,pinnedSourceCommit,columns){
 if(!hasExactKeys(evidence,REQUIRED_MANIFEST_KEYS)||
    evidence.formatVersion!==1||evidence.sourceCommit!==pinnedSourceCommit||
    evidence.scope!=='offline-source-shaped'||
    evidence.fullyCoveredGroups!==columns.length||
    evidence.sourceApproved!==false||evidence.d1Verified!==false||
    evidence.productionReady!==false||
    !safeCount(evidence.totalRows)||!Array.isArray(evidence.groups)||
    evidence.groups.length!==columns.length||!SAFE_SHA.test(evidence.fingerprint))
  reject('INVALID_FREEZE_EVIDENCE');
 let sum=0;
 for(let i=0;i<columns.length;i++){
  const group=evidence.groups[i];
  if(!hasExactKeys(group,REQUIRED_ENTRY_KEYS)||
     group.sourceGroup!==columns[i].sheetKey||
     !safeCount(group.declaredRows)||typeof group.sourceDigest!=='string'||
     !SAFE_SHA.test(group.sourceDigest))
   reject('INVALID_FREEZE_EVIDENCE');
  sum+=group.declaredRows;
  if(!safeCount(sum))reject('INVALID_FREEZE_EVIDENCE');
 }
 if(sum!==evidence.totalRows||
    checksum(pinnedSourceCommit,evidence.groups)!==evidence.fingerprint)
  reject('INVALID_FREEZE_EVIDENCE');
}
function canonical({schema,pinnedSourceCommit,sourceExport}){
 // Reuse existing #493 exact all-49 group text/physical provenance checks.
 // A self-comparison validates source shape only, not independent truth.
 const report=reviewOfflineSourceParity({
  schema,pinnedSourceCommit,sourceExport,candidateExport:sourceExport
 });
 if(!report.exactTextParity||report.sourceGroups!==49)
  reject('INVALID_SOURCE_SNAPSHOT');
 return report;
}

/**
 * Counts MUST be supplied independently by an authorized reviewer.
 * This function does not authenticate the reviewer or trust a copied count.
 */
export function captureOfflineSourceFreeze({
 schema,pinnedSourceCommit,sourceExport,declaredSourceCounts
}={}){
 const report=canonical({schema,pinnedSourceCommit,sourceExport});
 validateDeclaredCounts(declaredSourceCounts,schema.tables);
 const groups=report.groups.map(group=>{
  const declaredRows=declaredSourceCounts[group.sourceGroup];
  if(declaredRows!==group.sourceRows)
   reject('DECLARED_SOURCE_COUNT_MISMATCH');
  return {
   sourceGroup:group.sourceGroup,declaredRows,
   sourceDigest:group.sourceDigest
  };
 });
 return {
  formatVersion:1,sourceCommit:pinnedSourceCommit,
  scope:'offline-source-shaped',fullyCoveredGroups:schema.tables.length,
  totalRows:report.sourceRows,
  fingerprint:checksum(pinnedSourceCommit,groups),
  sourceApproved:false,d1Verified:false,productionReady:false,groups
 };
}

/** Compare later source-shaped snapshot against a separately retained manifest. */
export function verifyOfflineSourceFreeze({
 schema,pinnedSourceCommit,candidateExport,freezeManifest
}={}){
 const report=canonical({schema,pinnedSourceCommit,sourceExport:candidateExport});
 validEvidence(freezeManifest,pinnedSourceCommit,schema.tables);
 const issues=[],groups=[];
 for(let i=0;i<report.groups.length;i++){
  const source=freezeManifest.groups[i];
  const candidate=report.groups[i];
  if(source.declaredRows!==candidate.sourceRows)
   issues.push({sourceGroup:source.sourceGroup,code:'SOURCE_ROW_COUNT_MISMATCH',
    count:Math.abs(source.declaredRows-candidate.sourceRows)});
  if(source.sourceDigest!==candidate.sourceDigest)
   issues.push({sourceGroup:source.sourceGroup,code:'SOURCE_DIGEST_MISMATCH',count:1});
  groups.push({
   sourceGroup:source.sourceGroup,declaredRows:source.declaredRows,
   candidateRows:candidate.sourceRows,sourceDigest:source.sourceDigest,
   candidateDigest:candidate.sourceDigest
  });
 }
 return {
  formatVersion:1,sourceGroups:schema.tables.length,
  freezeFingerprint:freezeManifest.fingerprint,
  freezeExactMatch:issues.length===0,
  sourceApproved:false,d1Verified:false,productionReady:false,
  issues,groups
 };
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length!==3||(args[0]!=='--capture'&&args[0]!=='--verify'))
  reject('REQUIRE_EXPLICIT_CAPTURE_OR_VERIFY_FILES');
 let report;
 if(args[0]==='--capture'){
  const [sourceExport,declaredSourceCounts]=await Promise.all([
   readLocalJsonFile(args[1]),readLocalJsonFile(args[2])
  ]);
  report=captureOfflineSourceFreeze({
   schema:INVENTORY,pinnedSourceCommit:SOURCE_COMMIT,
   sourceExport,declaredSourceCounts
  });
 }else{
  const [freezeManifest,candidateExport]=await Promise.all([
   readLocalJsonFile(args[1]),readLocalJsonFile(args[2])
  ]);
  report=verifyOfflineSourceFreeze({
   schema:INVENTORY,pinnedSourceCommit:SOURCE_COMMIT,
   candidateExport,freezeManifest
  });
 }
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(args[0]==='--verify'&&!report.freezeExactMatch)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{
  process.stderr.write('M02 offline freeze rejected: invalid or inaccessible local evidence (values withheld)\n');
  process.exitCode=2;
 });
}
