import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {M07_PURCHASE_CASH_DDL} from '../fixtures/m07-purchase-cash-schema.mjs';
import {createSyntheticD1PurchaseCashReturnContract} from '../fixtures/m07-purchase-cash-contract.mjs';
import {M07_PURCHASE_CREDIT_DDL} from '../fixtures/m07-purchase-supplier-credit-schema.mjs';
import {createSyntheticD1PurchaseSupplierCreditContract} from '../fixtures/m07-purchase-supplier-credit-contract.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m07-purchase-supplier-credit-test.jsonc'}]});
const worker=server.getWorker('shererp-m07-purchase-supplier-credit-workerd-test');
let DB;
const one=sql=>DB.prepare(sql).first();
const rows=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const credit=options=>createSyntheticD1PurchaseSupplierCreditContract(DB,options);
const cash=()=>createSyntheticD1PurchaseCashReturnContract(DB);

async function purchase(id='A',options={}){
  const params={
    tenantId:'SHOP-A',actorId:'BUYER-1',purchaseId:'PUR-'+id,
    operationId:'OP-PURCHASE-CREDIT-'+id+'-001',supplierId:'SUP-1',
    sku:'PIPE',qty:2,expectedVersion:1,unitPrice:'15.25',sellPrice:'18.00',
    discount:'0.50',paidAmount:'20.00',date:'2026-11-10',
    paymentMethod:'Cash',bankAccountId:'',...options
  };
  assert.equal((await createSyntheticPurchasePoster(DB).post(params)).status,'COMMITTED');
  const {intent_hash:originalHash}=await DB.prepare(
    'SELECT intent_hash FROM m05_purchases WHERE tenant_id=? AND purchase_id=?'
  ).bind(params.tenantId,params.purchaseId).first();
  const lotId='LOT-'+params.purchaseId;
  await DB.prepare('INSERT INTO m07_purchase_lot_balances VALUES(?,?,?,?,?)')
    .bind(params.tenantId,lotId,params.purchaseId,params.sku,params.qty).run();
  const supplier=await DB.prepare('SELECT party_id,payable_paisa FROM m05_suppliers WHERE tenant_id=? AND supplier_id=?')
    .bind(params.tenantId,params.supplierId).first();
  await DB.prepare('INSERT OR IGNORE INTO m07_purchase_supplier_signed VALUES(?,?,?,?,1)')
    .bind(params.tenantId,params.supplierId,supplier.party_id,supplier.payable_paisa).run();
  return {purchaseId:params.purchaseId,sku:params.sku,lotId,supplierId:params.supplierId,originalHash};
}
const input=(source,operationId='OP-PUR-CREDIT-001',patch={})=>({
  tenantId:'SHOP-A',actorId:'RETURN-CLERK',operationId,
  returnId:'PRET-'+operationId,purchaseId:source.purchaseId,
  supplierId:source.supplierId,sku:source.sku,lotId:source.lotId,
  originalHash:source.originalHash,units:1,creditPaisa:1500,
  reason:'Original damaged',...patch
});
const cashInput=(source,operationId='OP-PUR-CASH-001',patch={})=>({
  tenantId:'SHOP-A',actorId:'RETURN-CLERK',operationId,
  returnId:'PRET-'+operationId,purchaseId:source.purchaseId,
  sku:source.sku,lotId:source.lotId,originalHash:source.originalHash,
  units:1,refundPaisa:1500,reason:'Original damaged',...patch
});
async function snapshot(){
  const q={
    purchases:'SELECT * FROM m05_purchases ORDER BY purchase_id',
    items:'SELECT * FROM m05_items ORDER BY purchase_id',
    lots:'SELECT * FROM m05_lots ORDER BY lot_id',
    originalMoves:'SELECT * FROM m05_movements ORDER BY purchase_id',
    originalCash:'SELECT * FROM m05_cash_book ORDER BY purchase_id',
    originalBank:'SELECT * FROM m05_bank_book ORDER BY purchase_id',
    originalSupplierLedger:'SELECT * FROM m05_supplier_ledger ORDER BY purchase_id',
    nativeSuppliers:'SELECT * FROM m05_suppliers ORDER BY supplier_id',
    unrelatedCustomer:'SELECT * FROM m05_unrelated_accounts ORDER BY party_id',
    products:'SELECT * FROM m05_products ORDER BY sku',
    lotBalances:'SELECT * FROM m07_purchase_lot_balances ORDER BY lot_id',
    moves:'SELECT * FROM m07_purchase_return_moves ORDER BY return_id',
    cashReturns:'SELECT * FROM m07_purchase_cash_returns ORDER BY return_id',
    cashInflows:'SELECT * FROM m07_purchase_cash_inflows ORDER BY return_id',
    creditReturns:'SELECT * FROM m07_purchase_credit_returns ORDER BY return_id',
    signedSuppliers:'SELECT * FROM m07_purchase_supplier_signed ORDER BY supplier_id',
    creditLedger:'SELECT * FROM m07_purchase_credit_ledger ORDER BY return_id'
  };
  const out={};for(const [key,sql] of Object.entries(q))out[key]=await rows(sql);
  return out;
}

