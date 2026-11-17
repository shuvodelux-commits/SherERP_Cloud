#!/usr/bin/env node
/**
 * M02 #24 — source-pinned OFFLINE sequential ID floor review.
 * No live Sheets, D1, ID issuance, arbitrary source mutation or public output.
 * Only M03 may implement SQL-atomic production ID issuance.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const MANIFEST=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8'));
const SOURCE_PIN=MANIFEST.source.commit;
const CONFIG_SOURCE=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url));
const SOURCE_BLOB='blob '+CONFIG_SOURCE.length+'\0';
const ACTUAL_CONFIG_SHA=createHash('sha1').update(SOURCE_BLOB).update(CONFIG_SOURCE).digest('hex');
const EXPECTED_CONFIG_SHA=MANIFEST.files.find(f=>f.path==='Config.gs')?.blobSha;
const FROZEN_CONFIG=CONFIG_SOURCE.toString('utf8');
const CONFIG_ID_BLOCK=FROZEN_CONFIG.match(/ID_PREFIX:\s*\{([\s\S]*?)\}\s*,\s*ID_PAD_LENGTH:\s*(\d+)/);
if(!CONFIG_ID_BLOCK||ACTUAL_CONFIG_SHA!==EXPECTED_CONFIG_SHA||CONFIG_ID_BLOCK[2]!=='6')
 throw new Error('M02 source ID contract rejected: FROZEN_CONFIG_DRIFT');

const isRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exactKeys=(value,keys)=>isRecord(value)&&Object.keys(value).length===keys.length&&
 keys.every(k=>Object.hasOwn(value,k));
const invalid=code=>{throw new Error('M02 original ID floor rejected: '+code);};
const familyRe=/([A-Z][A-Z0-9_]*):\s*"([A-Z]+)"/g;
const specs=[];
for(const found of CONFIG_ID_BLOCK[1].matchAll(familyRe)){
 const sourceGroup=found[1],prefix=found[2];
 const source=SCHEMA.tables.find(group=>group.sheetKey===sourceGroup);
 if(!source||!source.columns[0]||specs.some(s=>s.sourceGroup===sourceGroup||s.prefix===prefix))
  invalid('FROZEN_PREFIX_INVENTORY_DRIFT');
 specs.push(Object.freeze({
  sourceGroup,prefix,sourceIdColumn:source.columns[0],
  counterProperty:'ID_COUNTER_'+sourceGroup,minimumPad:6
 }));
}
if(specs.length!==38||SCHEMA.tables.length!==49)invalid('FROZEN_PREFIX_INVENTORY_DRIFT');
export const M02_ID_FAMILIES=Object.freeze(specs);

function requireEvidence(schema,pinnedSourceCommit,evidence){
 if(!isRecord(schema)||JSON.stringify(schema)!==JSON.stringify(SCHEMA)||
    pinnedSourceCommit!==SOURCE_PIN)invalid('FROZEN_SCHEMA_OR_PIN_DRIFT');
 if(!exactKeys(evidence,['formatVersion','sourceCommit','groups','counters','declaredSourceCounts'])||
    evidence.formatVersion!==1||evidence.sourceCommit!==SOURCE_PIN)
  invalid('INVALID_SOURCE_EVIDENCE');
 const keys=specs.map(s=>s.sourceGroup);
 for(const field of ['groups','counters','declaredSourceCounts']){
  if(!exactKeys(evidence[field],keys))invalid('INCOMPLETE_ID_FAMILY_EVIDENCE');
 }
}
function issueCounter(){
 const issues=new Map();
 return {
  add(group,code){
   const key=group+'\0'+code;
   const previous=issues.get(key);
   if(previous)previous.count++;
   else issues.set(key,{sourceGroup:group,code,count:1});
  },
  forGroup(group){return [...issues.values()].some(i=>i.sourceGroup===group);},
  list(){return [...issues.values()];}
 };
}

/**
 * Pure original-ID review: documented floor is max(valid historical ID sequence,
 * explicit original DocumentProperties counter). It is NEVER a DB-issued ID.
 * All values from original source IDs stay in-memory and are not in errors.
 */
