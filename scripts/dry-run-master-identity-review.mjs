#!/usr/bin/env node
/**
 * M02 #598 — private offline source-master identity collision *review* only.
 * Never joins a Party, creates a master identity, posts money or touches D1.
 * All original strings/IDs/physical rows remain solely in the supplied input.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewOfflineSourceParity} from './dry-run-source-parity.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const SOURCE_PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const MASTERS=Object.freeze([
 {group:'PRODUCT_CATEGORIES',label:'Category Name'},
 {group:'PRODUCT_UNITS',label:'Unit Name'}
]);
const PARTIES=Object.freeze([
 {group:'CUSTOMERS',name:'Customer Name'},
 {group:'EXPENSE_PAYEES',name:'Payee Name'},
 {group:'FINANCE_PERSONS',name:'Person Name'},
 {group:'SUPPLIERS',name:'Supplier Name'},
 {group:'VENDORS',name:'Vendor Name'}
]);
const namePresent=value=>typeof value==='string'&&value.trim()!=='';

function valueBuckets(exported,group,fields){
 const sheet=exported.groups[group],indexes=fields.map(field=>sheet.headers.indexOf(field));
 // Source shape is fully validated first; there is no untrusted header fallback.
 const counts=new Map();
 for(const row of sheet.rows){
  const parts=indexes.map(index=>row.cells[index]);
  if(parts.some(value=>!namePresent(value)))continue;
  const key=JSON.stringify(parts); // exact original source text; no normalization
  counts.set(key,(counts.get(key)||0)+1);
 }
 return counts;
}

/**
 * Public-safe exception counts; no private names, phones, IDs, row indices,
 * hashes, mutable links or inferred merged identities escape this routine.
 *
 * A clean report attests ONLY to advisory review emptiness of the input,
 * never independently captured source evidence or actual D1 reconciliation.
 */
export function reviewM02MasterIdentityCandidates({
 schema,pinnedSourceCommit,sourceExport
}={}){
 const shape=reviewOfflineSourceParity({
  schema,pinnedSourceCommit,sourceExport,candidateExport:sourceExport
 });
 const issues=[];
 for(const master of MASTERS){
  const counts=valueBuckets(sourceExport,master.group,[master.label]);
  let collisions=0;
  for(const n of counts.values())if(n>1)collisions+=n-1;
  if(collisions)issues.push({
   sourceGroup:master.group,code:'DUPLICATE_MASTER_DISPLAY_NAME_REVIEW',count:collisions
  });
 }
 const partyBuckets=new Map();
 for(const party of PARTIES)
  partyBuckets.set(party.group,valueBuckets(sourceExport,party.group,[party.name,'Phone']));
 for(let i=0;i<PARTIES.length;i++)for(let j=i+1;j<PARTIES.length;j++){
  const from=PARTIES[i].group,to=PARTIES[j].group;
  const left=partyBuckets.get(from),right=partyBuckets.get(to);
  let candidatePairs=0;
  for(const [key,count] of left)
   if(right.has(key))candidatePairs+=count*right.get(key);
  if(candidatePairs)issues.push({
   sourceGroup:from+'/'+to,code:'POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW',count:candidatePairs
  });
 }
 return {
  formatVersion:1,
  sourceGroups:shape.sourceGroups,
  masterGroupsReviewed:MASTERS.length,
  partyMasterGroupsReviewed:PARTIES.length,
  humanReviewRequired:issues.length>0,
  automaticPartyLinksCreated:0,masterIdentitiesMerged:0,
  identityConsolidationAuthorized:false,
  independentSourceExportVerified:false,d1Verified:false,
  sourceToD1Reconciled:false,productionReady:false,
  issues
 };
}

async function main(){
 if(process.argv.length!==3)throw new Error('REQUIRE_ONE_PRIVATE_LOCAL_SOURCE');
 const sourceExport=await readLocalJsonFile(process.argv[2]);
 const result=reviewM02MasterIdentityCandidates({
  schema:SCHEMA,pinnedSourceCommit:SOURCE_PIN,sourceExport
 });
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.humanReviewRequired)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  // Never print raw original values, IDs, source paths or parser exceptions.
  process.stderr.write('M02 private master identity review rejected (source values withheld)\n');
  process.exitCode=2;
 });
