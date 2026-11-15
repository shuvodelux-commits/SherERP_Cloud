import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createSyntheticD1SalePostingContract} from '../fixtures/m06-sale-posting-contract.mjs';
import {M06_SALE_TEST_DDL,M06_SALE_TEST_SEED} from '../fixtures/m06-sale-posting-schema.mjs';

const server=createTestHarness({workers:[{configPath:'./wrangler.m06-sale-posting-test.jsonc'}]});
const worker=server.getWorker('shererp-m06-sale-workerd-test');
let DB;
const input=(operationId,overrides={})=>({
  tenantId:'SHOP-A',actorId:'USER-A',operationId,invoiceId:'INV-'+operationId,
  sku:'PIPE',units:1,unitPrice:'100.00',discount:'0',customerId:'',
  payments:[{id:'C1',method:'Cash',amount:'100'}],...overrides
});
const account=(id,amount,method)=>({id,method,accountId:method==='Bank'?'BANK-1':'MOB-1',amount});
const posting=()=>createSyntheticD1SalePostingContract(DB);
const all=async(sql)=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
const one=async(sql)=>(await DB.prepare(sql).first());
const snapshot=async()=>({
  invoices:await all('SELECT tenant_id,invoice_id,operation_id,actor_id,paid_paisa,due_paisa FROM m06_invoices ORDER BY invoice_id'),
  items:await all('SELECT * FROM m06_sale_items ORDER BY invoice_id'),
  movements:await all('SELECT * FROM m06_stock_movements ORDER BY invoice_id'),
  children:await all('SELECT tenant_id,invoice_id,row_id,method,account_id,tender_paisa,applied_paisa,change_paisa FROM m06_payment_children ORDER BY invoice_id,row_order'),
  cash:await all('SELECT * FROM m06_cash_book ORDER BY invoice_id'),
  bank:await all('SELECT * FROM m06_bank_book ORDER BY invoice_id'),
  customerLedger:await all('SELECT * FROM m06_customer_ledger ORDER BY invoice_id'),
  stock:await all('SELECT * FROM m06_owned_stock ORDER BY tenant_id,sku'),
  customers:await all('SELECT * FROM m06_customer_accounts ORDER BY tenant_id,customer_id'),
  supplier:await all('SELECT * FROM m06_supplier_accounts ORDER BY tenant_id,supplier_id')
});
const count=async(table)=>(await one(`SELECT COUNT(*) n FROM ${table}`)).n;
const transactionalTables=[
  'm06_customer_ledger','m06_bank_book','m06_cash_book','m06_payment_children',
  'm06_stock_movements','m06_sale_items','m06_invoices'
];

