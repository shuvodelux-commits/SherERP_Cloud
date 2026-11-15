import {requireD1Binding} from '../db/d1-binding.js';
import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';

const GROUP=Object.freeze({
  category:Object.freeze({
    idKey:'PRODUCT_CATEGORIES',id:'Category ID',label:'Category Name',
    prefix:'PCAT',required:'Category name is required.',
    duplicate:'A category with this name already exists.'
  }),
  unit:Object.freeze({
    idKey:'PRODUCT_UNITS',id:'Unit ID',label:'Unit Name',
    prefix:'PUNT',required:'Unit name is required.',
    duplicate:'A unit with this name already exists.'
  })
});
const BUSINESS=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const OPERATION=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const READ_RECEIPT='SELECT intent_hash,name,result_id FROM synthetic_m03_master_intents '+
  'WHERE tenant_id=? AND id_key=? AND operation_id=?';
const CLAIM='INSERT INTO synthetic_m03_master_intents '+
  '(tenant_id,id_key,operation_id,intent_hash,name,snapshot_json,cleanup_json,created_at) '+
  'VALUES (?,?,?,?,?,?,?,?) '+
  'ON CONFLICT(tenant_id,id_key,operation_id) DO NOTHING';

function inputFields(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     (Object.getPrototypeOf(input)!==Object.prototype &&
      Object.getPrototypeOf(input)!==null) ||
     Reflect.ownKeys(input).length!==2 ||
     !Object.hasOwn(input,'operationId')||!Object.hasOwn(input,'name') ||
     Reflect.ownKeys(input).some(k=>typeof k!=='string' ||
       (k!=='operationId'&&k!=='name'))){
    throw new TypeError('Invalid source master creation operation');
  }
  const operation=Object.getOwnPropertyDescriptor(input,'operationId');
  const display=Object.getOwnPropertyDescriptor(input,'name');
  if(!operation?.enumerable || !Object.hasOwn(operation,'value') ||
     !display?.enumerable || !Object.hasOwn(display,'value') ||
     typeof operation.value!=='string' || !OPERATION.test(operation.value)){
    throw new TypeError('Invalid original creation operation ID');
  }
  if(typeof display.value!=='string'){
    throw new TypeError('Invalid original source master name');
  }
  return {operationId:operation.value,name:display.value.trim()};
}

async function intentHash(businessId,idKey,name){
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    throw new Error('NEEDS_REVIEW: Web Crypto required for master intent');
  const bytes=new TextEncoder().encode(JSON.stringify([businessId,idKey,name]));
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),
    x=>x.toString(16).padStart(2,'0')).join('');
}

function validateExisting(record,expectedHash,name,prefix){
  if(!record || record.intent_hash!==expectedHash || record.name!==name)
    throw new Error('Source master operation intent collision');
  if(typeof record.result_id!=='string' ||
     !new RegExp('^'+prefix+'-[0-9]{6,}$').test(record.result_id)){
    throw new Error('NEEDS_REVIEW: source master intent missing committed ID');
  }
  return {success:true,data:{id:record.result_id,name}};
}

function snapshotAndCleanup(rows,group,name){
  const identity=new Set(),snapshot=[],cleanup=[];
  const folded=name.toLowerCase();
  let duplicate=false;
  for(const row of rows){
    const id=row?.[group.id];
    const label=row?.[group.label];
    const status=row?.Status;
    if(typeof id!=='string'||!id.trim()||identity.has(id)||
       typeof label!=='string'||!label.trim()||
       typeof status!=='string' ||
       !Number.isInteger(row._rowIndex) || row._rowIndex<2 ||
       typeof row['Created At']!=='string'){
      throw new Error('NEEDS_REVIEW: unsafe ProductSettings catalog source identity');
    }
    identity.add(id);
    snapshot.push([row._rowIndex,id,label,status,row['Created At']]);
    if(label.trim().toLowerCase()===folded){
      if(String(status||'Active').toLowerCase()==='active'){
        duplicate=true;
      }else{
        cleanup.push(id);
      }
    }
  }
  return {duplicate,snapshot,cleanup};
}

/**
 * M03 LOCAL-ONLY proof. Requires test-only synthetic receipt/trigger DDL.
 *
 * Inserting one immutable intent fires SQLite triggers that compare the
 * complete original source-row snapshot, delete inactive matching IDs,
 * compact physical Sheet positions, issue the PCAT/PUNT sequence and append
 * exactly one Active master. An SQL ABORT rolls every effect back.
 *
 * NOT public RPC and NOT an authorization check. M04 products.add must be
 * enforced inside the SQL mutation before this can become a live operation.
 */
export function createM03AtomicProductMasterCreator(env,{businessId}={}){
  if(typeof businessId!=='string'||!BUSINESS.test(businessId))
    throw new TypeError('Invalid trusted single-business D1 context');
  const DB=requireD1Binding(env);
  const catalog=createLegacyCatalogReadAdapter(env);

  const create=async(group,input)=>{
    const {operationId,name}=inputFields(input);
    if(!name)return {success:false,message:group.required};

    const digest=await intentHash(businessId,group.idKey,name);
    const existing=await DB.prepare(READ_RECEIPT)
      .bind(businessId,group.idKey,operationId).first();
    if(existing!==null)return validateExisting(existing,digest,name,group.prefix);

    const rows=await catalog.getAllRows_(group.idKey);
    const {duplicate,snapshot,cleanup}=snapshotAndCleanup(rows,group,name);
    if(duplicate)return {success:false,message:group.duplicate};

    const committed=await DB.prepare(CLAIM).bind(
      businessId,group.idKey,operationId,digest,name,
      JSON.stringify(snapshot),JSON.stringify(cleanup),new Date().toISOString()
    ).run();
    if(committed?.success!==true){
      throw new Error('Unknown D1 master create outcome; reconcile by original operation ID');
    }
    // A concurrent same-op conflict causes ON CONFLICT DO NOTHING. A lost
    // response after a successful INSERT must reuse this same operation ID.
    const receipt=await DB.prepare(READ_RECEIPT)
      .bind(businessId,group.idKey,operationId).first();
    return validateExisting(receipt,digest,name,group.prefix);
  };

  return Object.freeze({
    createCategory_(input){return create(GROUP.category,input);},
    createUnit_(input){return create(GROUP.unit,input);}
  });
}
