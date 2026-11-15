/**
 * TEST-ONLY M03 D1 reversal contract. Not production sales/returns/finance.
 * These synthetic tables and triggers are deliberately absent from migrations.
 *
 * The only permitted posting target is a committed, exact-match owned-stock
 * source movement with no active return. The unique original-operation key
 * makes a second reversal ID conflict; a trigger restores stock and inserts
 * inverse evidence inside one atomic SQLite INSERT statement.
 */
import {hashCanonicalOperationIntent}
  from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Z0-9_-]{1,64}$/;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX=/^[0-9a-f]{64}$/;

const CLAIM=`INSERT INTO synthetic_reversals(
    tenant_id,reversal_id,original_operation_id,actor_id,
    original_hash,reversal_hash,units,reason,sku,result_ref)
  SELECT o.tenant_id,?,o.operation_id,?,o.payload_hash,?,
         o.units,?,o.sku,?
  FROM synthetic_original_ops o
  JOIN synthetic_owned_movements m
    ON m.tenant_id=o.tenant_id AND m.operation_id=o.operation_id
  WHERE o.tenant_id=? AND o.operation_id=? AND o.payload_hash=?
    AND o.units=? AND o.state='COMMITTED' AND o.has_return=0
    AND m.source_type='OWNED' AND m.sku=o.sku AND m.units=o.units
  ON CONFLICT DO NOTHING
  RETURNING reversal_id`;

const LOOKUP=`SELECT tenant_id,reversal_id,original_operation_id,actor_id,
                     original_hash,reversal_hash,units,reason,sku,result_ref
  FROM synthetic_reversals
  WHERE tenant_id=? AND (reversal_id=? OR original_operation_id=?)
  LIMIT 3`;

function validate(input){
  if(input===null || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null) ||
    Reflect.ownKeys(input).length!==7 ||
    Reflect.ownKeys(input).some(key=>typeof key!=='string') ||
    Object.keys(input).sort().join(',')!==
      'actorId,originalHash,originalOperationId,reason,reversalId,tenantId,units'){
    throw new TypeError('Invalid synthetic reversal input');
  }
  const get=(key)=>{
    const prop=Object.getOwnPropertyDescriptor(input,key);
    if(!prop?.enumerable || !Object.hasOwn(prop,'value')){
      throw new TypeError('Invalid synthetic reversal accessor');
    }
    return prop.value;
  };
  const tenantId=get('tenantId'), actorId=get('actorId'),
    reversalId=get('reversalId'), originalOperationId=get('originalOperationId'),
    originalHash=get('originalHash'), units=get('units'), reason=get('reason');
  if(typeof tenantId!=='string'||!IDENT.test(tenantId)||
     typeof actorId!=='string'||!IDENT.test(actorId)||
     typeof reversalId!=='string'||!ID.test(reversalId)||
     typeof originalOperationId!=='string'||!ID.test(originalOperationId)||
     typeof originalHash!=='string'||!HEX.test(originalHash)||
     !Number.isSafeInteger(units)||units<1||units>1000||
     typeof reason!=='string'||!reason.trim()||reason.length>200){
    throw new TypeError('Invalid synthetic reversal actor, source, units or reason');
  }
  return {tenantId,actorId,reversalId,originalOperationId,originalHash,units,reason};
}
function validRows(part){
  if(part?.success!==true || !Array.isArray(part.results)){
    throw new Error('NEEDS_REVIEW: malformed D1 reversal batch result');
  }
  return part.results;
}
function validStored(row,x){
  return !!row && typeof row==='object' &&
    row.tenant_id===x.tenantId &&
    typeof row.reversal_id==='string' && ID.test(row.reversal_id) &&
    typeof row.original_operation_id==='string' && ID.test(row.original_operation_id) &&
    (row.reversal_id===x.reversalId || row.original_operation_id===x.originalOperationId) &&
    typeof row.actor_id==='string' && IDENT.test(row.actor_id) &&
    typeof row.original_hash==='string' && HEX.test(row.original_hash) &&
    typeof row.reversal_hash==='string' && HEX.test(row.reversal_hash) &&
    Number.isSafeInteger(row.units) && row.units>0 && row.units<=1000 &&
    typeof row.reason==='string' && !!row.reason.trim() && row.reason.length<=200 &&
    typeof row.sku==='string' && !!row.sku.trim() &&
    typeof row.result_ref==='string' && !!row.result_ref.trim();
}
function sameIntent(row,x,hash){
  return row?.tenant_id===x.tenantId&&row?.reversal_id===x.reversalId &&
    row?.original_operation_id===x.originalOperationId &&
    row?.actor_id===x.actorId && row?.original_hash===x.originalHash &&
    row?.reversal_hash===hash && row?.units===x.units &&
    row?.reason===x.reason && row?.result_ref===x.reversalId &&
    typeof row?.sku==='string' && !!row.sku.trim();
}

export function createSyntheticD1ReversalContract(DB){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function'){
    throw new Error('D1 transactional batch binding unavailable for reversal');
  }
  return Object.freeze({
    async reverse(input){
      const x=validate(input);
      // Bind canonical intent to the trusted tenant and actor. This fixture
      // only accepts fixed synthetic values via its test Worker.
      const hash=await hashCanonicalOperationIntent({
        tenantId:x.tenantId,actorId:x.actorId,operationType:'sales.reverse',
        payload:{originalOperationId:x.originalOperationId,
          originalHash:x.originalHash,units:x.units,reason:x.reason}
      });
      const result=await DB.batch([
        DB.prepare(CLAIM).bind(x.reversalId,x.actorId,hash,
          x.reason,x.reversalId,x.tenantId,x.originalOperationId,
          x.originalHash,x.units),
        DB.prepare(LOOKUP).bind(x.tenantId,x.reversalId,x.originalOperationId)
      ]);
      if(!Array.isArray(result)||result.length!==2){
        throw new Error('NEEDS_REVIEW: invalid D1 reversal transaction; reconcile original ID');
      }
      const [inserted,found]=result.map(validRows);
      if(inserted.length>1 || found.length>2 ||
         found.some(row=>!validStored(row,x))){
        throw new Error('NEEDS_REVIEW: malformed or ambiguous D1 reversal transaction');
      }
      if(inserted.length===1){
        if(inserted[0]?.reversal_id!==x.reversalId ||
           found.length!==1 || !sameIntent(found[0],x,hash)){
          throw new Error('NEEDS_REVIEW: uncertain committed D1 reversal; reconcile original ID');
        }
        return {status:'REVERSED',reversalId:x.reversalId,resultRef:x.reversalId};
      }
      if(found.length===0)return {status:'DECLINED',reversalId:x.reversalId};
      if(found.length===1 && sameIntent(found[0],x,hash)){
        return {status:'REPLAY',reversalId:x.reversalId,resultRef:found[0].result_ref};
      }
      return {status:'CONFLICT',reversalId:x.reversalId};
    }
  });
}
