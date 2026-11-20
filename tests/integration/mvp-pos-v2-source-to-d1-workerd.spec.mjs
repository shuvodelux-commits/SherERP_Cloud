/**
 * MVP M06 integration: original POS request -> M06 adapter -> synthetic D1.
 * NO routed Owner API, production migration, or release acceptance.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import {normalizeMvpPosV2SaleIntent} from '../../src/modules/mvp-pos-v2-sale-intent.js';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED} from '../fixtures/m06-sale-posting-schema.mjs';

const accountRows=[
  {'Bank Account ID':'BANK-1','Account Name':'Shop Bank','Account Type':'Bank',
    Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'MOB-1','Account Name':'Shop Wallet','Account Type':'Mobile Banking',
    Status:'Active','Is Deleted':'FALSE'},
];
const context=(suffix='CASH')=>({
  tenantId:'SHOP-A',actorId:'USER-A',invoiceId:'INV-MVP-'+suffix,
  operationId:'OP-MVP-'+suffix+'-00000001',
});
const item=()=>({productId:'PIPE',name:'1 inch pipe',qty:1,unitPrice:'100.00',
  priceMode:'manual',shortageResolution:'own',productType:'Standard',bundleRevision:0});
const cash=()=>({
  customerId:'',customerName:'Walk-in',customerPhone:'',customerFatherName:'',
  customerRelationType:'',customerAddress:'',items:[item()],discount:'0.00',
  paymentType:'Cash',paidAmount:100,paymentMethod:'Cash',bankAccountId:'',
});
const normalize=(payload,ctx)=>normalizeMvpPosV2SaleIntent({context:ctx,payload,accountRows});
async function withDb(fn){
  const harness=createTestHarness({workers:[{configPath:'./wrangler.m06-sale-posting-test.jsonc'}]});
  try{
    await harness.listen();
    const {DB}=await harness.getWorker('shererp-m06-sale-workerd-test').getEnv();
    for(const ddl of M06_SALE_TEST_DDL)await DB.prepare(ddl).run();
    for(const [sql,args] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...args).run();
    return await fn(DB);
  }finally{
    await harness.close();
  }
}
const first=(DB,sql,...args)=>DB.prepare(sql).bind(...args).first();
const all=async(DB,sql,...args)=>(await DB.prepare(sql).bind(...args).all()).results;

test('actual original POS cash payload posts once to disposable D1, reduces stock and replay is a no-op',async()=>{
  await withDb(async DB=>{
    const ctx=context('CASH');
    const normalized=normalize(cash(),ctx);
    const api=createSyntheticD1SalePostingContract(DB);
    assert.deepEqual(await api.post(normalized),{
      status:'COMMITTED',operationId:ctx.operationId,invoiceId:ctx.invoiceId,
    });
    assert.equal((await first(DB,"SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,1);
    assert.deepEqual(await all(DB,'SELECT credit_paisa FROM m06_cash_book'),[{credit_paisa:10000}]);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_customer_ledger')).n,0);
    assert.deepEqual(await api.post(normalize(cash(),ctx)),{
      status:'REPLAY',operationId:ctx.operationId,invoiceId:ctx.invoiceId,
    });
    assert.equal((await first(DB,"SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,1);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_cash_book')).n,1);
  });
});

test('source split Bank+Mobile+Cash preserves cash change, real money books and zero due',async()=>{
  await withDb(async DB=>{
    const raw=cash(),ctx=context('SPLIT');
    delete raw.paymentType;delete raw.paidAmount;delete raw.paymentMethod;delete raw.bankAccountId;
    raw.customerId='CUS-1';raw.operationId=ctx.operationId;
    raw.payments=[
      {id:'BANK-ROW',method:'Bank',amount:'35.25',accountId:'BANK-1'},
      {id:'MOB-ROW',method:'Mobile Banking',amount:'22.75',accountId:'MOB-1'},
      {id:'CASH-ROW',method:'Cash',amount:'50.00',accountId:''},
    ];
    const result=await createSyntheticD1SalePostingContract(DB).post(normalize(raw,ctx));
    assert.equal(result.status,'COMMITTED');
    assert.deepEqual(await all(DB,'SELECT account_id,credit_paisa FROM m06_bank_book ORDER BY account_id'),[
      {account_id:'BANK-1',credit_paisa:3525},{account_id:'MOB-1',credit_paisa:2275},
    ]);
    assert.deepEqual(await all(DB,'SELECT credit_paisa FROM m06_cash_book'),[{credit_paisa:4200}]);
    assert.deepEqual(await all(DB,"SELECT tender_paisa,applied_paisa,change_paisa FROM m06_payment_children WHERE method='Cash'"),[
      {tender_paisa:5000,applied_paisa:4200,change_paisa:800},
    ]);
    assert.deepEqual(await first(DB,'SELECT grand_paisa,paid_paisa,due_paisa FROM m06_invoices'),{
      grand_paisa:10000,paid_paisa:10000,due_paisa:0,
    });
  });
});

test('source entirely-Due sale posts to one reviewed Customer account and not Cash/Bank',async()=>{
  await withDb(async DB=>{
    const raw={...cash(),customerId:'CUS-1',paymentType:'Due',paidAmount:0};
    const out=await createSyntheticD1SalePostingContract(DB).post(normalize(raw,context('DUE')));
    assert.equal(out.status,'COMMITTED');
    assert.equal((await first(DB,"SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,10000);
    assert.deepEqual(await all(DB,'SELECT customer_id,debit_paisa FROM m06_customer_ledger'),[
      {customer_id:'CUS-1',debit_paisa:10000},
    ]);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_cash_book')).n,0);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_bank_book')).n,0);
    assert.equal((await first(DB,'SELECT payable_paisa FROM m06_supplier_accounts')).payable_paisa,4000);
  });
});

test('stale bank account or stale Cash Session denies synthetic D1 posting after original POS preflight',async()=>{
  await withDb(async DB=>{
    const raw={...cash(),paymentMethod:'Bank',bankAccountId:'BANK-1'};
    const candidate=normalize(raw,context('BANK'));
    const posting=createSyntheticD1SalePostingContract(DB,{
      beforeBatch:async()=>DB.prepare("UPDATE m06_bank_accounts SET active=0 WHERE account_id='BANK-1'").run(),
    });
    assert.equal((await posting.post(candidate)).status,'DECLINED');
    assert.equal((await first(DB,"SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_invoices')).n,0);
  });
  await withDb(async DB=>{
    const candidate=normalize(cash(),context('CLOSED'));
    await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
    assert.equal((await createSyntheticD1SalePostingContract(DB).post(candidate)).status,'DECLINED');
    assert.equal((await first(DB,"SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
    assert.equal((await first(DB,'SELECT COUNT(*) AS n FROM m06_cash_book')).n,0);
  });
});
