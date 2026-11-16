import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED,
 M06_CHILD_IMMUTABILITY_TABLES,M06_CHILD_IMMUTABILITY_DDL} from '../fixtures/m06-sale-posting-schema.mjs';
import {M07_CASH_TEST_DDL} from '../fixtures/m07-cash-return-schema.mjs';
import {createSyntheticD1StoreCreditContract} from '../fixtures/m07-store-credit-contract.mjs';
import {M07_CREDIT_DELETE_TEST_DDL,M07_CREDIT_DELETE_IMMUTABLE_TABLES,
 M07_CREDIT_DELETE_IMMUTABLE_DDL} from '../fixtures/m07-credit-delete-schema.mjs';
import {createSyntheticD1CreditDeleteContract} from '../fixtures/m07-credit-delete-contract.mjs';
import {M07_RETURN_EDIT_READ_DDL} from '../fixtures/m07-return-edit-read-schema.mjs';
import {M07_CREDIT_PRICE_EDIT_DDL,M07_CREDIT_PRICE_EDIT_IMMUTABLE,
 M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL} from '../fixtures/m07-credit-price-edit-schema.mjs';
import {createSyntheticD1CreditPriceEditContract} from '../fixtures/m07-credit-price-edit-contract.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-credit-price-edit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-credit-price-edit-workerd-test');
let DB;
const first=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(row=>({...row}));
const editor=options=>createSyntheticD1CreditPriceEditContract(DB,options);

