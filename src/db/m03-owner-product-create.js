import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {originalSourceIdPrefix} from './m03-source-id-families.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';

const FIELD_LIMITS={name:120,brand:120,category:120,unit:80,barcode:120};
const FIELDS=[...Object.keys(FIELD_LIMITS),'operationId','purchasePrice','sellingPrice','stock','minStock','productType','components'];
const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PRICE=/^\d{1,10}(?:\.\d{1,2})?$/;
const QUANTITY=/^\d{1,10}$/;
const EXACT_AUTHORITY=`EXISTS(SELECT 1 FROM shop_identity i JOIN shop_owner_write_grant g USING(singleton)
  WHERE i.singleton=1 AND i.shop_id=? AND i.database_id=? AND i.database_marker=?
    AND g.enabled=1 AND g.token_hash=?)`;
export const CLEAN_PRODUCT_SOURCE=`NOT EXISTS(SELECT 1 FROM legacy_product_snapshots)
  AND NOT EXISTS(SELECT 1 FROM products WHERE source_profile='canonical')`;

function validateDraft(input){
  if(!input||typeof input!=='object'||Object.keys(input).length!==FIELDS.length||
     !FIELDS.every(key=>Object.hasOwn(input,key)))return null;
  if(typeof input.operationId!=='string'||!OPERATION_ID.test(input.operationId)||
     input.productType!=='Standard'||input.stock!=='0'||!Array.isArray(input.components)||input.components.length)return null;
  const payload={};
  for(const [key,limit] of Object.entries(FIELD_LIMITS)){
    const value=input[key];
    if(typeof value!=='string'||value.length>limit||!value.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value))return null;
    payload[key]=value.trim();
  }
  if(!payload.name)return null;
  payload.category||='Uncategorized';
  payload.unit||='pcs';
  for(const key of ['purchasePrice','sellingPrice','minStock']){
    const pattern=key==='minStock'?QUANTITY:PRICE;
    if(typeof input[key]!=='string'||!pattern.test(input[key]))return null;
    payload[key]=input[key];
  }
  return payload;
}

export async function createOwnerProduct(scope,{token,ownerSubject,input}){
  const payload=validateDraft(input);
  if(!payload)return {status:'invalid'};
  const tokenHash=await hashOpaqueSessionToken(token);
  if(!tokenHash)return {status:'denied'};
  const {shopDb,shopId,databaseId,databaseMarker}=scope;
  const actorId='google:'+ownerSubject;
  const intent=await hashCanonicalOperationIntent({tenantId:shopId,actorId,operationType:'products.add',payload});
  const authority=[shopId,databaseId,databaseMarker,tokenHash];
  const [write,read]=await shopDb.batch([
    shopDb.prepare(`INSERT INTO owner_product_create_receipts
      (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
      SELECT ?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)
      WHERE ${EXACT_AUTHORITY} AND ${CLEAN_PRODUCT_SOURCE}
        AND NOT EXISTS(SELECT 1 FROM owner_product_create_receipts WHERE operation_id=?)
        AND NOT EXISTS(SELECT 1 FROM owner_product_create_receipts r
          JOIN products p ON p.product_id='PRD-'||printf('%06d',r.sequence)
          WHERE r.name_key=? AND p.is_deleted=0)
      RETURNING sequence`).bind(input.operationId,actorId,intent,payload.name.toLowerCase(),
        JSON.stringify(payload),...authority,input.operationId,payload.name.toLowerCase()),
    shopDb.prepare(`SELECT ${EXACT_AUTHORITY} AS authorized, (${CLEAN_PRODUCT_SOURCE}) AS clean,
      r.sequence,r.actor_id,r.intent_hash FROM (SELECT 1) context
      LEFT JOIN owner_product_create_receipts r ON r.operation_id=?`).bind(...authority,input.operationId),
  ]);
  if(!write.success||!read.success)throw new Error('Product save outcome unavailable');
  const row=read.results[0];
  if(!row?.authorized)return {status:'denied'};
  if(!row.clean)return {status:'unavailable'};
  if(row.actor_id!==actorId||row.intent_hash!==intent)return {status:'conflict'};
  if(!Number.isSafeInteger(row.sequence)||row.sequence<1)throw new Error('Invalid Product ID receipt');
  return {status:write.results.length===1?'created':'replayed',
    id:originalSourceIdPrefix('PRODUCTS')+'-'+String(row.sequence).padStart(6,'0')};
}
