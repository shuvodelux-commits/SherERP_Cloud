/**
 * TEST-ONLY M05 multiple-SKU purchase D1 posting contract.
 * Never expose through public RPC or install as a production repository.
 * All identities below are controlled by a local test harness.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const LIMIT=1_000_000_000;
const SQL_POST=`INSERT INTO m05ml_purchases(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,supplier_id,purchase_date,
 items_json,subtotal_paisa,discount_paisa,grand_paisa,paid_paisa,due_paisa,
 payment_method,bank_account_id)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=? AND s.state='Open')
 AND EXISTS(SELECT 1 FROM m05ml_suppliers s JOIN m05ml_party_links l
 ON l.tenant_id=s.tenant_id AND l.source_group='SUPPLIERS'
 AND l.source_id=s.supplier_id AND l.party_id=s.party_id AND l.reviewed=1
 WHERE s.tenant_id=? AND s.supplier_id=? AND s.active=1)
 AND (?<>'Bank' OR EXISTS(SELECT 1 FROM m05ml_banks b
 WHERE b.tenant_id=? AND b.bank_id=? AND b.active=1))
 AND NOT EXISTS(
 SELECT 1 FROM json_each(?) j
 LEFT JOIN m05ml_products p
 ON p.tenant_id=? AND p.sku=json_extract(j.value,'$.sku')
 WHERE p.sku IS NULL
 OR p.version<>json_extract(j.value,'$.expectedVersion')
 OR p.active<>1 OR p.deleted<>0 OR p.product_type<>'Standard')
 ON CONFLICT(tenant_id,operation_id) DO NOTHING
 RETURNING purchase_id,intent_hash,actor_id`;
const SQL_LOOKUP=`SELECT purchase_id,intent_hash,actor_id
 FROM m05ml_purchases WHERE tenant_id=? AND operation_id=?`;

function amount(value,label){
  if(typeof value!=='string' || !/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.test(value))
    throw new TypeError('Invalid '+label+': exact paisa string required');
  const [whole,minor='']=value.split('.');
  const paisa=100*Number(whole)+Number(minor.padEnd(2,'0'));
  if(!Number.isSafeInteger(paisa) || paisa>LIMIT)
    throw new RangeError('Invalid '+label+' amount limit');
  return paisa;
}
const record=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);
function exactKeys(value,keys){
  return record(value) && Reflect.ownKeys(value).sort().join(',')===keys.slice().sort().join(',');
}
function parse(input){
  if(!exactKeys(input,[
    'tenantId','actorId','purchaseId','operationId','supplierId','date',
    'items','discount','paidAmount','paymentMethod','bankAccountId'
  ]) || !ID.test(input.tenantId||'') || !ID.test(input.actorId||'') ||
      !ID.test(input.purchaseId||'') || !OP.test(input.operationId||'') ||
      !ID.test(input.supplierId||'') ||
      typeof input.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !Number.isFinite(Date.parse(input.date+'T00:00:00Z')) ||
      new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date ||
      !Array.isArray(input.items) || input.items.length<1 || input.items.length>10 ||
      !['','Cash','Bank'].includes(input.paymentMethod) ||
      typeof input.bankAccountId!=='string' ||
      (input.paymentMethod==='Bank' && !ID.test(input.bankAccountId))){
    throw new TypeError('Invalid synthetic multi-line purchase envelope');
  }
  let subtotal=0;
  const seen=new Set();
  const lines=input.items.map(line=>{
    if(!exactKeys(line,['sku','qty','unitPrice','sellPrice','expectedVersion']) ||
       !ID.test(line.sku||'') ||
       !Number.isSafeInteger(line.qty) || line.qty<1 || line.qty>1_000_000 ||
       !Number.isSafeInteger(line.expectedVersion) ||
       line.expectedVersion<1 || line.expectedVersion>1_000_000){
      throw new TypeError('Invalid synthetic purchase SKU or quantity');
    }
    if(seen.has(line.sku))throw new TypeError('Duplicate purchase SKU: '+line.sku);
    seen.add(line.sku);
    const costPaisa=amount(line.unitPrice,'unit price');
    const sellPaisa=amount(line.sellPrice,'selling price');
    subtotal+=costPaisa*line.qty;
    if(!Number.isSafeInteger(subtotal) || subtotal>LIMIT)
      throw new RangeError('Invalid synthetic purchase subtotal');
    return {sku:line.sku,qty:line.qty,expectedVersion:line.expectedVersion,
      costPaisa,sellPaisa};
  });
  const discount=amount(input.discount,'discount');
  const grand=Math.max(0,subtotal-discount);
  // Source createPurchase clamps over-tender to grand, rather than taking change.
  const paid=Math.min(grand,amount(input.paidAmount,'paid amount'));
  const due=grand-paid;
  const method=paid>0?(input.paymentMethod||'Cash'):'';
  const bankId=method==='Bank'?input.bankAccountId:'';
  return {lines,subtotal,discount,grand,paid,due,method,bankId};
}
const rows=result=>{
  if(result?.success!==true || !Array.isArray(result.results))
    throw new Error('NEEDS_REVIEW: missing authoritative D1 purchase result');
  return result.results;
};

/**
 * This is intentionally NOT a production writer and does not authenticate
 * HTTP requests. The SQL claim repeats all supplier/product/session/bank
 * authority checks, then database triggers write all children atomically.
 */
