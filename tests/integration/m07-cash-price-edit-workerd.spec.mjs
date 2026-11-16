import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,
 M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL}
 from '../fixtures/m06-sale-posting-schema.mjs';
import {createSyntheticD1SalePostingContract}
 from '../fixtures/m06-sale-posting-contract.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {createSyntheticD1CashReturnContract}
 from '../fixtures/m07-cash-return-contract.mjs';
import {M07_CASH_DELETE_TEST_DDL} from '../fixtures/m07-cash-delete-schema.mjs';
import {createSyntheticD1CashReturnDeleteContract}
 from '../fixtures/m07-cash-delete-contract.mjs';
import {M07_RETURN_EDIT_READ_DDL}
 from '../fixtures/m07-return-edit-read-schema.mjs';
import {M07_CASH_PRICE_EDIT_DDL,M07_CASH_PRICE_EDIT_IMMUTABLE,
 M07_CASH_PRICE_EDIT_IMMUTABLE_DDL}
 from '../fixtures/m07-cash-price-edit-schema.mjs';
import {createSyntheticD1CashPriceEditContract}
 from '../fixtures/m07-cash-price-edit-contract.mjs';

// Synthetic local Workerd/D1 ONLY. Original UI, D1 migrations and RPC are untouched.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-cash-price-edit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-cash-price-edit-workerd-test');
let DB;
const first=sql=>DB.prepare(sql).first();
const rows=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const edit=options=>createSyntheticD1CashPriceEditContract(DB,options);
async function source(id='A'){
 const tenantId='SHOP-A',invoiceId='INV-PRICE-'+id,
  returnId='RET-PRICE-'+id,sku='PIPE',lotId='LOT-PRICE-'+id;
 const sale={
  tenantId,actorId:'SALE-USER',operationId:'OP-PRICE-SALE-'+id+'-001',
  invoiceId,sku,units:2,unitPrice:'100.00',discount:'0',
  customerId:'CUS-1',payments:[]
 };
 assert.equal((await createSyntheticD1SalePostingContract(DB).post(sale)).status,'COMMITTED');
 const {payload_hash:originalHash}=await DB.prepare(
  'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
 ).bind(tenantId,invoiceId).first();
 await DB.prepare('INSERT INTO m07_source_lots VALUES(?,?,?,?,?,0)')
  .bind(tenantId,invoiceId,sku,lotId,2).run();
 await DB.prepare('INSERT INTO m07_lot_stock VALUES(?,?,?,0)')
  .bind(tenantId,lotId,sku).run();
 const r={
  tenantId,actorId:'RETURN-USER',operationId:'OP-PRICE-RETURN-'+id+'-001',
  returnId,invoiceId,sku,lotId,originalHash,units:1,
  refundPaisa:7500,reason:'Damaged original'
 };
 assert.equal((await createSyntheticD1CashReturnContract(DB).post(r)).status,'COMMITTED');
 return r;
}
function request(s,operationId='OP-PRICE-EDIT-001',patch={}){
 return {
  tenantId:s.tenantId,actorId:'MANAGER',operationId,
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,expectedVersion:0,
  previousRefundPaisa:s.refundPaisa,newRefundPaisa:6800,
  reason:'Price correction only',...patch
 };
}
async function snapshot(){
 const q={
  originalInvoices:'SELECT * FROM m06_invoices ORDER BY invoice_id',
  originalItems:'SELECT * FROM m06_sale_items ORDER BY invoice_id',
  originalMovements:'SELECT * FROM m06_stock_movements ORDER BY invoice_id',
  originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
  originalBank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
  originalCustomer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
  originalSupplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
  lot:'SELECT * FROM m07_source_lots ORDER BY lot_id',
  lotStock:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
  shopStock:'SELECT * FROM m06_owned_stock ORDER BY sku',
  returns:'SELECT * FROM m07_cash_returns ORDER BY return_id',
  returnMovement:'SELECT * FROM m07_return_movements ORDER BY return_id',
  originalRefund:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
  active:'SELECT * FROM m07_cash_current_refund_values ORDER BY return_id',
  revisions:'SELECT * FROM m07_cash_price_edit_receipts ORDER BY next_version',
  offsets:'SELECT * FROM m07_cash_price_edit_adjustments ORDER BY next_version',
  versions:'SELECT * FROM m07_return_edit_versions ORDER BY return_id',
  dependencies:'SELECT * FROM m07_cash_price_edit_dependencies ORDER BY activity_id',
  corrections:'SELECT * FROM m07_cash_delete_receipts ORDER BY return_id'
 };
 const out={};for(const [k,sql] of Object.entries(q))out[k]=await rows(sql);
 return out;
}
const originalUnchanged=(a,b)=>{
 for(const k of ['originalInvoices','originalItems','originalMovements','originalCash',
  'originalBank','originalCustomer','originalSupplier',
  'lot','lotStock','shopStock','returns','returnMovement','originalRefund'])
  assert.deepEqual(a[k],b[k],k);
};
before(async()=>{
 await harness.listen();({DB}=await worker.getEnv());
 for(const q of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
  ...M07_CASH_DELETE_TEST_DDL,...M07_RETURN_EDIT_READ_DDL,
  ...M07_CASH_PRICE_EDIT_DDL,...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL])
  await DB.prepare(q).run();
 for(const [sql,params] of M06_SALE_TEST_SEED)
  await DB.prepare(sql).bind(...params).run();
});
beforeEach(async()=>{
 for(const t of M07_CASH_PRICE_EDIT_IMMUTABLE){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
 }
 for(const t of M06_CHILD_IMMUTABILITY_TABLES){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
 }
 for(const t of [
  'm07_price_inject_adjustment','m07_price_inject_version',
  'm07_receipt_immutable_delete','m06_invoice_immutable_delete'
 ])await DB.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
 for(const t of [
  'm07_cash_price_edit_dependencies','m07_cash_price_edit_adjustments',
  'm07_cash_price_edit_receipts','m07_return_edit_versions',
  'm07_cash_delete_offsets','m07_cash_delete_stock_undo','m07_cash_delete_receipts',
  'm07_cash_refunds','m07_return_movements','m07_cash_returns',
  'm07_lot_stock','m07_source_lots',
  'm06_customer_ledger','m06_bank_book','m06_cash_book',
  'm06_payment_children','m06_stock_movements','m06_sale_items','m06_invoices'
 ])await DB.prepare(`DELETE FROM ${t}`).run();
 for(const q of [...M06_CHILD_IMMUTABILITY_DDL,
  ...M07_CASH_PRICE_EDIT_IMMUTABLE_DDL])await DB.prepare(q).run();
 for(const q of [
  "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-cash-return'); END",
  "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'immutable-invoice'); END"
 ])await DB.prepare(q).run();
 await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END").run();
 await DB.prepare("UPDATE m06_customer_accounts SET due_paisa=0").run();
 await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
});
after(async()=>harness.close());

