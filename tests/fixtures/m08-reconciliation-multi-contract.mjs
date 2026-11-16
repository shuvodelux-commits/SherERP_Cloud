/**
 * TEST-ONLY M08 multi-entry closing Cash Reconciliation transaction proof.
 * No public route, production migration, live D1 binding or real Cash writer.
 *
 * This fixture uses a simplified one-session cash movement model and proves
 * the isolated SQL atomicity, auth and replay invariants only.
 */
import {hashCanonicalOperationIntent}
  from '../../src/db/operation-intent-fingerprint.js';
import {evaluateCashExplanation}
  from '../../src/modules/m08-cash-reconciliation-explanation.js';

const TOKEN=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const OP=/^[A-Za-z0-9_-]{1,64}$/;
const HASH=/^[0-9a-f]{64}$/;
const FIELD_NAMES='actorId,entryIds,legacyEntryId,now,operationId,revision,sessionId,tenantId,tokenHash';

const CLAIM=`WITH args(
  tenant_id,operation_id,actor_id,session_id,legacy_entry_id,
  revision,entry_ids_json,intent_hash,at_time,token_hash
) AS (VALUES(?,?,?,?,?,?,?,?,?,?))
INSERT INTO m08_multi_receipts(
  tenant_id,operation_id,actor_id,session_id,legacy_entry_id,
  revision,entry_ids_json,intent_hash,committed_at)
SELECT
  i.tenant_id,i.operation_id,i.actor_id,i.session_id,i.legacy_entry_id,
  i.revision,i.entry_ids_json,i.intent_hash,'2026-11-16T00:00:00Z'
FROM args i
WHERE EXISTS (
  SELECT 1 FROM m08_test_sessions auth
  JOIN m08_test_users staff ON
    staff.tenant_id=auth.tenant_id AND staff.user_id=auth.user_id
  JOIN m08_test_roles role ON
    role.tenant_id=auth.tenant_id AND role.role_id=auth.role_id
  WHERE auth.tenant_id=i.tenant_id AND auth.user_id=i.actor_id
    AND auth.token_hash=i.token_hash AND auth.revoked_at IS NULL
    AND auth.expires_at>i.at_time
    AND staff.status='Active' AND role.status='Active'
    AND staff.role_id=auth.role_id AND role.can_edit=1
    AND staff.auth_version=auth.user_version
    AND role.auth_version=auth.role_version
)
AND EXISTS (
  SELECT 1 FROM m08_test_cash_sessions sess
  WHERE sess.tenant_id=i.tenant_id AND sess.session_id=i.session_id
    AND sess.revision=i.revision AND sess.status IN ('Closed','Closing')
    AND sess.closing_entry_id IS NULL
    AND sess.counted_cents IS NOT NULL
    AND sess.counted_cents>sess.expected_cents
    AND json_valid(i.entry_ids_json)
    AND json_type(i.entry_ids_json)='array'
    AND json_array_length(i.entry_ids_json) BETWEEN 2 AND 16
    AND (SELECT COUNT(DISTINCT selected.value)
      FROM json_each(i.entry_ids_json) selected)
        =json_array_length(i.entry_ids_json)
    AND NOT EXISTS (
      SELECT 1 FROM json_each(i.entry_ids_json) selected
      LEFT JOIN m08_test_cash_entries real
        ON real.tenant_id=i.tenant_id AND real.entry_id=selected.value
      WHERE selected.type<>'text' OR real.entry_id IS NULL
        OR real.is_deleted<>0
        OR real.type IN ('Session Open','Day Close Adjustment')
        OR real.credit_cents-real.debit_cents<=0
        OR EXISTS (
          SELECT 1 FROM m08_multi_prior_usage used
          WHERE used.tenant_id=i.tenant_id AND used.entry_id=selected.value
        )
        OR EXISTS (
          SELECT 1 FROM m08_multi_links allocated
          WHERE allocated.tenant_id=i.tenant_id
            AND allocated.entry_id=selected.value
        )
    )
    AND (
      SELECT COALESCE(SUM(real.credit_cents-real.debit_cents),0)
      FROM json_each(i.entry_ids_json) selected
      JOIN m08_test_cash_entries real
        ON real.tenant_id=i.tenant_id AND real.entry_id=selected.value
    )=sess.counted_cents-sess.expected_cents
    AND EXISTS (
      SELECT 1 FROM m08_test_cash_entries legacy
      WHERE legacy.tenant_id=i.tenant_id
        AND legacy.entry_id=i.legacy_entry_id
        AND legacy.type='Day Close Adjustment'
        AND legacy.reference=i.session_id
        AND legacy.is_deleted=0
        AND legacy.credit_cents<>legacy.debit_cents
    )
    AND NOT EXISTS (
      SELECT 1 FROM m08_multi_links previous
      WHERE previous.tenant_id=i.tenant_id
        AND previous.session_id=i.session_id
        AND previous.phase='closing'
    )
)
ON CONFLICT(tenant_id,operation_id) DO NOTHING
RETURNING operation_id`;

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

const READ=`SELECT receipt.tenant_id,receipt.operation_id,receipt.actor_id,
  receipt.session_id,receipt.legacy_entry_id,receipt.revision,
  receipt.entry_ids_json,receipt.intent_hash
FROM m08_multi_receipts receipt
WHERE receipt.tenant_id=? AND receipt.operation_id=? AND receipt.actor_id=?
  AND EXISTS (${AUTH})
LIMIT 2`;

