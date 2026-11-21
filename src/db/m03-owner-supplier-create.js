import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {originalSourceIdPrefix} from './m03-source-id-families.js';

const OPERATION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SUPPLIER_ID=/^SUP-[0-9]{6}$/;
const SIGNED_MONEY=/^-?(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/;
const OPENING_LIMIT=1000000000000n;
function openingPaisa(value){
  const raw=typeof value==='number'&&Number.isFinite(value)?String(value):value;
  if(typeof raw!=='string'||!SIGNED_MONEY.test(raw))return null;
  const neg=raw.startsWith('-'),part=neg?raw.slice(1):raw;
  const [whole,fraction='']=part.split('.');
  const paisa=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')||'0');
  if(paisa>OPENING_LIMIT)return null;
  return Number(neg?-paisa:paisa);
}
async function hasOpeningCheckpoints(DB){
  const row=await DB.prepare(`SELECT 1 AS present FROM sqlite_schema
    WHERE type='table' AND name='owner_supplier_opening_checkpoints'`).first();
  return row?.present===1;
}
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
  const amount=openingPaisa(input.openingBalance??'0');
  if(amount===null)return null;
  payload.openingBalance=(amount/100).toFixed(2);
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
  const signed=openingPaisa(payload.openingBalance);
  const withOpening=await hasOpeningCheckpoints(DB);
  if(!withOpening&&signed!==0)return {status:'invalid'};
  // D1 batch is atomic: source receipt creates Party/Supplier identity first;
  // the opening checkpoint then records a role-only historical baseline.
  const receipt=DB.prepare(`INSERT INTO owner_supplier_create_receipts
      (operation_id,actor_id,intent_hash,name_key,payload,created_at_ms)
      SELECT ?,?,?,?,?,CAST(unixepoch('subsec') * 1000 AS INTEGER)
      WHERE ${CURRENT_GRANT} AND (${CLEAN_SOURCE})
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_create_receipts WHERE operation_id=?)
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_master
          WHERE name_key=? AND status='Active')
      RETURNING sequence`).bind(input.operationId,actorId,intent,nameKey,
        JSON.stringify(payload),...auth,input.operationId,nameKey);
  const opening=withOpening&&signed!==0?DB.prepare(`INSERT INTO owner_supplier_opening_checkpoints
      (supplier_id,operation_id,actor_id,signed_opening_paisa,as_of_date,created_at_ms)
      SELECT m.supplier_id,r.operation_id,r.actor_id,?,date('now','+6 hours'),
        CAST(unixepoch('subsec')*1000 AS INTEGER)
      FROM owner_supplier_create_receipts r
      JOIN owner_supplier_master m
        ON m.supplier_id='SUP-'||printf('%06d',r.sequence)
      WHERE r.operation_id=? AND r.actor_id=? AND r.intent_hash=?
        AND ${CURRENT_GRANT}
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_opening_checkpoints c
          WHERE c.supplier_id=m.supplier_id)
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_purchase_receipts p
          WHERE p.supplier_id=m.supplier_id)
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_supplier_cash_payment_receipts p
          WHERE p.supplier_id=m.supplier_id)
      RETURNING supplier_id`).bind(signed,input.operationId,actorId,intent,...auth):null;
  const check=DB.prepare(`SELECT ${CURRENT_GRANT} AS authorized,
      (${CLEAN_SOURCE}) AS clean,r.sequence,r.actor_id,r.intent_hash
      ${withOpening?`,(SELECT c.signed_opening_paisa
        FROM owner_supplier_opening_checkpoints c
        WHERE c.supplier_id='SUP-'||printf('%06d',r.sequence)) AS recordedOpening`:''}
      FROM (SELECT 1) context
      LEFT JOIN owner_supplier_create_receipts r ON r.operation_id=?`)
    .bind(...auth,input.operationId);
  const results=await DB.batch([receipt,...(opening?[opening]:[]),check]);
  const write=results[0],verification=results.at(-1);
  if(write?.success!==true||verification?.success!==true)
    throw new Error('Supplier save unavailable');
  const row=verification.results?.[0];
  if(row?.authorized!==1)return {status:'denied'};
  if(row.clean!==1)return {status:'unavailable'};
  if(withOpening&&signed!==0&&row.recordedOpening!==signed)return {status:'unavailable'};
  if(row.actor_id!==actorId||row.intent_hash!==intent)return {status:'conflict'};
  if(!Number.isSafeInteger(row.sequence)||row.sequence<1)
    throw new Error('Invalid Supplier ID receipt');
  return {status:write.results.length===1?'created':'replayed',
    id:originalSourceIdPrefix('SUPPLIERS')+'-'+String(row.sequence).padStart(6,'0')};
}

