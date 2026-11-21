import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FIELDS={name:120,phone:40,fatherName:180,address:250,notes:500};
const INPUT_KEYS=new Set(['operationId','name','phone','fatherName','relationType',
  'address','notes','openingBalance']);
const AUTH=`EXISTS(SELECT 1 FROM shop_identity i
  JOIN shop_owner_write_grant g ON g.singleton=i.singleton
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
    AND g.enabled=1 AND g.token_hash=?
    AND g.expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER))`;
const CLEAN=`NOT EXISTS(SELECT 1 FROM party_legacy_links WHERE source_group='CUSTOMERS')
  AND NOT EXISTS(SELECT 1 FROM party_roles r WHERE r.role='Customer'
    AND NOT EXISTS(SELECT 1 FROM owner_customer_master m WHERE m.party_id=r.party_id))`;
function plain(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
}
function normalize(input){
  if(!plain(input)||Object.keys(input).some(k=>!INPUT_KEYS.has(k))||
     typeof input.operationId!=='string'||!OPERATION_ID.test(input.operationId))return null;
  const payload={};
  for(const [name,max] of Object.entries(FIELDS)){
    const value=input[name]??'';
    if(typeof value!=='string'||value.length>max||!value.isWellFormed()||
       /[\u0000-\u001f\u007f]/.test(value))return null;
    payload[name]=value.trim();
  }
  if(!payload.name||!payload.phone||!/^[+]?[0-9][0-9 ()-]{5,39}$/.test(payload.phone)||
     payload.phone.replace(/\D/g,'').length<7)return null;
  const relationType=input.relationType??'Father';
  if(!['Father','Husband'].includes(relationType))return null;
  payload.relationType=relationType;
  const opening=input.openingBalance??'0';
  if(![0,'0','0.0','0.00'].includes(opening))return null;
  return payload;
}
const sourceCustomerId=n=>'CUS-'+String(n).padStart(6,'0');

/** Exactly one authenticated Shop D1 Customer Party role; no Cash/AR/credit. */
export async function createOwnerCustomer(scope,{token,ownerSubject,input}={}){
  const payload=normalize(input);
  if(!payload)return {status:'invalid'};
  if(typeof ownerSubject!=='string'||!ownerSubject.trim()||
     typeof scope?.shopDb?.batch!=='function')return {status:'denied'};
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return {status:'denied'};
  const {shopDb:db,shopId,databaseId,databaseMarker}=scope;
  const actorId='google:'+ownerSubject;
  const intent=await hashCanonicalOperationIntent({tenantId:shopId,actorId,
    operationType:'customers.add',payload});
  const bindings=[shopId,databaseId,databaseMarker,digest];
  const results=await db.batch([
    db.prepare(`INSERT INTO owner_customer_create_receipts
        (operation_id,actor_id,intent_hash,payload,created_at_ms)
      SELECT ?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)
      WHERE ${AUTH} AND (${CLEAN})
        AND NOT EXISTS(SELECT 1 FROM owner_customer_create_receipts WHERE operation_id=?)
      RETURNING sequence`).bind(input.operationId,actorId,intent,
        JSON.stringify(payload),...bindings,input.operationId),
    db.prepare(`SELECT ${AUTH} AS allowed,(${CLEAN}) AS clean,
      r.sequence,r.actor_id,r.intent_hash
      FROM (SELECT 1) gate
      LEFT JOIN owner_customer_create_receipts r ON r.operation_id=?`)
      .bind(...bindings,input.operationId),
  ]);
  if(results.some(r=>r?.success!==true))throw Error('Customer save unavailable');
  const row=results[1].results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  if(row.clean!==1)return {status:'unavailable'};
  if(row.actor_id!==null && (row.actor_id!==actorId||row.intent_hash!==intent))
    return {status:'conflict'};
  if(!Number.isSafeInteger(row.sequence)||row.sequence<1)
    throw Error('Customer receipt not confirmed');
  return {status:results[0].results?.length===1?'created':'replayed',
    id:sourceCustomerId(row.sequence)};
}

/** Trusted read AFTER private Owner auth & Shop binding verification. */
export async function readOwnerCustomerBootstrap(db){
  const read=await db.prepare(`SELECT m.customer_id AS id,p.display_name AS name,
      p.phone,p.address,m.father_name AS fatherName,m.relation_type AS relationType,
      m.notes,m.status,m.opening_paisa AS openingPaisa,m.current_due_paisa AS duePaisa
    FROM owner_customer_master m
    JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'
    JOIN party_roles r ON r.party_id=m.party_id AND r.role='Customer' AND r.status='ACTIVE'
    WHERE m.status='Active'
    ORDER BY m.customer_id LIMIT 1001`).all();
  if(read?.success!==true||!Array.isArray(read.results)||read.results.length>1000)
    throw Error('Customer directory unavailable');
  return {customers:read.results.map(row=>{
    if(!Number.isSafeInteger(row.openingPaisa)||!Number.isSafeInteger(row.duePaisa)||
       row.openingPaisa!==0||row.duePaisa!==0)
      throw Error('Customer financial balance is unavailable');
    return {'Customer ID':row.id,'Customer Name':row.name,
      Phone:row.phone||'','Father Name':row.fatherName||'',
      'Relation Type':row.relationType,Address:row.address||'',
      Notes:row.notes||'','Opening Balance':0,'Current Due':0,
      Status:row.status};
  }),bankAccounts:[],currencySymbol:''};
}

/** POS has its own original source customer card projection. */
export async function readOwnerPosCustomers(db){
  const {customers}=await readOwnerCustomerBootstrap(db);
  return customers.map(row=>({id:row['Customer ID'],name:row['Customer Name'],
    phone:row.Phone,fatherName:row['Father Name'],relationType:row['Relation Type'],
    address:row.Address,currentDue:0}));
}
