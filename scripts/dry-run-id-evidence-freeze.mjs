#!/usr/bin/env node
/** M02 #573: offline salted source-ID and DocumentProperties freeze, never D1 or posting. */
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildM02IdFloorReview,M02_ID_FAMILIES} from './dry-run-id-floor.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const HEX=/^[a-f0-9]{64}$/;
const KEYS=['formatVersion','sourceCommit','scope','salt','sourceFamilies','families',
 'rootDigest','sourceApproved','sourceToD1Reconciled','idIssuanceAuthorized','productionReady'];
const FAMILY_KEYS=['sourceGroup','rowCount','rowDigest','counterDigest'];
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const reject=()=>{throw new Error('M02 ID freeze rejected: invalid private evidence');};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requirePin(schema,sourceCommit){
 if(sourceCommit!==PIN||!record(schema)||JSON.stringify(schema)!==JSON.stringify(SCHEMA))reject();
}
function evidenceReview(schema,sourceCommit,evidence){
 return buildM02IdFloorReview({schema,pinnedSourceCommit:sourceCommit,evidence});
}
function familyDigest(f,evidence,salt){
 const group=f.sourceGroup,rows=evidence.groups[group];
 return {
  sourceGroup:group,rowCount:rows.length,
  rowDigest:digest(['M02-original-ID-row-v1',salt,group,
   rows.map(x=>[x.sheetRow,x.id]).sort((a,b)=>a[0]-b[0])]),
  counterDigest:digest(['M02-original-ID-property-v1',salt,group,evidence.counters[group]])
 };
}
function rootDigest(manifest){
 return digest(['M02-private-ID-freeze-v1',manifest.sourceCommit,manifest.salt,
  manifest.families.map(f=>[f.sourceGroup,f.rowCount,f.rowDigest,f.counterDigest])]);
}
function validateManifest(manifest){
 if(!exact(manifest,KEYS)||manifest.formatVersion!==1||
    manifest.sourceCommit!==PIN||manifest.scope!=='private-original-ID-evidence'||
    typeof manifest.salt!=='string'||!HEX.test(manifest.salt)||
    manifest.sourceFamilies!==M02_ID_FAMILIES.length||
    !Array.isArray(manifest.families)||manifest.families.length!==M02_ID_FAMILIES.length||
    manifest.sourceApproved!==false||manifest.sourceToD1Reconciled!==false||
    manifest.idIssuanceAuthorized!==false||manifest.productionReady!==false||
    typeof manifest.rootDigest!=='string'||!HEX.test(manifest.rootDigest))
  reject();
 for(let i=0;i<M02_ID_FAMILIES.length;i++){
  const f=manifest.families[i];
  if(!exact(f,FAMILY_KEYS)||f.sourceGroup!==M02_ID_FAMILIES[i].sourceGroup||
     !Number.isSafeInteger(f.rowCount)||f.rowCount<0||f.rowCount>250000||
     typeof f.rowDigest!=='string'||!HEX.test(f.rowDigest)||
     typeof f.counterDigest!=='string'||!HEX.test(f.counterDigest))reject();
 }
 if(rootDigest(manifest)!==manifest.rootDigest)reject();
}
/** Create only a locally retained source commitment, NOT an attestation. */
export function captureM02IdEvidenceFreeze({schema,pinnedSourceCommit,evidence,
 salt=randomBytes(32).toString('hex')}={}){
 requirePin(schema,pinnedSourceCommit);
 if(typeof salt!=='string'||!HEX.test(salt))reject();
 const r=evidenceReview(schema,pinnedSourceCommit,evidence);
 if(!r.candidateComplete)reject();
 const manifest={
  formatVersion:1,sourceCommit:PIN,scope:'private-original-ID-evidence',
  salt,sourceFamilies:M02_ID_FAMILIES.length,
  families:M02_ID_FAMILIES.map(f=>familyDigest(f,evidence,salt)),
  rootDigest:'',sourceApproved:false,sourceToD1Reconciled:false,
  idIssuanceAuthorized:false,productionReady:false
 };
 manifest.rootDigest=rootDigest(manifest);
 return manifest;
}
/** Compare a later local capture; never claim independent provenance or D1 proof. */
export function verifyM02IdEvidenceFreeze({schema,pinnedSourceCommit,manifest,evidence}={}){
 requirePin(schema,pinnedSourceCommit);
 validateManifest(manifest);
 const review=evidenceReview(schema,pinnedSourceCommit,evidence);
 const issues=review.issues.map(i=>({sourceGroup:i.sourceGroup,code:i.code,count:i.count}));
 if(review.candidateComplete){
  for(let i=0;i<M02_ID_FAMILIES.length;i++){
   const old=manifest.families[i],now=familyDigest(M02_ID_FAMILIES[i],evidence,manifest.salt);
   if(old.rowCount!==now.rowCount)
    issues.push({sourceGroup:old.sourceGroup,code:'ORIGINAL_ROW_COUNT_MISMATCH',count:1});
   if(old.rowDigest!==now.rowDigest)
    issues.push({sourceGroup:old.sourceGroup,code:'ORIGINAL_ID_ROW_DIGEST_MISMATCH',count:1});
   if(old.counterDigest!==now.counterDigest)
    issues.push({sourceGroup:old.sourceGroup,code:'ORIGINAL_COUNTER_DIGEST_MISMATCH',count:1});
  }
 }
 return {formatVersion:1,sourceFamilies:M02_ID_FAMILIES.length,
  exactMatch:issues.length===0,issues,
  independentCaptureVerified:false,sourceToD1Reconciled:false,
  d1Verified:false,idIssuanceAuthorized:false,productionReady:false};
}
function outputPath(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>4096||raw.startsWith('-')||
   /^[a-z][a-z0-9+.-]*:/i.test(raw))reject();
 return resolve(raw);
}
async function writePrivateNew(raw,manifest){
 const p=outputPath(raw);
 let handle;
 try{
  handle=await open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(JSON.stringify(manifest)+'\n','utf8');
  await handle.sync();
 }catch{reject();}
 finally{if(handle)await handle.close();}
}
async function main(){
 const [mode,left,right]=process.argv.slice(2);
 if(process.argv.length!==5||!['--capture','--verify'].includes(mode))reject();
 if(mode==='--capture'){
  const evidence=await readLocalJsonFile(left);
  const manifest=captureM02IdEvidenceFreeze({schema:SCHEMA,pinnedSourceCommit:PIN,evidence});
  await writePrivateNew(right,manifest);
  process.stdout.write(JSON.stringify({sourceFamilies:38,privateManifestWritten:true,
   sourceToD1Reconciled:false,idIssuanceAuthorized:false,productionReady:false})+'\n');
 }else{
  const [manifest,evidence]=await Promise.all([readLocalJsonFile(left),readLocalJsonFile(right)]);
  const r=verifyM02IdEvidenceFreeze({schema:SCHEMA,pinnedSourceCommit:PIN,manifest,evidence});
  process.stdout.write(JSON.stringify(r)+'\n');
  if(!r.exactMatch)process.exitCode=2;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  process.stderr.write('M02 private ID evidence rejected (details withheld)\n');
  process.exitCode=2;
 });
