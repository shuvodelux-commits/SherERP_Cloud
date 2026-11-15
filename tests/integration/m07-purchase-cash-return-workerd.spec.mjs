import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {M07_PURCHASE_CASH_DDL} from '../fixtures/m07-purchase-cash-schema.mjs';
import {createSyntheticD1PurchaseCashReturnContract} from '../fixtures/m07-purchase-cash-contract.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-purchase-cash-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-purchase-cash-workerd-test');
let DB;
const one=sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const returns=options=>createSyntheticD1PurchaseCashReturnContract(DB,options);

async function purchase(id='A',patch={}){
  const input={tenantId:'SHOP-A',actorId:'BUYER-1',
    purchaseId:'PUR-'+id,operationId:'OP-PURCHASE-'+id+'-001',
    supplierId:'SUP-1',sku:'PIPE',qty:2,expectedVersion:1,
    unitPrice:'15.25',sellPrice:'18.00',discount:'0.50',
    paidAmount:'20.00',date:'2026-11-10',paymentMethod:'Cash',bankAccountId:'',
    ...patch};
  assert.equal((await createSyntheticPurchasePoster(DB).post(input)).status,'COMMITTED');
  const row=await DB.prepare('SELECT intent_hash FROM m05_purchases WHERE tenant_id=? AND purchase_id=?')
    .bind(input.tenantId,input.purchaseId).first();
  await DB.prepare('INSERT INTO m07_purchase_lot_balances VALUES (?,?,?,?,?)')
    .bind(input.tenantId,'LOT-'+input.purchaseId,input.purchaseId,input.sku,input.qty).run();
  return {purchaseId:input.purchaseId,originalHash:row.intent_hash,
    sku:input.sku,lotId:'LOT-'+input.purchaseId,supplierId:input.supplierId};
}
const cash=(src,op='OP-RETURN-CASH-001',patch={})=>({
  tenantId:'SHOP-A',actorId:'RETURN-CLERK',
  returnId:'PRET-'+op,operationId:op,purchaseId:src.purchaseId,
  sku:src.sku,lotId:src.lotId,originalHash:src.originalHash,
  units:1,refundPaisa:1500,reason:'Defective original',...patch
});
async function snapshot(){
  const q={
    purchases:'SELECT * FROM m05_purchases ORDER BY purchase_id',
    items:'SELECT * FROM m05_items ORDER BY purchase_id',
    originalMoves:'SELECT * FROM m05_movements ORDER BY purchase_id',
    lots:'SELECT * FROM m05_lots ORDER BY lot_id',
    remaining:'SELECT * FROM m07_purchase_lot_balances ORDER BY lot_id',
    products:'SELECT * FROM m05_products ORDER BY sku',
    suppliers:'SELECT * FROM m05_suppliers ORDER BY supplier_id',
    customer:'SELECT * FROM m05_unrelated_accounts ORDER BY party_id',
    originalCash:'SELECT * FROM m05_cash_book ORDER BY purchase_id',
    originalBank:'SELECT * FROM m05_bank_book ORDER BY purchase_id',
    supplierLedger:'SELECT * FROM m05_supplier_ledger ORDER BY purchase_id',
    returns:'SELECT * FROM m07_purchase_cash_returns ORDER BY return_id',
    moves:'SELECT * FROM m07_purchase_return_moves ORDER BY return_id',
    cashIn:'SELECT * FROM m07_purchase_cash_inflows ORDER BY return_id'
  };
  const out={};for(const [k,sql] of Object.entries(q))out[k]=await all(sql);
  return out;
}
before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const stmt of M05_PURCHASE_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_PURCHASE_CASH_DDL)await DB.prepare(stmt).run();
  for(const [sql,args] of M05_PURCHASE_SEED)await DB.prepare(sql).bind(...args).run();
});
beforeEach(async()=>{
  for(const name of ['m07_inject_cash','m07_inject_move','m05_receipt_delete_guard',
    'm07_purchase_cash_immutable_delete'])await DB.prepare('DROP TRIGGER IF EXISTS '+name).run();
  for(const name of ['m07_purchase_cash_inflows','m07_purchase_return_moves',
    'm07_purchase_cash_returns','m07_purchase_lot_balances','m05_supplier_ledger','m05_bank_book','m05_cash_book',
    'm05_movements','m05_lots','m05_items','m05_purchases'])
    await DB.prepare('DELETE FROM '+name).run();
  for(const ddl of [
    "CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'immutable-purchase'); END",
    "CREATE TRIGGER m07_purchase_cash_immutable_delete BEFORE DELETE ON m07_purchase_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-return'); END"
  ])await DB.prepare(ddl).run();
  await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=4000,active=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
});
after(async()=>server.close());