async function source(id='A',{payments=[]}={}){
 const tenantId='SHOP-A',invoiceId='INV-CREDIT-PRICE-'+id,returnId='RET-CREDIT-PRICE-'+id,
  sku='PIPE',lotId='LOT-CREDIT-PRICE-'+id,customerId='CUS-1';
 const sale={tenantId,actorId:'ORIGINAL-CLERK',operationId:'OP-CREDIT-PRICE-SALE-'+id+'-001',
  invoiceId,sku,units:2,unitPrice:'100.00',discount:'0',customerId,payments};
 assert.equal((await createSyntheticD1SalePostingContract(DB).post(sale)).status,'COMMITTED');
 const {payload_hash:originalHash}=await DB.prepare(
  'SELECT payload_hash FROM m06_invoices WHERE tenant_id=? AND invoice_id=?'
 ).bind(tenantId,invoiceId).first();
 await DB.prepare('INSERT INTO m07_source_lots VALUES(?,?,?,?,?,0)')
  .bind(tenantId,invoiceId,sku,lotId,2).run();
 await DB.prepare('INSERT INTO m07_lot_stock VALUES(?,?,?,0)')
  .bind(tenantId,lotId,sku).run();
 for(const c of ['CUS-1','CUS-2']){
  const customer=await DB.prepare('SELECT party_id,due_paisa FROM m06_customer_accounts WHERE tenant_id=? AND customer_id=?')
   .bind(tenantId,c).first();
  await DB.prepare('INSERT INTO m07_customer_signed_accounts VALUES(?,?,?,?,1)')
   .bind(tenantId,c,customer.party_id,customer.due_paisa).run();
 }
 const credit={tenantId,actorId:'RETURN-CLERK',
  operationId:'OP-CREDIT-PRICE-RETURN-'+id+'-001',returnId,invoiceId,sku,lotId,
  originalHash,customerId,units:1,creditPaisa:7500,reason:'Original damaged fitting'};
 assert.equal((await createSyntheticD1StoreCreditContract(DB).post(credit)).status,'COMMITTED');
 return credit;
}
const request=(s,operationId='OP-CREDIT-PRICE-EDIT-001',patch={})=>({
 tenantId:s.tenantId,actorId:'MANAGER',operationId,
 returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
 originalHash:s.originalHash,customerId:s.customerId,expectedVersion:0,
 previousCreditPaisa:s.creditPaisa,newCreditPaisa:6800,
 reason:'Corrected unit credit price',...patch
});
async function snapshot(){
 const sql={
  invoices:'SELECT * FROM m06_invoices ORDER BY invoice_id',
  saleItems:'SELECT * FROM m06_sale_items ORDER BY invoice_id',
  saleMoves:'SELECT * FROM m06_stock_movements ORDER BY invoice_id',
  originalCash:'SELECT * FROM m06_cash_book ORDER BY invoice_id',
  originalBank:'SELECT * FROM m06_bank_book ORDER BY invoice_id',
  originalCustomer:'SELECT * FROM m06_customer_accounts ORDER BY customer_id',
  supplier:'SELECT * FROM m06_supplier_accounts ORDER BY supplier_id',
  shop:'SELECT * FROM m06_owned_stock ORDER BY sku',
  lots:'SELECT * FROM m07_source_lots ORDER BY invoice_id',
  lotStock:'SELECT * FROM m07_lot_stock ORDER BY lot_id',
  returns:'SELECT * FROM m07_credit_returns ORDER BY return_id',
  returnMoves:'SELECT * FROM m07_return_movements ORDER BY return_id',
  originalLedger:'SELECT * FROM m07_credit_ledger ORDER BY return_id',
  cashReturns:'SELECT * FROM m07_cash_returns ORDER BY return_id',
  cashRefunds:'SELECT * FROM m07_cash_refunds ORDER BY return_id',
  signed:'SELECT * FROM m07_customer_signed_accounts ORDER BY customer_id',
  active:'SELECT * FROM m07_credit_current_values ORDER BY return_id',
  revisions:'SELECT * FROM m07_credit_price_edit_receipts ORDER BY next_version',
  adjustments:'SELECT * FROM m07_credit_price_edit_ledger ORDER BY next_version',
  versions:'SELECT * FROM m07_return_edit_versions ORDER BY return_id',
  deletions:'SELECT * FROM m07_credit_delete_receipts ORDER BY return_id',
  dependencies:'SELECT * FROM m07_credit_price_edit_dependencies ORDER BY activity_id'
 };
 const out={};for(const [key,query] of Object.entries(sql))out[key]=await all(query);
 return out;
}
const originalUnchanged=(a,b)=>{
 for(const key of ['invoices','saleItems','saleMoves','originalCash',
  'originalBank','originalCustomer','supplier','shop','lots','lotStock',
  'returns','returnMoves','originalLedger','cashReturns','cashRefunds'])
  assert.deepEqual(a[key],b[key],key);
};
before(async()=>{
 await harness.listen();({DB}=await worker.getEnv());
 for(const statement of [...M06_SALE_TEST_DDL,...M07_CASH_TEST_DDL,
  ...M07_CREDIT_DELETE_TEST_DDL,...M07_RETURN_EDIT_READ_DDL,
  ...M07_CREDIT_PRICE_EDIT_DDL,...M07_CREDIT_DELETE_IMMUTABLE_DDL,
  ...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])await DB.prepare(statement).run();
 for(const [sql,args] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...args).run();
});
beforeEach(async()=>{
 for(const table of [...M07_CREDIT_PRICE_EDIT_IMMUTABLE,...M07_CREDIT_DELETE_IMMUTABLE_TABLES]){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_delete`).run();
 }
 for(const table of M06_CHILD_IMMUTABILITY_TABLES){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${table}_immutable_delete`).run();
 }
 for(const trig of ['m07_credit_price_fault_ledger','m07_credit_price_fault_account',
  'm07_credit_price_fault_version','m07_credit_immutable_delete',
  'm07_receipt_immutable_delete','m06_invoice_immutable_delete'])
  await DB.prepare(`DROP TRIGGER IF EXISTS ${trig}`).run();
 for(const table of [
  'm07_credit_price_edit_dependencies','m07_credit_price_edit_ledger',
  'm07_credit_price_edit_receipts','m07_return_edit_versions',
  'm07_credit_delete_ledger','m07_credit_delete_stock_undo',
  'm07_credit_delete_receipts','m07_credit_delete_dependencies',
  'm07_credit_ledger','m07_credit_returns',
  'm07_cash_refunds','m07_return_movements','m07_cash_returns',
  'm07_lot_stock','m07_source_lots','m07_customer_signed_accounts',
  'm06_customer_ledger','m06_bank_book','m06_cash_book',
  'm06_payment_children','m06_stock_movements','m06_sale_items','m06_invoices'
 ])await DB.prepare(`DELETE FROM ${table}`).run();
 for(const statement of [...M06_CHILD_IMMUTABILITY_DDL,
  ...M07_CREDIT_DELETE_IMMUTABLE_DDL,...M07_CREDIT_PRICE_EDIT_IMMUTABLE_DDL])
  await DB.prepare(statement).run();
 for(const statement of [
  "CREATE TRIGGER m07_credit_immutable_delete BEFORE DELETE ON m07_credit_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-credit'); END",
  "CREATE TRIGGER m07_receipt_immutable_delete BEFORE DELETE ON m07_cash_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-return'); END",
  "CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END"
 ])await DB.prepare(statement).run();
 await DB.prepare("UPDATE m06_owned_stock SET available=CASE WHEN sku='PIPE' THEN 2 ELSE 4 END").run();
 await DB.prepare('UPDATE m06_customer_accounts SET due_paisa=0').run();
 await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
 await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END").run();
});
after(async()=>harness.close());

