import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';
import {createSyntheticD1StoreCreditContract} from '../fixtures/m07-store-credit-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-store-credit-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-store-credit-workerd-test');
let DB;
const one=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const credit=()=>createSyntheticD1StoreCreditContract(DB);
async function seed({id='A',units=2,customerId='CUS-1',payments=[]}={}){
  const sku='PIPE',invoiceId='INV-'+id,tenantId='SHOP-A';
  const result=await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'CLERK-1',operationId:'ORIGINAL-SALE-'+id+'-001',
    invoiceId,sku,units,unitPrice:'100.00',discount:'0',
    customerId,payments
  });
  assert.equal(result.status,'COMMITTED');
  const {payload_hash:originalHash}=await DB.prepare(
    'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
  ).bind(tenantId,invoiceId).first();
  const lotId='ORIGINAL-LOT-'+id;
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,units).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  // Synthetic signed projection starts with original M06 due. It becomes the
  // SOLE signed account in this test; never claim M06 due is already migrated.
  for(const c of ['CUS-1','CUS-2']){
    const row=await DB.prepare('SELECT c.party_id,c.due_paisa FROM m06_customer_accounts c WHERE tenant_id=? AND customer_id=?')
      .bind(tenantId,c).first();
    await DB.prepare('INSERT OR REPLACE INTO m07_customer_signed_accounts VALUES (?,?,?,?,1)')
      .bind(tenantId,c,row.party_id,row.due_paisa).run();
  }
  return {invoiceId,sku,lotId,originalHash,customerId};
}
const request=(src,operationId,patch={})=>({
  tenantId:'SHOP-A',actorId:'CLERK-2',operationId,returnId:'RET-'+operationId,
  invoiceId:src.invoiceId,sku:src.sku,lotId:src.lotId,
  originalHash:src.originalHash,customerId:src.customerId,
  units:1,creditPaisa:7500,reason:'Damaged part',...patch
});
async function snap(){
  const out={};
  const sql={
    source:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lots:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    stocks:'SELECT * FROM m06_owned_stock ORDER BY sku',
    returnCash:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    returnCredit:'SELECT * FROM m07_credit_returns ORDER BY return_id',
    returnMoves:'SELECT * FROM m07_return_movements ORDER BY return_id',
    cashRefund:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    balances:'SELECT * FROM m07_customer_signed_accounts ORDER BY customer_id',
    ledger:'SELECT * FROM m07_credit_ledger ORDER BY return_id',
    originalAR:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
    originalBank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id'
  };
  for(const [key,query] of Object.entries(sql))out[key]=await all(query);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const sql of M06_SALE_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_TEST_DDL)await DB.prepare(sql).run();
  for(const [sql,values] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
  // Drop test-only posting guards before fixture cleanup; restore immediately after.
  for(const table of M06_CHILD_IMMUTABILITY_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_delete`).run();
  }
  await DB.prepare('DROP TRIGGER IF EXISTS m07_fail_credit_ledger').run();
  await DB.prepare('DROP TRIGGER IF EXISTS m07_fail_credit_stock').run();
  await DB.prepare('DROP TRIGGER m07_credit_immutable_delete').run();
  await DB.prepare('DROP TRIGGER m07_receipt_immutable_delete').run();
  for(const t of ['m07_credit_ledger','m07_credit_returns','m07_cash_refunds',
    'm07_return_movements','m07_cash_returns','m07_lot_stock','m07_source_lots',
    'm07_customer_signed_accounts'])await DB.prepare('DELETE FROM '+t).run();
  await DB.prepare(`CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns
    BEGIN SELECT RAISE(ABORT,'m07-immutable-credit'); END`).run();
  await DB.prepare(`CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns
    BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END`).run();
  await DB.prepare('DROP TRIGGER m06_invoice_immutable_delete').run();
  for(const t of ['m06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
    'm06_stock_movements','m06_sale_items','m06_invoices'])await DB.prepare('DELETE FROM '+t).run();
  await DB.prepare(`CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices
    BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`).run();
  for(const ddl of M06_CHILD_IMMUTABILITY_DDL)await DB.prepare(ddl).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE WHEN sku='PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>server.close());

test('due Store Credit changes selected signed Customer balance and ledger, not Cash/Bank/Supplier',async()=>{
  const src=await seed();
  assert.equal((await credit().post(request(src,'CREDIT-DUE-001'))).status,'COMMITTED');
  assert.deepEqual(await all('SELECT customer_id,signed_due_paisa FROM m07_customer_signed_accounts ORDER BY customer_id'),[
    {customer_id:'CUS-1',signed_due_paisa:12500},{customer_id:'CUS-2',signed_due_paisa:0}
  ]);
  assert.deepEqual(await all('SELECT customer_id,credit_paisa,balance_paisa FROM m07_credit_ledger'),[
    {customer_id:'CUS-1',credit_paisa:7500,balance_paisa:12500}
  ]);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,1);
  assert.equal((await one('SELECT returned_units FROM m07_source_lots')).returned_units,1);
  assert.equal((await one('SELECT available FROM m07_lot_stock')).available,1);
  assert.equal((await one("SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,20000);
  assert.equal((await one("SELECT payable_paisa FROM m06_supplier_accounts WHERE supplier_id='SUP-1'")).payable_paisa,4000);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m06_cash_book')).n,0);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m06_bank_book')).n,0);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m07_cash_refunds')).n,0);
});

test('fully paid original sale Store Credit creates a negative signed balance / advance',async()=>{
  const src=await seed({payments:[{id:'PAY1',method:'Cash',amount:'200'}]});
  const before=await snap();
  assert.equal((await credit().post(request(src,'CREDIT-ADVANCE01',{creditPaisa:7500}))).status,'COMMITTED');
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,-7500);
  assert.equal((await one('SELECT balance_paisa FROM m07_credit_ledger')).balance_paisa,-7500);
  assert.deepEqual((await snap()).originalCash,before.originalCash);
  assert.deepEqual((await snap()).originalBank,before.originalBank);
  assert.deepEqual((await snap()).supplier,before.supplier);
});

test('replay only identical intent and actor; changed credit, source, actor and return ID conflict',async()=>{
  const src=await seed();
  const input=request(src,'CREDIT-REPLAY01');
  assert.equal((await credit().post(input)).status,'COMMITTED');
  const before=await snap();
  assert.deepEqual(await credit().post(input),{status:'REPLAY',operationId:input.operationId,returnId:input.returnId});
  for(const patch of [{creditPaisa:1200},{reason:'Different'},{actorId:'OTHER'},{returnId:'RET-CHANGED'}]){
    assert.equal((await credit().post({...input,...patch})).status,'CONFLICT');
  }
  assert.deepEqual(await snap(),before);
});

test('concurrent last-unit Store Credit returns yield only one credit and one restoration',async()=>{
  const src=await seed({units:1});
  const states=await Promise.all([
    credit().post(request(src,'CREDIT-RACE-0001',{creditPaisa:5000})),
    credit().post(request(src,'CREDIT-RACE-0002',{creditPaisa:5000}))
  ]);
  assert.deepEqual(states.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m07_credit_ledger')).n,1);
  assert.equal((await one('SELECT returned_units FROM m07_source_lots')).returned_units,1);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,5000);
});

test('wrong Customer, unreviewed Party link, stale original and excess credit decline atomically',async()=>{
  const src=await seed();
  const before=await snap();
  for(const patch of [{customerId:'CUS-2'},{originalHash:'a'.repeat(64)},
    {creditPaisa:10001},{tenantId:'OTHER'}, {lotId:'UNRELATED'}]){
    assert.equal((await credit().post(request(src,'CREDIT-DECLINE01',patch))).status,'DECLINED');
    assert.deepEqual(await snap(),before);
  }
  await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
  const invalid=await snap();
  assert.equal((await credit().post(request(src,'CREDIT-DECLINE02'))).status,'DECLINED');
  assert.deepEqual(await snap(),invalid);
});

test('forged source sold units and closed Cash Session both reject with unchanged finances',async()=>{
  const src=await seed();
  await DB.prepare("UPDATE m07_source_lots SET sold_units=5 WHERE invoice_id='INV-A'").run();
  const bad=await snap();
  assert.equal((await credit().post(request(src,'CREDIT-FORGED001',{units:3,creditPaisa:15000}))).status,'DECLINED');
  assert.deepEqual(await snap(),bad);
  await DB.prepare("UPDATE m07_source_lots SET sold_units=2 WHERE invoice_id='INV-A'").run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  const closed=await snap();
  assert.equal((await credit().post(request(src,'CREDIT-CLOSED001'))).status,'DECLINED');
  assert.deepEqual(await snap(),closed);
});

test('failure injecting Customer ledger write rolls back credit, stock, receipt and quantity',async()=>{
  const src=await seed();
  const before=await snap();
  await DB.prepare(`CREATE TRIGGER m07_fail_credit_ledger BEFORE INSERT ON m07_credit_ledger
    BEGIN SELECT RAISE(ABORT,'fault-ledger'); END`).run();
  await assert.rejects(()=>credit().post(request(src,'CREDIT-FAULT0001')),/NEEDS_REVIEW/);
  assert.deepEqual(await snap(),before);
});

test('cash-to-credit duplicate operation and return ID is a conflict, not a second refund',async()=>{
  const src=await seed();
  const input=request(src,'CROSS-METHOD001');
  const cash={tenantId:input.tenantId,actorId:input.actorId,operationId:input.operationId,
    returnId:input.returnId,invoiceId:input.invoiceId,sku:input.sku,lotId:input.lotId,
    originalHash:input.originalHash,units:input.units,refundPaisa:7500,reason:input.reason};
  assert.equal((await createSyntheticD1CashReturnContract(DB).post(cash)).status,'COMMITTED');
  const before=await snap();
  assert.equal((await credit().post(input)).status,'CONFLICT');
  assert.deepEqual(await snap(),before);
});

test('credit-to-cash duplicate operation and return ID cannot post Cash debit',async()=>{
  const src=await seed();
  const input=request(src,'CROSS-METHOD002');
  assert.equal((await credit().post(input)).status,'COMMITTED');
  const before=await snap();
  const cash={tenantId:input.tenantId,actorId:input.actorId,operationId:input.operationId,
    returnId:input.returnId,invoiceId:input.invoiceId,sku:input.sku,lotId:input.lotId,
    originalHash:input.originalHash,units:input.units,refundPaisa:7500,reason:input.reason};
  assert.equal((await createSyntheticD1CashReturnContract(DB).post(cash)).status,'CONFLICT');
  assert.deepEqual(await snap(),before);
});

test('malformed input, missing Customer and unknown test route fail closed',async()=>{
  const src=await seed();
  for(const extra of [{units:0},{creditPaisa:-5},{reason:''},{customerId:''},{unexpected:true}])
    await assert.rejects(()=>credit().post(request(src,'CREDIT-INVALID01',extra)),/invalid|synthetic|customer/i);
  const response=await worker.fetch('http://m07.local/return',{method:'POST',body:'{}'});
  assert.equal(response.status,404);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m07_credit_returns')).n,0);
});

test('two independent verified invoice credits concurrently decrement the same selected account without lost update',async()=>{
  const a=await seed({id:'RACE-A',units:1});
  const b=await seed({id:'RACE-B',units:1});
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,20000);
  const results=await Promise.all([
    credit().post(request(a,'CREDIT-TWO-SALEA',{creditPaisa:5000})),
    credit().post(request(b,'CREDIT-TWO-SALEB',{creditPaisa:5000}))
  ]);
  assert.deepEqual(results.map(x=>x.status),['COMMITTED','COMMITTED']);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,10000);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m07_credit_ledger')).n,2);
  assert.equal((await one("SELECT payable_paisa FROM m06_supplier_accounts WHERE supplier_id='SUP-1'")).payable_paisa,4000);
});

test('injected return movement fault aborts all Stock and Store Credit effects',async()=>{
  const src=await seed();
  const before=await snap();
  await DB.prepare(`CREATE TRIGGER m07_fail_credit_stock BEFORE INSERT ON m07_return_movements
    BEGIN SELECT RAISE(ABORT,'fault-credit-stock-move'); END`).run();
  await assert.rejects(()=>credit().post(request(src,'CREDIT-STOCKFLT01')),/NEEDS_REVIEW/);
  assert.deepEqual(await snap(),before);
});
