import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL} from '../fixtures/m06-sale-posting-schema.mjs';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';
import {createSyntheticD1StoreCreditContract} from '../fixtures/m07-store-credit-contract.mjs';
import {M07_CASH_DELETE_TEST_DDL,M07_CASH_DELETE_IMMUTABLE_TABLES,M07_CASH_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-cash-delete-schema.mjs';
import {M07_CREDIT_DELETE_TEST_DDL,M07_CREDIT_DELETE_IMMUTABLE_TABLES,M07_CREDIT_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-credit-delete-schema.mjs';
import {createSyntheticD1CashReturnDeleteContract} from '../fixtures/m07-cash-delete-contract.mjs';
import {createSyntheticD1CreditDeleteContract} from '../fixtures/m07-credit-delete-contract.mjs';
import {M07_RETURN_EDIT_READ_DDL} from '../fixtures/m07-return-edit-read-schema.mjs';
import {M07_CASH_PRICE_EDIT_DDL,M07_CASH_PRICE_EDIT_IMMUTABLE,M07_CASH_PRICE_EDIT_IMMUTABLE_DDL} from '../fixtures/m07-cash-price-edit-schema.mjs';
import {M07_CREDIT_PRICE_EDIT_DDL,M07_CREDIT_PRICE_EDIT_IMMUTABLE,M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL} from '../fixtures/m07-credit-price-edit-schema.mjs';
import {createSyntheticD1CashPriceEditContract} from '../fixtures/m07-cash-price-edit-contract.mjs';
import {createSyntheticD1ReturnQuantityPreflight} from '../fixtures/m07-quantity-preflight-contract.mjs';

// No correction writer, public RPC or production D1; only a source-safe local read proof.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-quantity-preflight-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-quantity-preflight-workerd-test');
let DB;
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const preflight=()=>createSyntheticD1ReturnQuantityPreflight(DB);
const plan=(s,newUnits,patch={})=>preflight().plan({
 tenantId:s.tenantId,returnId:s.returnId,newUnits,expectedVersion:0,...patch
});
async function source(kind='Cash',returnUnits=2,id='A'){
 const tenantId='SHOP-A',invoiceId='INV-QTY-'+id,returnId='RET-QTY-'+id,
  sku='PIPE',lotId='LOT-QTY-'+id,customerId='CUS-1';
 const sale={tenantId,actorId:'SALE-CLERK',
  operationId:'OP-QTY-SALE-'+id+'-0001',invoiceId,sku,units:3,
  unitPrice:'100.00',discount:'0',customerId,payments:[]};
 assert.equal((await createSyntheticD1SalePostingContract(DB).post(sale)).status,'COMMITTED');
 const {payload_hash:originalHash}=await DB.prepare(
  'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
 ).bind(tenantId,invoiceId).first();
 await DB.prepare('INSERT INTO m07_source_lots VALUES(?,?,?,?,?,0)')
  .bind(tenantId,invoiceId,sku,lotId,3).run();
 await DB.prepare('INSERT INTO m07_lot_stock VALUES(?,?,?,0)')
  .bind(tenantId,lotId,sku).run();
 if(kind==='Store Credit'){
  for(const c of ['CUS-1','CUS-2']){
   const row=await DB.prepare('SELECT party_id,due_paisa FROM m06_customer_accounts WHERE tenant_id=? AND customer_id=?')
    .bind(tenantId,c).first();
   await DB.prepare('INSERT INTO m07_customer_signed_accounts VALUES(?,?,?,?,1)')
    .bind(tenantId,c,row.party_id,row.due_paisa).run();
  }
 }
 const returnInput={tenantId,actorId:'RETURN-CLERK',operationId:'OP-QTY-RETURN-'+id+'-001',
  returnId,invoiceId,sku,lotId,originalHash,units:returnUnits,
  reason:'Defective material'};
 const amount=7500*returnUnits;
 const effect=kind==='Cash'?{refundPaisa:amount}:{creditPaisa:amount,customerId};
 const writer=kind==='Cash'?
  createSyntheticD1CashReturnContract(DB):createSyntheticD1StoreCreditContract(DB);
 assert.equal((await writer.post({...returnInput,...effect})).status,'COMMITTED');
 return {...returnInput,...effect,kind,customerId};
}
const protectedTables=[
 'm06_invoices','m06_sale_items','m06_stock_movements','m06_cash_book','m06_bank_book',
 'm06_customer_accounts','m06_supplier_accounts','m06_owned_stock','m06_cash_sessions',
 'm06_party_links','m07_source_lots','m07_lot_stock','m07_cash_returns','m07_credit_returns',
 'm07_return_movements','m07_cash_refunds','m07_credit_ledger','m07_customer_signed_accounts',
 'm07_cash_delete_receipts','m07_credit_delete_receipts','m07_return_edit_versions',
 'm07_cash_price_edit_receipts','m07_credit_price_edit_receipts'
];
const snapshot=async()=>{
 const result={};
 for(const table of protectedTables)result[table]=await all('SELECT * FROM '+table+' ORDER BY rowid');
 return result;
};
before(async()=>{
 await harness.listen();({DB}=await worker.getEnv());
 for(const sql of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
  ...M07_CASH_DELETE_TEST_DDL,...M07_CREDIT_DELETE_TEST_DDL,
  ...M07_RETURN_EDIT_READ_DDL,...M07_CASH_PRICE_EDIT_DDL,...M07_CREDIT_PRICE_EDIT_DDL,
  ...M07_CASH_DELETE_IMMUTABLE_DDL,...M07_CREDIT_DELETE_IMMUTABLE_DDL,
  ...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL,...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])
  await DB.prepare(sql).run();
 for(const [sql,values] of M06_SALE_TEST_SEED)
  await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
 for(const table of [...M06_CHILD_IMMUTABILITY_TABLES,...M07_CASH_DELETE_IMMUTABLE_TABLES,
  ...M07_CREDIT_DELETE_IMMUTABLE_TABLES,...M07_CASH_PRICE_EDIT_IMMUTABLE,
  ...M07_CREDIT_PRICE_EDIT_IMMUTABLE]){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_delete`).run();
 }
 for(const t of ['m06_invoice_immutable_delete','m07_receipt_immutable_delete',
  'm07_credit_immutable_delete'])await DB.prepare('DROP TRIGGER IF EXISTS '+t).run();
 for(const table of [
  'm07_cash_price_edit_adjustments','m07_cash_price_edit_dependencies','m07_cash_price_edit_receipts',
  'm07_credit_price_edit_ledger','m07_credit_price_edit_dependencies','m07_credit_price_edit_receipts',
  'm07_return_edit_versions','m07_cash_delete_offsets','m07_cash_delete_stock_undo',
  'm07_cash_delete_receipts','m07_credit_delete_ledger','m07_credit_delete_stock_undo',
  'm07_credit_delete_receipts','m07_credit_delete_dependencies',
  'm07_credit_ledger','m07_credit_returns','m07_cash_refunds',
  'm07_return_movements','m07_cash_returns','m07_lot_stock','m07_source_lots',
  'm07_customer_signed_accounts',
  'm06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
  'm06_stock_movements','m06_sale_items','m06_invoices'
 ])await DB.prepare('DELETE FROM '+table).run();
 for(const ddl of [...M06_CHILD_IMMUTABILITY_DDL,...M07_CASH_DELETE_IMMUTABLE_DDL,
  ...M07_CREDIT_DELETE_IMMUTABLE_DDL,...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL,
  ...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])await DB.prepare(ddl).run();
 for(const ddl of [
  "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'immutable-invoice'); END",
  "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-cash-return'); END",
  "CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns BEGIN SELECT RAISE(ABORT,'immutable-credit-return'); END"
 ])await DB.prepare(ddl).run();
 await DB.prepare("UPDATE m06_owned_stock SET available=CASE WHEN sku='PIPE' THEN 6 ELSE 4 END").run();
 await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
 await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
 await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>harness.close());

test('Cash quantity reduction plans restoring-lot removal only, without writes',async()=>{
 const s=await source('Cash',2),before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'PLAN_ONLY',data:{
  returnId:s.returnId,invoiceId:s.invoiceId,refundMethod:'Cash',
  lotId:s.lotId,oldUnits:2,newUnits:1,deltaUnits:-1,
  action:'REMOVE_RETURNED_STOCK',editVersion:0,readOnly:true,commitAuthorized:false}});
 assert.deepEqual(await snapshot(),before);
});

test('Cash quantity increase within source sold capacity plans positive restoration',async()=>{
 const s=await source('Cash',1),before=await snapshot();
 const r=await plan(s,3);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.deltaUnits,2);
 assert.equal(r.data.action,'RESTORE_ORIGINAL_LOT');
 assert.deepEqual(await snapshot(),before);
});

test('Store Credit quantity decrease requires original Customer evidence but never changes signed due',async()=>{
 const s=await source('Store Credit',2),before=await snapshot();
 const r=await plan(s,1);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.refundMethod,'Store Credit');
 assert.equal(r.data.deltaUnits,-1);
 assert.deepEqual(await snapshot(),before);
});

test('Store Credit quantity increase stays read only; negative/advance accounting is not inferred',async()=>{
 const s=await source('Store Credit',1),before=await snapshot();
 const r=await plan(s,3);
 assert.equal(r.status,'PLAN_ONLY');
 assert.equal(r.data.action,'RESTORE_ORIGINAL_LOT');
 assert.deepEqual(await snapshot(),before);
});

test('additional active return on same lot consumes original sale capacity',async()=>{
 const s=await source('Cash',1);
 const sibling={tenantId:s.tenantId,actorId:'SECOND-CLERK',
  operationId:'OP-QTY-SIBLING-0001',returnId:'RET-QTY-SIBLING-0001',
  invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,originalHash:s.originalHash,
  units:1,refundPaisa:7500,reason:'Additional defective material'};
 assert.equal((await createSyntheticD1CashReturnContract(DB).post(sibling)).status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await plan(s,3),{status:'DECLINED'});
 assert.equal((await plan(s,2)).status,'PLAN_ONLY');
 assert.deepEqual(await snapshot(),before);
});

test('decrease declines when original returned lot was resold even if shop has other stock',async()=>{
 const s=await source('Cash',2);
 await DB.prepare('UPDATE m07_lot_stock SET available=0 WHERE lot_id=?').bind(s.lotId).run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('decrease declines when total shop stock insufficient despite available restored lot',async()=>{
 const s=await source('Cash',2);
 await DB.prepare("UPDATE m06_owned_stock SET available=0 WHERE sku='PIPE'").run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('absent original movement or inconsistent restored source lot fails Needs Review',async()=>{
 const s=await source('Cash',2);
 await DB.prepare('DELETE FROM m07_return_movements WHERE tenant_id=? AND return_id=?')
  .bind(s.tenantId,s.returnId).run();
 let before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 assert.deepEqual(await snapshot(),before);
 await DB.prepare('INSERT INTO m07_return_movements VALUES(?,?,?,?,?,?)')
  .bind(s.tenantId,s.returnId,s.invoiceId,s.sku,s.lotId,2).run();
 await DB.prepare('UPDATE m07_source_lots SET returned_units=1 WHERE invoice_id=?')
  .bind(s.invoiceId).run();
 before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 assert.deepEqual(await snapshot(),before);
});

test('Cash refund drift and original source fingerprint drift block quantity preflight',async()=>{
 const s=await source('Cash',2);
 await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=14900').run();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=15000').run();
 await DB.prepare("UPDATE m06_invoices SET payload_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'").run().catch(()=>{});
 // Original invoice immutability is enforced; mutate only through a temporary
 // explicit local test trigger removal rather than weaken the production source.
 await DB.prepare('DROP TRIGGER m06_invoice_immutable_update').run();
 await DB.prepare("UPDATE m06_invoices SET payload_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'").run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 assert.deepEqual(await snapshot(),before);
 await DB.prepare(`CREATE TRIGGER m06_invoice_immutable_update BEFORE UPDATE ON m06_invoices
 BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`).run();
});

test('reviewed Customer role and original credit ledger are mandatory for Store Credit',async()=>{
 const s=await source('Store Credit',2);
 await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 await DB.prepare("UPDATE m06_party_links SET reviewed=1 WHERE source_id='CUS-1'").run();
 await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=14900').run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'NEEDS_REVIEW'});
 assert.deepEqual(await snapshot(),before);
});

test('later Store Credit Customer ledger/settlement dependencies block quantity preflight',async()=>{
 const s=await source('Store Credit',2);
 await DB.prepare('INSERT INTO m07_credit_ledger VALUES(?,?,?,?,?,?,?)')
  .bind(s.tenantId,'RET-LATER','INV-LATER','CUS-1','PARTY-1',100,14900).run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('closed current Cash Session prevents the correction plan',async()=>{
 const s=await source('Cash',2);
 await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('missing return or wrong tenant hides all financial details',async()=>{
 const s=await source('Cash',2),before=await snapshot();
 assert.deepEqual(await plan(s,1,{tenantId:'SHOP-B'}),{status:'NOT_FOUND'});
 assert.deepEqual(await plan(s,1,{returnId:'RET-NO-SUCH'}),{status:'NOT_FOUND'});
 assert.deepEqual(await snapshot(),before);
});

test('stale read version and no-op proposed quantity are rejected without writes',async()=>{
 const s=await source('Cash',2);
 await DB.prepare('INSERT INTO m07_return_edit_versions VALUES(?,?,?)')
  .bind(s.tenantId,s.returnId,1).run();
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'STALE'});
 assert.deepEqual(await plan(s,2,{expectedVersion:1}),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('existing price revision forbids quantity plan without a combined source journal',async()=>{
 const s=await source('Cash',2);
 const edit={tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-QTY-PRICE-EDIT-0001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,expectedVersion:0,previousRefundPaisa:15000,
  newRefundPaisa:14000,reason:'Prior price-only correction'};
 assert.equal((await createSyntheticD1CashPriceEditContract(DB).post(edit)).status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await plan(s,1,{expectedVersion:1}),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('audited Cash deletion suppresses quantity planning without mutating historical rows',async()=>{
 const s=await source('Cash',2);
 const undone=await createSyntheticD1CashReturnDeleteContract(DB).post({
  tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-QTY-DELETE-CASH-0001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,units:2,refundPaisa:15000,
  reason:'Original return entered in error'});
 assert.equal(undone.status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('audited Store Credit deletion also blocks quantity planning',async()=>{
 const s=await source('Store Credit',2);
 const undone=await createSyntheticD1CreditDeleteContract(DB).post({
  tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-QTY-DELETE-CREDIT-0001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,customerId:s.customerId,units:2,creditPaisa:15000,
  reason:'Original credit return entered in error'});
 assert.equal(undone.status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await plan(s,1),{status:'DECLINED'});
 assert.deepEqual(await snapshot(),before);
});

test('malformed quantity/version, extra authority and SQL fields are rejected before D1',async()=>{
 const s=await source('Cash',2),before=await snapshot();
 for(const bad of [
  null,{}, {tenantId:'',returnId:s.returnId,newUnits:1,expectedVersion:0},
  {tenantId:s.tenantId,returnId:s.returnId,newUnits:0,expectedVersion:0},
  {tenantId:s.tenantId,returnId:s.returnId,newUnits:1.5,expectedVersion:0},
  {tenantId:s.tenantId,returnId:s.returnId,newUnits:1,expectedVersion:-1},
  {tenantId:s.tenantId,returnId:s.returnId,newUnits:1,expectedVersion:0,permission:'returns:edit'},
  {tenantId:s.tenantId,returnId:s.returnId,newUnits:1,expectedVersion:0,sql:'DROP TABLE m07_cash_returns'}
 ])await assert.rejects(()=>preflight().plan(bad),/invalid|shape|synthetic/i);
 assert.deepEqual(await snapshot(),before);
});

test('Worker does not expose quantity correction over HTTP',async()=>{
 const s=await source('Cash',2),before=await snapshot();
 assert.equal((await worker.fetch('https://m07.local/updateSalesReturn',{
  method:'POST',body:JSON.stringify({tenantId:s.tenantId,returnId:s.returnId,newUnits:1})
 })).status,404);
 assert.deepEqual(await snapshot(),before);
});