/** Trusted Shop D1 read, AFTER current Owner session/binding verification. */
export async function readOwnerSupplierBootstrap(DB){
  const withOpening=await hasOpeningCheckpoints(DB);
  const openingFields=withOpening?`,
    COALESCE(c.signed_opening_paisa,0) AS openingPaisa,
    CASE WHEN c.signed_opening_paisa<0 THEN -c.signed_opening_paisa ELSE 0 END AS advancePaisa,
    CASE WHEN c.signed_opening_paisa>0 THEN c.signed_opening_paisa ELSE 0 END AS payablePaisa`:
    ',m.opening_paisa AS openingPaisa,0 AS advancePaisa,0 AS payablePaisa';
  const openingJoin=withOpening?
    'LEFT JOIN owner_supplier_opening_checkpoints c ON c.supplier_id=m.supplier_id':'';
  const result=await DB.prepare(`SELECT m.supplier_id AS supplierId,
    p.display_name AS name,p.phone,p.address,m.notes,m.status,
    m.current_due_paisa AS duePaisa ${openingFields}
    FROM owner_supplier_master m
    JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'
    JOIN party_roles r ON r.party_id=p.party_id AND r.role='Supplier' AND r.status='ACTIVE'
    ${openingJoin}
    ORDER BY m.supplier_id LIMIT 1001`).all();
  if(result?.success!==true||!Array.isArray(result.results)||result.results.length>1000)
    throw new Error('Supplier catalog unavailable');
  return {
    suppliers:result.results.map(row=>{
      if([row.openingPaisa,row.duePaisa,row.advancePaisa,row.payablePaisa]
        .some(value=>!Number.isSafeInteger(value)))
        throw new Error('Supplier balance unavailable');
      return {'Supplier ID':row.supplierId,'Supplier Name':row.name,
        Phone:row.phone||'',Address:row.address||'',Notes:row.notes||'',
        'Opening Balance':row.openingPaisa/100,'Current Due':row.duePaisa/100,
        'Opening Payable':row.payablePaisa/100,
        'Supplier Advance':row.advancePaisa/100,
        Status:row.status};
    }),
    bankAccounts:[],currencySymbol:'',
  };
}

/** One-time historical opening for a Supplier created before the approved
 * opening-checkpoint schema was installed. Never post today's cash turnover.
 * The SQL writer requires a current Owner grant and a clean money history.
 */
export async function recordOwnerSupplierOpening(scope,{
  token,ownerSubject,supplierId,openingBalance,operationId
}={}){
  const signed=openingPaisa(openingBalance);
  if(signed===null||!SUPPLIER_ID.test(supplierId||'')||
     !OPERATION_ID.test(operationId||''))return {status:'invalid'};
  if(!scope||typeof ownerSubject!=='string'||!ownerSubject.trim()||
     typeof scope.shopDb?.batch!=='function')return {status:'denied'};
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return {status:'denied'};
  const {shopDb:DB,shopId,databaseId,databaseMarker}=scope;
  if(!await hasOpeningCheckpoints(DB))return {status:'unsupported'};
  const actorId='google:'+ownerSubject;
  const grant=[shopId,databaseId,databaseMarker,digest];
  const [write,read]=await DB.batch([
    DB.prepare(`INSERT INTO owner_supplier_opening_checkpoints(
        supplier_id,operation_id,actor_id,signed_opening_paisa,as_of_date,created_at_ms)
      SELECT m.supplier_id,?,?,?,date('now','+6 hours'),
        CAST(unixepoch('subsec')*1000 AS INTEGER)
      FROM owner_supplier_master m
      JOIN parties p ON p.party_id=m.party_id AND p.status='ACTIVE'
      JOIN party_roles r ON r.party_id=m.party_id
        AND r.role='Supplier' AND r.status='ACTIVE'
      WHERE m.supplier_id=? AND m.status='Active' AND m.current_due_paisa=0
        AND ${CURRENT_GRANT} AND (${CLEAN_SOURCE})
        AND NOT EXISTS(SELECT 1 FROM owner_supplier_opening_checkpoints c
          WHERE c.supplier_id=m.supplier_id OR c.operation_id=?)
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_purchase_receipts t
          WHERE t.supplier_id=m.supplier_id)
        AND NOT EXISTS(SELECT 1 FROM owner_mvp_supplier_cash_payment_receipts t
          WHERE t.supplier_id=m.supplier_id)
      RETURNING supplier_id`).bind(operationId,actorId,signed,supplierId,...grant,operationId),
    DB.prepare(`SELECT ${CURRENT_GRANT} AS allowed,c.operation_id AS operationId,
      c.actor_id AS actorId,c.signed_opening_paisa AS signedPaisa
      FROM (SELECT 1) gate
      LEFT JOIN owner_supplier_opening_checkpoints c ON c.supplier_id=?`)
      .bind(...grant,supplierId)
  ]);
  if(write?.success!==true||read?.success!==true)
    throw Error('Supplier opening outcome unavailable');
  const row=read.results?.[0];
  if(row?.allowed!==1)return {status:'denied'};
  if(write.results.length===1)return {status:'created',supplierId};
  if(row.operationId===operationId&&row.actorId===actorId&&
     row.signedPaisa===signed)return {status:'replayed',supplierId};
  return {status:'conflict'};
}
