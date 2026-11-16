import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';
import {
  M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,
  M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL
} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {
  M07_CASH_DELETE_TEST_DDL,
  M07_CASH_DELETE_IMMUTABLE_TABLES,
  M07_CASH_DELETE_IMMUTABLE_DDL
} from '../fixtures/m07-cash-delete-schema.mjs';
import {createSyntheticD1CashReturnDeleteContract} from '../fixtures/m07-cash-delete-contract.mjs';

// Synthetic real Workerd/D1, not production SQL, RBAC, or Cloudflare preview.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-cash-delete-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-cash-delete-workerd-test');
let DB;
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const first=async sql=>DB.prepare(sql).first();
const writer=(options)=>createSyntheticD1CashReturnDeleteContract(DB,options);

async function seed(id='ORIG1',{units=2,customerId='CUS-1'}={}){
  const tenantId='SHOP-A',invoiceId='INV-'+id,lotId='LOT-'+id,sku='PIPE';
  const posted=await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'SALE-CLERK',operationId:'OP-SALE-'+id+'-00001',
    invoiceId,sku,units,unitPrice:'100.00',discount:'0',
    customerId,payments:[]
  });
  assert.equal(posted.status,'COMMITTED');
  const {payload_hash:originalHash}=await DB.prepare(
    'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
  ).bind(tenantId,invoiceId).first();
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,units).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  const returnId='RET-'+id, returnOp='OP-RETURN-'+id+'-00001';
  const refundPaisa=7500;
  const result=await createSyntheticD1CashReturnContract(DB).post({
    tenantId,actorId:'RETURN-CLERK',operationId:returnOp,returnId,
    invoiceId,sku,lotId,originalHash,units:1,refundPaisa,
    reason:'Defective fitting'
  });
  assert.equal(result.status,'COMMITTED');
  return {tenantId,invoiceId,sku,lotId,originalHash,returnId,
    units:1,refundPaisa,customerId,returnOp};
}
function request(s,operationId='OP-CASH-DELETE-00001',patch={}){
  return {
    tenantId:s.tenantId,actorId:'MANAGER',operationId,returnId:s.returnId,
    invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,originalHash:s.originalHash,
    units:s.units,refundPaisa:s.refundPaisa,reason:'Correct erroneous return',
    ...patch
  };
}
async function snapshot(){
  const queries={
    receipt:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    active:'SELECT * FROM m07_active_cash_returns ORDER BY return_id',
    deletion:'SELECT * FROM m07_cash_delete_receipts ORDER BY return_id',
    undo:'SELECT * FROM m07_cash_delete_stock_undo ORDER BY return_id',
    offsets:'SELECT * FROM m07_cash_delete_offsets ORDER BY return_id',
    originalRefund:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    originalMovement:'SELECT * FROM m07_return_movements ORDER BY return_id',
    provenance:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lot:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    shop:'SELECT * FROM m06_owned_stock ORDER BY sku',
    customer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    cashBook:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
    bankBook:'SELECT * FROM m06_bank_book ORDER BY invoice_id'
  };
  const result={};
  for(const [name,sql] of Object.entries(queries))result[name]=await all(sql);
  return result;
}
before(async()=>{
  await harness.listen();({DB}=await worker.getEnv());
  for(const statement of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
    ...M07_CASH_DELETE_TEST_DDL,...M07_CASH_DELETE_IMMUTABLE_DDL])
    await DB.prepare(statement).run();
  for(const [sql,args] of M06_SALE_TEST_SEED)
    await DB.prepare(sql).bind(...args).run();
});
beforeEach(async()=>{
  for(const name of M07_CASH_DELETE_IMMUTABLE_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${name}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${name}_immutable_delete`).run();
  }
  await DB.prepare('DROP TRIGGER IF EXISTS m07_delete_inject_offset').run();
  await DB.prepare('DROP TRIGGER IF EXISTS m07_delete_inject_stock_undo').run();
  for(const name of M06_CHILD_IMMUTABILITY_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${name}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${name}_immutable_delete`).run();
  }
  await DB.prepare('DROP TRIGGER IF EXISTS m07_receipt_immutable_delete').run();
  await DB.prepare('DROP TRIGGER IF EXISTS m06_invoice_immutable_delete').run();
  for(const table of [
    'm07_cash_delete_offsets','m07_cash_delete_stock_undo','m07_cash_delete_receipts',
    'm07_cash_refunds','m07_return_movements','m07_cash_returns',
    'm07_credit_ledger','m07_credit_returns','m07_source_lots','m07_lot_stock',
    'm06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
    'm06_stock_movements','m06_sale_items','m06_invoices'])
    await DB.prepare(`DELETE FROM ${table}`).run();
  for(const statement of M07_CASH_DELETE_IMMUTABLE_DDL)await DB.prepare(statement).run();
  await DB.prepare("CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END").run();
  await DB.prepare("CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END").run();
  for(const statement of M06_CHILD_IMMUTABILITY_DDL)await DB.prepare(statement).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE WHEN sku='PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
});
after(async()=>harness.close());

test('delete one posted Cash Return once: original lot and Cash net reverse, original source remains auditable',async()=>{
  const s=await seed(),before=await snapshot();
  assert.equal(before.active.length,1);
  const input=request(s);
  assert.deepEqual(await writer().post(input),{
    status:'COMMITTED',operationId:input.operationId,returnId:s.returnId
  });
  const after=await snapshot();
  assert.equal(after.active.length,0);
  assert.deepEqual(after.receipt,before.receipt);
  assert.deepEqual(after.originalRefund,before.originalRefund);
  assert.deepEqual(after.originalMovement,before.originalMovement);
  assert.equal(after.provenance[0].returned_units,0);
  assert.equal(after.lot[0].available,0);
  assert.equal(after.shop.find(x=>x.sku==='PIPE').available,0);
  assert.deepEqual(after.undo.map(x=>({
    return_id:x.return_id,lot_id:x.lot_id,units_out:x.units_out
  })),[{return_id:s.returnId,lot_id:s.lotId,units_out:1}]);
  assert.deepEqual(after.offsets.map(x=>({
    return_id:x.return_id,credit_paisa:x.credit_paisa
  })),[{return_id:s.returnId,credit_paisa:7500}]);
  assert.equal(after.originalRefund[0].debit_paisa-after.offsets[0].credit_paisa,0);
  for(const name of ['customer','supplier','cashBook','bankBook'])
    assert.deepEqual(after[name],before[name],name);
});

