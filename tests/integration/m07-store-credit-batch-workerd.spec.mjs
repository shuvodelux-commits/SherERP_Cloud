import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {createSyntheticD1CashBatchReturnContract} from '../fixtures/m07-cash-batch-contract.mjs';
import {createSyntheticD1CreditBatchReturnContract} from '../fixtures/m07-credit-batch-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {M07_CASH_BATCH_TEST_DDL} from '../fixtures/m07-cash-batch-schema.mjs';
import {M07_CREDIT_BATCH_TEST_DDL} from '../fixtures/m07-credit-batch-schema.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-credit-batch-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-credit-batch-workerd-test');
let DB;
const one=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const post=options=>createSyntheticD1CreditBatchReturnContract(DB,options);

async function sale(id,{sku='PIPE',units=1,customerId='CUS-1',paymentVersion='legacy',payments=[]}={}){
  const tenantId='SHOP-A',invoiceId='INV-'+id,lotId='LOT-'+id;
  assert.equal((await createSyntheticD1SalePostingContract(DB).post({
    tenantId,actorId:'SALE-CLERK',operationId:'OP-SALE-CREDIT-'+id+'-01',
    invoiceId,sku,units,unitPrice:'100.00',discount:'0',customerId,payments
  })).status,'COMMITTED');
  const {payload_hash:originalHash}=await DB.prepare(
    'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
  ).bind(tenantId,invoiceId).first();
  await DB.prepare('INSERT INTO m07_source_lots VALUES (?,?,?,?,?,0)')
    .bind(tenantId,invoiceId,sku,lotId,units).run();
  await DB.prepare('INSERT INTO m07_lot_stock VALUES (?,?,?,0)')
    .bind(tenantId,lotId,sku).run();
  await DB.prepare('INSERT INTO m07_batch_source_policy VALUES (?,?,?)')
    .bind(tenantId,invoiceId,paymentVersion).run();
  return {invoiceId,sku,lotId,originalHash};
}
async function initCustomerBalance(){
  for(const customerId of ['CUS-1','CUS-2']){
    const a=await DB.prepare(
      'SELECT due_paisa,party_id FROM m06_customer_accounts WHERE tenant_id=? AND customer_id=?'
    ).bind('SHOP-A',customerId).first();
    await DB.prepare('INSERT INTO m07_customer_signed_accounts VALUES (?,?,?,?,1)')
      .bind('SHOP-A',customerId,a.party_id,a.due_paisa).run();
  }
}
const child=(src,id,creditPaisa=7000,overrides={})=>({
  invoiceId:src.invoiceId,returnId:'RET-'+id,operationId:'OP-CREDIT-CHILD-'+id,
  sku:src.sku,lotId:src.lotId,originalHash:src.originalHash,
  units:1,creditPaisa,...overrides
});
const batch=(children,overrides={})=>({
  tenantId:'SHOP-A',actorId:'CREDIT-CLERK',operationId:'OP-CREDIT-BATCH-001',
  batchId:'SRB-CREDIT-1',customerId:'CUS-1',reason:'Damaged original',children,...overrides
});
async function sources(options={}){
  const a=await sale('A',{sku:'PIPE',...options});
  const b=await sale('B',{sku:'OTHER',...options});
  await initCustomerBalance();
  return {a,b,children:[child(a,'A-00001'),child(b,'B-00001',8000)]};
}
async function snapshot(){
  const queries={
    batch:'SELECT * FROM m07_credit_batches ORDER BY batch_id',
    members:'SELECT * FROM m07_credit_batch_members ORDER BY child_order',
    credit:'SELECT * FROM m07_credit_returns ORDER BY return_id',
    creditLedger:'SELECT * FROM m07_credit_ledger ORDER BY return_id',
    signed:'SELECT * FROM m07_customer_signed_accounts ORDER BY customer_id',
    cashBatches:'SELECT * FROM m07_cash_batches ORDER BY batch_id',
    cashReturns:'SELECT * FROM m07_cash_returns ORDER BY return_id',
    cashRefunds:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
    moves:'SELECT * FROM m07_return_movements ORDER BY return_id',
    sources:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
    lots:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
    product:'SELECT * FROM m06_owned_stock ORDER BY sku',
    originalCustomer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
    supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
    originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
    originalBank:'SELECT * FROM m06_bank_book ORDER BY invoice_id'
  };
  const out={};for(const [k,sql] of Object.entries(queries))out[k]=await all(sql);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const sql of M06_SALE_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CASH_BATCH_TEST_DDL)await DB.prepare(sql).run();
  for(const sql of M07_CREDIT_BATCH_TEST_DDL)await DB.prepare(sql).run();
  for(const [sql,values] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
  for(const name of ['m07_fail_batch_ledger','m07_fail_batch_move'])
    await DB.prepare('DROP TRIGGER IF EXISTS '+name).run();
  for(const name of ['m07_credit_batch_immutable_delete','m07_cash_batch_immutable_delete',
    'm07_receipt_immutable_delete','m07_credit_immutable_delete','m06_invoice_immutable_delete'])
    await DB.prepare('DROP TRIGGER '+name).run();
  for(const table of ['m07_credit_batch_members','m07_credit_batches','m07_cash_batch_members',
    'm07_cash_batches','m07_credit_ledger','m07_credit_returns','m07_cash_refunds',
    'm07_return_movements','m07_cash_returns','m07_lot_stock','m07_source_lots',
    'm07_batch_source_policy','m07_customer_signed_accounts',
    'm06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
    'm06_stock_movements','m06_sale_items','m06_invoices'])
    await DB.prepare('DELETE FROM '+table).run();
  for(const ddl of [
    "CREATE TRIGGER m07_credit_batch_immutable_delete BEFORE DELETE ON m07_credit_batches BEGIN SELECT RAISE(ABORT,'immutable-credit-batch'); END",
    "CREATE TRIGGER m07_cash_batch_immutable_delete BEFORE DELETE ON m07_cash_batches BEGIN SELECT RAISE(ABORT,'immutable-cash-batch'); END",
    "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-cash'); END",
    "CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns BEGIN SELECT RAISE(ABORT,'immutable-credit'); END",
    "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'immutable-invoice'); END"
  ])await DB.prepare(ddl).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END").run();
  await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>server.close());