test('original discounted Purchase Cash Return reduces only its source lot/stock and records Cash inflow',async()=>{
  const src=await purchase(),before=await snapshot();
  assert.deepEqual(await returns().post(cash(src)),{
    status:'COMMITTED',operationId:'OP-RETURN-CASH-001',returnId:'PRET-OP-RETURN-CASH-001'
  });
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,4);
  assert.deepEqual(await all('SELECT lot_id,remaining FROM m07_purchase_lot_balances'),[
    {lot_id:src.lotId,remaining:1}
  ]);
  assert.deepEqual(await all('SELECT purchase_id,lot_id,units_out FROM m07_purchase_return_moves'),[
    {purchase_id:src.purchaseId,lot_id:src.lotId,units_out:1}
  ]);
  assert.deepEqual(await all('SELECT credit_paisa FROM m07_purchase_cash_inflows'),[
    {credit_paisa:1500}
  ]);
  const afterSnapshot=await snapshot();
  for(const k of ['suppliers','supplierLedger','customer','originalCash','originalBank','purchases','items','originalMoves'])
    assert.deepEqual(afterSnapshot[k],before[k],k);
});

test('same stable return operation replays, but changed intent, source or actor conflicts',async()=>{
  const src=await purchase(),input=cash(src);
  assert.equal((await returns().post(input)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await returns().post(input),{
    status:'REPLAY',returnId:input.returnId,operationId:input.operationId
  });
  for(const changes of [{actorId:'NEW-CLERK'},{refundPaisa:100},{returnId:'PRET-OTHER-1'},
    {reason:'Different'},{originalHash:'f'.repeat(64)}])
    assert.equal((await returns().post({...input,...changes})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('unpaid purchase cannot get Cash refund even though supplier due exists',async()=>{
  const src=await purchase('B',{paidAmount:'0'});
  const before=await snapshot();
  assert.equal((await returns().post(cash(src))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('second Cash refund cannot exceed original verified paid minus earlier Cash refund',async()=>{
  const src=await purchase();
  assert.equal((await returns().post(cash(src))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-002',{
    returnId:'PRET-OTHER-CASH-2'
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('paid-in-full original purchase can return both units once, no over-return',async()=>{
  const src=await purchase('FULL',{paidAmount:'30.00'});
  assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-003',{
    returnId:'PRET-FULL-1',units:2,refundPaisa:3000
  }))).status,'COMMITTED');
  assert.equal((await one('SELECT remaining FROM m07_purchase_lot_balances')).remaining,0);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,3);
  const before=await snapshot();
  assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-004',{
    returnId:'PRET-FULL-2'
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('forged source receipt, foreign lot or wrong SKU cannot reduce unrelated inventory',async()=>{
  const src=await purchase(),before=await snapshot();
  for(const changes of [
    {originalHash:'f'.repeat(64)},{lotId:'LOT-FOREIGN'},
    {sku:'BUNDLE'},{purchaseId:'PUR-FOREIGN'},{tenantId:'SHOP-B'}
  ]){
    assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-005',changes))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('source lot depleted by earlier sale blocks return rather than borrowing another lot',async()=>{
  const src=await purchase();
  await DB.prepare("UPDATE m07_purchase_lot_balances SET remaining=0 WHERE purchase_id='PUR-A'").run();
  const before=await snapshot();
  assert.equal((await returns().post(cash(src))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('forged refund price and over-original quantity decline',async()=>{
  const src=await purchase(),before=await snapshot();
  for(const changes of [
    {refundPaisa:1600},{refundPaisa:1499},{units:3,refundPaisa:4500}
  ]){
    assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-006',changes))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('stale supplier Party link and closed Cash Session decline at in-DB claim time',async()=>{
  const src=await purchase(),before=await snapshot();
  const w=returns({beforeBatch:async()=>{
    await DB.prepare("UPDATE m05_party_links SET reviewed=0 WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await w.post(cash(src))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  await DB.prepare("UPDATE m05_party_links SET reviewed=1 WHERE tenant_id='SHOP-A'").run();
  const closed=returns({beforeBatch:async()=>{
    await DB.prepare("UPDATE m05_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await closed.post(cash(src))).status,'DECLINED');
});

test('injected outgoing stock movement failure rolls back original source-lot and shop stock',async()=>{
  const src=await purchase(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_inject_move BEFORE INSERT ON m07_purchase_return_moves
    BEGIN SELECT RAISE(ABORT,'purchase-return-move-fault'); END`).run();
  await assert.rejects(()=>returns().post(cash(src)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('injected Cash inflow failure rolls back return, product and exact original lot',async()=>{
  const src=await purchase(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_inject_cash BEFORE INSERT ON m07_purchase_cash_inflows
    BEGIN SELECT RAISE(ABORT,'purchase-return-cash-fault'); END`).run();
  await assert.rejects(()=>returns().post(cash(src)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('concurrent last source-lot unit has exactly one successful Cash refund',async()=>{
  const src=await purchase('RACE',{paidAmount:'30.00'});
  const a=cash(src,'OP-RETURN-RACE-001',{returnId:'PRET-RACE-1',units:2,refundPaisa:3000});
  const b=cash(src,'OP-RETURN-RACE-002',{returnId:'PRET-RACE-2',units:2,refundPaisa:3000});
  const outcomes=await Promise.all([returns().post(a),returns().post(b)]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_purchase_cash_inflows')).n,1);
  assert.equal((await one('SELECT remaining FROM m07_purchase_lot_balances')).remaining,0);
});

test('duplicate return identity with different operation cannot commit and 404 test Worker stays closed',async()=>{
  const src=await purchase();
  assert.equal((await returns().post(cash(src))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await returns().post(cash(src,'OP-RETURN-CASH-777',{
    returnId:'PRET-OP-RETURN-CASH-001'
  }))).status,'CONFLICT');
  assert.equal((await worker.fetch('http://m07.local/completePurchaseReturn',{method:'POST',body:'{}'})).status,404);
  assert.deepEqual(await snapshot(),before);
});

test('hostile amount, ID, reason and extra field inputs are rejected before SQL writes',async()=>{
  const src=await purchase(),before=await snapshot();
  const good=cash(src);
  for(const bad of [
    {...good,units:0},{...good,refundPaisa:-1},{...good,refundPaisa:1.5},
    {...good,operationId:'short'}, {...good,reason:''},{...good,sql:'DROP TABLE m05_lots'}
  ])await assert.rejects(()=>returns().post(bad),/Invalid|invalid/i);
  assert.deepEqual(await snapshot(),before);
});

test('source-specific lot cannot be substituted with a real lot from another purchase',async()=>{
  const a=await purchase('A');
  const b=await purchase('B',{expectedVersion:2});
  const before=await snapshot();
  assert.equal((await returns().post(cash(a,'OP-RETURN-FOREIGN-LOT-01',{
    lotId:b.lotId,returnId:'PRET-FOREIGN-LOT'
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('fractional-cent net original purchase is declined, not silently rounded to a Cash refund',async()=>{
  const src=await purchase('ODD',{discount:'0.49'});
  const before=await snapshot();
  for(const refundPaisa of [1500,1501]){
    assert.equal((await returns().post(cash(src,'OP-RETURN-FRACTION-'+refundPaisa,{
      refundPaisa,returnId:'PRET-FRACTION-'+refundPaisa
    }))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('source-verified Bank purchase payment is cash-backed eligibility, refund itself enters only Cash',async()=>{
  const src=await purchase('BANK',{paymentMethod:'Bank',bankAccountId:'BANK-1'});
  const before=await snapshot();
  assert.equal((await returns().post(cash(src,'OP-RETURN-BANKPAID-001',{
    returnId:'PRET-BANKPAID-001'
  }))).status,'COMMITTED');
  const afterSnapshot=await snapshot();
  assert.deepEqual(afterSnapshot.originalBank,before.originalBank,
    'refund must not reverse or duplicate the original Bank debit');
  assert.equal(afterSnapshot.originalCash.length,0);
  assert.deepEqual(afterSnapshot.cashIn.map(x=>x.credit_paisa),[1500]);
  assert.deepEqual(afterSnapshot.suppliers,before.suppliers);
});
