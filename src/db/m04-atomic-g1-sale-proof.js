/**
 * M03-G1 INTERNAL, NONDEPLOYABLE integration proof. This combines the exact
 * proposed single-business M04 session schema, test-only immutable operation
 * receipts and synthetic one-SKU/zero-sum journal trigger. Not a live ERP
 * posting engine, not a source-parity sale and never registered in public RPC.
 *
 * The preflight SELECT derives the actor for immutable intent hashing only.
 * SQL rechecks CURRENT authorization in the very INSERT that triggers stock
 * and both synthetic ledger entries. Cash Session must be exactly Open for
 * new posts; historical receipt replay remains available after Close Day.
 * Every committed receipt is verified against its immutable stock movement
 * and exact cash/revenue child rows before COMMITTED or REPLAY is reported.
 * G4 issues an original-style INV sequence inside that same SQL INSERT,
 * never reserving it in an earlier JS read. A stale JavaScript preflight cannot
 * authorize any write. A post-commit unknown outcome always needs review.
 */
import {requireD1Binding} from './d1-binding.js';
import {hashCanonicalOperationIntent} from './operation-intent-fingerprint.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';

const BEARER=/^[0-9a-f]{64}$/;
const BUSINESS=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const OPERATION=/^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const ACTOR=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MONEY=/^(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/;
const HASH=/^[0-9a-f]{64}$/;
const SKU='PIPE-1';
const OP_TYPE='sales.post';
const SOURCE_INVOICE=/^INV-[0-9]{6,}$/;

// The M04 fixture stores one business per isolated D1: sessions do not have
// tenant_id. Never use this adapter with a shared-tenant D1 or public Worker.
// 'Allowed Modules' is display-only. Only literal JSON true grants sales.add.
const AUTH_FROM=`FROM auth_sessions AS s
  JOIN auth_users AS u ON u.user_id=s.user_id
  LEFT JOIN auth_roles AS g ON g.role_name=u.role_name`;
const AUTH_WHERE=`WHERE s.token_hash=?
  AND s.revoked_at_ms IS NULL
  AND s.created_at_ms<=? AND s.expires_at_ms>?
  AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=?
  AND u.status='Active' AND u.credential_state='Modern'
  AND u.auth_version=s.user_auth_version
  AND u.credential_version=s.credential_version
  AND (
    (u.role_name='Administrator' AND s.role_auth_version IS NULL)
    OR (
      u.role_name<>'Administrator' AND g.status='Active'
      AND g.auth_version=s.role_auth_version
      AND length(g.permissions_json)<=65536
      AND CASE WHEN json_valid(g.permissions_json) THEN
        json_type(g.permissions_json)='object'
        AND json_type(g.permissions_json,'$.sales')='object'
        AND json_type(g.permissions_json,'$.sales.add')='true'
      ELSE 0 END
    )
  )`;

const IDENTITY=`SELECT u.user_id AS actor_id ${AUTH_FROM} ${AUTH_WHERE} LIMIT 2`;
const CLAIM=`INSERT INTO operation_receipts(
    tenant_id,operation_id,actor_id,operation_type,payload_hash,
    result_ref,committed_at,sku,units,amount_cents,source_invoice_id)
  SELECT ?,?,u.user_id,'sales.post',?,?,?,?,?,? ,
    counter.prefix||'-'||printf('%06d',counter.current_sequence+1)
  ${AUTH_FROM}
  JOIN synthetic_m03_g4_sale_counters AS counter
    ON counter.business_id=? AND counter.id_key='SALES'
    AND counter.prefix='INV' AND counter.current_sequence<9007199254740991
  ${AUTH_WHERE}
    AND u.user_id=?
    AND EXISTS (
      SELECT 1 FROM synthetic_m03_g1_stock
      WHERE business_id=? AND sku='PIPE-1' AND available>=?
    )
    -- CashSession.gs: requireActiveCashSession_ checks exactly Open.
    -- Recheck with current M04 authority and stock in this INSERT.
    AND EXISTS (
      SELECT 1 FROM synthetic_m03_g1_cash_sessions AS cs
      WHERE cs.business_id=? AND cs.status='Open'
    )
  ON CONFLICT(tenant_id,operation_id) DO NOTHING
  RETURNING operation_id`;
const READ=`SELECT u.user_id AS actor_id,
    receipt.tenant_id AS receipt_tenant_id,
    receipt.operation_id AS receipt_operation_id,
    receipt.actor_id AS receipt_actor_id,
    receipt.operation_type,receipt.payload_hash,receipt.result_ref,
    receipt.sku,receipt.units,receipt.amount_cents,receipt.committed_at,
    receipt.source_invoice_id,
    (SELECT COUNT(*) FROM synthetic_m03_g1_stock_movements m
      WHERE m.business_id=receipt.tenant_id
        AND m.operation_id=receipt.operation_id) AS movement_count,
    (SELECT COUNT(*) FROM synthetic_m03_g1_stock_movements m
      WHERE m.business_id=receipt.tenant_id
        AND m.operation_id=receipt.operation_id
        AND m.sku=receipt.sku AND m.units_out=receipt.units) AS matching_movement_count,
    (SELECT COUNT(*) FROM synthetic_m03_g1_journal j
      WHERE j.business_id=receipt.tenant_id
        AND j.operation_id=receipt.operation_id) AS journal_count,
    (SELECT COUNT(*) FROM synthetic_m03_g1_journal j
      WHERE j.business_id=receipt.tenant_id
        AND j.operation_id=receipt.operation_id
        AND j.account_kind='cash' AND j.signed_cents=receipt.amount_cents)
        AS matching_cash_count,
    (SELECT COUNT(*) FROM synthetic_m03_g1_journal j
      WHERE j.business_id=receipt.tenant_id
        AND j.operation_id=receipt.operation_id
        AND j.account_kind='sales_revenue' AND j.signed_cents=-receipt.amount_cents)
        AS matching_revenue_count
  ${AUTH_FROM}
  LEFT JOIN operation_receipts AS receipt
    ON receipt.tenant_id=? AND receipt.operation_id=?
    AND receipt.actor_id=u.user_id
  ${AUTH_WHERE} AND u.user_id=?
  LIMIT 2`;

function exactInput(request){
  if(!request || typeof request!=='object' || Array.isArray(request) ||
      (Object.getPrototypeOf(request)!==Object.prototype &&
       Object.getPrototypeOf(request)!==null)){
    throw new TypeError('Invalid M03 G1 posting request');
  }
  const expected=['amount','nowMs','operationId','token','units'];
  const keys=Reflect.ownKeys(request);
  if(keys.length!==expected.length ||
     keys.some(key=>typeof key!=='string'||!expected.includes(key)) ||
     keys.some(key=>{
       const descriptor=Object.getOwnPropertyDescriptor(request,key);
       return descriptor?.enumerable!==true ||
         !Object.hasOwn(descriptor,'value');
     })){
    throw new TypeError('Invalid M03 G1 posting fields');
  }
  const {token,nowMs,operationId,units,amount}=request;
  if(typeof token!=='string'||!BEARER.test(token) ||
     !Number.isSafeInteger(nowMs)||nowMs<0 ||
     !Number.isSafeInteger(nowMs+AUTH_POLICY.sessionMaxMs) ||
     typeof operationId!=='string'||!OPERATION.test(operationId) ||
     !Number.isSafeInteger(units)||units<1||units>10_000 ||
     typeof amount!=='string'||!MONEY.test(amount)){
    throw new TypeError('Invalid M03 G1 posting token, clock, operation, units or money');
  }
  const amountCents=Number(amount.replace('.',''));
  if(!Number.isSafeInteger(amountCents)||amountCents<1){
    throw new TypeError('Invalid M03 G1 posting cents');
  }
  return {token,nowMs,operationId,units,amount,amountCents};
}
async function bearerDigest(token){
  if(typeof globalThis.crypto?.subtle?.digest!=='function'){
    throw new Error('NEEDS_REVIEW: Web Crypto is unavailable');
  }
  const bytes=new Uint8Array(32);
  for(let index=0;index<32;index++){
    bytes[index]=Number.parseInt(token.slice(index*2,index*2+2),16);
  }
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,value=>value.toString(16).padStart(2,'0')).join('');
}
function sessionParams(digest,nowMs){
  return [digest,nowMs,nowMs,nowMs-AUTH_POLICY.sessionIdleMs,nowMs];
}
function evidence(part){
  if(part?.success!==true || !Array.isArray(part.results) ||
     part.results.length!==1 || !part.results[0] ||
     typeof part.results[0]!=='object'){
    throw new Error('NEEDS_REVIEW: invalid G1 D1 receipt or authorization response');
  }
  return part.results[0];
}
function validChildEvidence(row){
  // One immutable stock movement, exactly one debit and one matching credit.
  // Do not compare historical receipt quantity with current stock balance:
  // later legitimate sales/purchases change that balance.
  return row.movement_count===1 &&
    row.matching_movement_count===1 &&
    row.journal_count===2 &&
    row.matching_cash_count===1 &&
    row.matching_revenue_count===1;
}