export function buildM02IdFloorReview({schema,pinnedSourceCommit,evidence}={}){
 requireEvidence(schema,pinnedSourceCommit,evidence);
 const notes=issueCounter();
 const families=[];
 for(const spec of specs){
  const key=spec.sourceGroup,rows=evidence.groups[key],
        counterText=evidence.counters[key],
        declared=evidence.declaredSourceCounts[key];
  if(!Array.isArray(rows)||rows.length>250000)
   invalid('INVALID_ID_ROWS_OR_BOUND');
  const prefix=spec.prefix+'-';
  if(!Number.isSafeInteger(declared)||declared<0||declared>250000)
   invalid('INVALID_DECLARED_SOURCE_COUNT');
  if(declared!==rows.length)notes.add(key,'DECLARED_SOURCE_COUNT_MISMATCH');
  let maxHistoricalSequence=0;
  const seenSheetRows=new Set(),seenOriginalIds=new Set();
  for(const row of rows){
   if(!exactKeys(row,['sheetRow','id'])||typeof row.id!=='string')
    invalid('INVALID_SOURCE_ROW_FORMAT');
   if(!Number.isSafeInteger(row.sheetRow)||row.sheetRow<2||
      seenSheetRows.has(row.sheetRow))notes.add(key,'DUPLICATE_OR_INVALID_ROW_PROVENANCE');
   else seenSheetRows.add(row.sheetRow);
   const id=row.id;
   if(seenOriginalIds.has(id))notes.add(key,'DUPLICATE_OR_REUSED_ID');
   else seenOriginalIds.add(id);
   if(!id.startsWith(prefix)){
    notes.add(key,'MALFORMED_OR_NONCANONICAL_ID');continue;
   }
   const digits=id.slice(prefix.length);
   if(!/^[0-9]+$/.test(digits)){
    notes.add(key,'MALFORMED_OR_NONCANONICAL_ID');continue;
   }
   const n=Number(digits);
   if(!Number.isSafeInteger(n)||n<1||
      String(n).padStart(spec.minimumPad,'0')!==digits){
    notes.add(key,'MALFORMED_OR_NONCANONICAL_ID');continue;
   }
   if(n>maxHistoricalSequence)maxHistoricalSequence=n;
  }
  let propertyCounter=null;
  if(counterText===null){
   notes.add(key,'MISSING_COUNTER_EVIDENCE');
  }else if(typeof counterText!=='string'||!/^(0|[1-9][0-9]*)$/.test(counterText)||
     !Number.isSafeInteger(Number(counterText))){
   notes.add(key,'INVALID_COUNTER_EVIDENCE');
  }else{
   propertyCounter=Number(counterText);
  }
  const floor=propertyCounter===null?null:Math.max(maxHistoricalSequence,propertyCounter);
  if(floor===Number.MAX_SAFE_INTEGER)notes.add(key,'COUNTER_EXHAUSTED');
  const ready=!notes.forGroup(key);
  families.push({
   sourceGroup:key,sourceIdColumn:spec.sourceIdColumn,prefix:spec.prefix,
   counterProperty:spec.counterProperty,sourceRows:rows.length,
   declaredSourceRows:declared,
   maxHistoricalSequence,propertyCounter,
   candidateFloor:ready?floor:null,
   nextIdCandidate:ready?spec.prefix+'-'+String(floor+1).padStart(spec.minimumPad,'0'):null,
   sourceIdentifiersPreserved:ready,
   independentSourceExportVerified:false,
   d1ReadbackVerified:false
  });
 }
 const issues=notes.list();
 return {
  formatVersion:1,sourceCommit:SOURCE_PIN,
  sourceFamilies:specs.length,candidateComplete:issues.length===0,
  familyEvidenceComplete:issues.length===0,
  sourceIdAndCounterReviewOnly:true,
  sourceToD1Reconciled:false,
  independentSourceExportVerified:false,
  d1Verified:false,idIssuanceAuthorized:false,productionReady:false,
  limitations:'Offline and potentially synthetic: M03 must implement SQL-atomic issuance and M10 must independently reconcile authorized original rows/counters with D1 readback. No live import or counter claim.',
  issues,families
 };
}

async function main(){
 if(process.argv.length!==3)invalid('REQUIRE_ONE_PRIVATE_LOCAL_JSON_PATH');
 const evidence=await readLocalJsonFile(process.argv[2]);
 const result=buildM02IdFloorReview({
  schema:SCHEMA,pinnedSourceCommit:SOURCE_PIN,evidence
 });
 // Intentionally do not print IDs, sequences, counters, source paths or raw rows.
 process.stdout.write(JSON.stringify({
  sourceFamilies:result.sourceFamilies,
  candidateComplete:result.candidateComplete,
  issueCount:result.issues.reduce((total,i)=>total+i.count,0),
  issueKinds:result.issues.map(i=>({
   sourceGroup:i.sourceGroup,code:i.code,count:i.count
  })),
  independentSourceExportVerified:false,
  sourceToD1Reconciled:false,d1Verified:false,
  idIssuanceAuthorized:false,productionReady:false
 })+'\n');
 if(!result.candidateComplete)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  process.stderr.write('M02 original ID floor rejected: invalid or inaccessible private evidence (values withheld)\n');
  process.exitCode=2;
 });
