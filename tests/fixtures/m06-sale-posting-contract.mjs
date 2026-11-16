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
  payload_hash,sku,units,grand_paisa,paid_paisa,due_paisa,customer_id,payments_json,
  unit_price_paisa,discount_paisa,source_draft_id,source_draft_version)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
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
 AND (?='' OR EXISTS (SELECT 1 FROM m06_drafts d WHERE d.tenant_id=?
   AND d.draft_id=? AND d.version=? AND d.owner_id=? AND d.payment_mode='Split'
   AND d.sku=? AND d.units=? AND d.unit_price_paisa=? AND d.discount_paisa=?
   AND d.customer_id=? AND d.payments_json=?))
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
  const keys=plain(input)?Reflect.ownKeys(input).sort().join(','):'';
  const normal='actorId,customerId,discount,invoiceId,operationId,payments,sku,tenantId,unitPrice,units';
  const withDraft='actorId,customerId,discount,invoiceId,operationId,payments,sku,sourceDraftId,sourceDraftVersion,tenantId,unitPrice,units';
  const hasDraft=keys===withDraft;
  if((keys!==normal && !hasDraft) ||
    (hasDraft && (!SIMPLE_ID.test(input.sourceDraftId||'') ||
      !Number.isSafeInteger(input.sourceDraftVersion) ||
      input.sourceDraftVersion<1 || input.sourceDraftVersion>1_000_000)) ||
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

/**
 * Read-only proof for a replayed, already-posted synthetic sale. Original
 * invoice identity alone does not prove the child Cash/Bank/Customer records
 * survived intact. These are fixed, tenant-scoped SQL selectors, not caller SQL.
 */
async function verifyReplayReceipt(DB,{
  tenantId,invoiceId,sku,units,customerId,due,children,
  sourceDraftId,sourceDraftVersion,actorId
}){
  const expectedPayments=children.map(p=>({
    row_id:p.rowId,row_order:p.rowOrder,method:p.method,
    account_id:p.accountId,tender_paisa:p.tenderPaisa,
    applied_paisa:p.appliedPaisa,change_paisa:p.changePaisa
  })).sort((a,b)=>a.row_order-b.row_order);
  const byRowId=(a,b)=>a.row_id<b.row_id?-1:a.row_id>b.row_id?1:0;
  const expectedCash=children.filter(p=>p.method==='Cash'&&p.appliedPaisa>0)
    .map(p=>({row_id:p.rowId,credit_paisa:p.appliedPaisa})).sort(byRowId);
  const expectedBank=children.filter(p=>p.method!=='Cash'&&p.appliedPaisa>0)
    .map(p=>({row_id:p.rowId,account_id:p.accountId,credit_paisa:p.appliedPaisa}))
    .sort(byRowId);
  const checks=[
    {
      sql:'SELECT sku,units FROM m06_sale_items WHERE tenant_id=? AND invoice_id=? ORDER BY sku',
      rows:[{sku,units}]
    },{
      sql:'SELECT sku,units_out FROM m06_stock_movements WHERE tenant_id=? AND invoice_id=? ORDER BY sku',
      rows:[{sku,units_out:units}]
    },{
      sql:'SELECT row_id,row_order,method,account_id,tender_paisa,applied_paisa,change_paisa FROM m06_payment_children WHERE tenant_id=? AND invoice_id=? ORDER BY row_order',
      rows:expectedPayments
    },{
      sql:'SELECT row_id,credit_paisa FROM m06_cash_book WHERE tenant_id=? AND invoice_id=? ORDER BY row_id',
      rows:expectedCash
    },{
      sql:'SELECT row_id,account_id,credit_paisa FROM m06_bank_book WHERE tenant_id=? AND invoice_id=? ORDER BY row_id',
      rows:expectedBank
    },{
      sql:'SELECT customer_id,debit_paisa FROM m06_customer_ledger WHERE tenant_id=? AND invoice_id=? ORDER BY customer_id',
      rows:due>0?[{customer_id:customerId,debit_paisa:due}]:[]
    },{
      sql:'SELECT draft_id,version,invoice_id,actor_id,action FROM m06_draft_audit WHERE tenant_id=? AND invoice_id=? ORDER BY draft_id',
      rows:sourceDraftId?[{
        draft_id:sourceDraftId,version:sourceDraftVersion,
        invoice_id:invoiceId,actor_id:actorId,action:'POSTED'
      }]:[]
    }
  ];
  // A consumed source draft must remain absent. A stale reimport under its
  // original ID is an unresolved inconsistency, not proof of clean replay.
  if(sourceDraftId)checks.push({
    sql:'SELECT draft_id FROM m06_drafts WHERE tenant_id=? AND draft_id=?',
    rows:[],draftId:sourceDraftId
  });
  try{
    // One read-only D1 batch observes a consistent synthetic receipt snapshot;
    // this is not a replacement for the authoritative atomic posting boundary.
    const proof=await DB.batch(checks.map(c=>
      DB.prepare(c.sql).bind(tenantId,c.draftId??invoiceId)));
    if(!Array.isArray(proof)||proof.length!==checks.length)
      throw new Error('Missing posted sale evidence');
    for(let i=0;i<checks.length;i++){
      const actual=dataRows(proof[i]);
      if(JSON.stringify(actual)!==JSON.stringify(checks[i].rows))
        throw new Error('Posted sale child mismatch');
    }
  }catch{
    throw new Error('NEEDS_REVIEW: posted sale receipt integrity mismatch; reconcile operation ID');
  }
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
      const sourceDraftId=Object.hasOwn(input,'sourceDraftId')?input.sourceDraftId:'';
      const sourceDraftVersion=sourceDraftId?input.sourceDraftVersion:0;
      // A prior operation is historical evidence, not permission for a new
      // payment. Only the same actor may normalize its now-inactive account;
      // intent hashing, exact receipt readback and SQL's live bank guard stay.
      const prior=await DB.prepare(SQL_LOOKUP).bind(tenantId,operationId).first();
      if(prior && prior.actor_id!==actorId)
        return {status:'CONFLICT',operationId};
      const historicalReplay=Boolean(prior);
      // A read can become stale: the SAME SQL posting statement must repeat
      // every bank/customer/stock/session guard. This read grants NO authority.
      const trustedBankRows=(await DB.prepare(SQL_ACCOUNTS).bind(tenantId).all()).results.map(a=>({
        'Bank Account ID':a.account_id,'Account Name':a.account_name,
        'Account Type':a.method,
        Status:a.active===1||historicalReplay?'Active':'Inactive','Is Deleted':'FALSE'
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
      if(sourceDraftId){
        payload.sourceDraftId=sourceDraftId;
        payload.sourceDraftVersion=sourceDraftVersion;
      }
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
            price,discount,sourceDraftId,sourceDraftVersion,
            tenantId,tenantId,sku,units,due,tenantId,customerId,
            paymentJson,tenantId,
            sourceDraftId,tenantId,sourceDraftId,sourceDraftVersion,actorId,
            sku,units,price,discount,customerId,paymentJson),
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
        if(existing && existing.actor_id===actorId && existing.payload_hash===payloadHash){
          await verifyReplayReceipt(DB,{
            tenantId,invoiceId:existing.invoice_id,sku,units,customerId,
            due,children,sourceDraftId,sourceDraftVersion,actorId
          });
          return {status:'REPLAY',operationId,invoiceId:existing.invoice_id};
        }
        if(existing)return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: ambiguous sale posting result; reconcile operation ID');
    }
  });
}
