#!/usr/bin/env node
/**
 * M02 #590 — OFFLINE comparison of the 49 original source-group snapshot,
 * the separate 38-family generated-ID/counter evidence and its private freeze.
 * Never reads source Sheets or D1; never authorizes real imports or ID issuance.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewOfflineSourceParity} from './dry-run-source-parity.mjs';
import {M02_ID_FAMILIES} from './dry-run-id-floor.mjs';
import {verifyM02IdEvidenceFreeze} from './dry-run-id-evidence-freeze.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;

/**
 * Comparisons are physical original sheet-row + exact source-ID text, never
 * a count-only check, inferred Party join, SQL rowid or 2 copies of a D1 read.
 * The Run 3/4/5 validators reject unsafe formats before these maps are used.
 */
export function reviewM02SourceIdCrosscheck({
 schema,pinnedSourceCommit,sourceExport,idEvidence,freezeManifest
}={}){
 const source=reviewOfflineSourceParity({
  schema,pinnedSourceCommit,sourceExport,candidateExport:sourceExport
 });
 const freeze=verifyM02IdEvidenceFreeze({
  schema,pinnedSourceCommit,manifest:freezeManifest,evidence:idEvidence
 });
 const issues=[...freeze.issues];
 const add=(sourceGroup,code,count)=>{
  if(count)issues.push({sourceGroup,code,count});
 };
 for(const family of M02_ID_FAMILIES){
  const sourceGroup=family.sourceGroup;
  const sourceRows=sourceExport.groups[sourceGroup].rows;
  const idRows=idEvidence.groups[sourceGroup];
  const frozenSourceIds=new Map(sourceRows.map(row=>[row.sheetRow,row.cells[0]]));
  const separatelyCapturedIds=new Map(idRows.map(row=>[row.sheetRow,row.id]));
  let missing=0,extra=0,changed=0;
  for(const [sheetRow,originalId] of frozenSourceIds){
   if(!separatelyCapturedIds.has(sheetRow))missing++;
   else if(separatelyCapturedIds.get(sheetRow)!==originalId)changed++;
  }
  for(const sheetRow of separatelyCapturedIds.keys()){
   if(!frozenSourceIds.has(sheetRow))extra++;
  }
  add(sourceGroup,'SOURCE_ID_EVIDENCE_ROW_MISSING',missing);
  add(sourceGroup,'SOURCE_ID_EVIDENCE_ROW_EXTRA',extra);
  add(sourceGroup,'SOURCE_ID_EVIDENCE_TEXT_MISMATCH',changed);
 }
 return {
  formatVersion:1,sourceGroups:source.sourceGroups,
  idFamilies:M02_ID_FAMILIES.length,
  nonSequentialGroups:source.sourceGroups-M02_ID_FAMILIES.length,
  exactOfflineCandidate:source.exactTextParity&&freeze.exactMatch&&issues.length===0,
  issues,
  independentSourceExportVerified:false,d1ReadbackVerified:false,
  sourceToD1Reconciled:false,idIssuanceAuthorized:false,productionReady:false
 };
}

async function main(){
 if(process.argv.length!==5)throw new Error('REQUIRE_THREE_PRIVATE_LOCAL_INPUTS');
 const [sourceExport,idEvidence,freezeManifest]=await Promise.all(
  process.argv.slice(2).map(readLocalJsonFile)
 );
 const review=reviewM02SourceIdCrosscheck({
  schema:SCHEMA,pinnedSourceCommit:PIN,sourceExport,idEvidence,freezeManifest
 });
 process.stdout.write(JSON.stringify(review)+'\n');
 if(!review.exactOfflineCandidate)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  // Never surface private original IDs, counters, row positions or input paths.
  process.stderr.write('M02 private cross-evidence rejected (values withheld)\n');
  process.exitCode=2;
 });
