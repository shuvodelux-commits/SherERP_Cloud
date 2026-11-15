/**
 * M07-A3 TEST ONLY. A single local D1 receipt/trigger atomically groups
 * existing synthetic M07 Cash child returns. No production RPC/account writer.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const INPUT_KEYS='actorId,batchId,children,customerId,operationId,reason,tenantId';
const CHILD_KEYS='invoiceId,lotId,operationId,originalHash,refundPaisa,returnId,sku,units';
const validObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const sameKeys=(x,keys)=>Reflect.ownKeys(x).sort().join(',')===keys;

function snapshot(raw){
  if(!validObject(raw)||!sameKeys(raw,INPUT_KEYS))
    throw new TypeError('Invalid synthetic Cash batch shape');
  const {tenantId,actorId,batchId,operationId,customerId,reason,children}=raw;
  if(![tenantId,actorId,batchId,customerId].every(x=>
    typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200||
    !Array.isArray(children)||children.length<2||children.length>20)
    throw new TypeError('Invalid synthetic Cash batch header or invoice count (2–20)');
  const invoices=new Set(),returns=new Set(),ops=new Set();
  let totalRefundPaisa=0;
  const exactChildren=children.map(c=>{
    if(!validObject(c)||!sameKeys(c,CHILD_KEYS))
      throw new TypeError('Invalid synthetic Cash batch child shape');
    const {invoiceId,returnId,operationId:childOp,sku,lotId,originalHash,
      units,refundPaisa}=c;
    if(![invoiceId,returnId,sku,lotId].every(x=>typeof x==='string'&&ID.test(x))||
      typeof childOp!=='string'||!OP.test(childOp)||
      typeof originalHash!=='string'||!HASH.test(originalHash)||
      !Number.isSafeInteger(units)||units<1||units>1_000_000||
      !Number.isSafeInteger(refundPaisa)||refundPaisa<0||refundPaisa>1_000_000_000)
      throw new TypeError('Invalid synthetic Cash batch child invoice, stock or price');
    if(invoices.has(invoiceId)||returns.has(returnId)||ops.has(childOp))
      throw new TypeError('Duplicate invoice or return in synthetic Cash batch');
    invoices.add(invoiceId);returns.add(returnId);ops.add(childOp);
    totalRefundPaisa+=refundPaisa;
    if(!Number.isSafeInteger(totalRefundPaisa))
      throw new TypeError('Invalid synthetic Cash batch money sum');
    return {invoiceId,returnId,operationId:childOp,sku,lotId,
      originalHash,units,refundPaisa};
  });
  return {tenantId,actorId,batchId,operationId,customerId,reason,
    children:exactChildren,totalRefundPaisa};
}

const CLAIM=`INSERT INTO m07_cash_batches(
 tenant_id,batch_id,operation_id,actor_id,customer_id,reason,intent_hash,
 children_json,child_count,total_refund_paisa)
 VALUES (?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT DO NOTHING RETURNING batch_id,operation_id,actor_id,intent_hash`;
const RECEIPT=`SELECT batch_id,operation_id,actor_id,intent_hash,children_json
 FROM m07_cash_batches WHERE tenant_id=? AND (batch_id=? OR operation_id=?)`;
function readback(value){
  if(value?.success!==true||!Array.isArray(value.results))
    throw new Error('NEEDS_REVIEW: Cash batch local D1 receipt unavailable');
  return value.results;
}

export function createSyntheticD1CashBatchReturnContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing synthetic Cash batch D1');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid synthetic Cash batch pre-claim hook');
  return Object.freeze({
    async post(raw){
      const input=snapshot(raw);
      const {tenantId,actorId,batchId,operationId,customerId,reason,children,totalRefundPaisa}=input;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.cash-batch',
        payload:{batchId,customerId,reason,children}
      });
      const json=JSON.stringify(children);
      if(beforeBatch)await beforeBatch({tenantId,batchId,operationId});
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(tenantId,batchId,operationId,actorId,customerId,
            reason,intentHash,json,children.length,totalRefundPaisa),
          DB.prepare(RECEIPT).bind(tenantId,batchId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Cash batch D1 commit status uncertain; inspect stable operation ID');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: Cash batch local D1 result incomplete');
      const [claimed,seen]=batch.map(readback);
      if(seen.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous Cash batch receipt identity');
      const old=seen[0],exact=old?.batch_id===batchId&&old?.operation_id===operationId&&
        old?.actor_id===actorId&&old?.intent_hash===intentHash;
      if(claimed.length===1&&exact)
        return {status:'COMMITTED',batchId,operationId,returnIds:children.map(x=>x.returnId)};
      if(claimed.length===0){
        if(!old)return {status:'DECLINED',operationId};
        if(exact){
          let oldChildren;
          try{oldChildren=JSON.parse(old.children_json)}catch{
            throw new Error('NEEDS_REVIEW: Cash batch stored child receipt is corrupt');
          }
          return {status:'REPLAY',batchId,operationId,returnIds:oldChildren.map(x=>x.returnId)};
        }
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory Cash batch write/readback');
    }
  });
}
