import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1CashReturnContract} from '../fixtures/m07-cash-return-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {M07_CASH_BATCH_TEST_DDL} from '../fixtures/m07-cash-batch-schema.mjs';
import {createSyntheticD1CashBatchReturnContract} from '../fixtures/m07-cash-batch-contract.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-cash-batch-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-cash-batch-workerd-test');
let DB;
const row=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const writer=()=>createSyntheticD1CashBatchReturnContract(DB);

async function sale(id,options={}){
  const {sku='PIPE',units=1,customerId='CUS-1',paymentVersion='legacy',
    payments=[]}=options;
  const tenantId='SHOP-A',invoiceId='INV-'+id,lotId='LOT-'+id;
  const result=await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'SALE-CLERK',operationId:'OP-SALE-'+id+'-00001',
    invoiceId,sku,units,unitPrice:'100.00',discount:'0',customerId,payments
  });
  assert.equal(result.status,'COMMITTED');
  const {payload_hash:originalHash}=await DB.prepare(
    'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
  ).bind(tenantId,invoiceId).first();
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,units).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  await DB.prepare('INSERT INTO m07_batch_source_policy VALUES (?,?,?)')
    .bind(tenantId,invoiceId,paymentVersion).run();
  return {invoiceId,sku,lotId,originalHash,customerId};
}
function child(src,id,patch={}){
  return {
    invoiceId:src.invoiceId,returnId:'RET-'+id,operationId:'OP-CHILD-'+id,
    sku:src.sku,lotId:src.lotId,originalHash:src.originalHash,
    units:1,refundPaisa:7000,...patch
  };
}
function batch(children,patch={}){
  return {
    tenantId:'SHOP-A',actorId:'RETURN-CLERK',operationId:'OP-BATCH-000001',
    batchId:'SRB-BATCH-1',customerId:'CUS-1',reason:'Broken part',
    children,...patch
  };
}
async function sources(){
  const a=await sale('A',{sku:'PIPE'});
  const b=await sale('B',{sku:'OTHER'});
  return {a,b,children:[child(a,'A-00001'),child(b,'B-00001')]};
}
async function snapshot(){
  const q={
    batches:'SELECT * FROM m07_cash_batches ORDER BY batch_id',
    batchMembers:'SELECT * FROM m07_cash_batch_members ORDER BY return_id',
    cash:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    refunds:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    movements:'SELECT * FROM m07_return_movements ORDER BY return_id',
    source:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lots:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    stock:'SELECT * FROM m06_owned_stock ORDER BY sku',
    customers:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    suppliers:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    bank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
    originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id'
  };
  const output={};
  for(const [k,v] of Object.entries(q))output[k]=await all(v);
  return output;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const sql of M06_SALE_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_BATCH_TEST_DDL)await DB.prepare(sql).run();
  for(const [sql,values] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
  for(const t of ['m07_fail_batch_refund','m07_fail_batch_move'])
    await DB.prepare('DROP TRIGGER IF EXISTS '+t).run();
  for(const t of ['m07_cash_batches','m07_cash_returns','m06_invoices'])
    await DB.prepare('DROP TRIGGER '+(
      t==='m07_cash_batches'?'m07_cash_batch_immutable_delete':
      t==='m07_cash_returns'?'m07_receipt_immutable_delete':'m06_invoice_immutable_delete')).run();
  for(const t of ['m07_cash_batch_members','m07_cash_batches','m07_cash_refunds','m07_return_movements',
    'm07_cash_returns','m07_credit_ledger','m07_credit_returns','m07_lot_stock','m07_source_lots',
    'm07_batch_source_policy','m07_customer_signed_accounts',
    'm06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
    'm06_stock_movements','m06_sale_items','m06_invoices'])
    await DB.prepare('DELETE FROM '+t).run();
  for(const sql of [
    "CREATE TRIGGER m07_cash_batch_immutable_delete BEFORE DELETE ON m07_cash_batches BEGIN SELECT RAISE(ABORT,'immutable-batch'); END",
    "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-return'); END",
    "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'immutable-invoice'); END"
  ])await DB.prepare(sql).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>server.close());

