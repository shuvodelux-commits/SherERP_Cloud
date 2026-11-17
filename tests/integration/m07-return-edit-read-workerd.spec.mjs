import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';
import {createSyntheticD1StoreCreditContract} from '../fixtures/m07-store-credit-contract.mjs';
import {createSyntheticD1CashReturnDeleteContract} from '../fixtures/m07-cash-delete-contract.mjs';
import {createSyntheticD1CreditDeleteContract} from '../fixtures/m07-credit-delete-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,
  M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {M07_CASH_DELETE_TEST_DDL,M07_CASH_DELETE_IMMUTABLE_TABLES,
  M07_CASH_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-cash-delete-schema.mjs';
import {M07_CREDIT_DELETE_TEST_DDL,M07_CREDIT_DELETE_IMMUTABLE_TABLES,
  M07_CREDIT_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-credit-delete-schema.mjs';
import {M07_RETURN_EDIT_READ_DDL} from '../fixtures/m07-return-edit-read-schema.mjs';
import {M07_CASH_PRICE_EDIT_DDL,M07_CASH_PRICE_EDIT_IMMUTABLE,
  M07_CASH_PRICE_EDIT_IMMUTABLE_DDL} from '../fixtures/m07-cash-price-edit-schema.mjs';
import {M07_CREDIT_PRICE_EDIT_DDL,M07_CREDIT_PRICE_EDIT_IMMUTABLE,
  M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL} from '../fixtures/m07-credit-price-edit-schema.mjs';
import {createSyntheticD1CashPriceEditContract} from '../fixtures/m07-cash-price-edit-contract.mjs';
import {createSyntheticD1CreditPriceEditContract} from '../fixtures/m07-credit-price-edit-contract.mjs';
import {createSyntheticD1ReturnEditReader} from '../fixtures/m07-return-edit-read-contract.mjs';

// No production RPC, no M04 permissions: only a source-shaped read-only D1 proof.
const server=createTestHarness({workers:[{configPath:'./wrangler.m07-return-edit-read-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-return-edit-read-workerd-test');
let DB;
const first=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const reader=()=>createSyntheticD1ReturnEditReader(DB);
const get=(tenantId,returnId)=>reader().getReturnForEdit({tenantId,returnId});

async function seed(kind='Cash',id='A'){
  const tenantId='SHOP-A',invoiceId='INV-EDIT-'+id,sku='PIPE',
    lotId='LOT-EDIT-'+id,returnId='RET-EDIT-'+id,customerId='CUS-1';
  const sale=await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'SALE-CLERK',operationId:'OP-SALE-EDIT-'+id+'-00001',
    invoiceId,sku,units:2,unitPrice:'100.00',discount:'0',
    customerId,payments:[]
  });
  assert.equal(sale.status,'COMMITTED');
  const {payload_hash:originalHash}=
    await DB.prepare('SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?')
      .bind(tenantId,invoiceId).first();
  await DB.prepare('INSERT INTO m07_source_lots VALUES(?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,2).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES(?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  if(kind==='Store Credit'){
    for(const c of ['CUS-1','CUS-2']){
      const account=await DB.prepare('SELECT party_id,due_paisa FROM m06_customer_accounts WHERE tenant_id=? AND customer_id=?')
        .bind(tenantId,c).first();
      await DB.prepare('INSERT INTO m07_customer_signed_accounts VALUES(?,?,?,?,1)')
        .bind(tenantId,c,account.party_id,account.due_paisa).run();
    }
  }
  const input={tenantId,actorId:'RETURN-CLERK',
    operationId:'OP-RETURN-EDIT-'+id+'-00001',returnId,invoiceId,sku,lotId,
    originalHash,units:1,reason:'Damaged fitting'};
  const effect=kind==='Cash'?{refundPaisa:7500}:{creditPaisa:7500,customerId};
  const post=kind==='Cash'
    ?createSyntheticD1CashReturnContract(DB)
    :createSyntheticD1StoreCreditContract(DB);
  assert.equal((await post.post({...input,...effect})).status,'COMMITTED');
  return {...input,...effect,kind,customerId};
}
const snapshot=async()=>{
  const queries={
    invoices:'SELECT * FROM m06_invoices ORDER BY invoice_id',
    items:'SELECT * FROM m06_sale_items ORDER BY invoice_id',
    stock:'SELECT * FROM m06_owned_stock ORDER BY sku',
    cash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
    bank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
    customer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    source:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lots:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    returnsCash:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    returnsCredit:'SELECT * FROM m07_credit_returns ORDER BY return_id',
    moves:'SELECT * FROM m07_return_movements ORDER BY return_id',
    refunds:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    creditLedger:'SELECT * FROM m07_credit_ledger ORDER BY return_id',
    signed:'SELECT * FROM m07_customer_signed_accounts ORDER BY customer_id',
    cashDelete:'SELECT * FROM m07_cash_delete_receipts ORDER BY return_id',
    creditDelete:'SELECT * FROM m07_credit_delete_receipts ORDER BY return_id',
    versions:'SELECT * FROM m07_return_edit_versions ORDER BY return_id',
    cashRevisions:'SELECT * FROM m07_cash_price_edit_receipts ORDER BY next_version',
    cashAdjustments:'SELECT * FROM m07_cash_price_edit_adjustments ORDER BY next_version',
    creditRevisions:'SELECT * FROM m07_credit_price_edit_receipts ORDER BY next_version',
    creditAdjustments:'SELECT * FROM m07_credit_price_edit_ledger ORDER BY next_version'
  };
  const snap={};
  for(const [key,sql] of Object.entries(queries))snap[key]=await all(sql);
  return snap;
};
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const q of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
    ...M07_CASH_DELETE_TEST_DDL,...M07_CREDIT_DELETE_TEST_DDL,
    ...M07_RETURN_EDIT_READ_DDL,...M07_CASH_PRICE_EDIT_DDL,
    ...M07_CREDIT_PRICE_EDIT_DDL,...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL,
    ...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])await DB.prepare(q).run();
  for(const [q,bind] of M06_SALE_TEST_SEED)await DB.prepare(q).bind(...bind).run();
});
beforeEach(async()=>{
  for(const t of [...M07_CASH_DELETE_IMMUTABLE_TABLES,...M07_CREDIT_DELETE_IMMUTABLE_TABLES,
    ...M07_CASH_PRICE_EDIT_IMMUTABLE,...M07_CREDIT_PRICE_EDIT_IMMUTABLE]){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
  }
  for(const t of M06_CHILD_IMMUTABILITY_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
  }
  for(const t of ['m07_receipt_immutable_delete','m07_credit_immutable_delete','m06_invoice_immutable_delete']){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
  }
  for(const table of [
    'm07_cash_price_edit_adjustments','m07_cash_price_edit_dependencies',
    'm07_cash_price_edit_receipts','m07_credit_price_edit_ledger',
    'm07_credit_price_edit_dependencies','m07_credit_price_edit_receipts',
    'm07_return_edit_versions',
    'm07_cash_delete_offsets','m07_cash_delete_stock_undo','m07_cash_delete_receipts',
    'm07_credit_delete_ledger','m07_credit_delete_stock_undo','m07_credit_delete_receipts',
    'm07_credit_delete_dependencies','m07_credit_ledger','m07_credit_returns',
    'm07_cash_refunds','m07_return_movements','m07_cash_returns',
    'm07_lot_stock','m07_source_lots','m07_customer_signed_accounts',
    'm06_customer_ledger','m06_bank_book','m06_cash_book',
    'm06_payment_children','m06_stock_movements','m06_sale_items','m06_invoices'
  ])await DB.prepare(`DELETE FROM ${table}`).run();
  for(const q of [...M06_CHILD_IMMUTABILITY_DDL,...M07_CASH_DELETE_IMMUTABLE_DDL,
    ...M07_CREDIT_DELETE_IMMUTABLE_DDL,...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL,
    ...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])await DB.prepare(q).run();
  for(const q of [
    "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-cash'); END",
    "CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns BEGIN SELECT RAISE(ABORT,'immutable-credit'); END",
    "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'immutable-invoice'); END"
  ])await DB.prepare(q).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>server.close());

test('Cash Return for edit: source header, one item, original invoice and zero version; no writes',async()=>{
  const s=await seed('Cash'),before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{
    status:'OK',data:{
      header:{returnId:s.returnId,invoiceId:s.invoiceId,refundMethod:'Cash',
        customerId:'CUS-1',reason:s.reason,totalReturnPaisa:7500},
      items:[{sku:'PIPE',lotId:s.lotId,quantity:1,amountPaisa:7500}],
      invoice:{invoiceId:s.invoiceId,sku:'PIPE',soldUnits:2,
        unitPricePaisa:10000,grandPaisa:20000,customerId:'CUS-1'},
      version:0,editable:true
    }
  });
  assert.deepEqual(await snapshot(),before);
});

