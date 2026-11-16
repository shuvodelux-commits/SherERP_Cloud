/**
 * TEST-ONLY M08 single-entry closing Cash Reconciliation contract.
 *
 * The synthetic insert/trigger covers one existing real Cash Book entry and
 * one Day Close Adjustment. NOT the real multi-entry source writer, a
 * production authenticated session, or the actual imported D1 cash schema.
 * This module must never be registered in public Workers or ERP RPC.
 */
import {hashCanonicalOperationIntent}
  from '../../src/db/operation-intent-fingerprint.js';

const TOKEN=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const OP=/^[A-Z0-9_-]{1,64}$/;
const HASH=/^[0-9a-f]{64}$/;
const EXPECTED_FIELDS='actorId,legacyEntryId,now,operationId,realEntryId,revision,sessionId,tenantId,tokenHash';

const AUTH=`SELECT 1 FROM m08_test_sessions auth
  JOIN m08_test_users staff
    ON staff.tenant_id=auth.tenant_id AND staff.user_id=auth.user_id
  JOIN m08_test_roles role
    ON role.tenant_id=auth.tenant_id AND role.role_id=auth.role_id
  WHERE auth.token_hash=? AND auth.tenant_id=? AND auth.user_id=?
    AND auth.revoked_at IS NULL AND auth.expires_at>?
    AND staff.status='Active' AND role.status='Active'
    AND role.can_edit=1 AND staff.role_id=auth.role_id
    AND staff.auth_version=auth.user_version
    AND role.auth_version=auth.role_version`;

const CLAIM=`INSERT INTO m08_test_receipts(
    tenant_id,operation_id,actor_id,session_id,real_entry_id,
    legacy_entry_id,revision,intent_hash,committed_at)
  SELECT ?,?,?,?,?,?,?,?,'2026-11-16T00:00:00Z'
  WHERE EXISTS (${AUTH})
    AND EXISTS (
      SELECT 1 FROM m08_test_cash_sessions cashSession
      JOIN m08_test_cash_entries real
        ON real.tenant_id=cashSession.tenant_id AND real.entry_id=?
      JOIN m08_test_cash_entries legacy
        ON legacy.tenant_id=cashSession.tenant_id AND legacy.entry_id=?
      WHERE cashSession.tenant_id=? AND cashSession.session_id=?
        AND cashSession.revision=?
        AND cashSession.status IN ('Closed','Closing')
        AND cashSession.closing_entry_id IS NULL
        AND cashSession.counted_cents IS NOT NULL
        AND cashSession.counted_cents<>cashSession.expected_cents
        AND real.is_deleted=0
        AND real.type NOT IN ('Session Open','Day Close Adjustment')
        AND real.credit_cents-real.debit_cents=
          cashSession.counted_cents-cashSession.expected_cents
        AND legacy.is_deleted=0
        AND legacy.type='Day Close Adjustment'
        AND legacy.reference=cashSession.session_id
        AND legacy.credit_cents<>legacy.debit_cents
        AND NOT EXISTS(
          SELECT 1 FROM m08_test_links existing
          WHERE existing.tenant_id=? AND existing.entry_id=real.entry_id
        )
        AND NOT EXISTS(
          SELECT 1 FROM m08_test_links existing
          WHERE existing.tenant_id=? AND existing.session_id=?
            AND existing.phase='closing'
        )
    )
  ON CONFLICT(tenant_id,operation_id) DO NOTHING
  RETURNING operation_id`;

const READ=`SELECT receipt.tenant_id,receipt.operation_id,receipt.actor_id,
    receipt.session_id,receipt.real_entry_id,receipt.legacy_entry_id,
    receipt.revision,receipt.intent_hash
  FROM m08_test_receipts receipt
  WHERE receipt.tenant_id=? AND receipt.operation_id=?
    AND receipt.actor_id=?
    AND EXISTS (${AUTH})
  LIMIT 2`;

