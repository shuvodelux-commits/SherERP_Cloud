import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-cash-return-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-cash-return-workerd-test');
let DB;
const all=async(sql)=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const first=async(sql)=>(await DB.prepare(sql).first());
const saleInput=(id,overrides={})=>({
  tenantId:'SHOP-A',actorId:'USER-A',operationId:'OP-ORIGINAL-'+id,
  invoiceId:'INV-'+id,sku:'PIPE',units:2,unitPrice:'100.00',discount:'0',
  customerId:'CUS-1',payments:[],...overrides
});
async function originalSale(id='ORIGIN-1',overrides={}){
  const sale=saleInput(id,overrides);
  assert.equal((await createSyntheticD1SalePostingContract(DB).post(sale)).status,'COMMITTED');
  const row=await DB.prepare('SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?')
    .bind(sale.tenantId,sale.invoiceId).first();
  assert.ok(row?.payload_hash);
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(sale.tenantId,sale.invoiceId,sale.sku,'LOT-'+id,sale.units).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(sale.tenantId,'LOT-'+id,sale.sku).run();
  return {invoiceId:sale.invoiceId,sku:sale.sku,lotId:'LOT-'+id,originalHash:row.payload_hash};
}
const request=(source,operationId,overrides={})=>({
  tenantId:'SHOP-A',actorId:'USER-B',operationId,returnId:'RET-'+operationId,
  invoiceId:source.invoiceId,sku:source.sku,lotId:source.lotId,
  originalHash:source.originalHash,units:1,refundPaisa:7500,
  reason:'Defective unit',...overrides
});
const post=(options)=>createSyntheticD1CashReturnContract(DB,options);
async function snapshot(){
  const queries={
    source:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lots:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    receipts:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    moves:'SELECT * FROM m07_return_movements ORDER BY return_id',
    refunds:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    stock:'SELECT * FROM m06_owned_stock ORDER BY sku',
    customer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    customerLedger:'SELECT * FROM m06_customer_ledger ORDER BY invoice_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id'
  };
  const snap={};
  for(const [key,sql] of Object.entries(queries))snap[key]=await all(sql);
  return snap;
}
before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
  for(const sql of M06_SALE_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_TEST_DDL)await DB.prepare(sql).run();
  for(const [sql,params] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...params).run();
});
beforeEach(async()=>{
  for(const t of ['m07_fail_refund','m07_fail_movement'])await DB.prepare('DROP TRIGGER IF EXISTS '+t).run();
  await DB.prepare('DROP TRIGGER m07_receipt_immutable_delete').run();
  for(const table of ['m07_cash_refunds','m07_return_movements','m07_cash_returns','m07_lot_stock','m07_source_lots'])
    await DB.prepare('DELETE FROM '+table).run();
  await DB.prepare(`CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns
    BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END`).run();
  await DB.prepare('DROP TRIGGER m06_invoice_immutable_delete').run();
  for(const table of ['m06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
    'm06_stock_movements','m06_sale_items','m06_invoices'])
    await DB.prepare('DELETE FROM '+table).run();
  await DB.prepare(`CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices
    BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare("UPDATE m06_customer_accounts SET due_paisa=0").run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
});
after(async()=>{await harness.close();});

test('original fully unpaid sale accepts actual Cash refund and retains original Customer AR and Supplier AP',async()=>{
  const source=await originalSale();
  const result=await post().post(request(source,'OP-RETURN-CASH01'));
  assert.deepEqual(result,{status:'COMMITTED',operationId:'OP-RETURN-CASH01',returnId:'RET-OP-RETURN-CASH01'});
  assert.equal((await first("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,1);
  assert.equal((await first("SELECT available FROM m07_lot_stock WHERE lot_id='LOT-ORIGIN-1'")).available,1);
  assert.equal((await first('SELECT returned_units FROM m07_source_lots')).returned_units,1);
  assert.deepEqual(await all('SELECT sku,lot_id,units_in FROM m07_return_movements'),
    [{sku:'PIPE',lot_id:'LOT-ORIGIN-1',units_in:1}]);
  assert.deepEqual(await all('SELECT debit_paisa FROM m07_cash_refunds'),[{debit_paisa:7500}]);
  assert.equal((await first("SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,20000);
  assert.equal((await first("SELECT payable_paisa FROM m06_supplier_accounts WHERE supplier_id='SUP-1'")).payable_paisa,4000);
  assert.equal((await first('SELECT COUNT(*) AS n FROM m06_cash_book')).n,0);
});

test('full Cash return restores exactly the proven owned lot quantity once',async()=>{
  const source=await originalSale();
  const intent=request(source,'OP-RETURN-FULL01',{units:2,refundPaisa:20000});
  assert.equal((await post().post(intent)).status,'COMMITTED');
  assert.equal((await first("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
  assert.equal((await first('SELECT returned_units FROM m07_source_lots')).returned_units,2);
  assert.deepEqual(await all('SELECT units_in FROM m07_return_movements'),[{units_in:2}]);
  const before=await snapshot();
  const extra=await post().post(request(source,'OP-RETURN-EXTRA1',{refundPaisa:10000}));
  assert.equal(extra.status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('same operation and content replay is immutable; changed reason, actor or return ID conflicts',async()=>{
  const source=await originalSale();
  const intent=request(source,'OP-RETURN-REPLAY1');
  assert.equal((await post().post(intent)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await post().post(intent),{
    status:'REPLAY',operationId:intent.operationId,returnId:intent.returnId
  });
  for(const patch of [{reason:'Changed'},{actorId:'USER-C'},{returnId:'RET-OTHER-1'}]){
    assert.equal((await post().post({...intent,...patch})).status,'CONFLICT');
  }
  assert.equal((await post().post({...intent,operationId:'OP-RETURN-OTHER1'})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('two competing last-unit returns against one sale cannot both restore that unit',async()=>{
  const source=await originalSale('ONE-UNIT',{units:1,unitPrice:'100',payments:[{id:'C1',method:'Cash',amount:'100'}],customerId:''});
  const results=await Promise.all([
    post().post(request(source,'OP-RETURN-RACEA1',{refundPaisa:5000})),
    post().post(request(source,'OP-RETURN-RACEB1',{refundPaisa:5000}))
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await first("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
  assert.equal((await first('SELECT returned_units FROM m07_source_lots')).returned_units,1);
  assert.equal((await first('SELECT COUNT(*) AS n FROM m07_cash_returns')).n,1);
  assert.equal((await first('SELECT COUNT(*) AS n FROM m07_cash_refunds')).n,1);
});

test('stale original hash, absent lineage, over-price and cross-tenant attempt never post',async()=>{
  const source=await originalSale();
  const before=await snapshot();
  for(const patch of [
    {originalHash:'f'.repeat(64)},
    {lotId:'LOT-MISSING'},
    {refundPaisa:10001},
    {tenantId:'SHOP-B'}
  ]){
    const result=await post().post(request(source,'OP-RETURN-DECLINE1',patch));
    assert.equal(result.status,'DECLINED',JSON.stringify(patch));
    assert.deepEqual(await snapshot(),before);
  }
});

test('cash drawer closure between intent preparation and SQL claim declines without any mutation',async()=>{
  const source=await originalSale();
  const before=await snapshot();
  const posting=post({beforeBatch:async()=>{
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await posting.post(request(source,'OP-RETURN-CLOSED1'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('injected Cash refund failure rolls back receipt, lot, product stock and movement in real D1',async()=>{
  const source=await originalSale();
  const before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_refund BEFORE INSERT ON m07_cash_refunds
    BEGIN SELECT RAISE(ABORT,'m07-injected-refund-failure'); END`).run();
  await assert.rejects(()=>post().post(request(source,'OP-RETURN-FAIL01')),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('injected stock movement failure rolls back Cash and original returned quantity in real D1',async()=>{
  const source=await originalSale();
  const before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_movement BEFORE INSERT ON m07_return_movements
    BEGIN SELECT RAISE(ABORT,'m07-injected-movement-failure'); END`).run();
  await assert.rejects(()=>post().post(request(source,'OP-RETURN-FAIL02')),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('committed return receipts are immutable and no test endpoint exists',async()=>{
  const source=await originalSale();
  await post().post(request(source,'OP-RETURN-LOCK01'));
  await assert.rejects(()=>DB.prepare("DELETE FROM m07_cash_returns WHERE tenant_id='SHOP-A'").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("UPDATE m07_cash_returns SET units=2 WHERE tenant_id='SHOP-A'").run(),/immutable/i);
  const response=await worker.fetch('http://m07.local/__return__',{method:'POST',body:'{}'});
  assert.equal(response.status,404);
});

test('invalid shapes, negative refunds and missing reason are rejected before any D1 return write',async()=>{
  const source=await originalSale();
  const intent=request(source,'OP-RETURN-VALID1');
  for(const value of [
    {...intent,units:0},{...intent,units:1.5},{...intent,refundPaisa:-1},
    {...intent,reason:''},{...intent,operationId:'bad'},
    {...intent,sql:'DELETE FROM m06_invoices'},null
  ])await assert.rejects(()=>post().post(value),/invalid|unsupported|reason|synthetic/i);
  assert.equal((await first('SELECT COUNT(*) AS n FROM m07_cash_returns')).n,0);
});

test('forged sold-lot quantity larger than original sale cannot mint returned stock',async()=>{
  const source=await originalSale();
  await DB.prepare("UPDATE m07_source_lots SET sold_units=5 WHERE invoice_id='INV-ORIGIN-1'").run();
  const before=await snapshot();
  const result=await post().post(request(source,'OP-RETURN-FORGED1',{units:3,refundPaisa:15000}));
  assert.equal(result.status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});
