/**
 * M07-A4 TEST ONLY. No public RPC, authenticated principal or production
 * Party account. Local D1 parent receipt inserts M07-A2 signed Credit children.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const KEYS='actorId,batchId,children,customerId,operationId,reason,tenantId';
const CHILD='creditPaisa,invoiceId,lotId,operationId,originalHash,returnId,sku,units';
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const hasKeys=(x,keys)=>Reflect.ownKeys(x).sort().join(',')===keys;

function validate(raw){
  if(!isRecord(raw)||!hasKeys(raw,KEYS))
    throw new TypeError('Invalid synthetic Store Credit batch shape');
  const {tenantId,actorId,batchId,operationId,customerId,reason,children}=raw;
  if(![tenantId,actorId,batchId,customerId].every(x=>typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200||
    !Array.isArray(children)||children.length<2||children.length>20)
    throw new TypeError('Invalid Store Credit batch Customer, reason or 2–20 invoice count');
  const invoices=new Set(),returns=new Set(),ops=new Set();
  let totalCreditPaisa=0;
  const items=children.map(row=>{
    if(!isRecord(row)||!hasKeys(row,CHILD))
      throw new TypeError('Invalid synthetic Store Credit batch child');
    const {invoiceId,returnId,operationId:childOp,sku,lotId,originalHash,units,creditPaisa}=row;
    if(![invoiceId,returnId,sku,lotId].every(x=>typeof x==='string'&&ID.test(x))||
      typeof childOp!=='string'||!OP.test(childOp)||
      typeof originalHash!=='string'||!HASH.test(originalHash)||
      !Number.isSafeInteger(units)||units<1||units>1000000||
      !Number.isSafeInteger(creditPaisa)||creditPaisa<1||creditPaisa>1000000000)
      throw new TypeError('Invalid synthetic Store Credit batch source or amount');
    if(invoices.has(invoiceId)||returns.has(returnId)||ops.has(childOp))
      throw new TypeError('Duplicate invoice or return in Store Credit batch');
    invoices.add(invoiceId);returns.add(returnId);ops.add(childOp);
    totalCreditPaisa+=creditPaisa;
    if(!Number.isSafeInteger(totalCreditPaisa))
      throw new TypeError('Invalid Store Credit batch money sum');
    return {invoiceId,returnId,operationId:childOp,sku,lotId,originalHash,units,creditPaisa};
  });
  return {tenantId,actorId,batchId,operationId,customerId,reason,children:items,totalCreditPaisa};
}
const CLAIM=`INSERT INTO m07_credit_batches(
 tenant_id,batch_id,operation_id,actor_id,customer_id,reason,intent_hash,
 children_json,child_count,total_credit_paisa)
 VALUES(?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT DO NOTHING RETURNING batch_id,operation_id,actor_id,intent_hash`;
const RECEIPT=`SELECT 'CREDIT' AS kind,batch_id,operation_id,actor_id,intent_hash,children_json
 FROM m07_credit_batches WHERE tenant_id=? AND (batch_id=? OR operation_id=?)
 UNION ALL SELECT 'CASH' AS kind,batch_id,operation_id,actor_id,intent_hash,children_json
 FROM m07_cash_batches WHERE tenant_id=? AND (batch_id=? OR operation_id=?)`;
function rows(part){
  if(part?.success!==true||!Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: Store Credit batch readback invalid');
  return part.results;
}
export function createSyntheticD1CreditBatchReturnContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing synthetic Store Credit batch D1 binding');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid Store Credit batch beforeBatch hook');
  return Object.freeze({
    async post(raw){
      const {tenantId,actorId,batchId,operationId,customerId,reason,children,totalCreditPaisa}=validate(raw);
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.return.store-credit-batch',
        payload:{batchId,customerId,reason,children}
      });
      if(beforeBatch)await beforeBatch({tenantId,batchId,operationId});
      let batch;
      try{
        batch=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,batchId,operationId,actorId,customerId,reason,intentHash,
            JSON.stringify(children),children.length,totalCreditPaisa
          ),
          DB.prepare(RECEIPT).bind(tenantId,batchId,operationId,tenantId,batchId,operationId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Store Credit batch uncertain; reconcile immutable operation');
      }
      if(!Array.isArray(batch)||batch.length!==2)
        throw new Error('NEEDS_REVIEW: Store Credit batch outcome incomplete');
      const [claimed,found]=batch.map(rows);
      if(found.length>1)throw new Error('NEEDS_REVIEW: cross-method batch identity ambiguous');
      const old=found[0];
      const exact=old?.kind==='CREDIT'&&old?.batch_id===batchId&&
        old?.operation_id===operationId&&old?.actor_id===actorId&&
        old?.intent_hash===intentHash;
      if(claimed.length===1&&exact)
        return {status:'COMMITTED',batchId,operationId,returnIds:children.map(x=>x.returnId)};
      if(claimed.length===0){
        if(!old)return {status:'DECLINED',operationId};
        if(exact){
          let oldChildren;
          try{oldChildren=JSON.parse(old.children_json)}catch{
            throw new Error('NEEDS_REVIEW: corrupt stored Store Credit batch');
          }
          return {status:'REPLAY',batchId,operationId,returnIds:oldChildren.map(c=>c.returnId)};
        }
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory Store Credit batch commit/readback');
    }
  });
}
