import {describe,before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05ML_DDL,M05ML_SEED} from '../fixtures/m05-purchase-multiline-schema.mjs';
import {createSyntheticMultilinePurchasePoster} from '../fixtures/m05-purchase-multiline-contract.mjs';

// Synthetic local D1; NEVER the deployed Worker, main D1, or real shop data.
const server=createTestHarness({workers:[{configPath:'./wrangler.m05-multiline-test.jsonc'}]});
const worker=server.getWorker('shererp-m05-multiline-local-test');
let DB;
const line=(sku,qty,unitPrice,sellPrice,expectedVersion=1)=>({
  sku,qty,unitPrice,sellPrice,expectedVersion
});
const input=(operationId,overrides={})=>({
  tenantId:'SHOP-A',actorId:'USER-A',purchaseId:'PUR-'+operationId,
  operationId,supplierId:'SUP-1',date:'2026-11-10',
  items:[line('PIPE',2,'15.25','18'),line('SWITCH',3,'7.50','10')],
  discount:'1',paidAmount:'20',paymentMethod:'Cash',bankAccountId:'',...overrides
});
const poster=options=>createSyntheticMultilinePurchasePoster(DB,options);
const all=async sql=>(await DB.prepare(sql).all()).results.map(r=>({...r}));
const one=sql=>DB.prepare(sql).first();
const count=async table=>(await one('SELECT COUNT(*) AS n FROM '+table)).n;
const snapshot=async()=>({
  purchases:await all('SELECT * FROM m05ml_purchases ORDER BY purchase_id'),
  items:await all('SELECT * FROM m05ml_items ORDER BY purchase_id,sku'),
  lots:await all('SELECT * FROM m05ml_lots ORDER BY purchase_id,sku'),
  movements:await all('SELECT * FROM m05ml_movements ORDER BY purchase_id,sku'),
  cash:await all('SELECT * FROM m05ml_cash_book ORDER BY purchase_id'),
  bank:await all('SELECT * FROM m05ml_bank_book ORDER BY purchase_id'),
  supplierLedger:await all('SELECT * FROM m05ml_supplier_ledger ORDER BY purchase_id'),
  products:await all('SELECT * FROM m05ml_products ORDER BY sku'),
  suppliers:await all('SELECT * FROM m05ml_suppliers ORDER BY supplier_id'),
  customers:await all('SELECT * FROM m05ml_customer_accounts ORDER BY party_id')
});