test('reduced Store Credit debits exactly one Customer account, never Cash or stock',async()=>{
 const s=await source(),before=await snapshot(),input=request(s);
 assert.deepEqual(await editor().post(input),{
  status:'COMMITTED',operationId:input.operationId,returnId:input.returnId,version:1
 });
 const after=await snapshot();
 assert.deepEqual(after.adjustments.map(x=>({
  debit:x.debit_paisa,credit:x.credit_paisa,balance:x.balance_paisa,
  party:x.party_id})),[{debit:700,credit:0,balance:13200,party:'PARTY-1'}]);
 assert.equal(after.signed[0].signed_due_paisa,13200);
 assert.equal(after.signed[1].signed_due_paisa,0);
 assert.equal(after.active[0].active_credit_paisa,6800);
 assert.equal(after.active[0].original_credit_paisa,7500);
 assert.equal(after.versions[0].edit_version,1);
 originalUnchanged(after,before);
});

test('increased Store Credit credits only original Customer, permits signed advance',async()=>{
 const s=await source('ADV',{payments:[{id:'PAY1',method:'Cash',amount:'200'}]});
 const before=await snapshot();
 assert.equal((await editor().post(request(s,'OP-ADVANCE-CREDIT-001',{
  newCreditPaisa:8400}))).status,'COMMITTED');
 const after=await snapshot();
 assert.equal(after.adjustments[0].credit_paisa,900);
 assert.equal(after.adjustments[0].debit_paisa,0);
 assert.equal(after.signed[0].signed_due_paisa,-8400);
 assert.equal(after.active[0].active_credit_paisa,8400);
 originalUnchanged(after,before);
});

test('successive same-return prices chain signed balances and immutable versions',async()=>{
 const s=await source(),before=await snapshot();
 assert.equal((await editor().post(request(s,'OP-SEQUENCE-CREDIT-001',{
  newCreditPaisa:7000}))).status,'COMMITTED');
 assert.equal((await editor().post(request(s,'OP-SEQUENCE-CREDIT-002',{
  expectedVersion:1,previousCreditPaisa:7000,newCreditPaisa:8100}))).status,'COMMITTED');
 const after=await snapshot();
 assert.deepEqual(after.adjustments.map(x=>[x.debit_paisa,x.credit_paisa,x.balance_paisa]),
  [[500,0,13000],[0,1100,11900]]);
 assert.equal(after.signed[0].signed_due_paisa,11900);
 assert.equal(after.active[0].active_credit_paisa,8100);
 assert.equal(after.active[0].revision_version,2);
 originalUnchanged(after,before);
});

