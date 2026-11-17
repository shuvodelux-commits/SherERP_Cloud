/**
 * M08 disposable local Workerd/D1 SQL-atomic synthetic marker retirement.
 * Not an authenticated Worker entry, source-data migration, or cash writer.
 * Inputs are synthetic test harness identities; SQL repeats all guards.
 */
import {hashCanonicalOperationIntent}
  from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const OP=/^[A-Za-z0-9_-]{1,64}$/;
const TOKEN=/^[0-9a-f]{64}$/;
const HASH=/^[0-9a-f]{64}$/;
const KEYS='actorId,now,operationId,phase,revision,sessionId,tenantId,tokenHash';

const CLAIM=[
  'WITH args(tenant_id,operation_id,session_id,phase,actor_id,revision,',
  ' intent_hash,at_time,token_hash) AS (VALUES(?,?,?,?,?,?,?,?,?))',
  'INSERT INTO m08_marker_receipts(tenant_id,operation_id,session_id,phase,',
  ' actor_id,revision,intent_hash,committed_at)',
  'SELECT i.tenant_id,i.operation_id,i.session_id,i.phase,',
  ' i.actor_id,i.revision,i.intent_hash,i.at_time FROM args i',
  'WHERE EXISTS (',
  ' SELECT 1 FROM m08_marker_tokens token',
  ' JOIN m08_marker_users staff ON',
  '   staff.tenant_id=token.tenant_id AND staff.user_id=token.user_id',
  ' JOIN m08_marker_roles role ON',
  '   role.tenant_id=token.tenant_id AND role.role_id=token.role_id',
  ' WHERE token.token_hash=i.token_hash AND token.tenant_id=i.tenant_id',
  '   AND token.user_id=i.actor_id AND token.revoked_at IS NULL',
  '   AND token.expires_at>i.at_time AND staff.status=\'Active\'',
  '   AND role.status=\'Active\' AND role.can_edit=1',
  '   AND staff.role_id=token.role_id',
  '   AND staff.auth_version=token.user_version',
  '   AND role.auth_version=token.role_version',
  ')',
  'AND EXISTS (',
  ' SELECT 1 FROM m08_marker_cash_sessions session',
  ' WHERE session.tenant_id=i.tenant_id AND session.session_id=i.session_id',
  ' AND session.revision=i.revision',
  ' AND session.status IN (\'Open\',\'Closing\',\'Closed\')',
  ')',
  'AND EXISTS (',
  ' SELECT 1 FROM m08_marker_cash cash',
  ' WHERE cash.tenant_id=i.tenant_id AND cash.reference=i.session_id',
  ' AND cash.is_deleted=0 AND cash.credit_cents<>cash.debit_cents',
  ' AND cash.type=CASE WHEN i.phase=\'opening\'',
  '   THEN \'Session Open\' ELSE \'Day Close Adjustment\' END',
  ')',
  'AND NOT EXISTS (',
  ' SELECT 1 FROM m08_marker_receipts prior',
  ' WHERE prior.tenant_id=i.tenant_id AND prior.session_id=i.session_id',
  ' AND prior.phase=i.phase',
  ')',
  'ON CONFLICT DO NOTHING RETURNING operation_id'
].join('\n');

const READ=[
  'SELECT receipt.tenant_id,receipt.operation_id,receipt.session_id,',
  ' receipt.phase,receipt.actor_id,receipt.revision,receipt.intent_hash',
  'FROM m08_marker_receipts receipt',
  'WHERE receipt.tenant_id=? AND receipt.operation_id=?',
  '  AND receipt.actor_id=?',
  'AND EXISTS (',
  ' SELECT 1 FROM m08_marker_tokens token',
  ' JOIN m08_marker_users staff ON',
  '   staff.tenant_id=token.tenant_id AND staff.user_id=token.user_id',
  ' JOIN m08_marker_roles role ON',
  '   role.tenant_id=token.tenant_id AND role.role_id=token.role_id',
  ' WHERE token.token_hash=? AND token.tenant_id=? AND token.user_id=?',
  ' AND token.revoked_at IS NULL AND token.expires_at>?',
  ' AND staff.status=\'Active\' AND role.status=\'Active\'',
  ' AND role.can_edit=1 AND staff.role_id=token.role_id',
  ' AND staff.auth_version=token.user_version',
  ' AND role.auth_version=token.role_version',
  ') LIMIT 2'
].join('\n');