test('Store Credit Return for edit: linked Customer account, original lot and positive edit version',async()=>{
  const s=await seed('Store Credit');
  await DB.prepare('INSERT INTO m07_return_edit_versions VALUES(?,?,?)')
    .bind('SHOP-A',s.returnId,4).run();
  const before=await snapshot();
  const out=await get('SHOP-A',s.returnId);
  assert.equal(out.status,'OK');
  assert.equal(out.data.header.refundMethod,'Store Credit');
  assert.equal(out.data.header.totalReturnPaisa,7500);
  assert.equal(out.data.header.customerId,'CUS-1');
  assert.equal(out.data.items[0].lotId,s.lotId);
  assert.equal(out.data.version,4);
  assert.deepEqual(await snapshot(),before);
});

test('edit view remains readable while Cash Session is Closed; mutation permission is separate',async()=>{
  const s=await seed('Cash');
  await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  const before=await snapshot();
  assert.equal((await get('SHOP-A',s.returnId)).status,'OK');
  assert.deepEqual(await snapshot(),before);
});

test('delete Cash Return keeps immutable history but removes editable projection',async()=>{
  const s=await seed('Cash');
  assert.equal((await createSyntheticD1CashReturnDeleteContract(DB).post({
    tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-CASH-EDIT-DELETE-001',
    returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,
    lotId:s.lotId,originalHash:s.originalHash,units:s.units,
    refundPaisa:s.refundPaisa,reason:'Reverse erroneous return'
  })).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'DELETED'});
  assert.equal(before.returnsCash.length,1);
  assert.equal(before.cashDelete.length,1);
  assert.deepEqual(await snapshot(),before);
});