test('same immutable operation replays; changed actor, source, amount and reason conflict',async()=>{
 const s=await source(),x=request(s);
 assert.equal((await editor().post(x)).status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await editor().post(x),{
  status:'REPLAY',operationId:x.operationId,returnId:x.returnId,version:1
 });
 for(const patch of [{actorId:'FORGED'},{reason:'Edited after submission'},
  {newCreditPaisa:6600},{lotId:'LOT-WRONG'},{customerId:'CUS-2'}]){
  assert.equal((await editor().post({...x,...patch})).status,'CONFLICT');
 }
 assert.deepEqual(await snapshot(),before);
});

test('replay of an outdated operation after newer edit does not appear current',async()=>{
 const s=await source(),old=request(s,'OP-OLD-CREDIT-001');
 assert.equal((await editor().post(old)).status,'COMMITTED');
 assert.equal((await editor().post(request(s,'OP-NEW-CREDIT-001',{
  expectedVersion:1,previousCreditPaisa:6800,newCreditPaisa:7200}))).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await editor().post(old)).status,'CONFLICT');
 assert.deepEqual(await snapshot(),before);
});

test('concurrent same-version edits commit exactly one Customer adjustment',async()=>{
 const s=await source();
 const outcomes=await Promise.all([
  editor().post(request(s,'OP-RACE-CREDIT-001',{newCreditPaisa:6900})),
  editor().post(request(s,'OP-RACE-CREDIT-002',{newCreditPaisa:8000}))
 ]);
 assert.deepEqual(outcomes.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
 assert.equal((await first('SELECT COUNT(*) n FROM m07_credit_price_edit_receipts')).n,1);
 assert.equal((await first('SELECT COUNT(*) n FROM m07_credit_price_edit_ledger')).n,1);
 assert.equal((await first('SELECT edit_version FROM m07_return_edit_versions')).edit_version,1);
});

test('wrong tenant, invoice, lot, source, Customer and stale previous amount decline with no writes',async()=>{
 const s=await source(),before=await snapshot();
 for(const patch of [{tenantId:'SHOP-B'},{invoiceId:'INV-WRONG'},
  {sku:'OTHER'},{lotId:'LOT-WRONG'},{originalHash:'f'.repeat(64)},
  {customerId:'CUS-2'},{previousCreditPaisa:7501},{expectedVersion:1},
  {newCreditPaisa:10001},{newCreditPaisa:7500}]){
  assert.equal((await editor().post(request(s,'OP-INVALID-CREDIT-001',patch))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
 }
});

test('closed Cash Session and explicit settlement dependency block credit correction',async()=>{
 const s=await source(),x=request(s);
 await DB.prepare("UPDATE m06_cash_sessions SET state='Closed'").run();
 const closed=await snapshot();
 assert.equal((await editor().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),closed);
 await DB.prepare("UPDATE m06_cash_sessions SET state='Open'").run();
 await DB.prepare('INSERT INTO m07_credit_price_edit_dependencies VALUES(?,?,?,?)')
  .bind('SHOP-A',s.returnId,'CUS-1','SETTLEMENT-001').run();
 const dependent=await snapshot();
 assert.equal((await editor().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),dependent);
});

test('a later Customer Store Credit ledger entry prevents retroactive value editing',async()=>{
 const s=await source();
 await DB.prepare('INSERT INTO m07_credit_ledger VALUES(?,?,?,?,?,?,?)')
  .bind('SHOP-A','RET-LATER','INV-LATER','CUS-1','PARTY-1',100,12400).run();
 const before=await snapshot();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('unreviewed or changed Customer Party attribution and signed balance drift fail closed',async()=>{
 const s=await source();
 await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id='FORGED' WHERE source_id='CUS-1'").run();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 await DB.prepare("UPDATE m06_party_links SET party_id='PARTY-1' WHERE source_id='CUS-1'").run();
 await DB.prepare("UPDATE m07_customer_signed_accounts SET signed_due_paisa=signed_due_paisa+1 WHERE customer_id='CUS-1'").run();
 const before=await snapshot();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('tampered original Store Credit ledger or missing original lot movement declines',async()=>{
 const s=await source();
 await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7400').run();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 await DB.prepare('UPDATE m07_credit_ledger SET credit_paisa=7500').run();
 await DB.prepare('DELETE FROM m07_return_movements').run();
 const before=await snapshot();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('deleted original Store Credit has no editable amount',async()=>{
 const s=await source();
 const result=await createSyntheticD1CreditDeleteContract(DB).post({
  tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-DELETE-CREDIT-001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,customerId:s.customerId,
  units:s.units,creditPaisa:s.creditPaisa,reason:'Incorrect original return'
 });
 assert.equal(result.status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await editor().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('ledger failure rolls back version, signed balance and correction receipt',async()=>{
 const s=await source(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_credit_price_fault_ledger BEFORE INSERT ON m07_credit_price_edit_ledger BEGIN SELECT RAISE(ABORT,'ledger fault'); END").run();
 await assert.rejects(()=>editor().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('Customer account and version fault each roll back everything atomically',async()=>{
 const s=await source(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_credit_price_fault_account BEFORE UPDATE ON m07_customer_signed_accounts BEGIN SELECT RAISE(ABORT,'signed account fault'); END").run();
 await assert.rejects(()=>editor().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
 await DB.prepare('DROP TRIGGER m07_credit_price_fault_account').run();
 await DB.prepare("CREATE TRIGGER m07_credit_price_fault_version BEFORE INSERT ON m07_return_edit_versions BEGIN SELECT RAISE(ABORT,'version fault'); END").run();
 await assert.rejects(()=>editor().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('credit price correction receipts and adjustment ledger cannot be changed or deleted',async()=>{
 const s=await source();
 assert.equal((await editor().post(request(s))).status,'COMMITTED');
 for(const t of M07_CREDIT_PRICE_EDIT_IMMUTABLE){
  await assert.rejects(()=>DB.prepare(`UPDATE ${t} SET tenant_id='BAD'`).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM ${t}`).run(),/immutable/i);
 }
});

test('old deletion writer is blocked after price correction until version-aware undo',async()=>{
 const s=await source();
 assert.equal((await editor().post(request(s))).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await createSyntheticD1CreditDeleteContract(DB).post({
  tenantId:s.tenantId,actorId:'MANAGER',operationId:'OP-DELETE-OLD-CREDIT-001',
  returnId:s.returnId,invoiceId:s.invoiceId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,customerId:s.customerId,
  units:s.units,creditPaisa:s.creditPaisa,reason:'Needs versioned undo'
 })).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('invalid input fields, client authority injection and malformed amounts reject before writes',async()=>{
 const s=await source(),x=request(s),before=await snapshot();
 for(const bad of [null,{...x,sql:'UPDATE m06_owned_stock'},
  {...x,permission:'returns:edit'},{...x,operationId:'tiny'},
  {...x,reason:' '},{...x,newCreditPaisa:-1},
  {...x,newCreditPaisa:0.5},{...x,expectedVersion:-1},
  {...x,customerId:''}]){
  await assert.rejects(()=>editor().post(bad),/invalid|synthetic|shape/i);
 }
 assert.deepEqual(await snapshot(),before);
});

test('synthetic Worker exposes no public updateSalesReturn RPC',async()=>{
 const s=await source(),before=await snapshot();
 const response=await worker.fetch('https://m07.local/updateSalesReturn',{
  method:'POST',body:JSON.stringify({tenantId:s.tenantId,returnId:s.returnId})
 });
 assert.equal(response.status,404);
 assert.deepEqual(await snapshot(),before);
});