before(async()=>{
  await server.listen();
  ({DB}=await worker.getEnv());
  for(const sql of M06_SALE_TEST_DDL)await DB.prepare(sql).run();
  for(const [sql,values] of M06_SALE_TEST_SEED)await DB.prepare(sql).bind(...values).run();
});
beforeEach(async()=>{
  for(const t of ['m06_fail_payment','m06_fail_bank','m06_fail_cash','m06_fail_due'])
    await DB.prepare('DROP TRIGGER IF EXISTS '+t).run();
  await DB.prepare('DROP TRIGGER m06_invoice_immutable_delete').run();
  for(const table of transactionalTables)await DB.prepare('DELETE FROM '+table).run();
  await DB.prepare(`CREATE TRIGGER m06_invoice_immutable_delete BEFORE DELETE ON m06_invoices
    BEGIN SELECT RAISE(ABORT,'m06-immutable-invoice'); END`).run();
  await DB.prepare("UPDATE m06_owned_stock SET available=CASE sku WHEN 'PIPE' THEN 2 ELSE 4 END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m06_cash_sessions SET state='Open' WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m06_bank_accounts SET active=1 WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m06_customer_accounts SET due_paisa=0 WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("UPDATE m06_party_links SET reviewed=1,party_id=CASE source_id WHEN 'CUS-1' THEN 'PARTY-1' ELSE 'PARTY-2' END WHERE tenant_id='SHOP-A'").run();
  await DB.prepare("DELETE FROM m06_cash_sessions WHERE tenant_id='SHOP-B'").run();
  for(const t of ['m06_owned_stock','m06_customer_accounts','m06_party_links','m06_supplier_accounts'])
    await DB.prepare(`DELETE FROM ${t} WHERE tenant_id='SHOP-B'`).run();
});
after(async()=>{await server.close();});

test('Cash tender returns change metadata, posts only applied paisa, and never invents walk-in Party',async()=>{
  const posted=await posting().post(input('OP-CASH-0001',{
    payments:[{id:'C1',method:'Cash',amount:'120'}]
  }));
  assert.deepEqual(posted,{status:'COMMITTED',operationId:'OP-CASH-0001',invoiceId:'INV-OP-CASH-0001'});
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,1);
  assert.deepEqual(await all('SELECT tender_paisa,applied_paisa,change_paisa FROM m06_payment_children'),
    [{tender_paisa:12000,applied_paisa:10000,change_paisa:2000}]);
  assert.deepEqual(await all('SELECT credit_paisa FROM m06_cash_book'),[{credit_paisa:10000}]);
  assert.equal(await count('m06_customer_ledger'),0);
  assert.equal((await one('SELECT COUNT(*) AS n FROM m06_customer_accounts')).n,2);
  assert.deepEqual(await all('SELECT payable_paisa FROM m06_supplier_accounts'),[{payable_paisa:4000}]);
});

test('Bank, Mobile Banking, Cash split conserves exact applied money and records only cash change as metadata',async()=>{
  const posted=await posting().post(input('OP-SPLIT-0001',{
    payments:[account('B1','35.25','Bank'),account('M1','22.75','Mobile Banking'),
      {id:'C1',method:'Cash',amount:'50.00'}]
  }));
  assert.equal(posted.status,'COMMITTED');
  assert.deepEqual(await all('SELECT account_id,credit_paisa FROM m06_bank_book ORDER BY account_id'),[
    {account_id:'BANK-1',credit_paisa:3525},{account_id:'MOB-1',credit_paisa:2275}
  ]);
  assert.deepEqual(await all('SELECT credit_paisa FROM m06_cash_book'),[{credit_paisa:4200}]);
  assert.deepEqual(await all("SELECT tender_paisa,applied_paisa,change_paisa FROM m06_payment_children WHERE method='Cash'"),[
    {tender_paisa:5000,applied_paisa:4200,change_paisa:800}
  ]);
  const invoice=await one('SELECT grand_paisa,paid_paisa,due_paisa FROM m06_invoices');
  assert.deepEqual(invoice,{grand_paisa:10000,paid_paisa:10000,due_paisa:0});
});

test('partial payment adds receivable only to selected verified Customer account, never Supplier payable',async()=>{
  const result=await posting().post(input('OP-PARTIAL-001',{
    customerId:'CUS-2',payments:[account('B1','40','Bank'),{id:'C1',method:'Cash',amount:'10'}]
  }));
  assert.equal(result.status,'COMMITTED');
  assert.deepEqual(await all('SELECT customer_id,due_paisa FROM m06_customer_accounts ORDER BY customer_id'),[
    {customer_id:'CUS-1',due_paisa:0},{customer_id:'CUS-2',due_paisa:5000}
  ]);
  assert.deepEqual(await all('SELECT customer_id,debit_paisa FROM m06_customer_ledger'),[
    {customer_id:'CUS-2',debit_paisa:5000}
  ]);
  assert.deepEqual(await all('SELECT payable_paisa FROM m06_supplier_accounts'),[{payable_paisa:4000}]);
});

