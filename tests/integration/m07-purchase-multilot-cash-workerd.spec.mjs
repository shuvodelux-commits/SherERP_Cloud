import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {M07_PURCHASE_CASH_DDL} from '../fixtures/m07-purchase-cash-schema.mjs';
import {createSyntheticD1PurchaseCashReturnContract} from '../fixtures/m07-purchase-cash-contract.mjs';
import {M07_PURCHASE_CREDIT_DDL} from '../fixtures/m07-purchase-supplier-credit-schema.mjs';
import {createSyntheticD1PurchaseSupplierCreditContract} from '../fixtures/m07-purchase-supplier-credit-contract.mjs';
import {M07_MULTI_CASH_DDL} from '../fixtures/m07-purchase-multilot-cash-schema.mjs';
import {createSyntheticMultiLotPurchaseCashReturn} from '../fixtures/m07-purchase-multilot-cash-contract.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-purchase-multilot-cash-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-purchase-multilot-cash-workerd-test');
let DB;
const all=async query=>(await DB.prepare(query).all()).results.map(x=>({...x}));
const one=query=>DB.prepare(query).first();
const poster=options=>createSyntheticMultiLotPurchaseCashReturn(DB,options);
const originalCash=()=>createSyntheticD1PurchaseCashReturnContract(DB);
const originalCredit=()=>createSyntheticD1PurchaseSupplierCreditContract(DB);

