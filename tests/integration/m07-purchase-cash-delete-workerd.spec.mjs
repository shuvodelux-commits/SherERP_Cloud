import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {M07_PURCHASE_CASH_DDL} from '../fixtures/m07-purchase-cash-schema.mjs';
import {createSyntheticD1PurchaseCashReturnContract} from '../fixtures/m07-purchase-cash-contract.mjs';
import {M07_PURCHASE_CASH_DELETE_DDL,M07_PURCHASE_CASH_DELETE_IMMUTABLE_DDL,
 M07_PURCHASE_CASH_DELETE_IMMUTABLE_TABLES} from '../fixtures/m07-purchase-cash-delete-schema.mjs';
import {createSyntheticD1PurchaseCashDeleteContract} from '../fixtures/m07-purchase-cash-delete-contract.mjs';

// Only the synthetic Workerd fixture has a D1 binding; the Worker has no RPC.
const server=createTestHarness({workers:[{configPath:'./wrangler.m07-purchase-cash-delete-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-purchase-cash-delete-workerd-test');
let DB;
const all=async sql=>(await DB.prepare(sql).all()).results.map(row=>({...row}));
const one=sql=>DB.prepare(sql).first();
const deletion=opts=>createSyntheticD1PurchaseCashDeleteContract(DB,opts);
async function purchaseReturn(id='A',options={}){
  const source={tenantId:'SHOP-A',actorId:'BUYER',purchaseId:'PUR-'+id,
    operationId:'OP-PURCHASE-'+id+'-001',supplierId:'SUP-1',
    sku:'PIPE',qty:2,expectedVersion:1,unitPrice:'15.25',
    sellPrice:'18.00',discount:'0.50',paidAmount:'20.00',
    date:'2026-11-10',paymentMethod:'Cash',bankAccountId:'',
    ...options};
  assert.equal((await createSyntheticPurchasePoster(DB).post(source)).status,'COMMITTED');
  const originalHash=(await DB.prepare('SELECT intent_hash FROM m05_purchases WHERE tenant_id=? AND purchase_id=?')
    .bind(source.tenantId,source.purchaseId).first()).intent_hash;
  const lotId='LOT-'+source.purchaseId,returnId='PRET-'+id;
  await DB.prepare('INSERT INTO m07_purchase_lot_balances VALUES (?,?,?,?,?)')
    .bind(source.tenantId,lotId,source.purchaseId,source.sku,source.qty).run();
  const cashReturn={tenantId:source.tenantId,actorId:'RETURN-CLERK',
    operationId:'OP-PUR-RETURN-'+id+'-001',returnId,
    purchaseId:source.purchaseId,sku:source.sku,lotId,originalHash,
    units:1,refundPaisa:1500,reason:'Original damaged'};
  assert.equal((await createSyntheticD1PurchaseCashReturnContract(DB).post(cashReturn)).status,'COMMITTED');
  return cashReturn;
}
const request=(s,operationId='OP-PUR-CASH-DELETE-001',patch={})=>({
  tenantId:s.tenantId,actorId:'MANAGER',operationId,returnId:s.returnId,
  purchaseId:s.purchaseId,sku:s.sku,lotId:s.lotId,
  originalHash:s.originalHash,units:s.units,refundPaisa:s.refundPaisa,
  reason:'Correct mistaken purchase refund',...patch
});
async function snapshot(){
  const q={
    purchase:'SELECT * FROM m05_purchases ORDER BY purchase_id',
    items:'SELECT * FROM m05_items ORDER BY purchase_id',
    sourceLots:'SELECT * FROM m05_lots ORDER BY lot_id',
    sourceMoves:'SELECT * FROM m05_movements ORDER BY purchase_id',
    remaining:'SELECT * FROM m07_purchase_lot_balances ORDER BY lot_id',
    product:'SELECT * FROM m05_products ORDER BY sku',
    supplier:'SELECT * FROM m05_suppliers ORDER BY supplier_id',
    supplierLedger:'SELECT * FROM m05_supplier_ledger ORDER BY purchase_id',
    otherParty:'SELECT * FROM m05_unrelated_accounts ORDER BY party_id',
    originalCash:'SELECT * FROM m05_cash_book ORDER BY purchase_id',
    originalBank:'SELECT * FROM m05_bank_book ORDER BY purchase_id',
    returnReceipt:'SELECT * FROM m07_purchase_cash_returns ORDER BY return_id',
    active:'SELECT * FROM m07_active_purchase_cash_returns ORDER BY return_id',
    originalReturnMoves:'SELECT * FROM m07_purchase_return_moves ORDER BY return_id',
    originalInflow:'SELECT * FROM m07_purchase_cash_inflows ORDER BY return_id',
    correction:'SELECT * FROM m07_purchase_cash_delete_receipts ORDER BY return_id',
    reverseMoves:'SELECT * FROM m07_purchase_cash_delete_moves ORDER BY return_id',
    cashOffsets:'SELECT * FROM m07_purchase_cash_delete_offsets ORDER BY return_id',
    dependencies:'SELECT * FROM m07_purchase_cash_delete_dependencies ORDER BY activity_id'
  };
  const out={};for(const [k,sql] of Object.entries(q))out[k]=await all(sql);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const sql of [...M05_PURCHASE_DDL,...M07_PURCHASE_CASH_DDL,
    ...M07_PURCHASE_CASH_DELETE_DDL,...M07_PURCHASE_CASH_DELETE_IMMUTABLE_DDL])
    await DB.prepare(sql).run();
  for(const [sql,args] of M05_PURCHASE_SEED)await DB.prepare(sql).bind(...args).run();
});
beforeEach(async()=>{
  for(const t of M07_PURCHASE_CASH_DELETE_IMMUTABLE_TABLES){
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_update`).run();
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}_immutable_delete`).run();
  }
  for(const t of ['m07_fail_reverse_move','m07_fail_cash_offset',
    'm05_receipt_delete_guard','m07_purchase_cash_immutable_delete'])
    await DB.prepare(`DROP TRIGGER IF EXISTS ${t}`).run();
  for(const t of ['m07_purchase_cash_delete_dependencies',
    'm07_purchase_cash_delete_offsets','m07_purchase_cash_delete_moves',
    'm07_purchase_cash_delete_receipts',
    'm07_purchase_cash_inflows','m07_purchase_return_moves',
    'm07_purchase_cash_returns','m07_purchase_lot_balances',
    'm05_supplier_ledger','m05_bank_book','m05_cash_book',
    'm05_movements','m05_lots','m05_items','m05_purchases'])
    await DB.prepare(`DELETE FROM ${t}`).run();
  for(const sql of M07_PURCHASE_CASH_DELETE_IMMUTABLE_DDL)await DB.prepare(sql).run();
  await DB.prepare("CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'immutable-purchase'); END").run();
  await DB.prepare("CREATE TRIGGER m07_purchase_cash_immutable_delete BEFORE DELETE ON m07_purchase_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-return'); END").run();
  await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=4000,active=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
});
after(async()=>server.close());

