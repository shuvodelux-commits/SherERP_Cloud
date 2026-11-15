/**
 * TEST-ONLY M05 local Workerd/D1 proof. Never register as a public RPC.
 * Trusted synthetic tenant/actor are harness-controlled, not browser fields.
 * Single physical item only: no production migration or accounting kernel.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const MAX_PAISA=1_000_000_000;
const SQL_POST=`INSERT INTO m05_purchases
 (tenant_id,purchase_id,operation_id,actor_id,intent_hash,supplier_id,sku,qty,
 expected_version,purchase_date,unit_cost_paisa,sell_price_paisa,discount_paisa,
 grand_paisa,paid_paisa,due_paisa,payment_method,bank_account_id)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m05_sessions WHERE tenant_id=? AND state='Open')
 AND EXISTS(SELECT 1 FROM m05_products WHERE tenant_id=? AND sku=? AND version=?
 AND active=1 AND deleted=0 AND product_type='Standard')
 AND EXISTS(SELECT 1 FROM m05_suppliers s JOIN m05_party_links l
 ON l.tenant_id=s.tenant_id AND l.source_group='SUPPLIERS'
 AND l.source_id=s.supplier_id AND l.party_id=s.party_id AND l.reviewed=1
 WHERE s.tenant_id=? AND s.supplier_id=? AND s.active=1)
 AND (?<>'Bank' OR EXISTS(SELECT 1 FROM m05_banks b WHERE b.tenant_id=?
 AND b.bank_id=? AND b.active=1))
 ON CONFLICT(tenant_id,operation_id) DO NOTHING
 RETURNING purchase_id,intent_hash,actor_id`;
const SQL_LOOKUP=`SELECT purchase_id,intent_hash,actor_id FROM m05_purchases
 WHERE tenant_id=? AND operation_id=?`;
const isRecord=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
 (Object.getPrototypeOf(x)===Object.prototype || Object.getPrototypeOf(x)===null);

function toPaisa(value,label){
 if(typeof value!=='string' || !/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.test(value))
   throw new TypeError('Invalid '+label+' paisa precision');
 const [integer,fraction='']=value.split('.');
 const paisa=Number(integer)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(paisa) || paisa>MAX_PAISA)
   throw new RangeError('Invalid '+label+' amount limit');
 return paisa;
}
function validate(input){
 const expected=['tenantId','actorId','purchaseId','operationId','supplierId','sku',
   'qty','expectedVersion','unitPrice','sellPrice','discount','paidAmount','date',
   'paymentMethod','bankAccountId'].sort().join(',');
 if(!isRecord(input) || Reflect.ownKeys(input).sort().join(',')!==expected ||
  !ID.test(input.tenantId||'') || !ID.test(input.actorId||'') ||
  !ID.test(input.purchaseId||'') || !OP.test(input.operationId||'') ||
  !ID.test(input.supplierId||'') || !ID.test(input.sku||'') ||
  !Number.isSafeInteger(input.qty) || input.qty<1 || input.qty>1_000_000 ||
  !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1 ||
  input.expectedVersion>1_000_000 ||
  typeof input.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
  new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date ||
  !['Cash','Bank'].includes(input.paymentMethod) ||
  (input.paymentMethod==='Cash' && input.bankAccountId!=='') ||
  (input.paymentMethod==='Bank' && !ID.test(input.bankAccountId||''))){
   throw new TypeError('Invalid synthetic purchase identity, date or payment method');
 }
 const cost=toPaisa(input.unitPrice,'unit cost');
 const sell=toPaisa(input.sellPrice,'lot selling price');
 const discount=toPaisa(input.discount,'discount');
 const paid=toPaisa(input.paidAmount,'paid amount');
 const subtotal=cost*input.qty;
 if(!Number.isSafeInteger(subtotal) || subtotal>MAX_PAISA)
   throw new RangeError('Invalid synthetic purchase subtotal');
 const grand=Math.max(0,subtotal-discount);
 if(paid>grand)throw new RangeError('Invalid synthetic paid amount exceeds grand');
 return {cost,sell,discount,paid,grand,due:grand-paid,
   method:paid>0?input.paymentMethod:'',
   bank:paid>0&&input.paymentMethod==='Bank'?input.bankAccountId:''};
}
const dataRows=result=>{
 if(result?.success!==true || !Array.isArray(result.results))
  throw new Error('NEEDS_REVIEW: malformed D1 purchase receipt response');
 return result.results;
};

export function createSyntheticPurchasePoster(DB,{beforeBatch}={}){
 if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
  throw new Error('Synthetic local D1 binding unavailable');
 if(beforeBatch!==undefined && typeof beforeBatch!=='function')
  throw new TypeError('Invalid synthetic beforeBatch callback');
 return Object.freeze({
  async post(input){
   const x=validate(input);
   const {tenantId,actorId,purchaseId,operationId,supplierId,sku,qty,expectedVersion}=input;
   const intentHash=await hashCanonicalOperationIntent({
    tenantId,actorId,operationType:'purchase.post',
    payload:{supplierId,sku,qty,expectedVersion,purchaseDate:input.date,
      costPaisa:x.cost,sellPaisa:x.sell,discountPaisa:x.discount,
      paidPaisa:x.paid,grandPaisa:x.grand,method:x.method,bankId:x.bank}
   });
   // The hook is a synthetic concurrency injector. The SQL claim, not this
   // preflight, must guard account/stock/session authority in one statement.
   if(beforeBatch)await beforeBatch({tenantId,operationId,purchaseId});
   let result;
   try{
    result=await DB.batch([
     DB.prepare(SQL_POST).bind(
      tenantId,purchaseId,operationId,actorId,intentHash,supplierId,sku,qty,
      expectedVersion,input.date,x.cost,x.sell,x.discount,x.grand,
      x.paid,x.due,x.method,x.bank,
      tenantId,tenantId,sku,expectedVersion,
      tenantId,supplierId,x.method,tenantId,x.bank),
     DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
    ]);
   }catch{
    // A failed response can occur after commit. Never automatically retry
    // with a fresh operation ID; first reconcile the original receipt.
    throw new Error('NEEDS_REVIEW: uncertain purchase commit; reconcile original operation ID');
   }
   if(!Array.isArray(result) || result.length!==2)
    throw new Error('NEEDS_REVIEW: missing purchase claim or receipt result');
   const [claim,lookup]=result.map(dataRows);
   const existing=lookup.length===1?lookup[0]:null;
   if(claim.length===1 && existing?.purchase_id===purchaseId &&
    existing?.intent_hash===intentHash && existing?.actor_id===actorId)
    return {status:'COMMITTED',operationId,purchaseId};
   if(claim.length===0){
    if(lookup.length===0)return {status:'DECLINED',operationId};
    if(existing?.intent_hash===intentHash && existing?.actor_id===actorId)
     return {status:'REPLAY',operationId,purchaseId:existing.purchase_id};
    if(existing)return {status:'CONFLICT',operationId};
   }
   throw new Error('NEEDS_REVIEW: ambiguous purchase receipt state');
  }
 });
}