function validReceipt(row,businessId,operationId,actorId){
  return row.receipt_tenant_id===businessId &&
    row.receipt_operation_id===operationId &&
    row.receipt_actor_id===actorId &&
    row.operation_type===OP_TYPE &&
    typeof row.payload_hash==='string' && HASH.test(row.payload_hash) &&
    row.result_ref==='SYNTH-'+operationId &&
    typeof row.source_invoice_id==='string' && SOURCE_INVOICE.test(row.source_invoice_id) &&
    row.sku===SKU &&
    Number.isSafeInteger(row.units) && row.units>=1 && row.units<=10_000 &&
    Number.isSafeInteger(row.amount_cents) && row.amount_cents>=1 &&
    typeof row.committed_at==='string' && !!row.committed_at.trim();
}

/**
 * Trusted server supplies opaque bearer and server clock, no actor or tenant
 * from the request. The backend MUST use a single-business D1 environment;
 * all schema and journal rows here are intentionally test-only.
 */
export function createM04AtomicG1SaleProof(env,{businessId}={}){
  if(typeof businessId!=='string'||!BUSINESS.test(businessId)){
    throw new TypeError('Invalid trusted G1 business context');
  }
  const DB=requireD1Binding(env);
  return Object.freeze({
    async post_(request){
      const x=exactInput(request);
      const digest=await bearerDigest(x.token);
      const session=sessionParams(digest,x.nowMs);
      let actorRow;
      try{
        actorRow=evidence(await DB.prepare(IDENTITY).bind(...session).all());
      }catch(cause){
        // The query may fail for missing/invalid authority. Never default to
        // client-supplied identity or a cached role.
        if(cause?.message?.startsWith('NEEDS_REVIEW:')){
          throw new Error('Denied: current M04 sales permission unavailable');
        }
        throw new Error('NEEDS_REVIEW: G1 D1 actor verification failed',{cause});
      }
      const actorId=actorRow.actor_id;
      if(typeof actorId!=='string'||!ACTOR.test(actorId)){
        throw new Error('Denied: current M04 sales permission unavailable');
      }
      const hash=await hashCanonicalOperationIntent({
        tenantId:businessId,actorId,operationType:OP_TYPE,
        payload:{sku:SKU,units:x.units,amount:x.amount}
      });
      const resultRef='SYNTH-'+x.operationId;
      let claim;
      try{
        claim=await DB.prepare(CLAIM).bind(
          businessId,x.operationId,hash,resultRef,
          new Date(x.nowMs).toISOString(),SKU,x.units,x.amountCents,
          businessId,...session,actorId,businessId,x.units,businessId
        ).first();
      }catch(cause){
        // A failing late journal trigger rolls back the INSERT in SQLite.
        // Network failure may instead follow a successful commit; never
        // auto-issue a new operation ID or assume a safe retry.
        throw new Error('NEEDS_REVIEW: G1 D1 claim outcome uncertain',{cause});
      }
      if(claim!==null && (claim?.operation_id!==x.operationId ||
          Reflect.ownKeys(claim).length!==1)){
        throw new Error('NEEDS_REVIEW: invalid G1 claim result');
      }
      let found;
      try{
        found=await DB.prepare(READ).bind(
          businessId,x.operationId,...session,actorId
        ).all();
      }catch(cause){
        throw new Error('NEEDS_REVIEW: G1 receipt readback failed',{cause});
      }
      if(found?.success!==true || !Array.isArray(found.results) ||
         found.results.length>1){
        throw new Error('NEEDS_REVIEW: ambiguous G1 receipt readback');
      }
      if(found.results.length===0){
        if(claim!==null)throw new Error('NEEDS_REVIEW: committed G1 receipt is unavailable');
        return {status:'DECLINED',operationId:x.operationId};
      }
      const row=found.results[0];
      if(!row || row.actor_id!==actorId){
        throw new Error('NEEDS_REVIEW: wrong G1 receipt actor');
      }
      if(row.receipt_operation_id===null){
        if(claim!==null)throw new Error('NEEDS_REVIEW: missing committed G1 receipt');
        return {status:'DECLINED',operationId:x.operationId};
      }
      if(!validReceipt(row,businessId,x.operationId,actorId)){
        throw new Error('NEEDS_REVIEW: invalid immutable G1 receipt');
      }
      if(!validChildEvidence(row)){
        throw new Error('NEEDS_REVIEW: G3 original stock movement or ledger integrity mismatch');
      }
      if(row.payload_hash!==hash || row.units!==x.units ||
         row.amount_cents!==x.amountCents){
        if(claim!==null)throw new Error('NEEDS_REVIEW: committed G1 intent mismatch');
        return {status:'CONFLICT',operationId:x.operationId};
      }
      return {status:claim===null?'REPLAY':'COMMITTED',
        operationId:x.operationId,resultRef:row.result_ref};
    }
  });
}
