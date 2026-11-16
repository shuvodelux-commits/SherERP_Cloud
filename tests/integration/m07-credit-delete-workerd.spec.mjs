import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1StoreCreditContract} from '../fixtures/m07-store-credit-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,
  M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL
} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {M07_CREDIT_DELETE_TEST_DDL,M07_CREDIT_DELETE_IMMUTABLE_TABLES,
  M07_CREDIT_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-credit-delete-schema.mjs';
import {createSyntheticD1CreditDeleteContract} from '../fixtures/m07-credit-delete-contract.mjs';

// Strictly test-owned isolated Workerd/D1; not an authenticated return endpoint.
const server=createTestHarness({workers:[{configPath:'./wrangler.m07-credit-delete-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-credit-delete-workerd-test');
let DB;
const first=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(row=>({...row}));
const deletion=options=>createSyntheticD1CreditDeleteContract(DB,options);
async function seed(id='A',{payments=[]}={}){
  const tenantId='SHOP-A',sku='PIPE',invoiceId='INV-CREDIT-'+id,customerId='CUS-1';
  const sale=await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'SALE-CLERK',operationId:'OP-SALE-CREDIT-'+id+'-001',
    invoiceId,sku,units:2,unitPrice:'100.00',discount:'0',customerId,payments
  });
  assert.equal(sale.status,'COMMITTED');
  const originalHash=(await DB.prepare('SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?')
    .bind(tenantId,invoiceId).first()).payload_hash;
  const lotId='LOT-CREDIT-'+id,returnId='RET-CREDIT-'+id;
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,2).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  for(const c of ['CUS-1','CUS-2']){
    const row=await DB.prepare('SELECT party_id,due_paisa FROM m06_customer_accounts WHERE tenant_id=? AND customer_id=?')
      .bind(tenantId,c).first();
    await DB.prepare('INSERT INTO m07_customer_signed_accounts VALUES (?,?,?,?,1)')
      .bind(tenantId,c,row.party_id,row.due_paisa).run();
  }
  const input={tenantId,actorId:'RETURN-CLERK',
    operationId:'OP-STORE-CREDIT-'+id+'-001',returnId,invoiceId,sku,lotId,
    originalHash,customerId,units:1,creditPaisa:7500,reason:'Defective item'};
  assert.equal((await createSyntheticD1StoreCreditContract(DB).post(input)).status,'COMMITTED');
  return input;
}
const request=(source,operationId='OP-CREDIT-DELETE-001',patch={})=>({
  tenantId:source.tenantId,actorId:'MANAGER',operationId,
  returnId:source.returnId,invoiceId:source.invoiceId,sku:source.sku,
  lotId:source.lotId,originalHash:source.originalHash,
  customerId:source.customerId,units:source.units,creditPaisa:source.creditPaisa,
  reason:'Correct erroneous Store Credit',...patch
});
async function snap(){
  const out={};
  const sql={
    original:'SELECT * FROM m07_credit_returns ORDER BY return_id',
    active:'SELECT * FROM m07_active_credit_returns ORDER BY return_id',
    originLedger:'SELECT * FROM m07_credit_ledger ORDER BY return_id',
    originalMoves:'SELECT * FROM m07_return_movements ORDER BY return_id',
    correction:'SELECT * FROM m07_credit_delete_receipts ORDER BY return_id',
    undoStock:'SELECT * FROM m07_credit_delete_stock_undo ORDER BY return_id',
    undoLedger:'SELECT * FROM m07_credit_delete_ledger ORDER BY return_id',
    provenance:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lot:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    shop:'SELECT * FROM m06_owned_stock ORDER BY sku',
    signed:'SELECT * FROM m07_customer_signed_accounts ORDER BY customer_id',
    originalAR:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    cash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
    bank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    dependencies:'SELECT * FROM m07_credit_delete_dependencies ORDER BY activity_id'
  };
  for(const [name,q] of Object.entries(sql))out[name]=await all(q);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const q of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
    ...M07_CREDIT_DELETE_TEST_DDL,...M07_CREDIT_DELETE_IMMUTABLE_DDL])
    await DB.prepare(q).run();
  for(const [q,args] of M06_SALE_TEST_SEED)
    await DB.prepare(q).bind(...args).run();
});
beforeEach(async()=>{
  for(const t of M07_CREDIT_DELETE_IMMUTABLE_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
  }
  for(const t of ['m07_credit_delete_fault_ledger','m07_credit_delete_fault_stock',
    'm07_credit_immutable_delete','m07_receipt_immutable_delete',
    'm06_invoice_immutable_delete'])
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
  for(const t of M06_CHILD_IMMUTABILITY_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
  }
  for(const t of ['m07_credit_delete_dependencies','m07_credit_delete_ledger',
    'm07_credit_delete_stock_undo','m07_credit_delete_receipts',
    'm07_credit_ledger','m07_credit_returns','m07_cash_refunds',
    'm07_return_movements','m07_cash_returns','m07_source_lots','m07_lot_stock',
    'm07_customer_signed_accounts','m06_customer_ledger','m06_bank_book',
    'm06_cash_book','m06_payment_children','m06_stock_movements',
    'm06_sale_items','m06_invoices'])
    await DB.prepare(`DELETE FROM ${t}`).run();
  for(const q of M07_CREDIT_DELETE_IMMUTABLE_DDL)await DB.prepare(q).run();
  await DB.prepare("CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-credit'); END").run();
  await DB.prepare("CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END").run();
  await DB.prepare("CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END").run();
  for(const q of M06_CHILD_IMMUTABILITY_DDL)await DB.prepare(q).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE WHEN sku='PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>server.close());

test('single Store Credit deletion restores signed due and original lot, keeping immutable return, ledger, Cash, Bank and Supplier',async()=>{
  const s=await seed(),before=await snap();
  const action=request(s);
  assert.deepEqual(await deletion().post(action),{
    status:'COMMITTED',operationId:action.operationId,returnId:s.returnId
  });
  const after=await snap();
  assert.equal(after.active.length,0);
  assert.deepEqual(after.original,before.original);
  assert.deepEqual(after.originLedger,before.originLedger);
  assert.deepEqual(after.originalMoves,before.originalMoves);
  assert.equal(after.provenance[0].returned_units,0);
  assert.equal(after.lot[0].available,0);
  assert.equal(after.shop.find(x=>x.sku==='PIPE').available,0);
  assert.deepEqual(after.undoStock.map(x=>[x.return_id,x.units_out]),[[s.returnId,1]]);
  assert.deepEqual(after.undoLedger.map(x=>[x.return_id,x.debit_paisa,x.balance_paisa]),
    [[s.returnId,7500,20000]]);
  assert.equal(after.signed.find(x=>x.customer_id==='CUS-1').signed_due_paisa,20000);
  assert.equal(after.signed.find(x=>x.customer_id==='CUS-2').signed_due_paisa,0);
  for(const k of ['originalAR','cash','bank','supplier'])
    assert.deepEqual(after[k],before[k],k);
});

test('fully paid original invoice: Store Credit deletion unwinds negative advance to exactly zero',async()=>{
  const s=await seed('PAID',{payments:[{id:'PAY-1',method:'Cash',amount:'200'}]});
  const before=await snap();
  assert.equal(before.signed[0].signed_due_paisa,-7500);
  assert.equal((await deletion().post(request(s))).status,'COMMITTED');
  const after=await snap();
  assert.equal(after.signed[0].signed_due_paisa,0);
  assert.deepEqual(after.cash,before.cash);
  assert.deepEqual(after.bank,before.bank);
  assert.deepEqual(after.supplier,before.supplier);
});

test('same immutable delete replays; changed actor, return ID, amount, reason or operation ID conflicts',async()=>{
  const s=await seed(),input=request(s);
  assert.equal((await deletion().post(input)).status,'COMMITTED');
  const before=await snap();
  assert.deepEqual(await deletion().post(input),
    {status:'REPLAY',operationId:input.operationId,returnId:s.returnId});
  for(const patch of [{actorId:'FORGED'},{returnId:'RET-OTHER'},
    {creditPaisa:7000},{reason:'Changed'},{operationId:'OP-CREDIT-DELETE-002'}])
    assert.equal((await deletion().post({...input,...patch})).status,'CONFLICT');
  assert.deepEqual(await snap(),before);
});

test('concurrent conflicting Store Credit deletions commit at most once',async()=>{
  const s=await seed();
  const results=await Promise.all([
    deletion().post(request(s,'OP-CREDIT-DEL-RACE1')),
    deletion().post(request(s,'OP-CREDIT-DEL-RACE2'))
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','CONFLICT']);
  assert.equal((await all('SELECT * FROM m07_credit_delete_ledger')).length,1);
  assert.equal((await first('SELECT returned_units FROM m07_source_lots')).returned_units,0);
});

test('returned original lot resold cannot be substituted from shop stock or another lot',async()=>{
  const s=await seed();
  await DB.prepare("UPDATE m07_lot_stock SET available=0 WHERE lot_id='LOT-CREDIT-A'").run();
  await DB.prepare("UPDATE m06_owned_stock SET available=1 WHERE sku='PIPE'").run();
  const before=await snap();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),before);
});

test('wrong Customer, tenant, original hash, returned units, amount, missing ledger or altered movement reject',async()=>{
  const s=await seed(),before=await snap();
  for(const patch of [{tenantId:'SHOP-B'},{customerId:'CUS-2'},
    {originalHash:'f'.repeat(64)},{units:2},{creditPaisa:7501},{lotId:'LOT-OTHER'}]){
    assert.equal((await deletion().post(request(s,'OP-CREDIT-DELETE-001',patch))).status,'DECLINED');
    assert.deepEqual(await snap(),before);
  }
  await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7400').run();
  const wrong=await snap();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),wrong);
  await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7500').run();
  await DB.prepare('UPDATE m07_return_movements SET units_in=2').run();
  const missing=await snap();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),missing);
});