function validate(raw){
  if(raw===null || typeof raw!=='object' || Array.isArray(raw) ||
     (Object.getPrototypeOf(raw)!==Object.prototype &&
       Object.getPrototypeOf(raw)!==null))
    throw new TypeError('Invalid synthetic M08 multi-entry shape');
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==9 || keys.some(x=>typeof x!=='string')||
    keys.slice().sort().join(',')!==FIELD_NAMES ||
    keys.some(key=>{
      const d=Object.getOwnPropertyDescriptor(raw,key);
      return !d || !d.enumerable || !Object.hasOwn(d,'value');
    }))
    throw new TypeError('Invalid synthetic M08 multi-entry fields');
  const v={};
  for(const key of keys)v[key]=Object.getOwnPropertyDescriptor(raw,key).value;
  if(typeof v.tenantId!=='string'||!ID.test(v.tenantId)||
     typeof v.actorId!=='string'||!ID.test(v.actorId)||
     typeof v.sessionId!=='string'||!ID.test(v.sessionId)||
     typeof v.legacyEntryId!=='string'||!ID.test(v.legacyEntryId)||
     typeof v.operationId!=='string'||!OP.test(v.operationId)||
     typeof v.tokenHash!=='string'||!TOKEN.test(v.tokenHash)||
     !Number.isSafeInteger(v.revision)||v.revision<1||
     !Number.isSafeInteger(v.now)||v.now<0)
    throw new TypeError('Invalid synthetic M08 multi-entry actor or session');
  const rawIds=v.entryIds;
  if(!(typeof rawIds==='string' || Array.isArray(rawIds)) ||
      (typeof rawIds==='string' && rawIds.length>2048) ||
      (Array.isArray(rawIds) && (rawIds.length>32 ||
        rawIds.some(x=>typeof x!=='string'))))
    throw new TypeError('Invalid multi-entry Cash ID selection');
  const ids=evaluateCashExplanation('',rawIds,[]).entryIds;
  if(ids.length<2 || ids.length>16 || ids.some(x=>!ID.test(x)))
    throw new TypeError('Invalid or insufficient unique multi-entry Cash IDs');
  return {...v,entryIds:ids.slice().sort()};
}

function readRows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: invalid M08 multi-entry D1 result');
  return part.results;
}
function identity(old,v){
  return old && old.tenant_id===v.tenantId &&
    old.operation_id===v.operationId && old.actor_id===v.actorId &&
    old.session_id===v.sessionId && old.legacy_entry_id===v.legacyEntryId &&
    old.revision===v.revision &&
    old.entry_ids_json===JSON.stringify(v.entryIds) &&
    typeof old.intent_hash==='string' && HASH.test(old.intent_hash);
}

/**
 * This function is a test fixture, not an authenticated request API.
 * All actors and tenant IDs originate in the isolated test harness.
 */
export function createSyntheticD1MultiCashReconciliationContract(DB){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 synthetic multi-entry binding unavailable');
  return Object.freeze({
    async post(raw){
      const v=validate(raw);
      const idsJson=JSON.stringify(v.entryIds);
      const hash=await hashCanonicalOperationIntent({
        tenantId:v.tenantId,actorId:v.actorId,
        operationType:'cash.reconciliation.multi-close',
        payload:{
          sessionId:v.sessionId,legacyEntryId:v.legacyEntryId,
          revision:v.revision,entryIds:v.entryIds
        }
      });
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(
            v.tenantId,v.operationId,v.actorId,v.sessionId,
            v.legacyEntryId,v.revision,idsJson,hash,v.now,v.tokenHash
          ),
          DB.prepare(READ).bind(
            v.tenantId,v.operationId,v.actorId,v.tokenHash,
            v.tenantId,v.actorId,v.now
          )
        ]);
      }catch(error){
        throw new Error('NEEDS_REVIEW: uncertain M08 multi-entry D1 posting outcome',
          {cause:error});
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: incomplete M08 multi-entry D1 batch');
      const [inserted,found]=batch.map(readRows);
      if(inserted.length>1 || found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous M08 multi-entry receipt');
      const saved=found[0];
      if(inserted.length===1){
        if(inserted[0]?.operation_id!==v.operationId ||
           found.length!==1 || !identity(saved,v) ||
           saved.intent_hash!==hash)
          throw new Error('NEEDS_REVIEW: M08 multi-entry receipt readback mismatch');
        return {
          status:'COMMITTED',operationId:v.operationId,
          sessionId:v.sessionId,entryIds:v.entryIds
        };
      }
      if(inserted.length!==0)
        throw new Error('NEEDS_REVIEW: invalid M08 multi-entry claim');
      if(!saved)return {status:'DECLINED',operationId:v.operationId};
      if(saved.operation_id!==v.operationId||saved.tenant_id!==v.tenantId||
        saved.actor_id!==v.actorId ||
        typeof saved.intent_hash!=='string'||!HASH.test(saved.intent_hash))
        throw new Error('NEEDS_REVIEW: invalid M08 multi-entry receipt identity');
      if(identity(saved,v) && saved.intent_hash===hash)
        return {
          status:'REPLAY',operationId:v.operationId,
          sessionId:v.sessionId,entryIds:v.entryIds
        };
      return {status:'CONFLICT',operationId:v.operationId};
    }
  });
}