test('two original invoices credit one signed Customer sequentially with no Cash, Bank or Supplier impact',async()=>{
  const {children}=await sources(),before=await snapshot();
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,20000);
  assert.deepEqual(await post().post(batch(children)),{
    status:'COMMITTED',batchId:'SRB-CREDIT-1',operationId:'OP-CREDIT-BATCH-001',
    returnIds:children.map(c=>c.returnId)
  });
  assert.deepEqual(await all('SELECT invoice_id,customer_id,credit_paisa,balance_paisa FROM m07_credit_ledger ORDER BY return_id'),[
    {invoice_id:'INV-A',customer_id:'CUS-1',credit_paisa:7000,balance_paisa:13000},
    {invoice_id:'INV-B',customer_id:'CUS-1',credit_paisa:8000,balance_paisa:5000}
  ]);
  assert.deepEqual(await all('SELECT invoice_id,return_id,child_order FROM m07_credit_batch_members ORDER BY child_order'),[
    {invoice_id:'INV-A',return_id:children[0].returnId,child_order:1},
    {invoice_id:'INV-B',return_id:children[1].returnId,child_order:2}
  ]);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,5000);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-2'")).signed_due_paisa,0);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='OTHER'")).available,4);
  const afterSnapshot=await snapshot();
  for(const x of ['originalCustomer','originalCash','originalBank','supplier','cashRefunds','cashReturns'])
    assert.deepEqual(afterSnapshot[x],before[x],x);
});

