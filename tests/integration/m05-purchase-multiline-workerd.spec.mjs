import {describe,before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05ML_DDL,M05ML_SEED} from '../fixtures/m05-purchase-multiline-schema.mjs';
import {createSyntheticMultilinePurchasePoster} from '../fixtures/m05-purchase-multiline-contract.mjs';
import {planPurchaseInventoryEdit,planPurchaseInventoryDelete} from '../../src/modules/purchase-correction-guards.js';
import {M05ML_DELETE_DDL} from '../fixtures/m05-purchase-delete-d1-schema.mjs';
import {createSyntheticPurchaseDeleter} from '../fixtures/m05-purchase-delete-d1-contract.mjs';

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
const deleter=options=>createSyntheticPurchaseDeleter(DB,options);
const deletionInput=(id,overrides={})=>({
  tenantId:'SHOP-A',actorId:'USER-A',purchaseId:'PUR-OP-DELETE-0001',
  operationId:id,reason:'Incorrect original purchase',...overrides
});
const reversalState=async()=>({
  original:await snapshot(),
  deleted:await all('SELECT * FROM m05ml_delete_receipts ORDER BY operation_id'),
  audit:await all('SELECT * FROM m05ml_delete_audit ORDER BY operation_id'),
  activeCash:await all('SELECT * FROM m05ml_active_cash_book ORDER BY purchase_id'),
  activeBank:await all('SELECT * FROM m05ml_active_bank_book ORDER BY purchase_id'),
  activeSupplierLedger:await all('SELECT * FROM m05ml_active_supplier_ledger ORDER BY purchase_id')
});
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
    for(const sql of M05ML_DELETE_DDL)await DB.prepare(sql).run();
    for(const [sql,args] of M05ML_SEED)await DB.prepare(sql).bind(...args).run();
  });
  beforeEach(async()=>{
    await DB.prepare('DROP TRIGGER IF EXISTS m05ml_inject_fail_ledger').run();
    await DB.prepare('DROP TRIGGER IF EXISTS m05ml_inject_fail_delete_audit').run();
    for(const t of ['m05ml_delete_audit','m05ml_delete_receipts','m05ml_purchase_returns','m05ml_purchase_settlements'])
      await DB.prepare('DELETE FROM '+t).run();
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

  test('source arithmetic clamps an over-tendered purchase payment to grand total without extra cash',async()=>{
    const result=await poster().post(input('OP-ML-CLAMP-001',{
      paidAmount:'9999',paymentMethod:'Cash'
    }));
    assert.equal(result.status,'COMMITTED');
    assert.deepEqual(await all('SELECT grand_paisa,paid_paisa,due_paisa FROM m05ml_purchases'),[
      {grand_paisa:5200,paid_paisa:5200,due_paisa:0}
    ]);
    assert.deepEqual(await all('SELECT debit_paisa FROM m05ml_cash_book'),[{debit_paisa:5200}]);
    assert.equal(await count('m05ml_supplier_ledger'),0);
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
      {paidAmount:'0.001'},
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

  test('real D1 posted two-SKU purchase correction guard refuses consumed lot and never posts reversal',async()=>{
    const receiptId='PUR-OP-CORR-00001';
    assert.equal((await poster().post(input('OP-CORR-00001'))).status,'COMMITTED');
    const readSourceShape=async()=>({
      purchases:(await all("SELECT * FROM m05ml_purchases WHERE purchase_id='"+receiptId+"'"))
        .map(p=>({'Purchase ID':p.purchase_id,'Is Deleted':'FALSE'})),
      items:(await all("SELECT * FROM m05ml_items WHERE purchase_id='"+receiptId+"'"))
        .map(i=>({'Purchase ID':i.purchase_id,'Product ID':i.sku,'Product Name':i.sku,
          'Quantity':i.qty,'Unit Price':i.cost_paisa/100})),
      lots:(await all("SELECT * FROM m05ml_lots WHERE purchase_id='"+receiptId+"'"))
        .map(l=>({'Purchase ID':l.purchase_id,'Lot ID':l.lot_id,'Product ID':l.sku,
          'Original Quantity':l.qty,'Remaining Quantity':l.remaining_qty})),
      products:(await all("SELECT * FROM m05ml_products WHERE tenant_id='SHOP-A'"))
        .map(p=>({'Product ID':p.sku,'Product Name':p.sku,'Current Stock':p.stock})),
      returns:[]
    });
    const original=await readSourceShape();
    const propose=[{productId:'PIPE',name:'PIPE',qty:1,unitPrice:15.25},
      {productId:'SWITCH',name:'SWITCH',qty:3,unitPrice:7.5}];
    assert.deepEqual(planPurchaseInventoryEdit(receiptId,original,propose),{
      stockChanges:[{productId:'PIPE',delta:-1,newStock:5}],costChanges:[]
    });
    assert.deepEqual(planPurchaseInventoryDelete(receiptId,original),{
      stockReversals:[
        {productId:'PIPE',qty:2,newStock:4,lotIds:['LOT-'+receiptId+'-PIPE']},
        {productId:'SWITCH',qty:3,newStock:2,lotIds:['LOT-'+receiptId+'-SWITCH']}
      ]
    });

    // Simulate an independent POS FIFO consumption AFTER preview.
    await DB.prepare("UPDATE m05ml_lots SET remaining_qty=remaining_qty-1 WHERE sku='PIPE'").run();
    await DB.prepare("UPDATE m05ml_products SET stock=stock-1 WHERE sku='PIPE'").run();
    const latest=await readSourceShape();
    const beforeChecks=await snapshot();
    assert.deepEqual(planPurchaseInventoryEdit(receiptId,latest,propose),{
      stockChanges:[{productId:'PIPE',delta:-1,newStock:4}],costChanges:[]
    });
    assert.throws(()=>planPurchaseInventoryEdit(receiptId,latest,[
      {...propose[0],unitPrice:16},propose[1]
    ]),/Purchase price cannot be changed after stock from this lot has already been sold/);
    assert.throws(()=>planPurchaseInventoryDelete(receiptId,latest),
      /Cannot delete this purchase - stock from it has already been sold: PIPE \(1 of 2 already sold\)/);
    assert.deepEqual(await snapshot(),beforeChecks,'read-only correction checks cannot mutate accounting');

    // A second sale makes the previously eligible -1 reduction stale.
    await DB.prepare("UPDATE m05ml_lots SET remaining_qty=remaining_qty-1 WHERE sku='PIPE'").run();
    await DB.prepare("UPDATE m05ml_products SET stock=stock-1 WHERE sku='PIPE'").run();
    const newer=await readSourceShape();
    assert.throws(()=>planPurchaseInventoryEdit(receiptId,newer,propose),
      /only 0 of the 2 bought on this purchase is still unsold/);
    assert.equal((await one("SELECT COUNT(*) AS n FROM m05ml_supplier_ledger")).n,1);
    assert.equal((await one("SELECT COUNT(*) AS n FROM m05ml_cash_book")).n,1);
    assert.equal((await one("SELECT customer_ar_paisa FROM m05ml_customer_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
  });


  test('M05 local D1 soft-delete reverses BOTH SKU stocks and original supplier due, with cash masked but history retained',async()=>{
    const p=await poster().post(input('OP-DELETE-0001'));
    assert.equal(p.status,'COMMITTED');
    assert.deepEqual(await deleter().remove(deletionInput('OP-DEL-000001')),{
      status:'COMMITTED',operationId:'OP-DEL-000001',
      purchaseId:'PUR-OP-DELETE-0001',linesReversed:2,dueReversedPaisa:3200
    });
    assert.deepEqual(await all("SELECT sku,stock,version FROM m05ml_products WHERE sku IN ('PIPE','SWITCH') ORDER BY sku"),[
      {sku:'PIPE',stock:4,version:3},{sku:'SWITCH',stock:2,version:3}
    ]);
    assert.deepEqual(await all('SELECT sku,qty,remaining_qty FROM m05ml_lots ORDER BY sku'),[
      {sku:'PIPE',qty:2,remaining_qty:0},{sku:'SWITCH',qty:3,remaining_qty:0}
    ]);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
    assert.equal((await one("SELECT customer_ar_paisa FROM m05ml_customer_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
    assert.equal(await count('m05ml_cash_book'),1,'source cash row retained for audit');
    assert.equal(await count('m05ml_supplier_ledger'),1,'source supplier ledger row retained for audit');
    assert.equal((await all('SELECT * FROM m05ml_active_cash_book')).length,0,'source cash entry becomes hidden');
    assert.equal((await all('SELECT * FROM m05ml_active_supplier_ledger')).length,0,'source payable entry becomes hidden');
    assert.equal(await count('m05ml_purchases'),1,'purchase header remains immutable');
    assert.equal((await one("SELECT reason,actor_id FROM m05ml_delete_receipts")).reason,'Incorrect original purchase');
    assert.deepEqual(await one('SELECT lines_reversed,due_reversed_paisa FROM m05ml_delete_audit'),{
      lines_reversed:2,due_reversed_paisa:3200
    });
  });

  test('fully paid Bank purchase deletion voids active Bank view, never touches Cash or Customer AR',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001',{
      paidAmount:'52',discount:'1',paymentMethod:'Bank',bankAccountId:'BANK-1'
    }))).status,'COMMITTED');
    assert.equal((await deleter().remove(deletionInput('OP-DEL-000002'))).status,'COMMITTED');
    assert.equal(await count('m05ml_bank_book'),1);
    assert.equal((await all('SELECT * FROM m05ml_active_bank_book')).length,0);
    assert.equal(await count('m05ml_cash_book'),0);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
    assert.equal((await one("SELECT customer_ar_paisa FROM m05ml_customer_accounts WHERE party_id='PARTY-1'")).customer_ar_paisa,9000);
  });

  test('no-payment supplier purchase deletes original full due without creating a tender reversal',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001',{paidAmount:'0',discount:'0'}))).status,'COMMITTED');
    const result=await deleter().remove(deletionInput('OP-DEL-000003'));
    assert.deepEqual({status:result.status,due:result.dueReversedPaisa},{status:'COMMITTED',due:5300});
    assert.equal(await count('m05ml_cash_book'),0);
    assert.equal(await count('m05ml_bank_book'),0);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
  });

  test('deletion replays exactly once; conflicting same operation cannot change reason or actor; second op cannot delete twice',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    const first=deletionInput('OP-DEL-REPLAY-1');
    assert.equal((await deleter().remove(first)).status,'COMMITTED');
    const prior=await reversalState();
    assert.deepEqual(await deleter().remove(first),{
      status:'REPLAY',operationId:first.operationId,purchaseId:first.purchaseId,
      linesReversed:2,dueReversedPaisa:3200
    });
    for(const override of [
      {reason:'Different reason'},{actorId:'USER-B'},{purchaseId:'PUR-SOME-OTHER'}
    ])assert.equal((await deleter().remove({...first,...override})).status,'CONFLICT');
    assert.equal((await deleter().remove({...first,operationId:'OP-DEL-SECOND-1'})).status,'DECLINED');
    assert.deepEqual(await reversalState(),prior);
  });

  test('consumed lot blocks deletion atomically even when other supplier stock could cover it',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    await DB.prepare("UPDATE m05ml_lots SET remaining_qty=remaining_qty-1 WHERE sku='PIPE'").run();
    await DB.prepare("UPDATE m05ml_products SET stock=stock-1,version=version+1 WHERE sku='PIPE'").run();
    const before=await reversalState();
    assert.equal((await deleter().remove(deletionInput('OP-DEL-CONSUMED-1'))).status,'DECLINED');
    assert.deepEqual(await reversalState(),before);
  });

  test('external stock depletion blocks whole two-SKU delete with original lots still unsold',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    await DB.prepare("UPDATE m05ml_products SET stock=1,version=version+1 WHERE sku='SWITCH'").run();
    const before=await reversalState();
    assert.equal((await deleter().remove(deletionInput('OP-DEL-SHORT-001'))).status,'DECLINED');
    assert.deepEqual(await reversalState(),before);
  });

  test('stale preview is rejected when a lot is consumed immediately before SQL claim',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    const result=await deleter({
      beforeBatch:()=>DB.prepare("UPDATE m05ml_lots SET remaining_qty=0 WHERE sku='SWITCH'").run()
    }).remove(deletionInput('OP-DEL-RACE-LOT'));
    assert.equal(result.status,'DECLINED');
    assert.equal(await count('m05ml_delete_receipts'),0);
    assert.equal(await count('m05ml_delete_audit'),0);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,7200);
  });

  test('stale preview is rejected when product stock changes immediately before SQL claim',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    const result=await deleter({
      beforeBatch:()=>DB.prepare("UPDATE m05ml_products SET stock=1,version=version+1 WHERE sku='SWITCH'").run()
    }).remove(deletionInput('OP-DEL-RACE-STK'));
    assert.equal(result.status,'DECLINED');
    assert.equal(await count('m05ml_delete_receipts'),0);
    assert.equal(await count('m05ml_delete_audit'),0);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,7200);
  });

  test('active Purchase Return or allocated Supplier settlement blocks delete until independently reversed',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    for(const [table,sql] of [
      ['return',"INSERT INTO m05ml_purchase_returns VALUES('SHOP-A','RET-1','PUR-OP-DELETE-0001',1)"],
      ['settlement',"INSERT INTO m05ml_purchase_settlements VALUES('SHOP-A','SET-1','PUR-OP-DELETE-0001',100,1)"]
    ]){
      await DB.prepare(sql).run();
      const before=await reversalState();
      assert.equal((await deleter().remove(deletionInput('OP-DEL-GATE-'+table))).status,'DECLINED');
      assert.deepEqual(await reversalState(),before);
      if(table==='return')await DB.prepare("DELETE FROM m05ml_purchase_returns").run();
      else await DB.prepare("DELETE FROM m05ml_purchase_settlements").run();
    }
  });

  test('closed Cash Session, inactive Supplier or unreviewed original Party link blocks delete safely',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    for(const [sql,restore] of [
      ["UPDATE m05ml_sessions SET state='Closed'","UPDATE m05ml_sessions SET state='Open'"],
      ["UPDATE m05ml_suppliers SET active=0 WHERE supplier_id='SUP-1'","UPDATE m05ml_suppliers SET active=1 WHERE supplier_id='SUP-1'"],
      ["UPDATE m05ml_party_links SET reviewed=0 WHERE source_id='SUP-1'","UPDATE m05ml_party_links SET reviewed=1 WHERE source_id='SUP-1'"]
    ]){
      await DB.prepare(sql).run();
      const before=await reversalState();
      assert.equal((await deleter().remove(deletionInput('OP-DEL-GATE-001'))).status,'DECLINED');
      assert.deepEqual(await reversalState(),before);
      await DB.prepare(restore).run();
    }
  });

  test('late audit append failure rolls back both SKU stocks, lots, Supplier payable and effective Cash',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    await DB.prepare("CREATE TRIGGER m05ml_inject_fail_delete_audit BEFORE INSERT ON m05ml_delete_audit BEGIN SELECT RAISE(ABORT,'forced-late-delete-audit-error'); END").run();
    const before=await reversalState();
    await assert.rejects(deleter().remove(deletionInput('OP-DEL-FAIL-001')),/NEEDS_REVIEW/);
    assert.deepEqual(await reversalState(),before);
  });

  test('concurrent deletion operation IDs can never reverse the same supplier purchase twice',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    const [a,b]=await Promise.allSettled([
      deleter().remove(deletionInput('OP-DEL-CONC-001')),
      deleter().remove(deletionInput('OP-DEL-CONC-002'))
    ]);
    const status=[a,b].map(x=>x.status==='fulfilled'?x.value.status:'NEEDS_REVIEW');
    assert.equal(status.filter(x=>x==='COMMITTED').length,1);
    assert.ok(status.every(s=>['COMMITTED','DECLINED','NEEDS_REVIEW'].includes(s)));
    assert.equal(await count('m05ml_delete_receipts'),1);
    assert.equal(await count('m05ml_delete_audit'),1);
    assert.equal((await one("SELECT payable_paisa FROM m05ml_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,4000);
    assert.deepEqual(await all("SELECT sku,stock FROM m05ml_products WHERE sku IN ('PIPE','SWITCH') ORDER BY sku"),
      [{sku:'PIPE',stock:4},{sku:'SWITCH',stock:2}]);
  });

  test('invalid identifier or empty reason never creates deletion operation',async()=>{
    assert.equal((await poster().post(input('OP-DELETE-0001'))).status,'COMMITTED');
    const before=await reversalState();
    for(const change of [{reason:''},{reason:'   '},{operationId:'short'},
      {tenantId:'SHOP-B'},{purchaseId:'DROP TABLE;'}, {actorId:''}]){
      const result=await deleter().remove(deletionInput('OP-DEL-VALID-001',change))
        .catch(e=>({error:e.message}));
      assert.notEqual(result.status,'COMMITTED');
    }
    assert.deepEqual(await reversalState(),before);
  });

});