test('delete Store Credit Return removes edit surface but retains original ledger audit',async()=>{
  const s=await seed('Store Credit');
  assert.equal((await createSyntheticD1CreditDeleteContract(DB).post({
    tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-CREDIT-EDIT-DELETE-001',
    returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,
    lotId:s.lotId,originalHash:s.originalHash,customerId:s.customerId,
    units:s.units,creditPaisa:s.creditPaisa,reason:'Reverse erroneous credit'
  })).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'DELETED'});
  assert.equal(before.returnsCredit.length,1);
  assert.equal(before.creditLedger.length,1);
  assert.equal(before.creditDelete.length,1);
  assert.deepEqual(await snapshot(),before);
});

test('unknown and different tenant returns are not disclosed',async()=>{
  const s=await seed('Cash');
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A','RET-NOT-FOUND'),{status:'NOT_FOUND'});
  assert.deepEqual(await get('SHOP-B',s.returnId),{status:'NOT_FOUND'});
  assert.deepEqual(await snapshot(),before);
});

test('Cash Return missing original stock movement fails closed as Needs Review',async()=>{
  const s=await seed('Cash');
  await DB.prepare('DELETE FROM m07_return_movements WHERE tenant_id=? AND return_id=?')
    .bind('SHOP-A',s.returnId).run();
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('Cash refund mismatch cannot become a trusted edit preview',async()=>{
  const s=await seed('Cash');
  await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=7400 WHERE return_id=?')
    .bind(s.returnId).run();
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('original lot provenance drift blocks edit rather than guessing FIFO',async()=>{
  const s=await seed('Cash');
  await DB.prepare('UPDATE m07_source_lots SET sold_units=3 WHERE tenant_id=? AND invoice_id=?')
    .bind('SHOP-A',s.invoiceId).run();
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('Store Credit ledger drift and reassigned Customer Party link reject edit preview',async()=>{
  const s=await seed('Store Credit');
  await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7400 WHERE return_id=?')
    .bind(s.returnId).run();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'NEEDS_REVIEW'});
  await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7500 WHERE return_id=?')
    .bind(s.returnId).run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-A',s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('malformed IDs, client-side SQL and unauthoritative edit fields reject before D1',async()=>{
  const s=await seed('Cash'),before=await snapshot();
  for(const bad of [null,{}, {tenantId:'',returnId:s.returnId},
    {tenantId:'SHOP-A',returnId:''},
    {tenantId:'SHOP-A',returnId:s.returnId,actorId:'FORGED'},
    {tenantId:'SHOP-A',returnId:s.returnId,expectedVersion:99},
    {tenantId:'SHOP-A',returnId:s.returnId,sql:'DELETE FROM m07_cash_returns'}])
    await assert.rejects(()=>reader().getReturnForEdit(bad),/invalid|shape|synthetic/i);
  assert.deepEqual(await snapshot(),before);
});

test('synthetic Worker has no public getReturnForEdit HTTP/RPC endpoint',async()=>{
  const s=await seed('Cash'),before=await snapshot();
  assert.equal((await worker.fetch('https://m07.local/getReturnForEdit',{
    method:'POST',body:JSON.stringify({tenantId:'SHOP-A',returnId:s.returnId})
  })).status,404);
  assert.deepEqual(await snapshot(),before);
});

const cashRevision=(s,operationId,patch={})=>({
  tenantId:s.tenantId,actorId:'MANAGER',operationId,
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,expectedVersion:0,previousRefundPaisa:7500,
  newRefundPaisa:6800,reason:'Correct refund price after review',...patch
});
const creditRevision=(s,operationId,patch={})=>({
  tenantId:s.tenantId,actorId:'MANAGER',operationId,
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,customerId:s.customerId,
  expectedVersion:0,previousCreditPaisa:7500,
  newCreditPaisa:6800,reason:'Correct store credit price after review',...patch
});

test('Cash correction readback shows latest of two immutable revisions, not original refund',async()=>{
  const s=await seed('Cash');
  assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(
    cashRevision(s,'OP-M07-B10-CASH-ONE-001'))).status,'COMMITTED');
  assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(
    cashRevision(s,'OP-M07-B10-CASH-TWO-001',{
      expectedVersion:1,previousRefundPaisa:6800,newRefundPaisa:7200
    }))).status,'COMMITTED');
  const before=await snapshot(),result=await get(s.tenantId,s.returnId);
  assert.equal(result.status,'OK');
  assert.equal(result.data.version,2);
  assert.equal(result.data.header.totalReturnPaisa,7200);
  assert.equal(result.data.items[0].amountPaisa,7200);
  assert.equal(before.refunds[0].debit_paisa,7500);
  assert.deepEqual(before.cashAdjustments.map(x=>[x.debit_paisa,x.credit_paisa]),
    [[0,700],[400,0]]);
  assert.deepEqual(await snapshot(),before);
});