test('two eligible original invoices commit two native Cash returns as one grouped D1 event',async()=>{
  const {children}=await sources();
  const before=await snapshot();
  assert.deepEqual(await writer().post(batch(children)),{
    status:'COMMITTED',batchId:'SRB-BATCH-1',operationId:'OP-BATCH-000001',
    returnIds:children.map(x=>x.returnId)
  });
  assert.deepEqual(await all('SELECT invoice_id,return_id FROM m07_cash_returns ORDER BY invoice_id'),[
    {invoice_id:'INV-A',return_id:children[0].returnId},
    {invoice_id:'INV-B',return_id:children[1].returnId}
  ]);
  assert.deepEqual(await all('SELECT invoice_id,return_id FROM m07_cash_batch_members ORDER BY invoice_id'),[
    {invoice_id:'INV-A',return_id:children[0].returnId},
    {invoice_id:'INV-B',return_id:children[1].returnId}
  ]);
  assert.deepEqual(await all('SELECT debit_paisa FROM m07_cash_refunds ORDER BY return_id'),[
    {debit_paisa:7000},{debit_paisa:7000}
  ]);
  assert.equal((await row("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
  assert.equal((await row("SELECT available FROM m06_owned_stock WHERE sku='OTHER'")).available,4);
  assert.equal((await row("SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,20000);
  assert.deepEqual((await snapshot()).suppliers,before.suppliers);
  assert.deepEqual((await snapshot()).bank,before.bank);
  assert.deepEqual((await snapshot()).originalCash,before.originalCash);
});

test('identical parent replay has no second stock or refund, changed child amount or actor conflict',async()=>{
  const {children}=await sources(),input=batch(children);
  assert.equal((await writer().post(input)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await writer().post(input),{
    status:'REPLAY',batchId:input.batchId,operationId:input.operationId,
    returnIds:children.map(c=>c.returnId)
  });
  for(const patch of [
    {actorId:'DIFFERENT'},
    {children:[{...children[0],refundPaisa:4000},children[1]]},
    {batchId:'SRB-DIFFERENT'}
  ])assert.equal((await writer().post({...input,...patch})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('single contributing invoice, 21 invoice inputs and duplicate invoices fail before D1 writes',async()=>{
  const {children}=await sources(),before=await snapshot();
  for(const c of [
    [children[0]],
    Array.from({length:21},(_,i)=>({...children[0],invoiceId:'INV-'+i,returnId:'RET-'+i,operationId:'OP-CHILD-LIMIT-'+i})),
    [children[0],{...children[1],invoiceId:children[0].invoiceId}]
  ])await assert.rejects(()=>writer().post(batch(c)),/batch|duplicate|between|invoice/i);
  assert.deepEqual(await snapshot(),before);
});

test('walk-in and mixed Customer source invoices decline with zero effects',async()=>{
  const a=await sale('A',{sku:'PIPE',customerId:'CUS-1'});
  const b=await sale('B',{sku:'OTHER',customerId:'',payments:[{id:'W1',method:'Cash',amount:'100'}]});
  const before=await snapshot();
  const result=await writer().post(batch([child(a,'A-00001'),child(b,'B-00001')]));
  assert.equal(result.status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('original payment detail version 1 rejects split-tender invoice even for matching Customer',async()=>{
  const a=await sale('A',{sku:'PIPE',paymentVersion:'legacy'});
  const b=await sale('B',{sku:'OTHER',paymentVersion:'1',payments:[
    {id:'C1',method:'Cash',amount:'50'},
    {id:'B1',method:'Bank',accountId:'BANK-1',amount:'50'}
  ]});
  const before=await snapshot();
  assert.equal((await writer().post(batch([child(a,'A-00001'),child(b,'B-00001')]))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('stale source receipt hash, forged original lot or unreviewed Customer link decline',async()=>{
  const {children}=await sources();
  for(const mutate of [
    async()=>DB.prepare("UPDATE m07_source_lots SET sold_units=3 WHERE invoice_id='INV-B'").run(),
    async()=>DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run()
  ]){
    const before=await snapshot();
    assert.equal((await writer().post(batch([{...children[0],originalHash:'f'.repeat(64)},children[1]]))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
    await mutate();
    const altered=await snapshot();
    assert.equal((await writer().post(batch(children))).status,'DECLINED');
    assert.deepEqual(await snapshot(),altered);
  }
});

test('Cash Session closed just before batch SQL claim leaves all child records absent',async()=>{
  const {children}=await sources();
  const before=await snapshot();
  const posting=createSyntheticD1CashBatchReturnContract(DB,{beforeBatch:async()=>{
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await posting.post(batch(children))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('fault on second child Cash refund rolls back first child receipt, money, stock and parent',async()=>{
  const {children}=await sources(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_batch_refund BEFORE INSERT ON m07_cash_refunds
    WHEN NEW.invoice_id='INV-B' BEGIN SELECT RAISE(ABORT,'second-child-cash-fault'); END`).run();
  await assert.rejects(()=>writer().post(batch(children)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('fault on second child stock movement rolls back full batch and original customer balances',async()=>{
  const {children}=await sources(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_batch_move BEFORE INSERT ON m07_return_movements
    WHEN NEW.invoice_id='INV-B' BEGIN SELECT RAISE(ABORT,'second-child-stock-fault'); END`).run();
  await assert.rejects(()=>writer().post(batch(children)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('concurrent distinct batches for the same final original units do not both commit',async()=>{
  const {children}=await sources();
  const next=children.map((c,i)=>({...c,returnId:'RET-RACE-'+i,operationId:'OP-RACE-CHILD-'+i}));
  const results=await Promise.all([
    writer().post(batch(children)),
    writer().post(batch(next,{operationId:'OP-BATCH-000002',batchId:'SRB-BATCH-2'}))
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await row('SELECT COUNT(*) n FROM m07_cash_batches')).n,1);
  assert.equal((await row('SELECT COUNT(*) n FROM m07_cash_refunds')).n,2);
});

test('single Cash Return before batch prevents double restoration; individual retry after batch conflicts',async()=>{
  const {children,a}=await sources();
  assert.equal((await createSyntheticD1CashReturnContract(DB).post({
    tenantId:'SHOP-A',actorId:'RETURN-CLERK',operationId:'OP-SINGLE-00001',returnId:'RET-SINGLE-1',
    invoiceId:a.invoiceId,sku:a.sku,lotId:a.lotId,originalHash:a.originalHash,
    units:1,refundPaisa:7000,reason:'Broken part'
  })).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await writer().post(batch(children))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('invalid batch shape, wrong tenant and arbitrary HTTP POST cannot create financial data',async()=>{
  const {children}=await sources();
  const before=await snapshot();
  for(const bad of [
    {...batch(children),bad:'SELECT 1'},
    batch(children,{customerId:''}),batch(children,{batchId:''}),
    batch(children,{reason:''})
  ])await assert.rejects(()=>writer().post(bad),/invalid|batch/i);
  assert.equal((await writer().post(batch(children,{tenantId:'SHOP-B'}))).status,'DECLINED');
  assert.equal((await worker.fetch('http://m07.local/completeReturnBatch',{method:'POST',body:'{}'})).status,404);
  assert.deepEqual(await snapshot(),before);
});
