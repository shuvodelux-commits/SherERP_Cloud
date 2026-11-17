#!/usr/bin/env node
/**
 * M02 QA #602 — separately authorized, local-only human-review row locators.
 * The original safe public CLI remains unchanged. Never import, merge Parties
 * or make financial/production mutations from candidate matching.
 */
import {readFileSync,constants} from 'node:fs';
import {open,link,unlink,realpath} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';
import {reviewM02MasterIdentityCandidates} from './dry-run-master-identity-review.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const REPO_ROOT=fileURLToPath(new URL('../',import.meta.url));
const MAX_REVIEW_BYTES=64*1024*1024;
const MASTERS=Object.freeze([
 {group:'PRODUCT_CATEGORIES',display:'Category Name'},
 {group:'PRODUCT_UNITS',display:'Unit Name'}
]);
const PARTIES=Object.freeze([
 {group:'CUSTOMERS',display:'Customer Name'},
 {group:'EXPENSE_PAYEES',display:'Payee Name'},
 {group:'FINANCE_PERSONS',display:'Person Name'},
 {group:'SUPPLIERS',display:'Supplier Name'},
 {group:'VENDORS',display:'Vendor Name'}
]);
const nonblank=value=>typeof value==='string'&&value.trim()!=='';
const byGroupRow=(a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)||a.sheetRow-b.sheetRow;
const cmp=(a,b)=>a<b?-1:a>b?1:0;

function groupsOf(exported,kind,withPhone=false){
 const sheet=exported.groups[kind.group];
 const indices=[sheet.headers.indexOf(kind.display)];
 if(withPhone)indices.push(sheet.headers.indexOf('Phone'));
 const buckets=new Map();
 for(const row of sheet.rows){
  const values=indices.map(i=>row.cells[i]);
  if(values.some(x=>!nonblank(x)))continue;
  const key=JSON.stringify(values); // private only; never emitted
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(row.sheetRow);
 }
 for(const rows of buckets.values())rows.sort((a,b)=>a-b);
 return buckets;
}
function publicIssueParity(expected,actual){
 const encode=issues=>issues.map(i=>i.code+'|'+i.sourceGroup+'|'+i.count).sort().join('\n');
 if(encode(expected)!==encode(actual))
  throw new Error('M02 private queue/public candidate mismatch (values withheld)');
}

/**
 * Creates only private review *locators* from an already source-shaped export.
 * No name, phone, balance, source ID, source row contents, identity decisions,
 * private hashes, or mutable D1/Party links are included in this return value.
 */
export function buildM02PrivateReviewQueue({
 schema,pinnedSourceCommit,sourceExport
}={}){
 // Reuse the full immutable 49-group source validator and advisory semantics.
 const publicReview=reviewM02MasterIdentityCandidates({
  schema,pinnedSourceCommit,sourceExport
 });
 const masterClusters=[],partyClusters=[],checkIssues=[];
 for(const master of MASTERS){
  const buckets=groupsOf(sourceExport,master);
  let count=0;
  const clusters=[];
  for(const rows of buckets.values()){
   if(rows.length<2)continue;
   count+=rows.length-1;
   clusters.push({
    sourceGroup:master.group,sheetRows:[...rows],candidateCount:rows.length-1
   });
  }
  clusters.sort((a,b)=>a.sheetRows[0]-b.sheetRows[0]);
  masterClusters.push(...clusters);
  if(count)checkIssues.push({
   sourceGroup:master.group,code:'DUPLICATE_MASTER_DISPLAY_NAME_REVIEW',count
  });
 }
 const matches=new Map();
 for(const party of PARTIES){
  const buckets=groupsOf(sourceExport,party,true);
  for(const [key,rows] of buckets){
   if(!matches.has(key))matches.set(key,new Map());
   matches.get(key).set(party.group,rows);
  }
 }
 const pairCounts=new Map();
 for(const membership of matches.values()){
  if(membership.size<2)continue;
  const sourceGroups=[...membership.keys()].sort();
  const rows=[];
  let candidatePairCount=0;
  for(let i=0;i<sourceGroups.length;i++){
   const left=sourceGroups[i];
   for(const sheetRow of membership.get(left))rows.push({sourceGroup:left,sheetRow});
   for(let j=i+1;j<sourceGroups.length;j++){
    const right=sourceGroups[j],pairs=membership.get(left).length*membership.get(right).length;
    const key=left+'/'+right;
    pairCounts.set(key,(pairCounts.get(key)||0)+pairs);
    candidatePairCount+=pairs;
   }
  }
  rows.sort(byGroupRow);
  partyClusters.push({sourceGroups,rows,candidatePairCount});
 }
 partyClusters.sort((a,b)=>
  a.sourceGroups.length-b.sourceGroups.length||
  cmp(a.sourceGroups.join('/'),b.sourceGroups.join('/'))||
  byGroupRow(a.rows[0],b.rows[0])
 );
 for(const [sourceGroup,count] of pairCounts)
  checkIssues.push({sourceGroup,code:'POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW',count});
 publicIssueParity(publicReview.issues,checkIssues);
 return {
  formatVersion:1,sourceCommit:pinnedSourceCommit,
  sourceGroups:publicReview.sourceGroups,reviewOnly:true,
  sourceToD1Reconciled:false,identityConsolidationAuthorized:false,
  productionReady:false,masterClusters,partyClusters
 };
}

