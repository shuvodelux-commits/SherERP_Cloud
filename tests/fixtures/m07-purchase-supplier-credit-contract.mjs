/**
 * M07-B2 TEST ONLY: signed Supplier Due/advance Purchase Return over one M05
 * original owned lot. No live M08 Supplier account, Cash/Bank or public RPC.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[0-9a-f]{64}$/;
const FIELDS='actorId,creditPaisa,lotId,operationId,originalHash,purchaseId,reason,returnId,sku,supplierId,tenantId,units';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function validate(raw){
  if(!plain(raw)||Reflect.ownKeys(raw).sort().join(',')!==FIELDS)
    throw new TypeError('Invalid synthetic Supplier Credit Purchase Return shape');
  const {tenantId,actorId,purchaseId,supplierId,returnId,operationId,
    sku,lotId,originalHash,units,creditPaisa,reason}=raw;
  if(![tenantId,actorId,purchaseId,supplierId,returnId,sku,lotId].every(x=>
    typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1000000||
    !Number.isSafeInteger(creditPaisa)||creditPaisa<1||creditPaisa>1000000000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200)
    throw new TypeError('Invalid Supplier Credit identity, amount, source or reason');
  return {tenantId,actorId,purchaseId,supplierId,returnId,operationId,
    sku,lotId,originalHash,units,creditPaisa,reason};
}

const CLAIM=`INSERT INTO m07_purchase_credit_returns(
 tenant_id,return_id,operation_id,actor_id,purchase_id,supplier_id,
 sku,lot_id,source_hash,intent_hash,units,credit_paisa,reason)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT DO NOTHING
 RETURNING return_id,operation_id,actor_id,intent_hash`;
const READ=`SELECT 'CREDIT' AS kind,return_id,operation_id,actor_id,intent_hash
 FROM m07_purchase_credit_returns
 WHERE tenant_id=? AND (operation_id=? OR return_id=?)
 UNION ALL
 SELECT 'CASH' AS kind,return_id,operation_id,actor_id,intent_hash
 FROM m07_purchase_cash_returns
 WHERE tenant_id=? AND (operation_id=? OR return_id=?)`;
function rows(part){
  if(part?.success!==true||!Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: Supplier Credit D1 return receipt incomplete');
  return part.results;
}
export function createSyntheticD1PurchaseSupplierCreditContract(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing synthetic Supplier Credit D1 binding');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid Supplier Credit beforeBatch hook');
  return Object.freeze({
    async post(raw){
      const x=validate(raw);
      const {tenantId,actorId,purchaseId,supplierId,returnId,operationId,
        sku,lotId,originalHash,units,creditPaisa,reason}=x;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.return.supplier-credit',
        payload:{purchaseId,supplierId,returnId,sku,lotId,originalHash,units,creditPaisa,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,purchaseId,returnId,operationId});
      let response;
      try{
        response=await DB.batch([
          DB.prepare(CLAIM).bind(
            tenantId,returnId,operationId,actorId,purchaseId,supplierId,
            sku,lotId,originalHash,intentHash,units,creditPaisa,reason),
          DB.prepare(READ).bind(
            tenantId,operationId,returnId,tenantId,operationId,returnId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: Supplier Credit commit uncertain; inspect stable operation ID');
      }
      if(!Array.isArray(response)||response.length!==2)
        throw new Error('NEEDS_REVIEW: Supplier Credit claim/receipt missing');
      const [claimed,found]=response.map(rows);
      if(found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous cross-method Purchase Return identity');
      const old=found[0];
      const exact=old?.kind==='CREDIT'&&old.return_id===returnId&&
        old.operation_id===operationId&&old.actor_id===actorId&&
        old.intent_hash===intentHash;
      if(claimed.length===1&&exact)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!old)return {status:'DECLINED',operationId};
        if(exact)return {status:'REPLAY',operationId,returnId};
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory Supplier Credit D1 commit/readback');
    }
  });
}