test('deleting returned Purchase Cash restores only source lot and shop stock, one inverse Cash amount, no other ledger',async()=>{
  const s=await purchaseReturn(),before=await snapshot(),x=request(s);
  assert.equal(before.remaining[0].remaining,1);
  assert.deepEqual(await deletion().post(x),
    {status:'COMMITTED',operationId:x.operationId,returnId:s.returnId});
  const after=await snapshot();
  assert.equal(after.active.length,0);
  assert.equal(after.remaining[0].remaining,2);
  assert.equal(after.product.find(x=>x.sku==='PIPE').stock,5);
  assert.deepEqual(after.reverseMoves.map(x=>[x.return_id,x.units_in,x.balance_stock]),
    [[s.returnId,1,5]]);
  assert.deepEqual(after.cashOffsets.map(x=>[x.return_id,x.debit_paisa]),
    [[s.returnId,1500]]);
  assert.equal(after.originalInflow[0].credit_paisa-after.cashOffsets[0].debit_paisa,0);
  for(const k of ['purchase','items','sourceLots','sourceMoves','returnReceipt',
    'originalReturnMoves','originalInflow','supplier','supplierLedger','otherParty',
    'originalCash','originalBank'])assert.deepEqual(after[k],before[k],k);
});

test('replay is immutable; changing actor/amount/reason/return ID or operation ID conflicts',async()=>{
  const s=await purchaseReturn(),x=request(s);
  assert.equal((await deletion().post(x)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await deletion().post(x),
    {status:'REPLAY',operationId:x.operationId,returnId:x.returnId});
  for(const patch of [{actorId:'OTHER'},{refundPaisa:1400},{reason:'Different'},
    {returnId:'PRET-OTHER'},{operationId:'OP-PUR-CASH-DELETE-002'}])
    assert.equal((await deletion().post({...x,...patch})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('competing correction IDs cannot restore or refund Cash twice',async()=>{
  const s=await purchaseReturn();
  const values=await Promise.all([
    deletion().post(request(s,'OP-PUR-DELETE-RACE-01')),
    deletion().post(request(s,'OP-PUR-DELETE-RACE-02'))
  ]);
  assert.deepEqual(values.map(x=>x.status).sort(),['COMMITTED','CONFLICT']);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_purchase_cash_delete_receipts')).n,1);
  assert.equal((await one('SELECT remaining FROM m07_purchase_lot_balances')).remaining,2);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,5);
});

test('wrong original purchase, source hash, tenant, lot, SKU, quantity or cash amount fail closed',async()=>{
  const s=await purchaseReturn(),x=request(s),before=await snapshot();
  for(const patch of [{tenantId:'SHOP-B'},{purchaseId:'PUR-OTHER'},
    {originalHash:'a'.repeat(64)},{lotId:'LOT-OTHER'},{sku:'BUNDLE'},
    {units:2},{refundPaisa:1501}]){
    assert.equal((await deletion().post({...x,...patch})).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('original purchase Cash inflow or return stock movement corruption cannot be reversed',async()=>{
  const s=await purchaseReturn(),x=request(s);
  await DB.prepare('UPDATE m07_purchase_cash_inflows SET credit_paisa=1499').run();
  const amountMismatch=await snapshot();
  assert.equal((await deletion().post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),amountMismatch);
  await DB.prepare('UPDATE m07_purchase_cash_inflows SET credit_paisa=1500').run();
  await DB.prepare('UPDATE m07_purchase_return_moves SET units_out=2').run();
  const moveMismatch=await snapshot();
  assert.equal((await deletion().post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),moveMismatch);
});

test('stale source lot overfill and unreviewed Supplier identity decline inside SQL',async()=>{
  const s=await purchaseReturn(),x=request(s);
  await DB.prepare('UPDATE m07_purchase_lot_balances SET remaining=2').run();
  const tooFull=await snapshot();
  assert.equal((await deletion().post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),tooFull);
  await DB.prepare('UPDATE m07_purchase_lot_balances SET remaining=1').run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=0 WHERE source_id='SUP-1'").run();
  const unreviewed=await snapshot();
  assert.equal((await deletion().post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),unreviewed);
});

test('dependent settlement marker and Cash Session closure block correction without changes',async()=>{
  const s=await purchaseReturn(),x=request(s);
  await DB.prepare('INSERT INTO m07_purchase_cash_delete_dependencies VALUES(?,?,?)')
    .bind('SHOP-A',s.returnId,'SETTLEMENT-1').run();
  const dependency=await snapshot();
  assert.equal((await deletion().post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),dependency);
  await DB.prepare('DELETE FROM m07_purchase_cash_delete_dependencies').run();
  const before=await snapshot();
  const writer=deletion({beforeBatch:async()=>{
    await DB.prepare("UPDATE m05_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await writer.post(x)).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('injected inverse Cash debit failure rolls back receipt, lot and stock restoration',async()=>{
  const s=await purchaseReturn(),before=await snapshot();
  await DB.prepare("CREATE TRIGGER m07_fail_cash_offset BEFORE INSERT ON m07_purchase_cash_delete_offsets BEGIN SELECT RAISE(ABORT,'cash-failure'); END").run();
  await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('injected inverse stock movement failure rolls back Cash and lot changes',async()=>{
  const s=await purchaseReturn(),before=await snapshot();
  await DB.prepare("CREATE TRIGGER m07_fail_reverse_move BEFORE INSERT ON m07_purchase_cash_delete_moves BEGIN SELECT RAISE(ABORT,'move-failure'); END").run();
  await assert.rejects(()=>deletion().post(request(s)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('correction receipt and inverse entries are immutable; no public return deletion endpoint',async()=>{
  const s=await purchaseReturn();
  assert.equal((await deletion().post(request(s))).status,'COMMITTED');
  for(const table of M07_PURCHASE_CASH_DELETE_IMMUTABLE_TABLES){
    await assert.rejects(()=>DB.prepare(`UPDATE ${table} SET tenant_id='OTHER'`).run(),/immutable/i);
    await assert.rejects(()=>DB.prepare(`DELETE FROM ${table}`).run(),/immutable/i);
  }
  const res=await worker.fetch('http://m07.local/__purchase_delete__',{method:'POST',body:'{}'});
  assert.equal(res.status,404);
});

test('invalid IDs, negative amount, zero units and extra SQL fields reject before any D1 writes',async()=>{
  const s=await purchaseReturn(),x=request(s),before=await snapshot();
  for(const bad of [null,{...x,units:0},{...x,refundPaisa:0},
    {...x,refundPaisa:1.5},{...x,reason:' '},{...x,operationId:'bad'},
    {...x,actorId:''},{...x,originalHash:'invalid'},
    {...x,sql:'DELETE FROM m05_purchases'}])
    await assert.rejects(()=>deletion().post(bad),/invalid|shape|synthetic/i);
  assert.deepEqual(await snapshot(),before);
});

test('original Purchase Cash Return operation ID cannot be reused as deletion ID',async()=>{
  const s=await purchaseReturn(),before=await snapshot();
  assert.equal((await deletion().post(request(s,s.operationId))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});