before(async()=>{
  await server.listen();({DB}=await worker.getEnv());
  for(const stmt of M05_PURCHASE_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_PURCHASE_CASH_DDL)await DB.prepare(stmt).run();
  for(const stmt of M07_PURCHASE_CREDIT_DDL)await DB.prepare(stmt).run();
  for(const [sql,args] of M05_PURCHASE_SEED)await DB.prepare(sql).bind(...args).run();
  await DB.prepare("INSERT INTO m05_suppliers VALUES('SHOP-A','SUP-2','PARTY-2',1,7000)").run();
  await DB.prepare("INSERT INTO m05_party_links VALUES('SHOP-A','SUPPLIERS','SUP-2','PARTY-2',1)").run();
});
beforeEach(async()=>{
  for(const name of ['m07_inject_credit_move','m07_inject_credit_ledger',
    'm07_purchase_credit_immutable_delete','m07_purchase_cash_immutable_delete',
    'm05_receipt_delete_guard'])await DB.prepare('DROP TRIGGER IF EXISTS '+name).run();
  for(const table of ['m07_purchase_credit_ledger','m07_purchase_credit_returns',
    'm07_purchase_cash_inflows','m07_purchase_return_moves','m07_purchase_cash_returns',
    'm07_purchase_supplier_signed','m07_purchase_lot_balances',
    'm05_supplier_ledger','m05_bank_book','m05_cash_book','m05_movements',
    'm05_lots','m05_items','m05_purchases'])
    await DB.prepare('DELETE FROM '+table).run();
  for(const statement of [
    "CREATE TRIGGER m07_purchase_credit_immutable_delete BEFORE DELETE ON m07_purchase_credit_returns BEGIN SELECT RAISE(ABORT,'immutable-credit'); END",
    "CREATE TRIGGER m07_purchase_cash_immutable_delete BEFORE DELETE ON m07_purchase_cash_returns BEGIN SELECT RAISE(ABORT,'immutable-cash'); END",
    "CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'immutable-purchase'); END"
  ])await DB.prepare(statement).run();
  await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=CASE supplier_id WHEN 'SUP-1' THEN 4000 ELSE 7000 END,active=1,party_id=CASE supplier_id WHEN 'SUP-1' THEN 'PARTY-1' ELSE 'PARTY-2' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id=CASE source_id WHEN 'SUP-1' THEN 'PARTY-1' ELSE 'PARTY-2' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
});
after(async()=>server.close());