test('price reduction appends exact Cash credit adjustment with no lot or stock movement',async()=>{
 const s=await source(),before=await snapshot(),r=request(s);
 assert.deepEqual(await edit().post(r),{
  status:'COMMITTED',operationId:r.operationId,returnId:r.returnId,version:1});
 const after=await snapshot();
 assert.deepEqual(after.offsets.map(x=>({debit:x.debit_paisa,credit:x.credit_paisa})),
  [{debit:0,credit:700}]);
 assert.equal(after.active[0].original_refund_paisa,7500);
 assert.equal(after.active[0].active_refund_paisa,6800);
 assert.equal(after.versions[0].edit_version,1);
 originalUnchanged(after,before);
});

test('price increase generates only Cash debit delta without touching original refund',async()=>{
 const s=await source(),before=await snapshot();
 const out=await edit().post(request(s,'OP-PRICE-INCREASE-001',{newRefundPaisa:8400}));
 assert.equal(out.status,'COMMITTED');
 const after=await snapshot();
 assert.equal(after.offsets[0].debit_paisa,900);
 assert.equal(after.offsets[0].credit_paisa,0);
 assert.equal(after.active[0].active_refund_paisa,8400);
 originalUnchanged(after,before);
});

test('sequential price edits chain versions and net Cash adjustments exactly',async()=>{
 const s=await source();
 assert.equal((await edit().post(request(s,'OP-PRICE-SEQUENTIAL-001',{
  newRefundPaisa:7000}))).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await edit().post(request(s,'OP-PRICE-SEQUENTIAL-002',{
  expectedVersion:1,previousRefundPaisa:7000,newRefundPaisa:8100}))).status,'COMMITTED');
 const after=await snapshot();
 assert.deepEqual(after.offsets.map(x=>[x.credit_paisa,x.debit_paisa]),[[500,0],[0,1100]]);
 assert.equal(after.active[0].revision_version,2);
 assert.equal(after.active[0].active_refund_paisa,8100);
 originalUnchanged(after,before);
});

test('stable operation replays identically and changed intent or actor conflicts',async()=>{
 const s=await source(),r=request(s);
 assert.equal((await edit().post(r)).status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await edit().post(r),{
  status:'REPLAY',operationId:r.operationId,returnId:r.returnId,version:1});
 for(const patch of [{newRefundPaisa:6700},{actorId:'OTHER'},
  {reason:'Different reason'}, {lotId:'FORGED'}, {operationId:'OP-PRICE-EDIT-DIFFERENT'}]){
  const result=await edit().post({...r,...patch});
  assert.equal(result.status,patch.operationId?'DECLINED':'CONFLICT');
 }
 assert.deepEqual(await snapshot(),before);
});

test('prior replay cannot be mistaken for latest revision after another price edit',async()=>{
 const s=await source(),a=request(s,'OP-PRICE-OLD-001');
 assert.equal((await edit().post(a)).status,'COMMITTED');
 assert.equal((await edit().post(request(s,'OP-PRICE-NEW-001',{
  expectedVersion:1,previousRefundPaisa:6800,newRefundPaisa:6900}))).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await edit().post(a)).status,'CONFLICT');
 assert.deepEqual(await snapshot(),before);
});

