import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {M07_PURCHASE_CASH_DDL} from '../fixtures/m07-purchase-cash-schema.mjs';
import {M07_PURCHASE_CREDIT_DDL} from '../fixtures/m07-purchase-supplier-credit-schema.mjs';
import {createSyntheticD1PurchaseSupplierCreditContract} from '../fixtures/m07-purchase-supplier-credit-contract.mjs';
import {M07_PURCHASE_CREDIT_DELETE_DDL,M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_DDL,
 M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_TABLES} from '../fixtures/m07-purchase-credit-delete-schema.mjs';
import {createSyntheticD1PurchaseCreditDeleteContract} from '../fixtures/m07-purchase-credit-delete-contract.mjs';

// All transactions here are synthetic and run in isolated real local Workerd/D1.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m07-purchase-credit-delete-test.jsonc'}]});
const worker=harness.getWorker('shererp-m07-purchase-credit-delete-workerd-test');
let DB;
const first=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const deletion=opts=>createSyntheticD1PurchaseCreditDeleteContract(DB,opts);

async function seed(id='A',{paidAmount='20.00'}={}){
 const base={tenantId:'SHOP-A',actorId:'BUYER-1',
  purchaseId:'PUR-'+id,operationId:'OP-PURCHASE-SUP-'+id+'-001',
  supplierId:'SUP-1',sku:'PIPE',qty:2,expectedVersion:1,
  unitPrice:'15.25',sellPrice:'18.00',discount:'0.50',
  paidAmount,date:'2026-11-10',paymentMethod:'Cash',
  bankAccountId:''};
 assert.equal((await createSyntheticPurchasePoster(DB).post(base)).status,'COMMITTED');
 const originalHash=(await DB.prepare('SELECT intent_hash FROM m05_purchases WHERE tenant_id=? AND purchase_id=?')
  .bind('SHOP-A',base.purchaseId).first()).intent_hash;
 const lotId='LOT-'+base.purchaseId,returnId='PRET-CREDIT-'+id;
 await DB.prepare('INSERT INTO m07_purchase_lot_balances VALUES(?,?,?,?,?)')
  .bind('SHOP-A',lotId,base.purchaseId,'PIPE',2).run();
 const supplier=await DB.prepare("SELECT party_id,payable_paisa FROM m05_suppliers WHERE tenant_id='SHOP-A' AND supplier_id='SUP-1'").first();
 await DB.prepare('INSERT INTO m07_purchase_supplier_signed VALUES(?,?,?,?,1)')
  .bind('SHOP-A','SUP-1',supplier.party_id,supplier.payable_paisa).run();
 const input={tenantId:'SHOP-A',actorId:'RETURN-CLERK',
  operationId:'OP-SUP-CREDIT-'+id+'-001',returnId,purchaseId:base.purchaseId,
  supplierId:'SUP-1',sku:'PIPE',lotId,originalHash,
  units:1,creditPaisa:1500,reason:'Damaged item'};
 assert.equal((await createSyntheticD1PurchaseSupplierCreditContract(DB).post(input)).status,'COMMITTED');
 return input;
}
function request(s,operationId='OP-SUP-CREDIT-DELETE-001',changes={}){
 return {tenantId:s.tenantId,actorId:'MANAGER',operationId,returnId:s.returnId,
  purchaseId:s.purchaseId,supplierId:s.supplierId,sku:s.sku,
  lotId:s.lotId,originalHash:s.originalHash,units:s.units,
  creditPaisa:s.creditPaisa,reason:'Correct mistaken Supplier Credit',...changes};
}
async function snapshot(){
 const q={
  purchases:'SELECT * FROM m05_purchases ORDER BY purchase_id',
  items:'SELECT * FROM m05_items ORDER BY purchase_id',
  sourceLots:'SELECT * FROM m05_lots ORDER BY lot_id',
  sourceMoves:'SELECT * FROM m05_movements ORDER BY purchase_id',
  originalCash:'SELECT * FROM m05_cash_book ORDER BY purchase_id',
  originalBank:'SELECT * FROM m05_bank_book ORDER BY purchase_id',
  sourceSupplierLedger:'SELECT * FROM m05_supplier_ledger ORDER BY purchase_id',
  nativeSuppliers:'SELECT * FROM m05_suppliers ORDER BY supplier_id',
  customer:'SELECT * FROM m05_unrelated_accounts ORDER BY party_id',
  product:'SELECT * FROM m05_products ORDER BY sku',
  lot:'SELECT * FROM m07_purchase_lot_balances ORDER BY lot_id',
  originalReturn:'SELECT * FROM m07_purchase_credit_returns ORDER BY return_id',
  originalLedger:'SELECT * FROM m07_purchase_credit_ledger ORDER BY return_id',
  originalReturnMove:'SELECT * FROM m07_purchase_return_moves ORDER BY return_id',
  supplierSigned:'SELECT * FROM m07_purchase_supplier_signed ORDER BY supplier_id',
  active:'SELECT * FROM m07_active_purchase_credit_returns ORDER BY return_id',
  corrections:'SELECT * FROM m07_purchase_credit_delete_receipts ORDER BY return_id',
  inverseMoves:'SELECT * FROM m07_purchase_credit_delete_moves ORDER BY return_id',
  inverseLedger:'SELECT * FROM m07_purchase_credit_delete_ledger ORDER BY return_id',
  cashReturns:'SELECT * FROM m07_purchase_cash_returns ORDER BY return_id',
  cashInflows:'SELECT * FROM m07_purchase_cash_inflows ORDER BY return_id',
  dependencies:'SELECT * FROM m07_purchase_credit_delete_dependencies ORDER BY activity_id'
 };
 const out={};for(const [k,sql] of Object.entries(q))out[k]=await all(sql);
 return out;
}
before(async()=>{
 await harness.listen();({DB}=await worker.getEnv());
 for(const sql of [...M05_PURCHASE_DDL,...M07_PURCHASE_CASH_DDL,
  ...M07_PURCHASE_CREDIT_DDL,...M07_PURCHASE_CREDIT_DELETE_DDL,
  ...M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_DDL])
  await DB.prepare(sql).run();
 for(const [sql,args] of M05_PURCHASE_SEED)await DB.prepare(sql).bind(...args).run();
 await DB.prepare("INSERT INTO m05_suppliers VALUES('SHOP-A','SUP-2','PARTY-2',1,7000)").run();
 await DB.prepare("INSERT INTO m05_party_links VALUES('SHOP-A','SUPPLIERS','SUP-2','PARTY-2',1)").run();
});
beforeEach(async()=>{
 for(const t of M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_TABLES){
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
  await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
 }
 for(const t of ['m07_inject_credit_delete_move','m07_inject_credit_delete_ledger',
   'm07_purchase_credit_immutable_delete','m07_purchase_cash_immutable_delete',
   'm05_receipt_delete_guard'])await DB.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
 for(const t of [
  'm07_purchase_credit_delete_dependencies','m07_purchase_credit_delete_ledger',
  'm07_purchase_credit_delete_moves','m07_purchase_credit_delete_receipts',
  'm07_purchase_credit_ledger','m07_purchase_credit_returns',
  'm07_purchase_cash_inflows','m07_purchase_return_moves','m07_purchase_cash_returns',
  'm07_purchase_supplier_signed','m07_purchase_lot_balances',
  'm05_supplier_ledger','m05_bank_book','m05_cash_book','m05_movements',
  'm05_lots','m05_items','m05_purchases'])
  await DB.prepare(`DELETE FROM ${t}`).run();
 for(const sql of M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_DDL)await DB.prepare(sql).run();
 await DB.prepare("CREATE TRIGGER m07_purchase_credit_immutable_delete BEFORE DELETE ON m07_purchase_credit_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-credit-return'); END").run();
 await DB.prepare("CREATE TRIGGER m07_purchase_cash_immutable_delete BEFORE DELETE ON m07_purchase_cash_returns BEGIN SELECT RAISE(ABORT,'m07-immutable-cash-return'); END").run();
 await DB.prepare("CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'m05-immutable-purchase'); END").run();
 await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
 await DB.prepare("UPDATE m05_suppliers SET payable_paisa=CASE supplier_id WHEN 'SUP-1' THEN 4000 ELSE 7000 END,active=1,party_id=CASE supplier_id WHEN 'SUP-1' THEN 'PARTY-1' ELSE 'PARTY-2' END WHERE tenant_id='SHOP-A'").run();
 await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id=CASE source_id WHEN 'SUP-1' THEN 'PARTY-1' ELSE 'PARTY-2' END WHERE tenant_id='SHOP-A'").run();
 await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
});
after(async()=>harness.close());