async function purchase(key='A',patch={}){
  const input={
    tenantId:'SHOP-A',actorId:'BUYER-1',purchaseId:'PUR-'+key,
    operationId:'OP-B4-PURCHASE-'+key+'-001',supplierId:'SUP-1',
    sku:'PIPE',qty:3,expectedVersion:1,unitPrice:'15.25',sellPrice:'18.00',
    discount:'0.75',paidAmount:'45.00',date:'2026-11-10',
    paymentMethod:'Cash',bankAccountId:'',...patch
  };
  assert.equal((await createSyntheticPurchasePoster(DB).post(input)).status,'COMMITTED');
  const {intent_hash:originalHash}=await DB.prepare(
    'SELECT intent_hash FROM m05_purchases WHERE tenant_id=? AND purchase_id=?'
  ).bind(input.tenantId,input.purchaseId).first();
  // This is explicitly an M07 test-only split of the immutable single M05 receipt's 3 units.
  for(const [lotId,date,qty] of [['LOT-Z','2026-11-08',1],['LOT-A','2026-11-10',2]]){
    await DB.prepare('INSERT INTO m07b4_lots VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(input.tenantId,input.purchaseId,input.supplierId,input.sku,lotId,
        date,originalHash,1525,qty,qty).run();
  }
  await DB.prepare('INSERT INTO m07_purchase_lot_balances VALUES(?,?,?,?,?)')
    .bind(input.tenantId,'LOT-'+input.purchaseId,input.purchaseId,input.sku,3).run();
  return {purchaseId:input.purchaseId,supplierId:input.supplierId,
    sku:input.sku,originalHash,rootLot:'LOT-'+input.purchaseId};
}
function cash(source,op='OP-B4-CASH-RETURN-001',patch={}){
  return {
    tenantId:'SHOP-A',actorId:'CLERK-RETURN',returnId:'PRET-'+op,
    operationId:op,purchaseId:source.purchaseId,supplierId:source.supplierId,
    sku:source.sku,originalHash:source.originalHash,
    units:2,refundPaisa:3000,
    draws:[{lotId:'LOT-Z',units:1},{lotId:'LOT-A',units:1}],
    reason:'Original damaged',...patch
  };
}
const oldCredit=(src,op)=>({
  tenantId:'SHOP-A',actorId:'CLERK-RETURN',operationId:op,
  returnId:'PRET-'+op,purchaseId:src.purchaseId,
  supplierId:src.supplierId,sku:src.sku,lotId:src.rootLot,
  originalHash:src.originalHash,units:1,creditPaisa:1500,
  reason:'Original damaged'
});
async function seedSignedSupplier(){
  await DB.prepare('INSERT INTO m07_purchase_supplier_signed VALUES(?,?,?,?,1)')
    .bind('SHOP-A','SUP-1','PARTY-1',4000).run();
}
const oldCash=(src,op)=>({
  tenantId:'SHOP-A',actorId:'CLERK-RETURN',operationId:op,
  returnId:'PRET-'+op,purchaseId:src.purchaseId,
  sku:src.sku,lotId:src.rootLot,originalHash:src.originalHash,
  units:1,refundPaisa:1500,reason:'Original damaged'
});
async function snapshot(){
  const queries={
    receipt:'SELECT * FROM m07b4_cash_returns ORDER BY return_id',
    splitLots:'SELECT * FROM m07b4_lots ORDER BY lot_id',
    movements:'SELECT * FROM m07b4_movements ORDER BY return_id,lot_id',
    refunds:'SELECT * FROM m07b4_cash_inflows ORDER BY return_id',
    products:'SELECT * FROM m05_products ORDER BY sku',
    supplier:'SELECT * FROM m05_suppliers ORDER BY supplier_id',
    customer:'SELECT * FROM m05_unrelated_accounts ORDER BY party_id',
    purchase:'SELECT * FROM m05_purchases ORDER BY purchase_id',
    items:'SELECT * FROM m05_items ORDER BY purchase_id',
    sourceLot:'SELECT * FROM m05_lots ORDER BY lot_id',
    originalMoves:'SELECT * FROM m05_movements ORDER BY purchase_id',
    originalCash:'SELECT * FROM m05_cash_book ORDER BY purchase_id',
    originalBank:'SELECT * FROM m05_bank_book ORDER BY purchase_id',
    originalSupplierLedger:'SELECT * FROM m05_supplier_ledger ORDER BY purchase_id',
    oldCash:'SELECT * FROM m07_purchase_cash_returns ORDER BY return_id',
    oldCredit:'SELECT * FROM m07_purchase_credit_returns ORDER BY return_id',
    signedSupplier:'SELECT * FROM m07_purchase_supplier_signed ORDER BY supplier_id',
    creditLedger:'SELECT * FROM m07_purchase_credit_ledger ORDER BY return_id'
  };
  const out={};for(const [k,sql] of Object.entries(queries))out[k]=await all(sql);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const stmt of M05_PURCHASE_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_PURCHASE_CASH_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_PURCHASE_CREDIT_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_MULTI_CASH_DDL)await DB.prepare(stmt).run();
  for(const [sql,args] of M05_PURCHASE_SEED)
    await DB.prepare(sql).bind(...args).run();
});
beforeEach(async()=>{
  for(const name of ['m05_receipt_delete_guard','m07_purchase_cash_immutable_delete',
    'm07_purchase_credit_immutable_delete','m07b4_cash_immutable_delete',
    'm07b4_inject_move','m07b4_inject_cash'])
    await DB.prepare('DROP TRIGGER IF EXISTS '+name).run();
  for(const name of [
    'm07b4_cash_inflows','m07b4_movements','m07b4_cash_returns','m07b4_lots',
    'm07_purchase_credit_ledger','m07_purchase_credit_returns','m07_purchase_supplier_signed','m07_purchase_cash_inflows',
    'm07_purchase_return_moves','m07_purchase_cash_returns','m07_purchase_lot_balances',
    'm05_supplier_ledger','m05_bank_book','m05_cash_book','m05_movements',
    'm05_lots','m05_items','m05_purchases'
  ])await DB.prepare('DELETE FROM '+name).run();
  for(const sql of [
    "CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'immutable-purchase'); END",
    "CREATE TRIGGER m07_purchase_cash_immutable_delete BEFORE DELETE ON m07_purchase_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-original-cash-return'); END",
    "CREATE TRIGGER m07_purchase_credit_immutable_delete BEFORE DELETE ON m07_purchase_credit_returns BEGIN SELECT RAISE(ABORT,'immutable-original-credit-return'); END",
    "CREATE TRIGGER m07b4_cash_immutable_delete BEFORE DELETE ON m07b4_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-b4-return'); END"
  ])await DB.prepare(sql).run();
  await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=4000,active=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
});
after(async()=>server.close());

test('two original-purchase split lots post FIFO Cash refund and distinct movements atomically',async()=>{
  const src=await purchase(),before=await snapshot();
  assert.deepEqual(await poster().post(cash(src)),{
    status:'COMMITTED',operationId:'OP-B4-CASH-RETURN-001',returnId:'PRET-OP-B4-CASH-RETURN-001'
  });
  assert.deepEqual(await all('SELECT lot_id,remaining FROM m07b4_lots ORDER BY lot_id'),[
    {lot_id:'LOT-A',remaining:1},{lot_id:'LOT-Z',remaining:0}
  ]);
  assert.deepEqual(await all('SELECT lot_id,units_out,balance_stock FROM m07b4_movements ORDER BY lot_id'),[
    {lot_id:'LOT-A',units_out:1,balance_stock:4},
    {lot_id:'LOT-Z',units_out:1,balance_stock:4}
  ]);
  assert.deepEqual(await all('SELECT credit_paisa FROM m07b4_cash_inflows'),[{credit_paisa:3000}]);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,4);
  const afterState=await snapshot();
  for(const table of ['purchase','items','sourceLot','originalMoves','supplier',
    'customer','originalCash','originalBank','originalSupplierLedger','oldCash','oldCredit'])
    assert.deepEqual(afterState[table],before[table],table);
});