function validated(input){
  if(input===null || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid synthetic M08 reconciliation input');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==9 || keys.some(key=>typeof key!=='string') ||
     keys.slice().sort().join(',')!==EXPECTED_FIELDS ||
     keys.some(key=>{
       const d=Object.getOwnPropertyDescriptor(input,key);
       return !d?.enumerable || !Object.hasOwn(d,'value');
     }))
    throw new TypeError('Invalid synthetic M08 reconciliation fields');
  const v={};
  for(const key of keys)v[key]=Object.getOwnPropertyDescriptor(input,key).value;
  if(typeof v.tokenHash!=='string'||!TOKEN.test(v.tokenHash) ||
    typeof v.tenantId!=='string'||!ID.test(v.tenantId)||
    typeof v.actorId!=='string'||!ID.test(v.actorId)||
    typeof v.operationId!=='string'||!OP.test(v.operationId)||
    typeof v.sessionId!=='string'||!ID.test(v.sessionId)||
    typeof v.realEntryId!=='string'||!ID.test(v.realEntryId)||
    typeof v.legacyEntryId!=='string'||!ID.test(v.legacyEntryId)||
    !Number.isSafeInteger(v.revision)||v.revision<1||
    !Number.isSafeInteger(v.now)||v.now<0)
    throw new TypeError('Invalid synthetic M08 actor, operation or revision');
  return v;
}

function rows(result){
  if(result?.success!==true || !Array.isArray(result.results))
    throw new Error('NEEDS_REVIEW: invalid M08 D1 reconciliation readback');
  return result.results;
}
function matches(row,v){
  return row && row.tenant_id===v.tenantId &&
    row.operation_id===v.operationId && row.actor_id===v.actorId &&
    row.session_id===v.sessionId && row.real_entry_id===v.realEntryId &&
    row.legacy_entry_id===v.legacyEntryId && row.revision===v.revision &&
    typeof row.intent_hash==='string' && HASH.test(row.intent_hash);
}

export function createSyntheticD1CashReconciliationContract(DB){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 synthetic reconciliation binding unavailable');

  return Object.freeze({
    async post(input){
      const v=validated(input);
      const intentHash=await hashCanonicalOperationIntent({
        tenantId:v.tenantId,actorId:v.actorId,
        operationType:'cash.reconciliation.close',
        payload:{
          sessionId:v.sessionId,realEntryId:v.realEntryId,
          legacyEntryId:v.legacyEntryId,revision:v.revision
        }
      });
      const auth=[v.tokenHash,v.tenantId,v.actorId,v.now];
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(
            v.tenantId,v.operationId,v.actorId,v.sessionId,
            v.realEntryId,v.legacyEntryId,v.revision,intentHash,
            ...auth,
            v.realEntryId,v.legacyEntryId,
            v.tenantId,v.sessionId,v.revision,
            v.tenantId,v.tenantId,v.sessionId
          ),
          DB.prepare(READ).bind(
            v.tenantId,v.operationId,v.actorId,...auth
          )
        ]);
      }catch(error){
        throw new Error('NEEDS_REVIEW: M08 D1 write outcome uncertain; reconcile operation ID',
          {cause:error});
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: incomplete M08 D1 reconciliation batch');
      const [claims,receipts]=batch.map(rows);
      if(claims.length>1 || receipts.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous M08 receipt');
      const old=receipts[0];
      if(claims.length===1){
        if(claims[0]?.operation_id!==v.operationId||
           receipts.length!==1||!matches(old,v)||
           old.intent_hash!==intentHash)
          throw new Error('NEEDS_REVIEW: missing committed M08 receipt');
        return {status:'COMMITTED',operationId:v.operationId,sessionId:v.sessionId};
      }
      if(claims.length!==0)
        throw new Error('NEEDS_REVIEW: invalid M08 claim response');
      if(!old)return {status:'DECLINED',operationId:v.operationId};
      if(old.tenant_id!==v.tenantId||old.operation_id!==v.operationId||
         old.actor_id!==v.actorId||!HASH.test(old.intent_hash))
        throw new Error('NEEDS_REVIEW: invalid M08 receipt identity');
      if(matches(old,v) && old.intent_hash===intentHash)
        return {status:'REPLAY',operationId:v.operationId,sessionId:v.sessionId};
      return {status:'CONFLICT',operationId:v.operationId};
    }
  });
}