test('Store Credit correction readback shows latest of two versions without rewriting original ledger',async()=>{
  const s=await seed('Store Credit');
  assert.equal((await createSyntheticD1CreditPriceEditContract(DB).post(
    creditRevision(s,'OP-M07-B10-CREDIT-ONE-001'))).status,'COMMITTED');
  assert.equal((await createSyntheticD1CreditPriceEditContract(DB).post(
    creditRevision(s,'OP-M07-B10-CREDIT-TWO-001',{
      expectedVersion:1,previousCreditPaisa:6800,newCreditPaisa:7200
    }))).status,'COMMITTED');
  const before=await snapshot(),result=await get(s.tenantId,s.returnId);
  assert.equal(result.status,'OK');
  assert.equal(result.data.version,2);
  assert.equal(result.data.header.refundMethod,'Store Credit');
  assert.equal(result.data.header.totalReturnPaisa,7200);
  assert.equal(result.data.items[0].amountPaisa,7200);
  assert.equal(before.creditLedger[0].credit_paisa,7500);
  assert.equal(before.signed.find(x=>x.customer_id==='CUS-1').signed_due_paisa,12800);
  assert.deepEqual(before.creditAdjustments.map(x=>[x.debit_paisa,x.credit_paisa]),[[700,0],[0,400]]);
  assert.deepEqual(await snapshot(),before);
});

