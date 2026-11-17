/**
 * M03 Run 7 — synthetic, private/local D1 counter floor seed proof.
 * Not a production migration, live importer, issuer or public RPC endpoint.
 * The single guarded INSERT is atomic in SQLite; the prior source proof and
 * subsequent floor audit are NOT one transaction with it and authorize nothing.
 */
import {requireD1Binding} from './d1-binding.js';
import {SOURCE_ID_PREFIXES} from './m03-source-id-families.js';
import {createM03PrivateIdEvidenceReconciler}
 from './m03-private-id-evidence-reconcile.js';
import {createM03PrivateSourceFloorAudit}
 from './m03-private-source-floor-audit.js';

const KEYS=Object.keys(SOURCE_ID_PREFIXES);
const TENANT=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const FAIL='M03 private source ID floor installation rejected';
const reject=()=>{throw new Error(FAIL);};
// These family keys and prefixes come solely from the fixed source-pinned
// Config inventory, never from evidence or a client request. Bind only the
// 38 private floor numbers (+ 3 tenant scopes) to stay within D1's 100 limit.
function sqlLiteral(value,pattern){
 if(typeof value!=='string'||!pattern.test(value))reject();
 return "'"+value+"'";
}
const INSERT='WITH floors(id_key,prefix,current_sequence) AS (VALUES '+
 KEYS.map(key=>'('+sqlLiteral(key,/^[A-Z][A-Z0-9_]{0,63}$/)+','+
  sqlLiteral(SOURCE_ID_PREFIXES[key],/^[A-Z][A-Z0-9]{0,15}$/)+',?)').join(',')+
 ') INSERT INTO synthetic_m03_id_counters'+
 ' (tenant_id,id_key,prefix,current_sequence)'+
 ' SELECT ?,id_key,prefix,current_sequence FROM floors'+
 ' WHERE NOT EXISTS ('+
 '  SELECT 1 FROM synthetic_m03_id_counters WHERE tenant_id=?'+
 ' ) AND NOT EXISTS ('+
 '  SELECT 1 FROM synthetic_m03_id_receipts WHERE tenant_id=?'+
 ' )';

function exact(record,fields){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(record)))reject();
 const props=Object.getOwnPropertyDescriptors(record);
 const keys=Reflect.ownKeys(props);
 if(keys.length!==fields.length||
    keys.some(x=>typeof x!=='string'||!fields.includes(x))||
    fields.some(x=>!props[x]?.enumerable||
      !Object.hasOwn(props[x],'value')))reject();
 return Object.fromEntries(fields.map(k=>[k,props[k].value]));
}

/** All source values are checked by the Run 5 private frozen-source verifier first. */
function parameterFloors(evidence){
 const params=[];
 for(const key of KEYS){
  const prefix=SOURCE_ID_PREFIXES[key];
  const group=evidence.groups[key];
  const propertyText=evidence.counters[key];
  if(!Array.isArray(group)||
     typeof propertyText!=='string'||!/^(0|[1-9][0-9]*)$/.test(propertyText))
   reject();
  const property=Number(propertyText);
  if(!Number.isSafeInteger(property))reject();
  let maxHistorical=0;
  for(const row of group){
   if(!row||typeof row.id!=='string'||!row.id.startsWith(prefix+'-'))reject();
   const digits=row.id.slice(prefix.length+1),sequence=Number(digits);
   if(!/^[0-9]{6,}$/.test(digits)||!Number.isSafeInteger(sequence)||
      sequence<1||String(sequence).padStart(6,'0')!==digits)reject();
   maxHistorical=Math.max(maxHistorical,sequence);
  }
  const floor=Math.max(maxHistorical,property);
  if(floor>=Number.MAX_SAFE_INTEGER)reject();
  params.push(floor);
 }
 return params;
}

/** Trusted offline caller only. Caller-supplied tenant/authority is never accepted. */
export function createM03PrivateSourceFloorInstaller(env,tenantId){
 const DB=requireD1Binding(env);
 if(typeof tenantId!=='string'||!TENANT.test(tenantId))reject();
 const verified=createM03PrivateIdEvidenceReconciler(env);
 const audit=createM03PrivateSourceFloorAudit(env,tenantId);
 return Object.freeze({
  async installFreshSynthetic_(...args){
   try{
    if(args.length!==1)reject();
    const request=exact(args[0],['idEvidence','freezeManifest']);
    const original=await verified.reconcile_(request);
    if(original.localD1ArchiveMatchesSuppliedIdFreeze!==true)reject();
    // One SQL statement either inserts exactly all 38 floors or zero rows.
    // The NOT EXISTS guards prevent combining new seed rows with a partial
    // pre-existing seed or with previously issued receipts in this tenant.
    const values=parameterFloors(request.idEvidence);
    const result=await DB.prepare(INSERT)
     .bind(...values,tenantId,tenantId,tenantId).run();
    if(result?.success!==true)reject();
    // Check the actual committed DB, not a JS-generated optimistic result.
    // Same evidence replay gives zero insert changes and passes this audit.
    const after=await audit.auditFreshSeed_(request);
    if(after.exactFreshSyntheticD1CounterFloors!==true)reject();
    return Object.freeze({
     formatVersion:1,sourceGroups:49,idFamilies:38,
     localSyntheticD1FloorsInstalled:true,
     independentSourceCaptureVerified:false,sourceToD1Reconciled:false,
     idIssuanceAuthorized:false,publicRpcEnabled:false,productionReady:false
    });
   }catch{reject();}
  }
 });
}