test('identical delete operation replays without additional inverse stock, Cash or ledger effect',async()=>{
  const s=await seed(),input=request(s);
  assert.equal((await writer().post(input)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await writer().post(input),{
    status:'REPLAY',returnId:s.returnId,operationId:input.operationId
  });
  for(const p of [{actorId:'OTHER'},{reason:'Changed correction'},
    {returnId:'RET-DIFFERENT'},{operationId:'OP-OTHER-DELETE001'}])
    assert.equal((await writer().post({...input,...p})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('competing delete operation IDs for one Cash Return allow at most one reversal',async()=>{
  const s=await seed();
  const [a,b]=await Promise.all([
    writer().post(request(s,'OP-DELETE-RACE-00001')),
    writer().post(request(s,'OP-DELETE-RACE-00002'))
  ]);
  assert.deepEqual([a.status,b.status].sort(),['COMMITTED','CONFLICT']);
  const state=await snapshot();
  assert.equal(state.deletion.length,1);
  assert.equal(state.offsets.length,1);
  assert.equal(state.undo.length,1);
  assert.equal(state.lot[0].available,0);
  assert.equal(state.provenance[0].returned_units,0);
});

test('returned lot resold before deletion cannot borrow spare stock from another lot',async()=>{
  const s=await seed();
  await DB.prepare("UPDATE m07_lot_stock SET available=0 WHERE lot_id='LOT-ORIG1'").run();
  await DB.prepare("UPDATE m06_owned_stock SET available=1 WHERE sku='PIPE'").run();
  const before=await snapshot();
  assert.equal((await writer().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('stale source, missing Cash refund, forged movement and wrong tenant refuse deletion without writes',async()=>{
  const s=await seed(),original=request(s);
  const zero=await snapshot();
  for(const p of [
    {tenantId:'SHOP-B'},
    {originalHash:'a'.repeat(64)},
    {units:2},{refundPaisa:7501},{lotId:'LOT-UNRELATED'}
  ]){
    assert.equal((await writer().post({...original,...p})).status,'DECLINED');
    assert.deepEqual(await snapshot(),zero);
  }
  await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=7499').run();
  const before=await snapshot();
  assert.equal((await writer().post(original)).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  await DB.prepare('UPDATE m07_cash_refunds SET debit_paisa=7500').run();
  await DB.prepare('UPDATE m07_return_movements SET units_in=2').run();
  const stale=await snapshot();
  assert.equal((await writer().post(original)).status,'DECLINED');
  assert.deepEqual(await snapshot(),stale);
});

test('closure of Cash Session just before guarded D1 claim refuses correction',async()=>{
  const s=await seed();
  const original=await snapshot();
  const action=writer({beforeBatch:async()=>{
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await action.post(request(s))).status,'DECLINED');
  const after=await snapshot();
  assert.deepEqual(after,original);
});

test('injected inverse Cash offset failure atomically undoes deletion marker and lot/stock reductions',async()=>{
  const s=await seed(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_delete_inject_offset BEFORE INSERT ON m07_cash_delete_offsets
    BEGIN SELECT RAISE(ABORT,'fault-in-cash-offset'); END`).run();
  await assert.rejects(()=>writer().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('injected inverse stock movement failure rolls back source lot and Cash deletion',async()=>{
  const s=await seed(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_delete_inject_stock_undo BEFORE INSERT ON m07_cash_delete_stock_undo
    BEGIN SELECT RAISE(ABORT,'fault-in-stock-undo'); END`).run();
  await assert.rejects(()=>writer().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('correction marker and inverse financial/stock evidence are immutable; no public endpoint',async()=>{
  const s=await seed();
  assert.equal((await writer().post(request(s))).status,'COMMITTED');
  for(const table of M07_CASH_DELETE_IMMUTABLE_TABLES){
    await assert.rejects(()=>DB.prepare(`DELETE FROM ${table}`).run(),/immutable/i);
    await assert.rejects(()=>DB.prepare(`UPDATE ${table} SET tenant_id='TAMPER'`).run(),/immutable/i);
  }
  const response=await worker.fetch('http://m07.local/__cash_delete__',{method:'POST',body:'{}'});
  assert.equal(response.status,404);
});

test('invalid operation shape, amount, identifiers and reason rejected before any D1 correction write',async()=>{
  const s=await seed(),good=request(s);
  const before=await snapshot();
  for(const candidate of [
    null,
    {...good,operationId:'bad'},
    {...good,units:0},
    {...good,refundPaisa:-1},
    {...good,reason:'  '},
    {...good,sql:'DROP TABLE m07_cash_returns'},
    {...good,originalHash:'not-a-hash'},
    {...good,actorId:''}
  ]){
    await assert.rejects(()=>writer().post(candidate),/invalid|synthetic|identifier|reason|shape/i);
  }
  assert.deepEqual(await snapshot(),before);
});

test('reusing a historical Return operation ID cannot become a new delete operation',async()=>{
  const s=await seed();
  const before=await snapshot();
  const result=await writer().post(request(s,s.returnOp));
  assert.equal(result.status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});
