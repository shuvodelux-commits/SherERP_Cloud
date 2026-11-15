/**
 * M07-B4A: strictly synthetic, local-only multi-lot Cash Return posting.
 * Never expose through src/rpc or deploy m07b4_* SQL tables.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const HASH=/^[0-9a-f]{64}$/;
const LOT=/^[A-Z0-9-]{1,80}$/;
const FIELDS='actorId,draws,operationId,originalHash,purchaseId,reason,refundPaisa,returnId,sku,supplierId,tenantId,units';
function plain(obj){
  return obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
    (Object.getPrototypeOf(obj)===Object.prototype||
     Object.getPrototypeOf(obj)===null)&&
    !Object.values(Object.getOwnPropertyDescriptors(obj)).some(d=>'get' in d||'set' in d);
}
function validate(raw){
  if(!plain(raw)||Reflect.ownKeys(raw).sort().join(',')!==FIELDS)
    throw new TypeError('Invalid multi-lot Cash Return shape');
  const {tenantId,actorId,purchaseId,supplierId,returnId,operationId,sku,
    originalHash,units,refundPaisa,draws,reason}=raw;
  if(![tenantId,actorId,purchaseId,supplierId,returnId,sku].every(x=>
    typeof x==='string'&&ID.test(x))||
    typeof operationId!=='string'||!OP.test(operationId)||
    typeof originalHash!=='string'||!HASH.test(originalHash)||
    !Number.isSafeInteger(units)||units<1||units>1000000||
    !Number.isSafeInteger(refundPaisa)||refundPaisa<1||refundPaisa>1000000000||
    typeof reason!=='string'||!reason||reason.trim()!==reason||reason.length>200||
    !Array.isArray(draws)||draws.length<1||draws.length>20)
    throw new TypeError('Invalid multi-lot Cash Return identity, amount, source or reason');
  const seen=new Set();
  const canonical=draws.map(d=>{
    if(!plain(d)||Reflect.ownKeys(d).sort().join(',')!=='lotId,units'||
      typeof d.lotId!=='string'||!LOT.test(d.lotId)||
      !Number.isSafeInteger(d.units)||d.units<1||d.units>1000000)
      throw new TypeError('Invalid multi-lot Cash Return draw');
    if(seen.has(d.lotId))throw new TypeError('Duplicate multi-lot Cash Return draw');
    seen.add(d.lotId);
    return {lotId:d.lotId,units:d.units};
  });
  if(canonical.reduce((s,d)=>s+d.units,0)!==units)
    throw new TypeError('Invalid multi-lot Cash Return quantity total');
  return {tenantId,actorId,purchaseId,supplierId,returnId,operationId,
    sku,originalHash,units,refundPaisa,draws:canonical,reason};
}
const CLAIM="INSERT INTO m07b4_cash_returns\n (tenant_id,return_id,operation_id,actor_id,purchase_id,supplier_id,\n  sku,source_hash,intent_hash,units,refund_paisa,draws_json,reason)\n VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)\n ON CONFLICT DO NOTHING\n RETURNING return_id,operation_id,actor_id,intent_hash";
const READ="SELECT 'MULTI_CASH' AS kind,return_id,operation_id,actor_id,intent_hash\n FROM m07b4_cash_returns\n WHERE tenant_id=? AND (operation_id=? OR return_id=?)\n UNION ALL\n SELECT 'OLD_CASH' AS kind,return_id,operation_id,actor_id,intent_hash\n FROM m07_purchase_cash_returns\n WHERE tenant_id=? AND (operation_id=? OR return_id=?)\n UNION ALL\n SELECT 'OLD_CREDIT' AS kind,return_id,operation_id,actor_id,intent_hash\n FROM m07_purchase_credit_returns\n WHERE tenant_id=? AND (operation_id=? OR return_id=?)";
function rows(response){
  if(response?.success!==true||!Array.isArray(response.results))
    throw new Error('NEEDS_REVIEW: incomplete multi-lot Cash D1 receipt');
  return response.results;
}
export function createSyntheticMultiLotPurchaseCashReturn(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Missing local synthetic multi-lot D1 binding');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid multi-lot beforeBatch hook');
  return Object.freeze({
    async post(raw){
      const x=validate(raw);
      const {tenantId,actorId,purchaseId,supplierId,returnId,operationId,
        sku,originalHash,units,refundPaisa,draws,reason}=x;
      const intentHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.return.cash.multilot.test',
        payload:{purchaseId,supplierId,returnId,sku,originalHash,
          units,refundPaisa,draws,reason}
      });
      if(beforeBatch)await beforeBatch({tenantId,purchaseId,returnId,operationId});
      let response;
      try{
        response=await DB.batch([
          DB.prepare(CLAIM).bind(tenantId,returnId,operationId,actorId,
            purchaseId,supplierId,sku,originalHash,intentHash,units,
            refundPaisa,JSON.stringify(draws),reason),
          DB.prepare(READ).bind(
            tenantId,operationId,returnId,
            tenantId,operationId,returnId,
            tenantId,operationId,returnId)
        ]);
      }catch{
        throw new Error('NEEDS_REVIEW: multi-lot Cash commit uncertain; reconcile stable operation ID');
      }
      if(!Array.isArray(response)||response.length!==2)
        throw new Error('NEEDS_REVIEW: multi-lot Cash claim/readback missing');
      const [claimed,found]=response.map(rows);
      if(found.length>1)
        throw new Error('NEEDS_REVIEW: ambiguous multi-lot or cross-method identity');
      const existing=found[0];
      const exact=existing?.kind==='MULTI_CASH'&&existing.return_id===returnId&&
        existing.operation_id===operationId&&existing.actor_id===actorId&&
        existing.intent_hash===intentHash;
      if(claimed.length===1&&exact)
        return {status:'COMMITTED',operationId,returnId};
      if(claimed.length===0){
        if(!existing)return {status:'DECLINED',operationId};
        if(exact)return {status:'REPLAY',operationId,returnId};
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: contradictory multi-lot Cash receipt');
    }
  });
}