export function createSyntheticMultilinePurchasePoster(DB,{beforeBatch}={}){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('Synthetic D1 test database unavailable');
  if(beforeBatch!==undefined && typeof beforeBatch!=='function')
    throw new TypeError('Invalid test-only beforeBatch hook');
  return Object.freeze({
    async post(input){
      const v=parse(input);
      const {tenantId,actorId,purchaseId,operationId,supplierId,date}=input;
      const payload={supplierId,purchaseDate:date,lines:v.lines,
        subtotalPaisa:v.subtotal,discountPaisa:v.discount,grandPaisa:v.grand,
        paidPaisa:v.paid,duePaisa:v.due,paymentMethod:v.method,bankAccountId:v.bankId};
      const hash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.post.multi',payload
      });
      const itemsJson=JSON.stringify(v.lines);
      if(beforeBatch)await beforeBatch({tenantId,operationId,purchaseId});
      let result;
      try{
        result=await DB.batch([
          DB.prepare(SQL_POST).bind(
            tenantId,purchaseId,operationId,actorId,hash,supplierId,date,
            itemsJson,v.subtotal,v.discount,v.grand,v.paid,v.due,v.method,v.bankId,
            tenantId,tenantId,supplierId,v.method,tenantId,v.bankId,itemsJson,tenantId
          ),
          DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
        ]);
      }catch{
        // Network errors can happen AFTER an authoritative commit: never
        // automatically create a new operation ID or infer rollback.
        throw new Error('NEEDS_REVIEW: multi-line purchase commit uncertain; reconcile operation ID');
      }
      if(!Array.isArray(result)||result.length!==2)
        throw new Error('NEEDS_REVIEW: ambiguous multi-line purchase batch');
      const [claim,lookup]=result.map(rows);
      const existing=lookup.length===1?lookup[0]:null;
      if(claim.length===1 && existing?.purchase_id===purchaseId &&
         existing?.intent_hash===hash && existing?.actor_id===actorId)
        return {status:'COMMITTED',operationId,purchaseId};
      if(claim.length===0){
        if(lookup.length===0)return {status:'DECLINED',operationId};
        if(existing?.intent_hash===hash && existing?.actor_id===actorId)
          return {status:'REPLAY',operationId,purchaseId:existing.purchase_id};
        if(existing)return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: conflicting multi-line purchase receipt');
    }
  });
}