test('FIFO is SQL-enforced: later Lot ID/date cannot skip a partially available earlier lot',async()=>{
  const src=await purchase(),before=await snapshot();
  for(const change of [
    {units:1,refundPaisa:1500,draws:[{lotId:'LOT-A',units:1}]},
    {draws:[{lotId:'LOT-Z',units:1},{lotId:'LOT-A',units:1}].reverse()},
    {draws:[{lotId:'OTHER-PURCHASE',units:1},{lotId:'LOT-A',units:1}]}
  ]){
    assert.equal((await poster().post(cash(src,'OP-B4-BAD-DRAWS-001',change))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('complete three-unit Cash return honors original 45.00 net amount and forbids over-return',async()=>{
  const src=await purchase('FULL');
  assert.equal((await poster().post(cash(src,'OP-B4-FULL-RETURN-001',{
    units:3,refundPaisa:4500,draws:[{lotId:'LOT-Z',units:1},{lotId:'LOT-A',units:2}]
  }))).status,'COMMITTED');
  assert.equal((await one('SELECT SUM(remaining) n FROM m07b4_lots')).n,0);
  const after=await snapshot();
  assert.equal((await poster().post(cash(src,'OP-B4-FULL-RETURN-002'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),after);
});

test('paid ceiling, source receipt, net discount, and supplier link are checked inside D1',async()=>{
  const src=await purchase('PARTPAID',{paidAmount:'20.00'});
  const before=await snapshot();
  for(const patch of [
    {},{originalHash:'f'.repeat(64)},{supplierId:'SUP-OTHER'},
    {refundPaisa:2999},{refundPaisa:3001},{purchaseId:'PUR-OTHER'},
    {tenantId:'SHOP-B'}
  ]){
    assert.equal((await poster().post(cash(src,'OP-B4-DECLINE-001',patch))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
  const session=poster({beforeBatch:async()=>DB.prepare("UPDATE m05_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run()});
  assert.equal((await session.post(cash(src))).status,'DECLINED');
  assert.equal((await one('SELECT COUNT(*) n FROM m07b4_cash_returns')).n,0);
});

test('stable operation replays once and conflicting actor, amount, lot split or reason is denied',async()=>{
  const src=await purchase();
  const intent=cash(src);
  assert.equal((await poster().post(intent)).status,'COMMITTED');
  const after=await snapshot();
  assert.deepEqual(await poster().post(intent),{
    status:'REPLAY',operationId:intent.operationId,returnId:intent.returnId
  });
  for(const patch of [{actorId:'OTHER-USER'},{refundPaisa:1500},
    {reason:'Different reason'},{returnId:'PRET-OTHER'},
    {draws:[{lotId:'LOT-A',units:1},{lotId:'LOT-Z',units:1}]}]){
    assert.equal((await poster().post({...intent,...patch})).status,'CONFLICT');
    assert.deepEqual(await snapshot(),after);
  }
});

test('later movement or Cash failure rolls back receipt, both lot balances, stock and payment',async()=>{
  for(const [name,target] of [
    ['m07b4_inject_move','m07b4_movements'],
    ['m07b4_inject_cash','m07b4_cash_inflows']
  ]){
    const src=await purchase('FAULT-'+name);
    const before=await snapshot();
    await DB.prepare('CREATE TRIGGER '+name+' BEFORE INSERT ON '+target+
      " BEGIN SELECT RAISE(ABORT,'forced-multi-return-fault'); END").run();
    await assert.rejects(()=>poster().post(cash(src,'OP-B4-'+name+'-001')),/NEEDS_REVIEW/);
    assert.deepEqual(await snapshot(),before);
    await DB.prepare('DROP TRIGGER '+name).run();
    // One purchase per test case; reset original fixture through cleanup in this test itself.
    for(const table of ['m07b4_lots','m07_purchase_lot_balances','m05_supplier_ledger',
      'm05_cash_book','m05_movements','m05_lots','m05_items']){
      await DB.prepare('DELETE FROM '+table).run();
    }
    await DB.prepare('DROP TRIGGER m05_receipt_delete_guard').run();
    await DB.prepare('DELETE FROM m05_purchases').run();
    await DB.prepare("CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'immutable-purchase'); END").run();
    await DB.prepare("UPDATE m05_products SET stock=3,version=1 WHERE sku='PIPE'").run();
    await DB.prepare("UPDATE m05_suppliers SET payable_paisa=4000 WHERE supplier_id='SUP-1'").run();
  }
});

test('competing returns for the last split-lot unit commit at most once',async()=>{
  const src=await purchase('RACE');
  assert.equal((await poster().post(cash(src,'OP-B4-RACE-FIRST-001'))).status,'COMMITTED');
  const partial={units:1,refundPaisa:1500,draws:[{lotId:'LOT-A',units:1}]};
  const results=await Promise.all([
    poster().post(cash(src,'OP-B4-RACE-SECOND-001',partial)),
    poster().post(cash(src,'OP-B4-RACE-THIRD-001',partial))
  ]);
  assert.equal(results.filter(x=>x.status==='COMMITTED').length,1);
  assert.equal(results.filter(x=>x.status==='DECLINED').length,1);
  assert.equal((await one('SELECT SUM(remaining) n FROM m07b4_lots')).n,0);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,3);
  assert.equal((await one('SELECT COUNT(*) n FROM m07b4_cash_inflows')).n,2);
});

test('do not mix preexisting single-lot Cash returns and multi-lot proof on one purchase',async()=>{
  const src=await purchase('CROSS');
  assert.equal((await originalCash().post(oldCash(src,'OP-B4-OLD-CASH-001'))).status,'COMMITTED');
  assert.equal((await poster().post(cash(src,'OP-B4-NEW-CASH-001'))).status,'DECLINED');
  assert.equal((await one('SELECT COUNT(*) n FROM m07b4_cash_returns')).n,0);
});

test('new multi-lot receipt prevents old single-lot Cash posting and duplicate identity',async()=>{
  const src=await purchase('CROSSREV');
  assert.equal((await poster().post(cash(src,'OP-B4-CROSSREV-001'))).status,'COMMITTED');
  const after=await snapshot();
  assert.equal((await originalCash().post(oldCash(src,'OP-B4-OLD-AFTER-001'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),after);
  assert.equal((await poster().post(cash(src,'OP-B4-CROSSREV-001',{
    returnId:'PRET-DIFFERENT'
  }))).status,'CONFLICT');
});

test('reject malformed line data before any D1 claim; isolated worker exposes no returns route',async()=>{
  const src=await purchase(),base=cash(src);
  for(const patch of [
    {draws:[]},{draws:[{lotId:'LOT-Z',units:1.5}]},
    {draws:[{lotId:'LOT-Z',units:1,extra:true}]},
    {draws:[{lotId:'LOT-Z',units:1},{lotId:'LOT-Z',units:1}]},
    {units:Infinity},{refundPaisa:30.5}
  ])await assert.rejects(()=>poster().post({...base,...patch}),/Invalid|Duplicate/);
  assert.equal((await one('SELECT COUNT(*) n FROM m07b4_cash_returns')).n,0);
  assert.equal((await worker.fetch('https://test.local/api/rpc')).status,404);
});


test('same-date original lots use Lot ID ascending for first eligible Cash refund',async()=>{
  const src=await purchase('TIE');
  await DB.prepare("UPDATE m07b4_lots SET purchase_date='2026-11-10' WHERE lot_id='LOT-Z'").run();
  const before=await snapshot();
  assert.equal((await poster().post(cash(src,'OP-B4-TIE-SKIP-001',{
    units:1,refundPaisa:1500,draws:[{lotId:'LOT-Z',units:1}]
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  assert.equal((await poster().post(cash(src,'OP-B4-TIE-CORRECT-001',{
    draws:[{lotId:'LOT-A',units:2}]
  }))).status,'COMMITTED');
  assert.deepEqual(await all('SELECT lot_id,remaining FROM m07b4_lots ORDER BY lot_id'),[
    {lot_id:'LOT-A',remaining:0},{lot_id:'LOT-Z',remaining:1}
  ]);
});

test('old signed Supplier Credit return blocks synthetic multi-lot Cash for same purchase',async()=>{
  const src=await purchase('CREDITFIRST');
  await seedSignedSupplier();
  assert.equal((await originalCredit().post(oldCredit(src,'OP-B4-CREDIT-FIRST-001'))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await poster().post(cash(src,'OP-B4-NEW-AFTER-CREDIT-001'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('synthetic multi-lot Cash receipt blocks later old Supplier Credit, including unchanged signed due',async()=>{
  const src=await purchase('CREDITLATER');
  await seedSignedSupplier();
  assert.equal((await poster().post(cash(src,'OP-B4-CASH-FIRST-001'))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await originalCredit().post(oldCredit(src,'OP-B4-CREDIT-AFTER-001'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});