describe('M05 multiple SKU atomic purchase (isolated real Workerd D1)',()=>{
  before(async()=>{
    await server.listen();
    ({DB}=await worker.getEnv());
    for(const sql of M05ML_DDL)await DB.prepare(sql).run();
    for(const [sql,args] of M05ML_SEED)await DB.prepare(sql).bind(...args).run();
  });
  beforeEach(async()=>{
    await DB.prepare('DROP TRIGGER IF EXISTS m05ml_inject_fail_ledger').run();
    await DB.prepare('DROP TRIGGER IF EXISTS m05ml_purchase_immutable_delete').run();
    for(const table of [
      'm05ml_supplier_ledger','m05ml_bank_book','m05ml_cash_book','m05ml_movements',
      'm05ml_lots','m05ml_items','m05ml_purchases'
    ])await DB.prepare('DELETE FROM '+table).run();
    await DB.prepare(`CREATE TRIGGER m05ml_purchase_immutable_delete BEFORE DELETE ON m05ml_purchases
      BEGIN SELECT RAISE(ABORT,'m05ml-immutable-receipt'); END`).run();
    await DB.prepare(`UPDATE m05ml_products SET
      stock=CASE sku WHEN 'PIPE' THEN 4 WHEN 'SWITCH' THEN 2 ELSE 0 END,
      version=1,active=1,sell_paisa=0`).run();
    await DB.prepare(`UPDATE m05ml_suppliers SET active=1,
      payable_paisa=CASE supplier_id WHEN 'SUP-1' THEN 4000 ELSE 2000 END`).run();
    await DB.prepare('UPDATE m05ml_party_links SET reviewed=1').run();
    await DB.prepare("UPDATE m05ml_sessions SET state='Open'").run();
    await DB.prepare('UPDATE m05ml_banks SET active=1').run();
  });
  after(async()=>server.close());

  test('test-only Worker does not expose purchase RPC',async()=>{
    assert.equal((await worker.fetch('http://m05ml.local/api/rpc')).status,404);
  });

  test('two source purchase lines commit distinct supplier lots, movements and stock versions with one gross due',async()=>{
    assert.deepEqual(await poster().post(input('OP-ML-000001')),{
      status:'COMMITTED',operationId:'OP-ML-000001',purchaseId:'PUR-OP-ML-000001'
    });
    assert.deepEqual(await all('SELECT sku,stock,version,sell_paisa FROM m05ml_products ORDER BY sku'),[
      {sku:'BUNDLE',stock:0,version:1,sell_paisa:0},
      {sku:'PIPE',stock:6,version:2,sell_paisa:1800},
      {sku:'SWITCH',stock:5,version:2,sell_paisa:1000}
    ]);
    assert.deepEqual(await all('SELECT sku,qty,cost_paisa,sell_paisa,purchase_date,supplier_id FROM m05ml_lots ORDER BY sku'),[
      {sku:'PIPE',qty:2,cost_paisa:1525,sell_paisa:1800,purchase_date:'2026-11-10',supplier_id:'SUP-1'},
      {sku:'SWITCH',qty:3,cost_paisa:750,sell_paisa:1000,purchase_date:'2026-11-10',supplier_id:'SUP-1'}
    ]);
    assert.deepEqual(await all('SELECT sku,units_in,balance_stock FROM m05ml_movements ORDER BY sku'),[
      {sku:'PIPE',units_in:2,balance_stock:6},{sku:'SWITCH',units_in:3,balance_stock:5}
    ]);
    assert.deepEqual(await one('SELECT subtotal_paisa,discount_paisa,grand_paisa,paid_paisa,due_paisa FROM m05ml_purchases'),{
      subtotal_paisa:5300,discount_paisa:100,grand_paisa:5200,paid_paisa:2000,due_paisa:3200
    });
    assert.deepEqual(await all('SELECT debit_paisa FROM m05ml_cash_book'),[{debit_paisa:2000}]);
    assert.deepEqual(await all('SELECT supplier_id,debit_paisa,balance_paisa FROM m05ml_supplier_ledger'),[
      {supplier_id:'SUP-1',debit_paisa:3200,balance_paisa:7200}
    ]);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,7200);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-2'")).payable_paisa,2000);
    assert.equal((await one("SELECT customer_ar_paisa FROM m05ml_customer_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
    assert.equal(await count('m05ml_items'),2);
  });

  test('fully paid Bank purchase posts one debit to Bank Book; no Cash or Supplier ledger',async()=>{
    assert.equal((await poster().post(input('OP-ML-000002',{
      discount:'1',paidAmount:'52.00',paymentMethod:'Bank',bankAccountId:'BANK-1'
    }))).status,'COMMITTED');
    assert.deepEqual(await all('SELECT bank_account_id,debit_paisa FROM m05ml_bank_book'),[
      {bank_account_id:'BANK-1',debit_paisa:5200}
    ]);
    assert.equal(await count('m05ml_cash_book'),0);
    assert.equal(await count('m05ml_supplier_ledger'),0);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
  });

  test('same operation fingerprint replays once; modified line, actor and supplier cannot reuse its ID',async()=>{
    const purchase=input('OP-ML-000003');
    assert.equal((await poster().post(purchase)).status,'COMMITTED');
    const committed=await snapshot();
    assert.deepEqual(await poster().post({...purchase,purchaseId:'PUR-IGNORED'}),{
      status:'REPLAY',operationId:purchase.operationId,purchaseId:purchase.purchaseId
    });
    for(const changed of [
      {...purchase,items:[...purchase.items.slice(0,1),line('SWITCH',4,'7.50','10')]},
      {...purchase,actorId:'USER-B'},
      {...purchase,supplierId:'SUP-2'}
    ])assert.equal((await poster().post(changed)).status,'CONFLICT');
    assert.deepEqual(await snapshot(),committed);
  });

  test('second SKU stale version declines the ENTIRE multi-line basket with no purchase, lot or money',async()=>{
    const original=await snapshot();
    assert.equal((await poster().post(input('OP-ML-STALE-01',{
      items:[line('PIPE',2,'15.25','18'),line('SWITCH',3,'7.50','10',9)]
    }))).status,'DECLINED');
    assert.deepEqual(await snapshot(),original);
  });

  test('product version changing after preview rejects in atomic SQL before either product is touched',async()=>{
    const result=await poster({
      beforeBatch:()=>DB.prepare("UPDATE m05ml_products SET version=2 WHERE sku='SWITCH'").run()
    }).post(input('OP-ML-TOCTOU-1'));
    assert.equal(result.status,'DECLINED');
    assert.equal(await count('m05ml_purchases'),0);
    assert.equal(await count('m05ml_lots'),0);
    assert.equal((await one("SELECT stock FROM m05ml_products WHERE sku='PIPE'")).stock,4);
    assert.equal((await one("SELECT stock FROM m05ml_products WHERE sku='SWITCH'")).stock,2);
  });

  test('inactive Supplier, unreviewed legacy link, closed Cash Session or disabled Bank refuse all lines',async()=>{
    const scenarios=[
      ["UPDATE m05ml_suppliers SET active=0 WHERE supplier_id='SUP-1'",{}],
      ["UPDATE m05ml_party_links SET reviewed=0 WHERE source_id='SUP-1'",{}],
      ["UPDATE m05ml_sessions SET state='Closed'",{}],
      ["UPDATE m05ml_banks SET active=0",{paymentMethod:'Bank',bankAccountId:'BANK-1'}]
    ];
    for(let i=0;i<scenarios.length;i++){
      const [mutation,overrides]=scenarios[i];
      await DB.prepare(mutation).run();
      const beforeState=await snapshot();
      assert.equal((await poster().post(input('OP-ML-GATE-00'+i,overrides))).status,'DECLINED');
      assert.deepEqual(await snapshot(),beforeState);
      await DB.prepare("UPDATE m05ml_suppliers SET active=1").run();
      await DB.prepare("UPDATE m05ml_party_links SET reviewed=1").run();
      await DB.prepare("UPDATE m05ml_sessions SET state='Open'").run();
      await DB.prepare("UPDATE m05ml_banks SET active=1").run();
    }
  });

  test('failure inserting the final Supplier ledger rolls back BOTH stock rows, lots and cash debit',async()=>{
    await DB.prepare(`CREATE TRIGGER m05ml_inject_fail_ledger BEFORE INSERT ON m05ml_supplier_ledger
      BEGIN SELECT RAISE(ABORT,'test-late-supplier-ledger-failure'); END`).run();
    const original=await snapshot();
    await assert.rejects(poster().post(input('OP-ML-FAIL-0001')),/NEEDS_REVIEW/);
    assert.deepEqual(await snapshot(),original);
  });

  test('two concurrent operation IDs racing with identical SKU versions cannot both commit',async()=>{
    const [a,b]=await Promise.allSettled([
      poster().post(input('OP-ML-RACE-0001')),
      poster().post(input('OP-ML-RACE-0002'))
    ]);
    const statuses=[a,b].map(x=>x.status==='fulfilled'?x.value.status:'NEEDS_REVIEW');
    assert.equal(statuses.filter(s=>s==='COMMITTED').length,1);
    assert.equal(statuses.every(s=>['COMMITTED','DECLINED','NEEDS_REVIEW'].includes(s)),true);
    assert.equal(await count('m05ml_purchases'),1);
    assert.equal(await count('m05ml_lots'),2);
    assert.equal(await count('m05ml_movements'),2);
    assert.equal(await count('m05ml_cash_book'),1);
  });

  test('source backdated date participates in FIFO across purchases from different suppliers',async()=>{
    const a=input('OP-ML-FIFO-0001');
    assert.equal((await poster().post(a)).status,'COMMITTED');
    const second=input('OP-ML-FIFO-0002',{
      supplierId:'SUP-2',date:'2026-11-01',
      items:[line('PIPE',1,'20','22',2),line('SWITCH',1,'8','11',2)],
      paidAmount:'0',discount:'0'
    });
    assert.equal((await poster().post(second)).status,'COMMITTED');
    assert.deepEqual(await all("SELECT supplier_id,purchase_date FROM m05ml_lots WHERE sku='PIPE' ORDER BY purchase_date,lot_id"),[
      {supplier_id:'SUP-2',purchase_date:'2026-11-01'},
      {supplier_id:'SUP-1',purchase_date:'2026-11-10'}
    ]);
    assert.equal(await count('m05ml_supplier_ledger'),2);
    assert.equal((await one("SELECT customer_ar_paisa FROM m05ml_customer_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
  });

  test('duplicate, empty, missing or Bundle lines and fractional paisa never post',async()=>{
    const variants=[
      {items:[]},
      {items:[line('PIPE',1,'1','2'),line('PIPE',2,'1','2')]},
      {items:[line('PIPE',1,'1','2'),line('MISSING',1,'1','2')]},
      {items:[line('PIPE',1,'1','2'),line('BUNDLE',1,'1','2')]},
      {items:[line('PIPE',0,'1','2')]},
      {items:[line('PIPE',2,'1.001','2')]},
      {discount:'-1'},
      {paidAmount:'9999'},
      {tenantId:'SHOP-NO-SESSION'}
    ];
    for(let i=0;i<variants.length;i++){
      const outcome=await poster().post(input('OP-ML-VALID-'+String(i).padStart(3,'0'),variants[i]))
        .catch(e=>({error:e.message}));
      assert.notEqual(outcome.status,'COMMITTED');
      assert.equal(await count('m05ml_purchases'),0);
      assert.equal(await count('m05ml_items'),0);
    }
  });
});
