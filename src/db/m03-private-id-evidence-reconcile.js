/**
 * M03 Run 5: PRIVATE, READ-ONLY source-ID evidence vs sealed D1 archive.
 * This proves supplied evidence consistency, NOT independent source custody,
 * issuer floor installation, staff authority, operational D1 or public RPC.
 * Never log/return original IDs, counters, hashes or source text.
 */
import {createFrozenSourceReadback} from './m03-frozen-source-readback.js';
import {FROZEN_SOURCE_COMMIT} from './m03-frozen-source-headers.js';
import {SOURCE_ID_PREFIXES} from './m03-source-id-families.js';

const FAMILIES=Object.keys(SOURCE_ID_PREFIXES);
const HEX=/^[a-f0-9]{64}$/;
const DECIMAL=/^(0|[1-9][0-9]*)$/;
const EVIDENCE=['formatVersion','sourceCommit','groups','counters','declaredSourceCounts'];
const MANIFEST=['formatVersion','sourceCommit','scope','salt','sourceFamilies','families',
 'rootDigest','sourceApproved','sourceToD1Reconciled','idIssuanceAuthorized','productionReady'];
const FAMILY_FIELDS=['sourceGroup','rowCount','rowDigest','counterDigest'];
const ERROR='M03 private original ID evidence rejected';
const reject=()=>{throw new Error(ERROR);};

function exact(record,names){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(record)))reject();
 const descriptors=Object.getOwnPropertyDescriptors(record);
 const fields=Reflect.ownKeys(descriptors);
 if(fields.length!==names.length||
    fields.some(k=>typeof k!=='string'||!names.includes(k))||
    names.some(k=>descriptors[k]?.enumerable!==true||
      !Object.hasOwn(descriptors[k],'value')))reject();
 return Object.fromEntries(names.map(k=>[k,descriptors[k].value]));
}
function dense(rows){
 if(!Array.isArray(rows)||Object.getPrototypeOf(rows)!==Array.prototype||
    rows.length>250000||Reflect.ownKeys(rows).length!==rows.length+1)reject();
 return Array.from({length:rows.length},(_,i)=>{
  const d=Object.getOwnPropertyDescriptor(rows,String(i));
  if(!d?.enumerable||!Object.hasOwn(d,'value'))reject();
  return d.value;
 });
}
async function sha(value){
 const bytes=new TextEncoder().encode(JSON.stringify(value));
 const sum=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(sum),v=>v.toString(16).padStart(2,'0')).join('');
}
function familyRows(key,prefix,rows){
 const pairs=dense(rows).map(item=>{
  const x=exact(item,['sheetRow','id']);
  if(!Number.isSafeInteger(x.sheetRow)||x.sheetRow<2||typeof x.id!=='string'||
     !x.id.startsWith(prefix+'-'))reject();
  const digits=x.id.slice(prefix.length+1),n=Number(digits);
  if(!/^[0-9]{6,}$/.test(digits)||!Number.isSafeInteger(n)||n<1||
     String(n).padStart(6,'0')!==digits)reject();
  return [x.sheetRow,x.id];
 }).sort((a,b)=>a[0]-b[0]);
 for(let i=1;i<pairs.length;i++)
  if(pairs[i-1][0]===pairs[i][0]||pairs[i-1][1]===pairs[i][1])reject();
 if(new Set(pairs.map(p=>p[1])).size!==pairs.length)reject();
 return pairs;
}
async function reconcile(archive,input){
 const x=exact(input,['idEvidence','freezeManifest']);
 const evidence=exact(x.idEvidence,EVIDENCE),freeze=exact(x.freezeManifest,MANIFEST);
 if(evidence.formatVersion!==1||evidence.sourceCommit!==FROZEN_SOURCE_COMMIT||
    freeze.formatVersion!==1||freeze.sourceCommit!==FROZEN_SOURCE_COMMIT||
    freeze.scope!=='private-original-ID-evidence'||!HEX.test(freeze.salt)||
    !HEX.test(freeze.rootDigest)||freeze.sourceFamilies!==FAMILIES.length||
    freeze.sourceApproved!==false||freeze.sourceToD1Reconciled!==false||
    freeze.idIssuanceAuthorized!==false||freeze.productionReady!==false)reject();
 const groups=exact(evidence.groups,FAMILIES),counters=exact(evidence.counters,FAMILIES);
 const counts=exact(evidence.declaredSourceCounts,FAMILIES);
 const seals=dense(freeze.families);
 if(seals.length!==FAMILIES.length)reject();
 const next=[];
 for(let i=0;i<FAMILIES.length;i++){
  const key=FAMILIES[i],prefix=SOURCE_ID_PREFIXES[key],group=archive.groups[key];
  if(!group||!Array.isArray(group.rows)||group.headers[0]===undefined)reject();
  const pairs=familyRows(key,prefix,groups[key]);
  const count=counts[key],counter=counters[key];
  if(!Number.isSafeInteger(count)||count!==pairs.length||
     typeof counter!=='string'||!DECIMAL.test(counter)||
     !Number.isSafeInteger(Number(counter)))reject();
  if(group.rows.length!==pairs.length)reject();
  for(let j=0;j<pairs.length;j++){
   const source=group.rows[j];
   if(source.sheetRow!==pairs[j][0]||source.cells[0]!==pairs[j][1])reject();
  }
  const frozen=exact(seals[i],FAMILY_FIELDS);
  if(frozen.sourceGroup!==key||frozen.rowCount!==pairs.length||
     typeof frozen.rowDigest!=='string'||!HEX.test(frozen.rowDigest)||
     typeof frozen.counterDigest!=='string'||!HEX.test(frozen.counterDigest))reject();
  const rowDigest=await sha(['M02-original-ID-row-v1',freeze.salt,key,pairs]);
  const counterDigest=await sha(['M02-original-ID-property-v1',freeze.salt,key,counter]);
  if(rowDigest!==frozen.rowDigest||counterDigest!==frozen.counterDigest)reject();
  next.push([key,frozen.rowCount,frozen.rowDigest,frozen.counterDigest]);
 }
 if(await sha(['M02-private-ID-freeze-v1',FROZEN_SOURCE_COMMIT,freeze.salt,next])
    !==freeze.rootDigest)reject();
 return Object.freeze({
  formatVersion:1,sourceGroups:49,idFamilies:38,
  localD1ArchiveMatchesSuppliedIdFreeze:true,
  independentSourceCaptureVerified:false,sourceToD1Reconciled:false,
  idIssuanceAuthorized:false,publicRpcEnabled:false,productionReady:false
 });
}

/** Trusted offline/test-only caller; deliberately no token, tenant or writer. */
export function createM03PrivateIdEvidenceReconciler(env){
 const reader=createFrozenSourceReadback(env);
 return Object.freeze({
  async reconcile_(...args){
   try{
    if(args.length!==1)reject();
    // Full sealed 49/49 SHA-256 archival readback before comparing ID rows.
    const archive=await reader.readAllSourceGroups();
    return await reconcile(archive,args[0]);
   }catch{reject();}
  }
 });
}