function safeDestinationPath(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>4096||
    raw.startsWith('-')||/^[a-z][a-z0-9+.-]*:/i.test(raw))
  throw new Error('M02 private output rejected');
 return resolve(raw);
}
async function publishPrivateFile(raw,artifact){
 const output=safeDestinationPath(raw),payload=JSON.stringify(artifact)+'\n';
 if(Buffer.byteLength(payload,'utf8')>MAX_REVIEW_BYTES)
  throw new Error('M02 private output rejected');
 let tmp=null,handle=null;
 try{
  // Canonical parent prevents accidentally writing under GitHub via a symlink.
  // Run only in a trusted private directory, not a concurrently mutable one.
  const parent=await realpath(dirname(output));
  const root=await realpath(REPO_ROOT);
  const rel=relative(root,parent);
  if(rel===''||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)))
   throw new Error('PRIVATE_REVIEW_OUTPUT_INSIDE_REPOSITORY');
  const finalPath=join(parent,basename(output));
  tmp=join(parent,'.m02-private-'+randomBytes(16).toString('hex'));
  handle=await open(tmp,constants.O_WRONLY|constants.O_CREAT|
    constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const stat=await handle.stat();
  if(!stat.isFile()||(stat.mode&0o777)!==0o600)
   throw new Error('UNSAFE_PRIVATE_TEMP');
  await handle.writeFile(payload,'utf8');
  await handle.sync();
  await handle.close();handle=null;
  // Hard-link publication is atomic and refuses existing paths/symlinks.
  // Never rename-overwrite, never publish a partially written destination.
  await link(tmp,finalPath);
  await unlink(tmp);tmp=null;
 }catch{
  throw new Error('M02 private output rejected');
 }finally{
  if(handle)await handle.close().catch(()=>{});
  if(tmp)await unlink(tmp).catch(()=>{});
 }
}
async function main(){
 if(process.argv.length!==5||process.argv[3]!=='--private-output')
  throw new Error('REQUIRE_EXPLICIT_PRIVATE_OUTPUT');
 const sourceExport=await readLocalJsonFile(process.argv[2]);
 const args={schema:SCHEMA,pinnedSourceCommit:PIN,sourceExport};
 const privateQueue=buildM02PrivateReviewQueue(args);
 const safeReport=reviewM02MasterIdentityCandidates(args);
 await publishPrivateFile(process.argv[4],privateQueue);
 // Privacy invariant: only safe codes/group names/counts to console.
 process.stdout.write(JSON.stringify(safeReport)+'\n');
 if(safeReport.humanReviewRequired)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  process.stderr.write('M02 private review queue rejected (all private values withheld)\n');
  process.exitCode=2;
 });
