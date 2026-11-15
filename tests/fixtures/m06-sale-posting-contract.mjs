/**
 * M06 TEST-ONLY Workerd/D1 slice: 1 owned-stock SKU, source-faithful split
 * payments and exact customer due. This is NOT an authenticated public writer,
 * approved ERP schema, FIFO/vendor/bundle service or production posting engine.
 * Caller supplies trusted synthetic tenant/actor context (never use request body).
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {normalizeSalePayments_,salePaymentPaisa_} from '../../src/modules/sale-payments.js';

const SIMPLE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP_ID=/^[A-Za-z0-9_-]{12,100}$/;
const SQLITE_INTEGER_LIMIT=1_000_000_000; // Bound amounts well below JS integer-paisa precision.
const SQL_ACCOUNTS=`SELECT account_id,account_name,method,active FROM m06_bank_accounts WHERE tenant_id=?`;
const SQL_POST=`INSERT INTO m06_invoices(tenant_id,invoice_id,operation_id,actor_id,
  payload_hash,sku,units,grand_paisa,paid_paisa,due_paisa,customer_id,payments_json)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?
 WHERE EXISTS(SELECT 1 FROM m06_cash_sessions WHERE tenant_id=? AND state='Open')
 AND EXISTS(SELECT 1 FROM m06_owned_stock WHERE tenant_id=? AND sku=? AND available>=?)
 AND (?=0 OR EXISTS(SELECT 1 FROM m06_customer_accounts c JOIN m06_party_links l
   ON l.tenant_id=c.tenant_id AND l.source_group='CUSTOMERS'
   AND l.source_id=c.customer_id AND l.party_id=c.party_id AND l.reviewed=1
   WHERE c.tenant_id=? AND c.customer_id=?))
 AND NOT EXISTS(SELECT 1 FROM json_each(?) AS tender
   WHERE json_extract(tender.value,'$.method')<>'Cash'
   AND NOT EXISTS(SELECT 1 FROM m06_bank_accounts b WHERE b.tenant_id=?
    AND b.account_id=json_extract(tender.value,'$.accountId')
    AND b.method=json_extract(tender.value,'$.method') AND b.active=1))
 ON CONFLICT(tenant_id,operation_id) DO NOTHING
 RETURNING invoice_id,payload_hash,actor_id`;
const SQL_LOOKUP=`SELECT invoice_id,payload_hash,actor_id FROM m06_invoices
 WHERE tenant_id=? AND operation_id=?`;
const asPaisa=(value,label)=>salePaymentPaisa_(value,label,false);
const decimalString=cents=>(cents/100).toFixed(2);
const dataRows=part=>{
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('NEEDS_REVIEW: invalid D1 sale response; reconcile original operation ID');
  return part.results;
};
const plain=obj=>obj!==null && typeof obj==='object' && !Array.isArray(obj) &&
  (Object.getPrototypeOf(obj)===Object.prototype || Object.getPrototypeOf(obj)===null);
function validate(input){
  if(!plain(input) || Reflect.ownKeys(input).sort().join(',')!==
    'actorId,customerId,discount,invoiceId,operationId,payments,sku,tenantId,unitPrice,units' ||
    !SIMPLE_ID.test(input.tenantId||'') || !SIMPLE_ID.test(input.actorId||'') ||
    !SIMPLE_ID.test(input.invoiceId||'') || !OP_ID.test(input.operationId||'') ||
    !SIMPLE_ID.test(input.sku||'') ||
    (input.customerId!=='' && !SIMPLE_ID.test(input.customerId||'')) ||
    !Number.isSafeInteger(input.units) || input.units<1 || input.units>1_000_000 ||
    !Array.isArray(input.payments)){
    throw new TypeError('Invalid synthetic sale identifier, quantity or payment input');
  }
  const price=asPaisa(input.unitPrice,'Unit price');
  const discount=asPaisa(input.discount,'Discount');
  const subtotal=price*input.units;
  if(!Number.isSafeInteger(subtotal) || subtotal>SQLITE_INTEGER_LIMIT ||
    discount>SQLITE_INTEGER_LIMIT)throw new RangeError('Invalid synthetic sale money limit');
  return {price,discount,grand:Math.max(0,subtotal-discount)};
}

export function createSyntheticD1SalePostingContract(DB,{beforeBatch}={}){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 transactional sale binding unavailable');
  if(beforeBatch!==undefined && typeof beforeBatch!=='function')
    throw new TypeError('Invalid test-only beforeBatch hook');
  return Object.freeze({
    async post(input){
      const {price,discount,grand}=validate(input);
      const {tenantId,actorId,invoiceId,operationId,sku,units,customerId}=input;
      // A read can become stale: the SAME SQL posting statement must repeat
      // every bank/customer/stock/session guard. This read grants NO authority.
      const trustedBankRows=(await DB.prepare(SQL_ACCOUNTS).bind(tenantId).all()).results.map(a=>({
        'Bank Account ID':a.account_id,'Account Name':a.account_name,
        'Account Type':a.method,Status:a.active===1?'Active':'Inactive','Is Deleted':'FALSE'
      }));
      const allocation=normalizeSalePayments_(decimalString(grand),input.payments,trustedBankRows);
      const paid=asPaisa(allocation.paidAmount,'Paid amount');
      const due=asPaisa(allocation.dueAmount,'Due amount');
      if(paid+due!==grand || (due>0 && !customerId))
        throw new TypeError('Synthetic sale requires valid customer due and balanced payment');
      const children=allocation.payments.map(p=>({
        rowId:p.rowId,rowOrder:p.rowOrder,method:p.method,accountId:p.bankAccountId,
        tenderPaisa:asPaisa(p.tendered,'Cash tender'),
        appliedPaisa:asPaisa(p.applied,'Applied payment'),
        changePaisa:asPaisa(p.change,'Cash change')
      }));
      const payload={sku,units,pricePaisa:price,discountPaisa:discount,
        customerId,payments:children};
      const payloadHash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'sales.post',payload
      });
      const paymentJson=JSON.stringify(children);
      if(beforeBatch)await beforeBatch({tenantId,operationId,invoiceId});
      let result;
      try{
        result=await DB.batch([
          DB.prepare(SQL_POST).bind(tenantId,invoiceId,operationId,actorId,
            payloadHash,sku,units,grand,paid,due,customerId,paymentJson,
            tenantId,tenantId,sku,units,due,tenantId,customerId,
            paymentJson,tenantId),
          DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
        ]);
      }catch{
        // D1 may have committed before a response was lost. Never infer zero
        // side effects from an exception, or assign a new operation ID.
        throw new Error('NEEDS_REVIEW: sale batch outcome uncertain; reconcile operation ID');
      }
      if(!Array.isArray(result) || result.length!==2)
        throw new Error('NEEDS_REVIEW: missing sale result; reconcile operation ID');
      const [claimed,lookup]=result.map(dataRows);
      const existing=lookup.length===1?lookup[0]:null;
      if(claimed.length===1 && existing?.invoice_id===invoiceId &&
        existing?.payload_hash===payloadHash && existing?.actor_id===actorId)
        return {status:'COMMITTED',operationId,invoiceId};
      if(claimed.length===0){
        if(lookup.length===0)return {status:'DECLINED',operationId};
        if(existing && existing.actor_id===actorId && existing.payload_hash===payloadHash)
          return {status:'REPLAY',operationId,invoiceId:existing.invoice_id};
        if(existing)return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: ambiguous sale posting result; reconcile operation ID');
    }
  });
}