test('exact original-lot correction restores signed Supplier due and no Cash, Bank, Customer, or unrelated Supplier',async()=>{
 const s=await seed(),before=await snapshot(),input=request(s);
 assert.equal(before.active.length,1);
 assert.equal(before.supplierSigned.find(x=>x.supplier_id==='SUP-1').signed_due_paisa,3500);
 assert.deepEqual(await deletion().post(input),{
  status:'COMMITTED',operationId:input.operationId,returnId:s.returnId});
 const after=await snapshot();
 assert.equal(after.active.length,0);
 assert.equal(after.lot[0].remaining,2);
 assert.equal(after.product.find(x=>x.sku==='PIPE').stock,5);
 assert.equal(after.supplierSigned.find(x=>x.supplier_id==='SUP-1').signed_due_paisa,5000);
 assert.equal(after.supplierSigned.find(x=>x.supplier_id==='SUP-2')?.signed_due_paisa,undefined);
 assert.deepEqual(after.inverseMoves.map(x=>[x.return_id,x.lot_id,x.units_in]),
  [[s.returnId,s.lotId,1]]);
 assert.deepEqual(after.inverseLedger.map(x=>[x.return_id,x.supplier_id,x.debit_paisa,x.balance_paisa]),
  [[s.returnId,'SUP-1',1500,5000]]);
 for(const k of ['purchases','items','sourceLots','sourceMoves','originalCash',
  'originalBank','sourceSupplierLedger','nativeSuppliers','customer',
  'originalReturn','originalLedger','originalReturnMove','cashReturns','cashInflows'])
  assert.deepEqual(after[k],before[k],k);
});

