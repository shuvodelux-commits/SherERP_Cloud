/**
 * TEST-ONLY session-authorized synthetic D1 posting contract.
 *
 * Fixed one-SKU receipt + decrement + movement acceptance proof. Never import
 * into public Workers; this does not implement ERP sales, money or ledgers.
 */
import {hashCanonicalOperationIntent}
  from '../../src/db/operation-intent-fingerprint.js';

const TOKEN=/^[0-9a-f]{64}$/;
const ID=/^[A-Z0-9_-]{1,64}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const HASH=/^[0-9a-f]{64}$/;
const DECIMAL=/^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/;
const OP_TYPE='sales.post';
const COMMITTED_AT='2026-11-15T06:00:00Z';

const AUTH=`SELECT 1 FROM synthetic_post_sessions AS s
  JOIN synthetic_post_users AS u
    ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
  JOIN synthetic_post_roles AS r
    ON r.tenant_id=s.tenant_id AND r.role_id=s.role_id
  WHERE s.token_hash=? AND s.tenant_id=? AND s.user_id=?
    AND s.revoked_at IS NULL AND s.expires_at>?
    AND u.status='Active' AND r.status='Active' AND r.can_post=1
    AND u.role_id=s.role_id
    AND u.auth_version=s.user_version AND r.auth_version=s.role_version`;

const CLAIM=`INSERT INTO synthetic_auth_post_receipts(
    tenant_id,operation_id,actor_id,operation_type,
    payload_hash,units,amount,result_ref,committed_at)
  SELECT ?,?,?,'sales.post',?,?,?,?,?
  WHERE EXISTS (${AUTH})
    AND EXISTS(
      SELECT 1 FROM synthetic_post_stock
      WHERE tenant_id=? AND sku='PIPE-1' AND available>=?
    )
  ON CONFLICT DO NOTHING
  RETURNING operation_id`;

const READ=`SELECT receipt.tenant_id,receipt.operation_id,receipt.actor_id,
    receipt.operation_type,receipt.payload_hash,receipt.units,
    receipt.amount,receipt.result_ref,receipt.committed_at
  FROM synthetic_auth_post_receipts AS receipt
  WHERE receipt.tenant_id=? AND receipt.operation_id=? AND receipt.actor_id=?
    AND EXISTS (${AUTH})
  LIMIT 2`;

function validate(input){
  if(input===null || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null)){
    throw new TypeError('Invalid synthetic posting request');
  }
  const keys=Reflect.ownKeys(input);
  const expected=['actorId','amount','now','operationId','tenantId','tokenHash','units'];
  if(keys.length!==expected.length ||
    keys.some(k=>typeof k!=='string'||!expected.includes(k)) ||
    keys.some(k=>{
      const d=Object.getOwnPropertyDescriptor(input,k);
      return !d || !d.enumerable || !Object.hasOwn(d,'value');
    })){
    throw new TypeError('Invalid synthetic posting request fields');
  }
  const {tokenHash,tenantId,actorId,operationId,units,amount,now}=input;
  if(typeof tokenHash!=='string'||!TOKEN.test(tokenHash) ||
    typeof tenantId!=='string'||!KEY.test(tenantId) ||
    typeof actorId!=='string'||!KEY.test(actorId) ||
    typeof operationId!=='string'||!ID.test(operationId) ||
    !Number.isSafeInteger(units)||units<1||units>10000 ||
    typeof amount!=='string'||!DECIMAL.test(amount) ||
    !Number.isSafeInteger(now)||now<0){
    throw new TypeError('Invalid synthetic posting token, scope, operation or amount');
  }
  return {tokenHash,tenantId,actorId,operationId,units,amount,now};
}
function rows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: malformed synthetic D1 posting result');
  return part.results;
}
function correct(row,x){
  return !!row && typeof row==='object' &&
    row.tenant_id===x.tenantId && row.operation_id===x.operationId &&
    row.actor_id===x.actorId && row.operation_type===OP_TYPE &&
    typeof row.payload_hash==='string' && HASH.test(row.payload_hash) &&
    Number.isSafeInteger(row.units) && row.units>0 && row.units<=10000 &&
    typeof row.amount==='string' && DECIMAL.test(row.amount) &&
    typeof row.result_ref==='string' && row.result_ref===x.operationId &&
    typeof row.committed_at==='string' && !!row.committed_at;
}

export function createSyntheticAuthorizedPostingContract(DB){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 synthetic posting batch binding unavailable');
  return Object.freeze({
    async post(input){
      const x=validate(input);
      // D1 rechecks this trusted actor against the current session in the
      // INSERT statement. Hashing in JS is NOT a permission preflight.
      const hash=await hashCanonicalOperationIntent({
        tenantId:x.tenantId,actorId:x.actorId,operationType:OP_TYPE,
        payload:{sku:'PIPE-1',units:x.units,amount:x.amount}
      });
      const authority=[x.tokenHash,x.tenantId,x.actorId,x.now];
      const result=await DB.batch([
        DB.prepare(CLAIM).bind(
          x.tenantId,x.operationId,x.actorId,hash,x.units,x.amount,
          x.operationId,COMMITTED_AT,
          ...authority,x.tenantId,x.units
        ),
        DB.prepare(READ).bind(x.tenantId,x.operationId,x.actorId,...authority)
      ]);
      if(!Array.isArray(result)||result.length!==2)
        throw new Error('NEEDS_REVIEW: ambiguous synthetic D1 posting batch');
      const [claimed,found]=result.map(rows);
      if(claimed.length>1 || found.length>1 ||
        found.some(row=>!correct(row,x))){
        throw new Error('NEEDS_REVIEW: invalid or ambiguous synthetic posting evidence');
      }
      if(claimed.length===1){
        if(claimed[0]?.operation_id!==x.operationId ||
          found.length!==1 || found[0].payload_hash!==hash ||
          found[0].units!==x.units || found[0].amount!==x.amount){
          throw new Error('NEEDS_REVIEW: uncertain synthetic committed receipt');
        }
        return {status:'COMMITTED',operationId:x.operationId,resultRef:x.operationId};
      }
      if(found.length===0){
        // Either no stock or no live authority, or somebody else's receipt.
        // No receipt existence or authorization status is disclosed.
        return {status:'DECLINED',operationId:x.operationId};
      }
      if(found[0].payload_hash===hash &&
        found[0].units===x.units && found[0].amount===x.amount){
        return {status:'REPLAY',operationId:x.operationId,resultRef:found[0].result_ref};
      }
      return {status:'CONFLICT',operationId:x.operationId};
    }
  });
}