test('two fully paid original invoices can create a negative Customer advance without moving current Cash',async()=>{
  const {children}=await sources({payments:[{id:'PAY-1',method:'Cash',amount:'100'}]});
  const before=await snapshot();
  assert.equal((await post().post(batch(children))).status,'COMMITTED');
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,-15000);
  assert.deepEqual(await all('SELECT balance_paisa FROM m07_credit_ledger ORDER BY return_id'),[
    {balance_paisa:-7000},{balance_paisa:-15000}
  ]);
  const afterSnapshot=await snapshot();
  for(const x of ['originalCash','originalBank','supplier','originalCustomer'])assert.deepEqual(afterSnapshot[x],before[x]);
});

test('identical parent operation replays; changed amount, actor, reason or batch ID conflicts',async()=>{
  const {children}=await sources(),input=batch(children);
  assert.equal((await post().post(input)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await post().post(input),{
    status:'REPLAY',batchId:input.batchId,operationId:input.operationId,
    returnIds:children.map(c=>c.returnId)
  });
  for(const change of [
    {actorId:'OTHER-STAFF'},{reason:'Other'},
    {children:[{...children[0],creditPaisa:100},children[1]]},
    {batchId:'SRB-OTHER'}
  ])assert.equal((await post().post({...input,...change})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('single, 21 and duplicate invoice / child identities fail before financial writes',async()=>{
  const {children}=await sources(),before=await snapshot();
  for(const bad of [
    [children[0]],
    Array.from({length:21},(_,i)=>({...children[0],invoiceId:'INV-'+i,
      returnId:'RET-LIMIT-'+i,operationId:'OP-LIMIT-CREDIT-'+i})),
    [children[0],{...children[1],invoiceId:children[0].invoiceId}],
    [children[0],{...children[1],returnId:children[0].returnId}],
    [children[0],{...children[1],operationId:children[0].operationId}]
  ])await assert.rejects(()=>post().post(batch(bad)),/invalid|duplicate|2–20|invoice/i);
  assert.deepEqual(await snapshot(),before);
});

test('different original Customer and walk-in cannot enter Store Credit batch',async()=>{
  const a=await sale('A',{sku:'PIPE'});
  const b=await sale('B',{sku:'OTHER',customerId:'CUS-2'});
  await initCustomerBalance();
  const before=await snapshot();
  assert.equal((await post().post(batch([child(a,'A-00001'),child(b,'B-00001')]))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('split-payment original invoice is excluded despite valid Customer and stock',async()=>{
  const a=await sale('A',{sku:'PIPE'});
  const b=await sale('B',{sku:'OTHER',paymentVersion:'1',payments:[
    {id:'PAY-1',method:'Cash',amount:'50'},
    {id:'PAY-2',method:'Bank',accountId:'BANK-1',amount:'50'}
  ]});
  await initCustomerBalance();
  const before=await snapshot();
  assert.equal((await post().post(batch([child(a,'A-00001'),child(b,'B-00001')]))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('stale source hash, forged lot and unreviewed Customer link decline with no side effects',async()=>{
  const {children}=await sources();
  for(const patch of [{originalHash:'f'.repeat(64)},{lotId:'MISSING-LOT'}]){
    const before=await snapshot();
    assert.equal((await post().post(batch([{...children[0],...patch},children[1]]))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
  await DB.prepare("UPDATE m07_source_lots SET sold_units=5 WHERE invoice_id='INV-B'").run();
  const beforeForged=await snapshot();
  assert.equal((await post().post(batch(children))).status,'DECLINED');
  assert.deepEqual(await snapshot(),beforeForged);
  await DB.prepare("UPDATE m07_source_lots SET sold_units=1 WHERE invoice_id='INV-B'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
  const beforeUnreviewed=await snapshot();
  assert.equal((await post().post(batch(children))).status,'DECLINED');
  assert.deepEqual(await snapshot(),beforeUnreviewed);
});

test('closing Cash Session immediately before SQL claim refuses all child returns',async()=>{
  const {children}=await sources();
  const before=await snapshot();
  const w=post({beforeBatch:async()=>{
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await w.post(batch(children))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('second child ledger failure rolls back first child signed balance and restored stock',async()=>{
  const {children}=await sources(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_batch_ledger BEFORE INSERT ON m07_credit_ledger
    WHEN NEW.invoice_id='INV-B' BEGIN SELECT RAISE(ABORT,'second-credit-ledger-failed'); END`).run();
  await assert.rejects(()=>post().post(batch(children)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('second child movement failure rolls back parent, lot, credit, ledger and stock',async()=>{
  const {children}=await sources(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_fail_batch_move BEFORE INSERT ON m07_return_movements
    WHEN NEW.invoice_id='INV-B' BEGIN SELECT RAISE(ABORT,'second-credit-movement-failed'); END`).run();
  await assert.rejects(()=>post().post(batch(children)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('concurrent batches for remaining same original units credit only once',async()=>{
  const {children}=await sources();
  const other=children.map((c,i)=>({...c,returnId:'RET-OTHER-'+i,operationId:'OP-OTHER-CREDIT-'+i}));
  const results=await Promise.all([
    post().post(batch(children)),
    post().post(batch(other,{batchId:'SRB-CREDIT-2',operationId:'OP-CREDIT-BATCH-002'}))
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_credit_batches')).n,1);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_credit_ledger')).n,2);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_customer_signed_accounts WHERE customer_id='CUS-1'")).signed_due_paisa,5000);
});

test('Cash batch refuses reused Store Credit parent IDs even for unrelated original invoices',async()=>{
  const {children}=await sources();
  const input=batch(children);
  assert.equal((await post().post(input)).status,'COMMITTED');
  const a=await sale('C',{sku:'PIPE'}),b=await sale('D',{sku:'OTHER'});
  const cashChildren=[
    {...child(a,'C-00001'),refundPaisa:4000},
    {...child(b,'D-00001'),refundPaisa:5000}
  ].map(({creditPaisa,...c})=>c);
  const before=await snapshot();
  const cash={...input,children:cashChildren};
  // Existing Cash parent API reports DECLINED for a foreign-method receipt;
  // in-DB ID guard prevents a second economic write without revealing it.
  assert.equal((await createSyntheticD1CashBatchReturnContract(DB).post(cash)).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('Store Credit parent reports CONFLICT on an already committed Cash batch ID',async()=>{
  const {children}=await sources();
  const input=batch(children);
  const cashChildren=children.map(({creditPaisa,...c})=>({...c,refundPaisa:creditPaisa}));
  assert.equal((await createSyntheticD1CashBatchReturnContract(DB).post({
    ...input,children:cashChildren
  })).status,'COMMITTED');
  const a=await sale('C',{sku:'PIPE'}),b=await sale('D',{sku:'OTHER'});
  const before=await snapshot();
  const creditChild=[child(a,'C-00001'),child(b,'D-00001')];
  assert.equal((await post().post(batch(creditChild))).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('unsupported input shape and HTTP POST cannot create credit batches',async()=>{
  const {children}=await sources(),before=await snapshot();
  for(const value of [
    {...batch(children),sql:'DELETE FROM m07_credit_ledger'},
    batch(children,{customerId:''}),
    batch(children,{reason:''}),
    batch(children,{children:[{...children[0],creditPaisa:-1},children[1]]})
  ])await assert.rejects(()=>post().post(value),/invalid|credit|batch/i);
  assert.equal((await worker.fetch('http://m07.local/completeReturnBatch',{method:'POST',body:'{}'})).status,404);
  assert.deepEqual(await snapshot(),before);
});

test('SQL parent claim rejects any child whose return ID or operation ID aliases the parent',async()=>{
  const {children}=await sources();
  const input=batch(children);
  for(const changed of [
    [{...children[0],operationId:input.operationId},children[1]],
    [{...children[0],returnId:input.batchId},children[1]]
  ]){
    const before=await snapshot();
    const claim=await DB.prepare(
      'INSERT INTO m07_credit_batches VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(input.tenantId,input.batchId,input.operationId,input.actorId,
      input.customerId,input.reason,'a'.repeat(64),
      JSON.stringify(changed),changed.length,15000).run();
    assert.equal(claim.meta.changes,0,'DB must reject parent/child shared identity');
    assert.deepEqual(await snapshot(),before);
  }
});