test('negative signed Supplier advance after fully-paid source is restored to zero exactly',async()=>{
 await DB.prepare("UPDATE m05_suppliers SET payable_paisa=0 WHERE supplier_id='SUP-1'").run();
 const s=await seed('PAID',{paidAmount:'30.00'}),before=await snapshot();
 assert.equal(before.supplierSigned[0].signed_due_paisa,-1500);
 assert.equal((await deletion().post(request(s))).status,'COMMITTED');
 const after=await snapshot();
 assert.equal(after.supplierSigned[0].signed_due_paisa,0);
 for(const k of ['originalCash','originalBank','nativeSuppliers','customer'])
  assert.deepEqual(after[k],before[k],k);
});

test('unpaid original purchase Supplier Credit correction never creates Cash entry',async()=>{
 const s=await seed('UNPAID',{paidAmount:'0'}),before=await snapshot();
 assert.equal(before.originalCash.length,0);
 assert.equal((await deletion().post(request(s))).status,'COMMITTED');
 assert.equal((await first("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,7000);
 const after=await snapshot();
 assert.deepEqual(after.originalCash,before.originalCash);
 assert.deepEqual(after.originalBank,before.originalBank);
});

test('exact replay is inert; changed intent, actor, return or operation identity conflict',async()=>{
 const s=await seed(),input=request(s);
 assert.equal((await deletion().post(input)).status,'COMMITTED');
 const before=await snapshot();
 assert.deepEqual(await deletion().post(input),
  {status:'REPLAY',operationId:input.operationId,returnId:input.returnId});
 for(const patch of [{actorId:'OTHER'},{reason:'Other reason'},
  {creditPaisa:1400},{originalHash:'f'.repeat(64)},
  {returnId:'PRET-OTHER'},{operationId:'OP-SUP-CREDIT-DELETE-002'}])
  assert.equal((await deletion().post({...input,...patch})).status,'CONFLICT');
 assert.deepEqual(await snapshot(),before);
});

test('concurrent competing delete operations result in exactly one Supplier and lot restoration',async()=>{
 const s=await seed();
 const [a,b]=await Promise.all([
  deletion().post(request(s,'OP-SUP-DELETE-RACE-001')),
  deletion().post(request(s,'OP-SUP-DELETE-RACE-002'))]);
 assert.deepEqual([a.status,b.status].sort(),['COMMITTED','CONFLICT']);
 assert.equal((await first('SELECT COUNT(*) n FROM m07_purchase_credit_delete_receipts')).n,1);
 assert.equal((await first('SELECT remaining FROM m07_purchase_lot_balances')).remaining,2);
 assert.equal((await first('SELECT signed_due_paisa FROM m07_purchase_supplier_signed')).signed_due_paisa,5000);
});

test('wrong tenant, supplier, purchase, lot, SKU, qty, source hash or credit cannot reverse',async()=>{
 const s=await seed(),x=request(s),before=await snapshot();
 for(const patch of [
  {tenantId:'SHOP-B'},{supplierId:'SUP-2'},{purchaseId:'PUR-OTHER'},
  {sku:'BUNDLE'},{lotId:'LOT-UNRELATED'},{originalHash:'f'.repeat(64)},
  {units:2},{creditPaisa:1501}
 ]){
  assert.equal((await deletion().post({...x,...patch})).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
 }
});

test('forged original Credit ledger and stock movement evidence are rejected without any mutation',async()=>{
 const s=await seed(),x=request(s);
 await DB.prepare('UPDATE m07_purchase_credit_ledger SET credit_paisa=1499').run();
 const before=await snapshot();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
 await DB.prepare('UPDATE m07_purchase_credit_ledger SET credit_paisa=1500').run();
 await DB.prepare('UPDATE m07_purchase_return_moves SET units_out=2').run();
 const stale=await snapshot();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),stale);
});

test('later active Supplier Credit blocks earlier correction; reverse latest first',async()=>{
 const s=await seed();
 const second={...s,actorId:'RETURN-CLERK',operationId:'OP-SUP-CREDIT-LATER-001',
  returnId:'PRET-CREDIT-LATER',reason:'Another damaged unit'};
 assert.equal((await createSyntheticD1PurchaseSupplierCreditContract(DB).post(second)).status,'COMMITTED');
 const before=await snapshot();
 assert.equal((await deletion().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
 assert.equal((await deletion().post(request(second,'OP-SUP-DELETE-LATER-001'))).status,'COMMITTED');
 assert.equal((await deletion().post(request(s,'OP-SUP-DELETE-EARLIER-001'))).status,'COMMITTED');
 assert.equal((await first("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,5000);
});

test('overfilled original lot cannot be restored and no unrelated purchased lot is touched',async()=>{
 const s=await seed();
 await DB.prepare('UPDATE m07_purchase_lot_balances SET remaining=2').run();
 const before=await snapshot();
 assert.equal((await deletion().post(request(s))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('stale reviewed Supplier Party, reassigned identity and balance drift all fail closed',async()=>{
 const s=await seed(),x=request(s);
 await DB.prepare("UPDATE m05_party_links SET reviewed=0 WHERE source_id='SUP-1'").run();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id='PARTY-2' WHERE source_id='SUP-1'").run();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 await DB.prepare("UPDATE m05_party_links SET party_id='PARTY-1' WHERE source_id='SUP-1'").run();
 await DB.prepare("UPDATE m07_purchase_supplier_signed SET signed_due_paisa=3499 WHERE supplier_id='SUP-1'").run();
 const before=await snapshot();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});

test('dependent Supplier settlement marker and closed Cash Session decline without balance change',async()=>{
 const s=await seed(),x=request(s);
 await DB.prepare('INSERT INTO m07_purchase_credit_delete_dependencies VALUES(?,?,?,?)')
  .bind('SHOP-A',s.returnId,'SUP-1','SETTLEMENT-1').run();
 const marked=await snapshot();
 assert.equal((await deletion().post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),marked);
 await DB.prepare('DELETE FROM m07_purchase_credit_delete_dependencies').run();
 const original=await snapshot();
 const contract=deletion({beforeBatch:async()=>{
  await DB.prepare("UPDATE m05_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
 }});
 assert.equal((await contract.post(x)).status,'DECLINED');
 assert.deepEqual(await snapshot(),original);
});

test('injected inverse signed Supplier ledger failure aborts stock/lot/account and receipt atomically',async()=>{
 const s=await seed(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_inject_credit_delete_ledger BEFORE INSERT ON m07_purchase_credit_delete_ledger BEGIN SELECT RAISE(ABORT,'supplier-ledger-fault'); END").run();
 await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('injected inverse original-stock movement failure rolls back all signed Supplier undo',async()=>{
 const s=await seed(),before=await snapshot();
 await DB.prepare("CREATE TRIGGER m07_inject_credit_delete_move BEFORE INSERT ON m07_purchase_credit_delete_moves BEGIN SELECT RAISE(ABORT,'supplier-stock-fault'); END").run();
 await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
 assert.deepEqual(await snapshot(),before);
});

test('correction receipt, inverse movement and inverse ledger immutable and test Worker exposes no route',async()=>{
 const s=await seed();
 assert.equal((await deletion().post(request(s))).status,'COMMITTED');
 for(const t of M07_PURCHASE_CREDIT_DELETE_IMMUTABLE_TABLES){
  await assert.rejects(()=>DB.prepare(`UPDATE ${t} SET tenant_id='BAD'`).run(),/immutable/i);
  await assert.rejects(()=>DB.prepare(`DELETE FROM ${t}`).run(),/immutable/i);
 }
 assert.equal((await worker.fetch('https://m07.local/__supplier_credit_delete__',{
  method:'POST',body:'{}'})).status,404);
});

test('hostile shape, insufficient operation ID, zero amount and unexpected SQL rejected pre-write',async()=>{
 const s=await seed(),x=request(s),before=await snapshot();
 for(const v of [null,{...x,units:0},{...x,creditPaisa:-1},{...x,reason:' '},
  {...x,operationId:'short'},{...x,supplierId:''},
  {...x,originalHash:'invalid'},{...x,arbitrarySQL:'DROP TABLE m05_suppliers'}])
  await assert.rejects(()=>deletion().post(v),/invalid|synthetic|shape/i);
 assert.deepEqual(await snapshot(),before);
});

test('original Supplier Credit operation ID must not be reused as correction operation',async()=>{
 const s=await seed(),before=await snapshot();
 assert.equal((await deletion().post(request(s,s.operationId))).status,'DECLINED');
 assert.deepEqual(await snapshot(),before);
});