test('later credited return blocks old correction; newest can be corrected before original',async()=>{
  const s=await seed(),another={
    ...s,actorId:'RETURN-CLERK',returnId:'RET-CREDIT-LATER',
    operationId:'OP-STORE-CREDIT-LATER-001',reason:'Second damaged part'
  };
  assert.equal((await createSyntheticD1StoreCreditContract(DB).post(another)).status,'COMMITTED');
  const before=await snap();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),before);
  const latest={...s,returnId:another.returnId};
  assert.equal((await deletion().post(request(latest,'OP-CREDIT-DELETE-LATER'))).status,'COMMITTED');
  assert.equal((await deletion().post(request(s,'OP-CREDIT-DELETE-OLDER'))).status,'COMMITTED');
  assert.equal((await first("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,20000);
});

test('dependent settlement marker, stale balance, unreviewed Party link or reassigned Party fail closed',async()=>{
  const s=await seed();
  await DB.prepare('INSERT INTO m07_credit_delete_dependencies VALUES (?,?,?,?)')
    .bind('SHOP-A',s.returnId,'CUS-1','SETTLEMENT-LATER-1').run();
  const marked=await snap();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),marked);
  await DB.prepare('DELETE FROM m07_credit_delete_dependencies').run();
  await DB.prepare("UPDATE m07_customer_signed_accounts SET signed_due_paisa=12499 WHERE customer_id='CUS-1'").run();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  await DB.prepare("UPDATE m07_customer_signed_accounts SET signed_due_paisa=12500 WHERE customer_id='CUS-1'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id='PARTY-2' WHERE source_id='CUS-1'").run();
  assert.equal((await deletion().post(request(s))).status,'DECLINED');
});