test('entirely due sale has no payment children or money book, but one Customer ledger entry',async()=>{
  const result=await posting().post(input('OP-ALL-DUE-001',{
    customerId:'CUS-1',payments:[]
  }));
  assert.equal(result.status,'COMMITTED');
  for(const table of ['m06_payment_children','m06_cash_book','m06_bank_book'])
    assert.equal(await count(table),0,table);
  assert.equal((await one('SELECT due_paisa FROM m06_invoices')).due_paisa,10000);
  assert.equal((await one("SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,10000);
});

test('unchanged operation replays the original invoice with no additional stock, money or due',async()=>{
  const sale=input('OP-REPLAY-0001');
  assert.equal((await posting().post(sale)).status,'COMMITTED');
  const original=await snapshot();
  assert.deepEqual(await posting().post({...sale,invoiceId:'INV-IGNORED-REPLAY'}),{
    status:'REPLAY',operationId:'OP-REPLAY-0001',invoiceId:'INV-OP-REPLAY-0001'
  });
  assert.deepEqual(await snapshot(),original);
  assert.deepEqual(await posting().post({...sale,unitPrice:'99'}),{
    status:'CONFLICT',operationId:'OP-REPLAY-0001'
  });
  assert.deepEqual(await posting().post({...sale,actorId:'USER-B'}),{
    status:'CONFLICT',operationId:'OP-REPLAY-0001'
  });
  assert.deepEqual(await snapshot(),original);
});

test('two distinct operations racing for one last owned item cannot both commit',async()=>{
  await DB.prepare("UPDATE m06_owned_stock SET available=1 WHERE sku='PIPE'").run();
  const [a,b]=await Promise.allSettled([
    posting().post(input('OP-RACE-000001')),posting().post(input('OP-RACE-000002'))
  ]);
  const status=([a,b]).map(r=>r.status==='fulfilled'?r.value.status:'NEEDS_REVIEW').sort();
  assert.equal(status.includes('COMMITTED'),true);
  assert.equal(status.filter(s=>s==='COMMITTED').length,1);
  assert.equal(status.every(s=>['COMMITTED','DECLINED','NEEDS_REVIEW'].includes(s)),true);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,0);
  assert.equal(await count('m06_invoices'),1);
  assert.equal(await count('m06_stock_movements'),1);
  assert.equal(await count('m06_cash_book'),1);
});

test('late payment row trigger failure rolls back invoice, owned stock and all financial children',async()=>{
  await DB.prepare(`CREATE TRIGGER m06_fail_payment BEFORE INSERT ON m06_payment_children
    BEGIN SELECT RAISE(ABORT,'injected-child-failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting().post(input('OP-FAIL-CHILD1')),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('late Bank Book failure rolls back cash, stock, children and invoice',async()=>{
  await DB.prepare(`CREATE TRIGGER m06_fail_bank BEFORE INSERT ON m06_bank_book
    BEGIN SELECT RAISE(ABORT,'injected-bank-failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting().post(input('OP-FAIL-BANK01',{
    payments:[account('B1','50','Bank'),{id:'C1',method:'Cash',amount:'50'}]
  })),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('Customer ledger error rolls back stock, Cash/Bank and Customer balance update',async()=>{
  await DB.prepare(`CREATE TRIGGER m06_fail_due BEFORE INSERT ON m06_customer_ledger
    BEGIN SELECT RAISE(ABORT,'injected-due-failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting().post(input('OP-FAIL-DUE001',{
    customerId:'CUS-1',payments:[account('B1','50','Bank')]
  })),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('closed Cash Session blocks even all-Due sale with zero writes',async()=>{
  await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();
  const before=await snapshot();
  assert.deepEqual(await posting().post(input('OP-CLOSED-0001',{
    customerId:'CUS-1',payments:[]
  })),{status:'DECLINED',operationId:'OP-CLOSED-0001'});
  assert.deepEqual(await snapshot(),before);
});

test('stale bank disabled after payment preflight fails SQL boundary; never posts to disabled account',async()=>{
  const preflight=await snapshot();
  const p=createSyntheticD1SalePostingContract(DB,{
    beforeBatch:async()=>{await DB.prepare("UPDATE m06_bank_accounts SET active=0 WHERE account_id='BANK-1'").run();}
  });
  assert.deepEqual(await p.post(input('OP-BANK-RACE01',{
    payments:[account('B1','100','Bank')]
  })),{status:'DECLINED',operationId:'OP-BANK-RACE01'});
  assert.deepEqual(await snapshot(),preflight);
});

test('removed reviewed Customer link after payment preflight declines without touching any ledger',async()=>{
  const before=await snapshot();
  const p=createSyntheticD1SalePostingContract(DB,{
    beforeBatch:async()=>{await DB.prepare("UPDATE m06_party_links SET reviewed=0 WHERE source_id='CUS-1'").run();}
  });
  assert.deepEqual(await p.post(input('OP-PARTY-RACE1',{
    customerId:'CUS-1',payments:[{id:'C1',method:'Cash',amount:'10'}]
  })),{status:'DECLINED',operationId:'OP-PARTY-RACE1'});
  assert.deepEqual(await snapshot(),before);
});

test('no cash tender writes for a returned-in-full Cash row after Bank already covers the invoice',async()=>{
  assert.equal((await posting().post(input('OP-ALL-CHANGE1',{
    payments:[account('B1','100','Bank'),{id:'C1',method:'Cash',amount:'30'}]
  }))).status,'COMMITTED');
  assert.equal(await count('m06_cash_book'),0);
  assert.deepEqual(await all("SELECT tender_paisa,applied_paisa,change_paisa FROM m06_payment_children WHERE method='Cash'"),[
    {tender_paisa:3000,applied_paisa:0,change_paisa:3000}
  ]);
  assert.deepEqual(await all('SELECT credit_paisa FROM m06_bank_book'),[{credit_paisa:10000}]);
});

test('invalid inputs rejected before financial writes, and unknown bank/Customer never creates Party',async()=>{
  const invalid=[
    input('bad'),input('OP-INVALID-01',{unitPrice:'100.001'}),
    input('OP-INVALID-02',{units:-1}),input('OP-INVALID-03',{payments:[
      {id:'C1',method:'Cash',amount:1},{id:'C1',method:'Cash',amount:2}]}),
    input('OP-INVALID-04',{payments:[account('B1','150','Bank')]}),
    input('OP-INVALID-05',{payments:[{id:'B1',method:'Mobile Banking',accountId:'BANK-1',amount:'100'}]}),
    input('OP-INVALID-06',{payments:[],customerId:''}),
    input('OP-INVALID-07',{payments:[{id:'C1',method:'Cash',amount:'-1'}]})
  ];
  const before=await snapshot();
  for(const value of invalid){
    // Some invalid-but-balanced preflight cases (e.g. an unreferenced name)
    // can DECLINE, but must never COMMIT or mutate.
    try {const result=await posting().post(value);assert.notEqual(result.status,'COMMITTED');}
    catch(error){assert.match(error.message,/Invalid|missing|payment|customer|multiple|account|decimal|row|operation|unique|amount|paisa|two/i);}
    assert.deepEqual(await snapshot(),before);
  }
});

test('immovable original invoice and test-only Worker isolation remain intact',async()=>{
  const config=JSON.parse(readFileSync(new URL('../../wrangler.m06-sale-posting-test.jsonc',import.meta.url),'utf8'));
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.main,'tests/fixtures/m06-sale-posting-worker.mjs');
  assert.deepEqual(config.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000016']);
  const response=await worker.fetch('http://m06.local/api/rpc',{method:'POST'});
  assert.equal(response.status,404);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('m06-sale-posting-contract'),false);
  assert.equal(live.includes('m06_invoices'),false);
  await posting().post(input('OP-IMMUTABLE-01'));
  await assert.rejects(()=>DB.prepare("UPDATE m06_invoices SET paid_paisa=0 WHERE operation_id='OP-IMMUTABLE-01'").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM m06_invoices WHERE operation_id='OP-IMMUTABLE-01'").run(),/immutable/i);
});

test('stale stock preflight is denied by the atomic SQL claim without orphan invoice or tender',async()=>{
  const p=createSyntheticD1SalePostingContract(DB,{
    beforeBatch:async()=>{await DB.prepare("UPDATE m06_owned_stock SET available=0 WHERE sku='PIPE'").run();}
  });
  assert.deepEqual(await p.post(input('OP-STOCK-RACE1')),
    {status:'DECLINED',operationId:'OP-STOCK-RACE1'});
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,0);
  for(const table of transactionalTables)assert.equal(await count(table),0,table);
});

test('cash drawer closed between preflight and D1 INSERT prevents all sale effects',async()=>{
  const p=createSyntheticD1SalePostingContract(DB,{
    beforeBatch:async()=>{await DB.prepare("UPDATE m06_cash_sessions SET state='Closed' WHERE tenant_id='SHOP-A'").run();}
  });
  assert.deepEqual(await p.post(input('OP-CASH-RACE01')),
    {status:'DECLINED',operationId:'OP-CASH-RACE01'});
  for(const table of transactionalTables)assert.equal(await count(table),0,table);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,2);
});

test('forced Cash Book failure rolls back source stock and tender children',async()=>{
  await DB.prepare(`CREATE TRIGGER m06_fail_cash BEFORE INSERT ON m06_cash_book
    BEGIN SELECT RAISE(ABORT,'injected-cash-failure'); END`).run();
  const before=await snapshot();
  await assert.rejects(()=>posting().post(input('OP-FAIL-CASH01')),/NEEDS_REVIEW/);
  assert.deepEqual(await snapshot(),before);
});

test('concurrent independent due sales atomically increment one verified Customer AR without lost updates',async()=>{
  const due=(op)=>input(op,{customerId:'CUS-1',payments:[]});
  const results=await Promise.all([
    posting().post(due('OP-DUE-RACE001')),posting().post(due('OP-DUE-RACE002'))
  ]);
  assert.deepEqual(results.map(x=>x.status),['COMMITTED','COMMITTED']);
  assert.equal((await one("SELECT available FROM m06_owned_stock WHERE sku='PIPE'")).available,0);
  assert.equal((await one("SELECT due_paisa FROM m06_customer_accounts WHERE customer_id='CUS-1'")).due_paisa,20000);
  assert.equal(await count('m06_customer_ledger'),2);
  assert.equal((await one("SELECT payable_paisa FROM m06_supplier_accounts WHERE supplier_id='SUP-1'")).payable_paisa,4000);
});

test('same operation ID across different synthetic tenants does not share stock, Cash or invoice identity',async()=>{
  await DB.prepare("INSERT INTO m06_cash_sessions VALUES ('SHOP-B','Open')").run();
  await DB.prepare("INSERT INTO m06_owned_stock VALUES ('SHOP-B','PIPE',1)").run();
  const op='OP-TENANT-0001';
  assert.equal((await posting().post(input(op))).status,'COMMITTED');
  assert.equal((await posting().post(input(op,{tenantId:'SHOP-B',actorId:'USER-B'}))).status,'COMMITTED');
  assert.deepEqual(await all('SELECT tenant_id,invoice_id FROM m06_invoices ORDER BY tenant_id'),[
    {tenant_id:'SHOP-A',invoice_id:'INV-'+op},{tenant_id:'SHOP-B',invoice_id:'INV-'+op}
  ]);
  assert.deepEqual(await all("SELECT tenant_id,available FROM m06_owned_stock WHERE sku='PIPE' ORDER BY tenant_id"),[
    {tenant_id:'SHOP-A',available:1},{tenant_id:'SHOP-B',available:0}
  ]);
  assert.equal(await count('m06_cash_book'),2);
});