test('competing edits using stale version commit at most once',async()=>{
 const s=await source();
 const x=await Promise.all([
  edit().post(request(s,'OP-PRICE-RACE-001',{newRefundPaisa:7000})),
  edit().post(request(s,'OP-PRICE-RACE-002',{newRefundPaisa:6900}))
 ]);
 assert.deepEqual(x.map(y=>y.status).sort(),['COMMITTED','DECLINED']);
 assert.equal((await first('SELECT COUNT(*) n FROM m07_cash_price_edit_receipts')).n,1);
 assert.equal((await first('SELECT COUNT(*) n FROM m07_cash_price_edit_adjustments')).n,1);
 assert.equal((await first('SELECT edit_version FROM m07_return_edit_versions')).edit_version,1);
});

test('wrong invoice/tenant/lot/source hash/stale version/previous amount and cap decline without writes',async()=>{
 const s=await source(),before=await snapshot();
 for(const patch of [
  {tenantId:'SHOP-B'},{invoiceId:'INV-WRONG'},
  {sku:'OTHER'},{lotId:'LOT-FORGED'},
  {originalHash:'f'.repeat(64)},
  {expectedVersion:1},{previousRefundPaisa:7501},
  {newRefundPaisa:10001},{newRefundPaisa:7500}
 ]){
  assert.equal((await edit().post(request(s,'OP-PRICE-INVALID-001',patch))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
 }
});

test('closed Cash Session and dependent Cash reconciliation block correction',async()=>{
 const s=await source(),x=request(s);
 await DB.prepare("UPDATE m06_cash_sessions SET state='Closed'").run();
 const closed=await snapshot();
 assert.equal((await edit().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),closed);
 await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
 await DB.prepare('INSERT INTO m07_cash_price_edit_dependencies VALUES(?,?,?)')
  .bind('SHOP-A',s.returnId,'SETTLEMENT-1').run();
 const dependent=await snapshot();
 assert.equal((await edit().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),dependent);
});

test('deleted Cash return cannot receive a new price adjustment',async()=>{
 const s=await source();
 assert.equal((await createSyntheticD1CashReturnDeleteContract(DB).post({
  tenantId:'SHOP-A',actorId:'MANAGER',operationId:'OP-PRICE-DELETE-001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,units:1,refundPaisa:7500,
  reason:'Original return invalid'
 })).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await edit().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('source Cash refund drift and lost movement block price edit',async()=>{
 const s=await source(),x=request(s);
 await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=7400').run();
 const mismatch=await snapshot();
 assert.equal((await edit().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),mismatch);
 await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=7500').run();
 await DB.prepare('DELETE FROM m07_return_movements').run();
 const missing=await snapshot();
 assert.equal((await edit().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),missing);
});

test('injected Cash adjustment failure rolls back version and receipt, stock unchanged',async()=>{
 const s=await source(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_price_inject_adjustment BEFORE INSERT ON m07_cash_price_edit_adjustments BEGIN SELECT RAISE(ABORT,'Cash adjustment fault'); END").run();
 await assert.rejects(()=>edit().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('injected version allocation fault rolls back all money and price revisions',async()=>{
 const s=await source(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_price_inject_version BEFORE INSERT ON m07_return_edit_versions BEGIN SELECT RAISE(ABORT,'edit version fault'); END").run();
 await assert.rejects(()=>edit().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('financial revision receipts and Cash adjustments are immutable and no public edit RPC exists',async()=>{
 const s=await source();
 assert.equal((await edit().post(request(s))).status,'COMMITTED');
 for(const table of M07_CASH_PRICE_EDIT_IMMUTABLE){
  await assert.rejects(()=>DB.prepare(`UPDATE ${table} SET tenant_id='BAD'`).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM ${table}`).run(),/immutable/i);
 }
 const response=await worker.fetch('https://m07.local/updateSalesReturn',{
  method:'POST',body:'{}'});
 assert.equal(response.status,404);
});

test('client-side authority, SQL fields, malformed price and IDs are rejected before any D1 writes',async()=>{
 const s=await source(),before=await snapshot(),x=request(s);
 for(const invalid of [
  null,{...x,clientPermission:'returns:edit'},{...x,sql:'UPDATE m06_owned_stock'},
  {...x,operationId:'tiny'},{...x,tenantId:''},
  {...x,newRefundPaisa:-1},{...x,newRefundPaisa:0.5},
  {...x,expectedVersion:-1},{...x,reason:'   '}
 ]){
  await assert.rejects(()=>edit().post(invalid),/invalid|synthetic|shape/i);
 }
 assert.deepEqual(await snapshot(),before);
});

test('once revised, old native deletion flow is blocked pending source-matched correction',async()=>{
 const s=await source();
 assert.equal((await edit().post(request(s))).status,'COMMITTED');
 const before=await snapshot();
 const deleted=await createSyntheticD1CashReturnDeleteContract(DB).post({
  tenantId:s.tenantId,actorId:'MANAGER',
  operationId:'OP-PRICE-DELETE-BLOCKED-001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,units:s.units,refundPaisa:s.refundPaisa,
  reason:'Requires version-aware undo'
 });
 assert.equal(deleted.status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});