test('Cash Session closure immediately before SQL claim causes no correction posting',async()=>{
  const s=await seed(),before=await snap();
  const contract=deletion({beforeBatch:async()=>{
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await contract.post(request(s))).status,'DECLINED');
  assert.deepEqual(await snap(),before);
});

test('injected inverse credit ledger failure rolls back stock, signed account and deletion receipt',async()=>{
  const s=await seed(),before=await snap();
  await DB.prepare(`CREATE TRIGGER m07_credit_delete_fault_ledger BEFORE INSERT ON m07_credit_delete_ledger
    BEGIN SELECT RAISE(ABORT,'m07-injected-inverse-ledger'); END`).run();
  await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snap(),before);
});

test('injected inverse stock movement failure rolls back all Store Credit reversal effects',async()=>{
  const s=await seed(),before=await snap();
  await DB.prepare(`CREATE TRIGGER m07_credit_delete_fault_stock BEFORE INSERT ON m07_credit_delete_stock_undo
    BEGIN SELECT RAISE(ABORT,'m07-injected-inverse-stock'); END`).run();
  await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snap(),before);
});

test('immutable correction receipt and exact reverse evidence; local fixture has no return endpoint',async()=>{
  const s=await seed();
  assert.equal((await deletion().post(request(s))).status,'COMMITTED');
  for(const t of M07_CREDIT_DELETE_IMMUTABLE_TABLES){
    await assert.rejects(()=>DB.prepare(`DELETE FROM ${t}`).run(),/immutable/i);
    await assert.rejects(()=>DB.prepare(`UPDATE ${t} SET tenant_id='FORGED'`).run(),/immutable/i);
  }
  const response=await worker.fetch('http://m07.local/__credit_delete__',{method:'POST',body:'{}'});
  assert.equal(response.status,404);
});

test('malformed or unsafe intent fails before D1 writes',async()=>{
  const s=await seed(),base=request(s),before=await snap();
  for(const v of [null,{...base,units:0},{...base,creditPaisa:-1},
    {...base,reason:' '},{...base,operationId:'short'},
    {...base,originalHash:'invalid'}, {...base,actorId:''},
    {...base,sql:'UPDATE m07_customer_signed_accounts'}])
    await assert.rejects(()=>deletion().post(v),/invalid|synthetic|reason|shape/i);
  assert.deepEqual(await snap(),before);
});

test('source Store Credit operation ID cannot be reused as a delete operation',async()=>{
  const s=await seed(),before=await snap();
  assert.equal((await deletion().post(request(s,s.operationId))).status,'DECLINED');
  assert.deepEqual(await snap(),before);
});
