/**
 * M03/M04 LOCAL-ONLY actor-authorized Product Category/Unit atomic proof.
 * Requires nondeployable M04 auth schema and M03 synthetic master triggers.
 * Never register with the production Worker or public RPC registry.
 */
import {requireD1Binding} from '../db/d1-binding.js';
import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {tokenFingerprint} from '../auth/d1-legacy-rpc.js';
import {M03_MASTER_CREATION_INTERNALS as source} from './m03-product-master-atomic-create.js';

const BUSINESS=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const denied=()=>new Error('Denied: current products.add authorization or immutable intent required');
const FROM=' FROM auth_sessions AS s JOIN auth_users AS u ON u.user_id=s.user_id '+
  'LEFT JOIN auth_roles AS r ON r.role_name=u.role_name';
const WHERE=' WHERE s.token_hash=? AND s.revoked_at_ms IS NULL '+
  'AND s.created_at_ms<=? AND s.expires_at_ms>? '+
  'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=? '+
  "AND u.status='Active' AND u.credential_state='Modern' "+
  'AND u.auth_version=s.user_auth_version '+
  'AND u.credential_version=s.credential_version '+
  "AND ((u.role_name='Administrator' AND s.role_auth_version IS NULL) "+
  "OR (u.role_name<>'Administrator' AND r.role_name IS NOT NULL "+
  "AND r.status='Active' AND r.auth_version=s.role_auth_version "+
  'AND CASE WHEN length(r.permissions_json) BETWEEN 2 AND 16384 '+
  "AND json_valid(r.permissions_json)=1 THEN json_type(r.permissions_json,'$.products.add')='true' "+
  'ELSE 0 END))';
const CURRENT_ACTOR='SELECT u.user_id'+FROM+WHERE;
const CLAIM='INSERT INTO synthetic_m03_master_intents '+
  '(tenant_id,id_key,operation_id,intent_hash,name,snapshot_json,cleanup_json,created_at,actor_id) '+
  'SELECT ?,?,?,?,?,?,?,?,u.user_id'+FROM+WHERE+' '+
  'ON CONFLICT(tenant_id,id_key,operation_id) DO NOTHING';
const READ_RECEIPT='SELECT i.intent_hash,i.name,i.result_id FROM synthetic_m03_master_intents AS i '+
  'JOIN ('+CURRENT_ACTOR+') AS current_actor ON current_actor.user_id=i.actor_id '+
  'WHERE i.tenant_id=? AND i.id_key=? AND i.operation_id=?';
const HAS_OPERATION='SELECT 1 AS collision FROM synthetic_m03_master_intents '+
  'WHERE tenant_id=? AND id_key=? AND operation_id=?';

function requiredRequest(raw){
  if(raw===null || typeof raw!=='object' || Array.isArray(raw) ||
    (Object.getPrototypeOf(raw)!==Object.prototype && Object.getPrototypeOf(raw)!==null) ||
    Reflect.ownKeys(raw).length!==3)
    throw denied();
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  if(!['token','operationId','name'].every(key=>
    Object.hasOwn(descriptors,key) && Object.hasOwn(descriptors[key],'value') &&
    descriptors[key].enumerable) ||
    Reflect.ownKeys(descriptors).some(key=>
      typeof key!=='string' || !['token','operationId','name'].includes(key)))
    throw denied();
  const token=descriptors.token.value;
  if(typeof token!=='string')throw denied();
  const planned=source.inputFields({
    operationId:descriptors.operationId.value,
    name:descriptors.name.value
  });
  return {...planned,token};
}
function clock(now){
  const value=now();
  if(!Number.isSafeInteger(value) || value<AUTH_POLICY.sessionIdleMs ||
    value>8_640_000_000_000_000-AUTH_POLICY.sessionMaxMs)
    throw denied();
  return value;
}
const scope=(fingerprint,nowMs)=>[
  fingerprint,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs
];

/**
 * Internal service. A preflight permission read may protect data disclosure,
 * but it is NEVER relied on for mutation. INSERT...SELECT independently
 * checks current M04 SQL authority in the exact statement firing all
 * catalog/source-ID/receipt triggers, and SQL derives immutable actor_id.
 */
export function createM03M04AuthorizedMasterCreator(env,{businessId,now=Date.now}={}){
  if(typeof businessId!=='string' || !BUSINESS.test(businessId) ||
    typeof now!=='function')throw denied();
  const DB=requireD1Binding(env);
  const catalog=createLegacyCatalogReadAdapter(env);

  async function receipt(group,operationId,params){
    return DB.prepare(READ_RECEIPT)
      .bind(...params,businessId,group.idKey,operationId).first();
  }

  async function create(group,raw){
    const {token,operationId,name}=requiredRequest(raw);
    const nowMs=clock(now);
    const fingerprint=await tokenFingerprint(token);
    if(!fingerprint)throw denied();
    const params=scope(fingerprint,nowMs);

    // This SELECT protects source/catalog/receipt information. It is
    // nonauthoritative for the later mutation, whose SQL repeats the checks.
    const actor=await DB.prepare(CURRENT_ACTOR).bind(...params).first();
    if(!actor || typeof actor.user_id!=='string' || !actor.user_id)throw denied();

    const digest=await source.intentHash(businessId,group.idKey,name);
    const previous=await receipt(group,operationId,params);
    if(previous)return source.validateExisting(previous,digest,name,group.prefix);
    if(await DB.prepare(HAS_OPERATION)
      .bind(businessId,group.idKey,operationId).first())throw denied();

    if(!name)return {success:false,message:group.required};
    const rows=await catalog.getAllRows_(group.idKey);
    const {duplicate,snapshot,cleanup}=source.snapshotAndCleanup(rows,group,name);
    if(duplicate)return {success:false,message:group.duplicate};

    // Statement-level permission and SQL-owned actor attribution: never
    // replace with a JS authorize() then unconditional INSERT VALUES.
    const write=await DB.prepare(CLAIM).bind(
      businessId,group.idKey,operationId,digest,name,
      JSON.stringify(snapshot),JSON.stringify(cleanup),
      new Date(nowMs).toISOString(),...params
    ).run();
    if(write?.success!==true)throw denied();
    // A zero-row claim (revocation, stale session, conflicting operation)
    // is NOT a successful write. Recheck current authority at receipt read.
    const committed=await receipt(group,operationId,params);
    if(!committed)throw denied();
    return source.validateExisting(committed,digest,name,group.prefix);
  }

  return Object.freeze({
    createCategory_(request){return create(source.groups.category,request);},
    createUnit_(request){return create(source.groups.unit,request);}
  });
}
