/**
 * M03 Run 6: private read-only pre-issuance counter floor inspection.
 * Not an importer, not a counter seeder, and never public RPC.
 * A positive result is only a synthetic D1/evidence consistency check.
 */
import {requireD1Binding} from './d1-binding.js';
import {createM03PrivateIdEvidenceReconciler}
 from './m03-private-id-evidence-reconcile.js';
import {SOURCE_ID_PREFIXES} from './m03-source-id-families.js';

const KEYS=Object.keys(SOURCE_ID_PREFIXES);
const COUNTERS='SELECT id_key,prefix,current_sequence FROM synthetic_m03_id_counters '+
 'WHERE tenant_id=? ORDER BY id_key ASC LIMIT 39';
const RECEIPTS='SELECT 1 AS present FROM synthetic_m03_id_receipts '+
 'WHERE tenant_id=? LIMIT 1';
const ERROR='M03 private original ID counter floor rejected';
const TENANT=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const reject=()=>{throw new Error(ERROR);};
function exact(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))reject();
 const desc=Object.getOwnPropertyDescriptors(value);
 const names=Reflect.ownKeys(desc);
 if(names.length!==fields.length||
    names.some(n=>typeof n!=='string'||!fields.includes(n))||
    fields.some(n=>!desc[n]?.enumerable||!Object.hasOwn(desc[n],'value')))reject();
 return Object.fromEntries(fields.map(n=>[n,desc[n].value]));
}
async function all(DB,sql,tenant){
 const answer=await DB.prepare(sql).bind(tenant).all();
 if(answer?.success!==true||!Array.isArray(answer.results))reject();
 return answer.results;
}
function sourceFloor(group,prefix,counter){
 if(typeof counter!=='string'||!/^(0|[1-9][0-9]*)$/.test(counter))reject();
 const property=Number(counter);
 if(!Number.isSafeInteger(property))reject();
 let highest=0;
 for(const row of group){
  const suffix=row.id.slice(prefix.length+1);
  if(!/^[0-9]{6,}$/.test(suffix))reject();
  const n=Number(suffix);
  if(!Number.isSafeInteger(n)||n<1||
     String(n).padStart(6,'0')!==suffix)reject();
  if(n>highest)highest=n;
 }
 const floor=Math.max(highest,property);
 if(floor===Number.MAX_SAFE_INTEGER)reject();
 return floor;
}
/**
 * Tenant is a trusted server-supplied scope; the caller can only request
 * an evidence check and cannot ask this method to seed or issue anything.
 */
export function createM03PrivateSourceFloorAudit(env,tenantId){
 const DB=requireD1Binding(env);
 if(typeof tenantId!=='string'||!TENANT.test(tenantId))reject();
 const archiveVerifier=createM03PrivateIdEvidenceReconciler(env);
 return Object.freeze({
  async auditFreshSeed_(...args){
   try{
    if(args.length!==1)reject();
    const input=exact(args[0],['idEvidence','freezeManifest']);
    // First verify frozen 49 source groups and all 38 M02 salted commitments.
    const source=await archiveVerifier.reconcile_(input);
    if(!source.localD1ArchiveMatchesSuppliedIdFreeze)reject();
    const evidence=input.idEvidence;
    const rows=await all(DB,COUNTERS,tenantId);
    if(rows.length!==KEYS.length)reject();
    const found=new Map();
    for(const item of rows){
     const record=exact(item,['id_key','prefix','current_sequence']);
     if(typeof record.id_key!=='string'||
        !Object.hasOwn(SOURCE_ID_PREFIXES,record.id_key)||
        found.has(record.id_key)||
        record.prefix!==SOURCE_ID_PREFIXES[record.id_key]||
        !Number.isSafeInteger(record.current_sequence)||
        record.current_sequence<0)reject();
     found.set(record.id_key,record.current_sequence);
    }
    for(const key of KEYS){
     if(!found.has(key))reject();
     if(found.get(key)!==sourceFloor(evidence.groups[key],
       SOURCE_ID_PREFIXES[key],evidence.counters[key]))reject();
    }
    // Fresh staging precondition: no prior issued receipts for this tenant.
    if((await all(DB,RECEIPTS,tenantId)).length!==0)reject();
    return Object.freeze({
     formatVersion:1,sourceGroups:49,idFamilies:38,
     exactFreshSyntheticD1CounterFloors:true,
     sourceToD1Reconciled:false,idIssuanceAuthorized:false,
     publicRpcEnabled:false,productionReady:false
    });
   }catch{reject();}
  }
 });
}