test('Cash revision adjustment drift fails closed instead of showing the original refund',async()=>{
  const s=await seed('Cash');
  assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(
    cashRevision(s,'OP-M07-B10-CASH-DRIFT-001'))).status,'COMMITTED');
  // Synthetic evidence tamper: original refund remains immutable.
  await DB.prepare('DROP TRIGGER m07_cash_price_edit_adjustments_immutable_update').run();
  await DB.prepare('UPDATE m07_cash_price_edit_adjustments SET credit_paisa=500 WHERE return_id=?')
    .bind(s.returnId).run();
  const before=await snapshot();
  assert.deepEqual(await get(s.tenantId,s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('Store Credit revised signed Customer balance drift fails closed',async()=>{
  const s=await seed('Store Credit');
  assert.equal((await createSyntheticD1CreditPriceEditContract(DB).post(
    creditRevision(s,'OP-M07-B10-CREDIT-DRIFT-001'))).status,'COMMITTED');
  await DB.prepare("UPDATE m07_customer_signed_accounts SET signed_due_paisa=signed_due_paisa+1 WHERE customer_id='CUS-1'").run();
  const before=await snapshot();
  assert.deepEqual(await get(s.tenantId,s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('missing latest Store Credit adjustment row cannot create a valid edit preview',async()=>{
  const s=await seed('Store Credit');
  assert.equal((await createSyntheticD1CreditPriceEditContract(DB).post(
    creditRevision(s,'OP-M07-B10-CREDIT-MISSING-001'))).status,'COMMITTED');
  await DB.prepare('DROP TRIGGER m07_credit_price_edit_ledger_immutable_delete').run();
  await DB.prepare('DELETE FROM m07_credit_price_edit_ledger WHERE return_id=?')
    .bind(s.returnId).run();
  const before=await snapshot();
  assert.deepEqual(await get(s.tenantId,s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('version drift after a valid Cash revision is rejected; no historical rewrite',async()=>{
  const s=await seed('Cash');
  assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(
    cashRevision(s,'OP-M07-B10-VERSION-DRIFT-001'))).status,'COMMITTED');
  await DB.prepare('UPDATE m07_return_edit_versions SET edit_version=9 WHERE return_id=?')
    .bind(s.returnId).run();
  const before=await snapshot();
  assert.deepEqual(await get(s.tenantId,s.returnId),{status:'NEEDS_REVIEW'});
  assert.deepEqual(await snapshot(),before);
});

test('tenant isolation holds for corrected Cash Return and read-only method',async()=>{
  const s=await seed('Cash');
  assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(
    cashRevision(s,'OP-M07-B10-TENANT-TEST-001'))).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await get('SHOP-B',s.returnId),{status:'NOT_FOUND'});
  assert.deepEqual(await snapshot(),before);
});