test('Supplier Credit decreases only original Supplier signed due, records Credit ledger and original-lot stock-out',async()=>{
  const source=await purchase();
  const before=await snapshot();
  assert.equal((await one("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,5000);
  assert.deepEqual(await credit().post(input(source)),{
    status:'COMMITTED',operationId:'OP-PUR-CREDIT-001',returnId:'PRET-OP-PUR-CREDIT-001'
  });
  assert.deepEqual(await rows('SELECT supplier_id,party_id,credit_paisa,balance_paisa FROM m07_purchase_credit_ledger'),[
    {supplier_id:'SUP-1',party_id:'PARTY-1',credit_paisa:1500,balance_paisa:3500}
  ]);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,3500);
  assert.deepEqual(await rows('SELECT lot_id,remaining FROM m07_purchase_lot_balances'),[
    {lot_id:source.lotId,remaining:1}
  ]);
  assert.deepEqual(await rows('SELECT purchase_id,lot_id,units_out FROM m07_purchase_return_moves'),[
    {purchase_id:source.purchaseId,lot_id:source.lotId,units_out:1}
  ]);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,4);
  const afterSnapshot=await snapshot();
  for(const key of ['purchases','items','lots','originalMoves','originalCash',
    'originalBank','originalSupplierLedger','nativeSuppliers','unrelatedCustomer','cashInflows'])
    assert.deepEqual(afterSnapshot[key],before[key],key);
});

test('fully paid original purchase with zero supplier due creates a negative signed Supplier advance',async()=>{
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=0 WHERE supplier_id='SUP-1'").run();
  const source=await purchase('PAID',{paidAmount:'30.00'});
  const before=await snapshot();
  assert.equal((await one("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,0);
  assert.equal((await credit().post(input(source))).status,'COMMITTED');
  assert.deepEqual(await rows('SELECT credit_paisa,balance_paisa FROM m07_purchase_credit_ledger'),[
    {credit_paisa:1500,balance_paisa:-1500}
  ]);
  assert.equal((await one("SELECT signed_due_paisa FROM m07_purchase_supplier_signed WHERE supplier_id='SUP-1'")).signed_due_paisa,-1500);
  const afterSnapshot=await snapshot();
  for(const key of ['nativeSuppliers','originalCash','originalBank','unrelatedCustomer'])
    assert.deepEqual(afterSnapshot[key],before[key],key);
});

test('unpaid purchase is eligible for Supplier Credit, unlike Cash refund',async()=>{
  const source=await purchase('UNPAID',{paidAmount:'0'});
  const before=await snapshot();
  assert.equal((await cash().post(cashInput(source))).status,'DECLINED');
  assert.equal((await credit().post(input(source))).status,'COMMITTED');
  const afterSnapshot=await snapshot();
  assert.equal(afterSnapshot.cashInflows.length,0);
  assert.deepEqual(afterSnapshot.originalCash,before.originalCash);
  assert.deepEqual(afterSnapshot.originalBank,before.originalBank);
});

test('same operation replays without changed balances, changed intent and actor conflict',async()=>{
  const source=await purchase();
  const claim=input(source);
  assert.equal((await credit().post(claim)).status,'COMMITTED');
  const before=await snapshot();
  assert.deepEqual(await credit().post(claim),{
    status:'REPLAY',operationId:claim.operationId,returnId:claim.returnId
  });
  for(const change of [
    {actorId:'OTHER-CLERK'},{returnId:'PRET-ANOTHER'},
    {reason:'Other original issue'},{creditPaisa:100},
    {originalHash:'f'.repeat(64)}
  ])assert.equal((await credit().post({...claim,...change})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('cross-method Cash then Supplier Credit reuse of return/operation ID conflicts without double stock',async()=>{
  const source=await purchase('CASHFIRST',{paidAmount:'30.00'});
  assert.equal((await cash().post(cashInput(source,'OP-CROSS-METHOD-001'))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await credit().post(input(source,'OP-CROSS-METHOD-001'))).status,'CONFLICT');
  assert.deepEqual(await snapshot(),before);
});

test('cross-method Supplier Credit then Cash refuses ID reuse even with sufficient paid and remaining stock',async()=>{
  const source=await purchase('CREDITFIRST',{paidAmount:'30.00'});
  assert.equal((await credit().post(input(source,'OP-CROSS-METHOD-002'))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await cash().post(cashInput(source,'OP-CROSS-METHOD-002'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('distinct Cash and Credit returns can consume separate eligible units but not over-return',async()=>{
  const source=await purchase('MIXED',{paidAmount:'30.00'});
  assert.equal((await credit().post(input(source,'OP-CREDIT-MIXED-001'))).status,'COMMITTED');
  assert.equal((await cash().post(cashInput(source,'OP-CASH-MIXED-001'))).status,'COMMITTED');
  const before=await snapshot();
  assert.equal((await credit().post(input(source,'OP-CREDIT-MIXED-002'))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  assert.equal((await one('SELECT remaining FROM m07_purchase_lot_balances')).remaining,0);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_purchase_return_moves')).n,2);
});

test('wrong original source receipt, supplier, lot or over-original economic value declines with no writes',async()=>{
  const source=await purchase(),before=await snapshot();
  for(const change of [
    {originalHash:'f'.repeat(64)},{supplierId:'SUP-2'},
    {lotId:'LOT-OTHER'},{purchaseId:'PUR-OTHER'},
    {sku:'BUNDLE'},{tenantId:'SHOP-B'},{creditPaisa:1499},
    {creditPaisa:1501},{units:3,creditPaisa:4500}
  ]){
    assert.equal((await credit().post(input(source,'OP-INVALID-CREDIT-001',change))).status,'DECLINED');
    assert.deepEqual(await snapshot(),before);
  }
});

test('real lot of another purchase and unrelated Supplier cannot be used as source',async()=>{
  const a=await purchase('A');
  const b=await purchase('B',{supplierId:'SUP-2',expectedVersion:2});
  const before=await snapshot();
  assert.equal((await credit().post(input(a,'OP-FORGED-FOREIGN-LOT-001',{
    lotId:b.lotId
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  assert.equal((await credit().post(input(b,'OP-FORGED-SUPPLIER-001',{
    supplierId:a.supplierId
  }))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('signed Supplier oracle must match currently reviewed original Supplier to Party source link',async()=>{
  const source=await purchase();
  await DB.prepare("UPDATE m07_purchase_supplier_signed SET party_id='PARTY-FORGED' WHERE supplier_id='SUP-1'").run();
  const before=await snapshot();
  assert.equal((await credit().post(input(source))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
  await DB.prepare("UPDATE m07_purchase_supplier_signed SET party_id='PARTY-1' WHERE supplier_id='SUP-1'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=0 WHERE source_id='SUP-1'").run();
  const beforeUnreviewed=await snapshot();
  assert.equal((await credit().post(input(source))).status,'DECLINED');
  assert.deepEqual(await snapshot(),beforeUnreviewed);
});

test('Cash Session closing just before guarded claim declines without any return effect',async()=>{
  const source=await purchase(),before=await snapshot();
  const pending=credit({beforeBatch:async()=>{
    await DB.prepare("UPDATE m05_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  }});
  assert.equal((await pending.post(input(source))).status,'DECLINED');
  assert.deepEqual(await snapshot(),before);
});

test('movement constraint fault rolls back source lot, shop stock, Supplier due and receipt',async()=>{
  const source=await purchase(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_inject_credit_move BEFORE INSERT ON m07_purchase_return_moves
    BEGIN SELECT RAISE(ABORT,'purchase-credit-movement-fault'); END`).run();
  await assert.rejects(()=>credit().post(input(source)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('Supplier Credit ledger fault rolls back prior source lot, shop stock and signed balance',async()=>{
  const source=await purchase(),before=await snapshot();
  await DB.prepare(`CREATE TRIGGER m07_inject_credit_ledger BEFORE INSERT ON m07_purchase_credit_ledger
    BEGIN SELECT RAISE(ABORT,'purchase-credit-ledger-fault'); END`).run();
  await assert.rejects(()=>credit().post(input(source)),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('competing same-last-unit Supplier Credit claims can commit only once',async()=>{
  const source=await purchase('RACE');
  const a=input(source,'OP-RACE-CREDIT-001',{units:2,creditPaisa:3000});
  const b=input(source,'OP-RACE-CREDIT-002',{units:2,creditPaisa:3000});
  const result=await Promise.all([credit().post(a),credit().post(b)]);
  assert.deepEqual(result.map(x=>x.status).sort(),['COMMITTED','DECLINED']);
  assert.equal((await one('SELECT COUNT(*) n FROM m07_purchase_credit_ledger')).n,1);
  assert.equal((await one('SELECT remaining FROM m07_purchase_lot_balances')).remaining,0);
});

test('hostile shapes and unsupported HTTP POST never create a Supplier Credit return',async()=>{
  const source=await purchase(),before=await snapshot();
  const base=input(source);
  for(const invalid of [
    {...base,creditPaisa:0},{...base,creditPaisa:1.5},
    {...base,units:0},{...base,operationId:'short'},
    {...base,supplierId:''},{...base,reason:''},
    {...base,arbitrarySQL:'UPDATE m05_suppliers'}
  ])await assert.rejects(()=>credit().post(invalid),/invalid|supplier credit/i);
  assert.equal((await worker.fetch('https://m07.local/completePurchaseReturn',{
    method:'POST',body:'{}'})).status,404);
  assert.deepEqual(await snapshot(),before);
});
