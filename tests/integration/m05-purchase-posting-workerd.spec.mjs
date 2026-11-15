import {describe,before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_PURCHASE_DDL,M05_PURCHASE_SEED} from '../fixtures/m05-purchase-d1-schema.mjs';
import {createSyntheticPurchasePoster} from '../fixtures/m05-purchase-d1-contract.mjs';
import {projectPurchaseDetail} from '../../src/modules/purchase-detail-projection.js';

const server=createTestHarness({workers:[{configPath:'./wrangler.m05-purchase-test.jsonc'}]});
const worker=server.getWorker('shererp-m05-purchase-local-test');
let DB;
const input=(id,override={})=>({
  tenantId:'SHOP-A',actorId:'USER-A',purchaseId:'PUR-'+id,operationId:id,
  supplierId:'SUP-1',sku:'PIPE',qty:2,expectedVersion:1,
  unitPrice:'15.25',sellPrice:'18.00',discount:'0.50',paidAmount:'10.00',
  date:'2026-11-10',paymentMethod:'Cash',bankAccountId:'',...override
});
const poster=(options)=>createSyntheticPurchasePoster(DB,options);
const one=sql=>DB.prepare(sql).first();
const rows=async sql=>(await DB.prepare(sql).all()).results;
const snapshot=async()=>({
  purchases:await rows('SELECT * FROM m05_purchases ORDER BY purchase_id'),
  items:await rows('SELECT * FROM m05_items ORDER BY purchase_id'),
  lots:await rows('SELECT * FROM m05_lots ORDER BY lot_id'),
  movements:await rows('SELECT * FROM m05_movements ORDER BY purchase_id'),
  cash:await rows('SELECT * FROM m05_cash_book ORDER BY purchase_id'),
  bank:await rows('SELECT * FROM m05_bank_book ORDER BY purchase_id'),
  ledgers:await rows('SELECT * FROM m05_supplier_ledger ORDER BY purchase_id'),
  products:await rows('SELECT * FROM m05_products ORDER BY sku'),
  suppliers:await rows('SELECT * FROM m05_suppliers ORDER BY supplier_id')
});
describe('M05 isolated local D1 purchase transaction',()=>{
before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  for(const sql of M05_PURCHASE_DDL)await DB.prepare(sql).run();
  for(const [sql,values] of M05_PURCHASE_SEED)await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
  await DB.prepare('DROP TRIGGER IF EXISTS m05_inject_failure').run();
  await DB.prepare('DROP TRIGGER IF EXISTS m05_receipt_delete_guard').run();
  for(const table of ['m05_supplier_ledger','m05_bank_book','m05_cash_book','m05_movements','m05_lots','m05_items','m05_purchases']) {
    await DB.prepare('DELETE FROM '+table).run();
  }
  await DB.prepare("CREATE TRIGGER m05_receipt_delete_guard BEFORE DELETE ON m05_purchases BEGIN SELECT RAISE(ABORT,'m05-immutable-receipt'); END").run();
  await DB.prepare("UPDATE m05_products SET stock=CASE sku WHEN 'PIPE' THEN 3 ELSE 0 END,version=1,active=1,deleted=0,product_type=CASE sku WHEN 'BUNDLE' THEN 'Bundle' ELSE 'Standard' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_suppliers SET payable_paisa=4000,active=1 WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_party_links SET reviewed=1,party_id='PARTY-1' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m05_banks SET active=1 WHERE tenant_id='SHOP-A'").run();
});
after(async()=>server.close());

test('test Worker has no public purchase RPC',async()=>{
  const response=await worker.fetch('https://m05.local/api/rpc');
  assert.equal(response.status,404);
});