function validate(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid synthetic M08 marker request');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==8 || keys.some(x=>typeof x!=='string') ||
    keys.slice().sort().join(',')!==KEYS ||
    keys.some(key=>{
      const prop=Object.getOwnPropertyDescriptor(value,key);
      return !prop || !prop.enumerable || !Object.hasOwn(prop,'value');
    }))
    throw new TypeError('Invalid synthetic M08 marker input shape');
  const v={};
  for(const key of keys)v[key]=Object.getOwnPropertyDescriptor(value,key).value;
  if(typeof v.tenantId!=='string'||!ID.test(v.tenantId)||
     typeof v.actorId!=='string'||!ID.test(v.actorId)||
     typeof v.sessionId!=='string'||!ID.test(v.sessionId)||
     typeof v.operationId!=='string'||!OP.test(v.operationId)||
     typeof v.phase!=='string'||
       (v.phase!=='opening' && v.phase!=='closing')||
     typeof v.tokenHash!=='string'||!TOKEN.test(v.tokenHash)||
     !Number.isSafeInteger(v.revision)||v.revision<1||
     !Number.isSafeInteger(v.now)||v.now<0)
    throw new TypeError('Invalid M08 marker phase, identity or revision');
  return v;
}

function rows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: M08 synthetic marker D1 readback unavailable');
  return part.results;
}

function sameIntent(saved,v,hash){
  return saved?.tenant_id===v.tenantId &&
    saved.operation_id===v.operationId &&
    saved.actor_id===v.actorId &&
    saved.session_id===v.sessionId &&
    saved.phase===v.phase &&
    saved.revision===v.revision &&
    saved.intent_hash===hash;
}

export function createSyntheticM08MarkerRetirement(DB){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 synthetic M08 marker binding unavailable');
  return Object.freeze({
    async post(raw){
      const v=validate(raw);
      const hash=await hashCanonicalOperationIntent({
        tenantId:v.tenantId,actorId:v.actorId,
        operationType:'cash.synthetic.marker-retire',
        payload:{
          sessionId:v.sessionId,phase:v.phase,revision:v.revision
        }
      });
      let result;
      try{
        result=await DB.batch([
          DB.prepare(CLAIM).bind(v.tenantId,v.operationId,
            v.sessionId,v.phase,v.actorId,v.revision,hash,v.now,v.tokenHash),
          DB.prepare(READ).bind(v.tenantId,v.operationId,v.actorId,
            v.tokenHash,v.tenantId,v.actorId,v.now)
        ]);
      }catch(cause){
        throw new Error('NEEDS_REVIEW: uncertain synthetic M08 marker D1 outcome',
          {cause});
      }
      if(!Array.isArray(result)||result.length!==2)
        throw new Error('NEEDS_REVIEW: incomplete synthetic M08 marker batch');
      const [created,readback]=result.map(rows);
      if(created.length>1 || readback.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous synthetic M08 marker claim');
      if(created.length===1){
        if(created[0]?.operation_id!==v.operationId ||
          readback.length!==1 || !sameIntent(readback[0],v,hash))
          throw new Error('NEEDS_REVIEW: inconsistent synthetic M08 marker receipt');
        return {status:'COMMITTED',operationId:v.operationId,
          sessionId:v.sessionId,phase:v.phase};
      }
      if(created.length!==0)
        throw new Error('NEEDS_REVIEW: invalid synthetic M08 marker claim');
      if(readback.length===0)
        return {status:'DECLINED',operationId:v.operationId};
      const saved=readback[0];
      if(saved.tenant_id!==v.tenantId || saved.actor_id!==v.actorId ||
         saved.operation_id!==v.operationId ||
         typeof saved.intent_hash!=='string' || !HASH.test(saved.intent_hash))
        throw new Error('NEEDS_REVIEW: corrupted synthetic M08 marker receipt');
      if(sameIntent(saved,v,hash))
        return {status:'REPLAY',operationId:v.operationId,
          sessionId:v.sessionId,phase:v.phase};
      return {status:'CONFLICT',operationId:v.operationId};
    }
  });
}
