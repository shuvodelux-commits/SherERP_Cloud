import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {originalSourceIdPrefix} from './m03-source-id-families.js';

const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FIELD_LIMITS={name:120,phone:40,address:250,notes:500};
const VALID_KEYS=new Set(['operationId','name','phone','address','notes','openingBalance']);
const CURRENT_GRANT=`EXISTS(SELECT 1 FROM shop_identity i
  JOIN shop_owner_write_grant g ON g.singleton=i.singleton
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
    AND g.enabled=1 AND g.token_hash=?
    AND g.expires_at_ms>CAST(unixepoch('subsec') * 1000 AS INTEGER))`;
const CLEAN_SOURCE=`NOT EXISTS(SELECT 1 FROM party_legacy_links)
  AND NOT EXISTS(SELECT 1 FROM party_roles r WHERE r.role='Supplier'
    AND NOT EXISTS(SELECT 1 FROM owner_supplier_master m WHERE m.party_id=r.party_id))`;

function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).some(k=>!VALID_KEYS.has(k))||
     typeof input.operationId!=='string'||!OPERATION_ID.test(input.operationId))return null;
  const payload={};
  for(const [key,max] of Object.entries(FIELD_LIMITS)){
    const value=input[key]??'';
    if(typeof value!=='string'||value.length>max||!value.isWellFormed()||
       /[\u0000-\u001f\u007f]/.test(value))return null;
    payload[key]=value.trim();
  }
  if(!payload.name)return null;
  const opening=input.openingBalance??'0';
  if(!((typeof opening==='string'&&/^0(?:\.0{1,2})?$/.test(opening))||
        (typeof opening==='number'&&Object.is(opening,0))))return null;
  payload.openingBalance='0';
  return payload;
}

/**
 * Clean-business-only original addSupplier primitive. Invoked by a private
 * Worker after current Control D1 Owner/session/binding verification. A Shop
 * grant is independently checked at SQL mutation time inside one D1 batch.
 * Nonzero historical opening requires an approved gross-ledger migration.
 */
export async function createOwnerSupplier(scope,{token,ownerSubject,input}={}){
  const payload=normalize(input);
  if(!payload)return {status:'invalid'};
  if(typeof ownerSubject!=='string'||!ownerSubject.trim())return {status:'denied'};
  const digest=await hashOpaqueSessionToken(token);
  if(!digest||!scope||typeof scope.shopDb?.batch!=='function')return {status:'denied'};
  const {shopDb:DB,shopId,databaseId,databaseMarker}=scope;
  const actorId='google:'+ownerSubject;
  const intent=await hashCanonicalOperationIntent({
    tenantId:shopId,actorId,operationType:'suppliers.add',payload,
  });
  const nameKey=payload.name.toLowerCase();
  const auth=[shopId,databaseId,databaseMarker,digest];
  const [write,check]=await DB.batch([
    DB.prepare(`INSERT INTO owner_supplier_create_receipts
      (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
      SELECT ?,?,?,?,?,CAST(unixepoch('subsec') * 1000 AS INTEGER)
      WHERE ${CURRENT_GRANT} AND (${CLEAN_SOURCE})
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_create_receipts WHERE operation_id=?)
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_master
          WHERE name_key=? AND status='Active')
      RETURNING sequence`).bind(input.operationId,actorId,intent,nameKey,
        JSON.stringify(payload),...auth,input.operationId,nameKey),
    DB.prepare(`SELECT ${CURRENT_GRANT} AS authorized,(${CLEAN_SOURCE}) AS clean,
      r.sequence,r.actor_id,r.intent_hash FROM (SELECT 1) context
      LEFT JOIN owner_supplier_create_receipts r ON r.operation_id=?`)
      .bind(...auth,input.operationId),
  ]);
  if(write?.success!==true||check?.success!==true)
    throw new Error('Supplier save unavailable');
  const row=check.results?.[0];
  if(row?.authorized!==1)return {status:'denied'};
  if(row.clean!==1)return {status:'unavailable'};
  if(row.actor_id!==actorId||row.intent_hash!==intent)return {status:'conflict'};
  if(!Number.isSafeInteger(row.sequence)||row.sequence<1)
    throw new Error('Invalid Supplier ID receipt');
  return {status:write.results.length===1?'created':'replayed',
    id:originalSourceIdPrefix('SUPPLIERS')+'-'+String(row.sequence).padStart(6,'0')};
}

/** Trusted Shop D1 read, AFTER current Owner session/binding verification. */
export async function readOwnerSupplierBootstrap(DB){
  const result=await DB.prepare(`SELECT m.supplier_id AS supplierId,
    p.display_name AS name,p.phone,p.address,m.notes,m.status,
    m.opening_paisa AS openingPaisa,m.current_due_paisa AS duePaisa
    FROM owner_supplier_master m
    JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'
    JOIN party_roles r ON r.party_id=p.party_id AND r.role='Supplier' AND r.status='ACTIVE'
    ORDER BY m.supplier_id LIMIT 1001`).all();
  if(result?.success!==true||!Array.isArray(result.results)||result.results.length>1000)
    throw new Error('Supplier catalog unavailable');
  return {
    suppliers:result.results.map(row=>{
      if(!Number.isSafeInteger(row.openingPaisa)||!Number.isSafeInteger(row.duePaisa))
        throw new Error('Supplier balance unavailable');
      return {'Supplier ID':row.supplierId,'Supplier Name':row.name,
        Phone:row.phone||'',Address:row.address||'',Notes:row.notes||'',
        'Opening Balance':row.openingPaisa/100,'Current Due':row.duePaisa/100,
        Status:row.status};
    }),
    bankAccounts:[],currencySymbol:'',
  };
}