test('cash purchase creates one supplier lot with original purchase date, stock, movement and due, without customer net',async()=>{
  assert.deepEqual(await poster().post(input('OP-PUR-000001')),{status:'COMMITTED',operationId:'OP-PUR-000001',purchaseId:'PUR-OP-PUR-000001'});
  assert.deepEqual(await one("SELECT stock,version FROM m05_products WHERE sku='PIPE'"),{stock:5,version:2});
  assert.deepEqual(await one('SELECT supplier_id,sku,qty,unit_cost_paisa,sell_price_paisa,purchase_date FROM m05_lots'),{
    supplier_id:'SUP-1',sku:'PIPE',qty:2,unit_cost_paisa:1525,sell_price_paisa:1800,purchase_date:'2026-11-10'
  });
  assert.deepEqual(await one('SELECT grand_paisa,paid_paisa,due_paisa FROM m05_purchases'),{grand_paisa:3000,paid_paisa:1000,due_paisa:2000});
  assert.deepEqual(await rows('SELECT debit_paisa FROM m05_cash_book'),[{debit_paisa:1000}]);
  assert.deepEqual(await rows('SELECT debit_paisa FROM m05_supplier_ledger'),[{debit_paisa:2000}]);
  assert.equal((await one("SELECT payable_paisa FROM m05_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,6000);
  assert.equal((await one("SELECT customer_ar_paisa FROM m05_unrelated_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m05_movements')).n,1);
});

test('bank purchase records bank debit and no Cash Book movement; fully paid purchase has no due ledger',async()=>{
  const result=await poster().post(input('OP-PUR-000002',{
    unitPrice:'10.00',discount:'0',paidAmount:'20.00',paymentMethod:'Bank',bankAccountId:'BANK-1'
  }));
  assert.equal(result.status,'COMMITTED');
  assert.equal((await one('SELECT COUNT(*) AS n FROM m05_cash_book')).n,0);
  assert.deepEqual(await rows('SELECT bank_account_id,debit_paisa FROM m05_bank_book'),[{bank_account_id:'BANK-1',debit_paisa:2000}]);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m05_supplier_ledger')).n,0);
  assert.equal((await one("SELECT payable_paisa FROM m05_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
});

test('operation replay is exactly once and mutated intent or actor conflicts without effects',async()=>{
  const purchase=input('OP-PUR-000003');
  assert.equal((await poster().post(purchase)).status,'COMMITTED');
  const original=await snapshot();
  assert.deepEqual(await poster().post({...purchase,purchaseId:'IGNORED-ON-REPLAY'}),{
    status:'REPLAY',operationId:'OP-PUR-000003',purchaseId:purchase.purchaseId
  });
  assert.equal((await poster().post({...purchase,qty:1})).status,'CONFLICT');
  assert.equal((await poster().post({...purchase,actorId:'USER-OTHER'})).status,'CONFLICT');
  assert.deepEqual(await snapshot(),original);
});

test('stale product version, inactive supplier, unreviewed Party link, closed session and disabled bank each decline before mutation',async()=>{
  for(const [id,sql,override] of [
    ['OP-STALE-0001',null,{expectedVersion:2}],
    ['OP-STALE-0002',"UPDATE m05_suppliers SET active=0",{}],
    ['OP-STALE-0003',"UPDATE m05_party_links SET reviewed=0",{}],
    ['OP-STALE-0004',"UPDATE m05_sessions SET state='Closed'",{}],
    ['OP-STALE-0005',"UPDATE m05_banks SET active=0",{paymentMethod:'Bank',bankAccountId:'BANK-1'}]
  ]){
    if(sql)await DB.prepare(sql).run();
    const beforeState=await snapshot();
    assert.equal((await poster().post(input(id,override))).status,'DECLINED',id);
    assert.deepEqual(await snapshot(),beforeState,id);
    if(sql?.includes('suppliers'))await DB.prepare('UPDATE m05_suppliers SET active=1').run();
    if(sql?.includes('party_links'))await DB.prepare('UPDATE m05_party_links SET reviewed=1').run();
    if(sql?.includes('sessions'))await DB.prepare("UPDATE m05_sessions SET state='Open'").run();
    if(sql?.includes('banks'))await DB.prepare('UPDATE m05_banks SET active=1').run();
  }
});

test('after preflight the SQL claim rejects stale supplier Party mapping and changed product version',async()=>{
  for(const [id,sql] of [
    ['OP-TOCTOU-001',"UPDATE m05_party_links SET party_id='PARTY-WRONG'"],
    ['OP-TOCTOU-002',"UPDATE m05_products SET version=version+1"]
  ]){
    const result=await poster({beforeBatch:async()=>DB.prepare(sql).run()}).post(input(id));
    assert.equal(result.status,'DECLINED');
    assert.equal((await one('SELECT COUNT(*) AS n FROM m05_purchases')).n,0);
    assert.equal((await one('SELECT COUNT(*) AS n FROM m05_lots')).n,0);
    if(sql?.includes('party_links'))await DB.prepare("UPDATE m05_party_links SET party_id='PARTY-1'").run();
    if(sql?.includes('products'))await DB.prepare("UPDATE m05_products SET version=1").run();
  }
});

test('concurrent operations cannot both spend the same product version',async()=>{
  const [a,b]=await Promise.allSettled([
    poster().post(input('OP-RACE-00001')),
    poster().post(input('OP-RACE-00002'))
  ]);
  const status=[a,b].map(x=>x.status==='fulfilled'?x.value.status:'NEEDS_REVIEW');
  assert.equal(status.filter(x=>x==='COMMITTED').length,1);
  assert.equal(status.every(x=>['COMMITTED','DECLINED','NEEDS_REVIEW'].includes(x)),true);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m05_purchases')).n,1);
  assert.equal((await one("SELECT stock FROM m05_products WHERE sku='PIPE'")).stock,5);
});

test('late ledger constraint failure rolls back receipt, lot, stock, cash and due in the same D1 transaction',async()=>{
  await DB.prepare("CREATE TRIGGER m05_inject_failure BEFORE INSERT ON m05_supplier_ledger BEGIN SELECT RAISE(ABORT,'injected-late-ledger-failure'); END").run();
  const original=await snapshot();
  await assert.rejects(poster().post(input('OP-FAIL-000001')),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),original);
});

test('invalid or imprecise money, bundle SKU, negative qty and no source supplier reject safely',async()=>{
  for(const override of [
    {qty:0},{qty:-1},{unitPrice:'1.001'},{discount:'-1.00'},{paidAmount:'99.99'},
    {sku:'BUNDLE',qty:1},{supplierId:''},{bankAccountId:'NO-BANK',paymentMethod:'Bank'}
  ]){
    const result=await poster().post(input('OP-VALID-0001',override)).catch(e=>({error:e.message}));
    assert.notEqual(result.status,'COMMITTED');
    assert.equal((await one('SELECT COUNT(*) AS n FROM m05_purchases')).n,0);
  }
});

test('uncertain response must not automatically repeat a new operation or claim no commit',async()=>{
  const beforeBatch=async()=>{throw new Error('network interrupted before commit');};
  await assert.rejects(poster({beforeBatch}).post(input('OP-UNKNOWN-01')),/network interrupted/);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m05_purchases')).n,0);
});


test('real local D1 posted purchase can be projected as source-shaped read-only detail without ledger or lot changes',async()=>{
  const posting=await poster().post(input('OP-DETAIL-0001'));
  assert.equal(posting.status,'COMMITTED');
  const beforeRead=await snapshot();
  const receipt=await one("SELECT * FROM m05_purchases WHERE tenant_id='SHOP-A' AND operation_id='OP-DETAIL-0001'");
  const items=await rows("SELECT * FROM m05_items WHERE tenant_id='SHOP-A' AND purchase_id='PUR-OP-DETAIL-0001'");
  const lots=await rows("SELECT * FROM m05_lots WHERE tenant_id='SHOP-A' AND purchase_id='PUR-OP-DETAIL-0001'");
  const detail=projectPurchaseDetail(receipt.purchase_id,{
    purchases:[{
      'Purchase ID':receipt.purchase_id,'Date':receipt.purchase_date,
      'Supplier ID':receipt.supplier_id,'Supplier Name':'Synthetic Supplier',
      'Subtotal':(receipt.grand_paisa+receipt.discount_paisa)/100,
      'Discount':receipt.discount_paisa/100,'Grand Total':receipt.grand_paisa/100,
      'Paid Amount':receipt.paid_paisa/100,'Due Amount':receipt.due_paisa/100,
      'Payment Status':'Partial','Payment Method':receipt.payment_method,
      'Bank Account Name':'','Is Deleted':'FALSE'
    }],
    items:items.map(i=>({
      'Purchase ID':i.purchase_id,'Product ID':i.sku,'Product Name':'Synthetic Pipe',
      'Quantity':i.qty,'Unit Price':i.unit_cost_paisa/100,
      'Sell Price':'','Line Total':(i.unit_cost_paisa*i.qty)/100
    })),
    lots:lots.map(l=>({
      'Lot ID':l.lot_id,'Purchase ID':l.purchase_id,'Product ID':l.sku,
      'Sell Price':l.sell_price_paisa/100
    })),
    products:[{'Product ID':'PIPE','Selling Price':0}],
    returns:[]
  });
  assert.deepEqual({
    id:detail.purchaseId,supplier:detail.supplierId,date:detail.date,
    grand:detail.grandTotal,paid:detail.paidAmount,due:detail.dueAmount,
    item:detail.items[0],returned:detail.returnedAmount
  },{
    id:'PUR-OP-DETAIL-0001',supplier:'SUP-1',date:'2026-11-10',
    grand:30,paid:10,due:20,
    item:{productId:'PIPE',name:'Synthetic Pipe',qty:2,unitPrice:15.25,
      sellingPrice:18,lineTotal:30.5},
    returned:0
  });
  assert.deepEqual(await snapshot(),beforeRead);
});

});
