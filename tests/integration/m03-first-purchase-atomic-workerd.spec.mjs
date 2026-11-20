/**
 * M03 integration rehearsal only: no operational purchase/RPC/Cloudflare writes.
 * Actual Workerd D1 + existing M04 auth migrations + existing M08 quote engine.
 */
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {
  createPurchaseTestSchema,seedPurchaseTestShop,submitLocalFirstPurchase,
  inspectPurchaseTestShop
} from '../fixtures/m03-first-purchase-atomic-local.mjs';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m03-first-purchase-local-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m03-first-purchase-local-only');
const NOW=1800000000000;
let DB,seq=0;
const baseLines=()=>[
  {id:'A',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'},
  {id:'B',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'}
];
const basePayments=()=>[
  {id:'BANK-1',method:'Bank',amountPaisa:'25',bankAccountId:'BANK-A'},
  {id:'CASH-1',method:'Cash',amountPaisa:'42'}
];
async function shop(extra={}){
  const n=++seq;
  const shopId=extra.shopId||'SHOP-'+n;
  const context=await seedPurchaseTestShop(DB,{
    shopId,serial:n,now:NOW,
    userRole:extra.userRole||'CashierAdd',
    cashStatus:extra.cashStatus||'Open',
    supplierStatus:extra.supplierStatus||'Active',
    partyStatus:extra.partyStatus||'Active',
  });
  return context;
}
const intent=(context,more={})=>({
  shopId:context.shopId,token:context.token,operationId:'OP-FIRST',
  purchaseId:'PUR-000001',supplierId:'SUP-000001',
  cashSessionId:context.cashSessionId,roundingMode:'HALF_UP',
  lines:baseLines(),payments:basePayments(),...more
});
const post=(ctx,extra={})=>submitLocalFirstPurchase(DB,intent(ctx,extra),{now:NOW});
const snapshot=ctx=>inspectPurchaseTestShop(DB,ctx.shopId);

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('CashierAdd','Active','{"pos":{"add":true}}',''),
           ('CashierNoAdd','Active','{"pos":{"add":false}}','')`).run();
});
after(async()=>harness.close());
beforeEach(async()=>createPurchaseTestSchema(DB));

test('67 paisa first purchase atomically posts two immutable line allocations, lots, supplier ledger and money books',async()=>{
  const ctx=await shop();
  const r=await post(ctx);
  assert.deepEqual(r,{state:'inserted',purchaseId:'PUR-000001',
    grandPaisa:'67',paidPaisa:'67',duePaisa:'0'});
  const s=await snapshot(ctx);
  assert.deepEqual(s.purchase.map(x=>[x.grand_paisa,x.paid_paisa,x.due_paisa]),[[67,67,0]]);
  assert.deepEqual(s.lines.map(x=>[x.line_id,x.price_text,x.allocated_paisa]),
    [['A','0.335',34],['B','0.335',33]]);
  assert.deepEqual(s.stock.map(x=>[x.product_id,x.quantity]),[['A',11],['B',11]]);
  assert.deepEqual(s.lots.map(x=>[x.product_id,x.quantity,x.allocated_cost_paisa]),
    [['A',1,34],['B',1,33]]);
  assert.deepEqual(s.supplierLedger.map(x=>[x.entry_type,x.debit_paisa,x.credit_paisa]),
    [['Payment',0,25],['Payment',0,42],['Purchase',67,0]]);
  assert.deepEqual(s.moneyBook.map(x=>[x.method,x.amount_paisa]),[['Bank',25],['Cash',42]]);
  assert.equal(s.seal.length,1);
  assert.equal(s.seal[0].line_count,2);
  assert.equal(s.seal[0].payment_count,2);
});

test('same operation retry yields one purchase, one set of lots and no duplicate funds',async()=>{
  const ctx=await shop();
  assert.equal((await post(ctx)).state,'inserted');
  const before=await snapshot(ctx);
  const replay=await post(ctx);
  assert.equal(replay.state,'replay');
  assert.deepEqual(await snapshot(ctx),before);
});

test('changed intent under same operation is rejected without any replacement',async()=>{
  const ctx=await shop();
  await post(ctx);
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx,{lines:[
    {...baseLines()[0],unitPrice:'0.345'},baseLines()[1]
  ]}),/conflict|changed|denied/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('new operation cannot mint a second purchase under same Shop and source purchase ID',async()=>{
  const ctx=await shop();
  await post(ctx);
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx,{operationId:'OP-OTHER'}),/conflict|duplicate|unique|denied/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('closed Cash Session refuses all stock, Supplier and Bank/Cash writes',async()=>{
  const ctx=await shop({cashStatus:'Closed'});
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|session|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('non-privileged role missing literal pos.add refuses first purchase',async()=>{
  const ctx=await shop({userRole:'CashierNoAdd'});
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|permission|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('revoked current M04 session denies without using a cached actor',async()=>{
  const ctx=await shop();
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW,ctx.tokenHash).run();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|session|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('revoked current M04 role epoch denies before receipt and journal',async()=>{
  const ctx=await shop();
  await DB.prepare('UPDATE auth_roles SET auth_version=auth_version+1 WHERE role_name=?')
    .bind(ctx.userRole).run();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|session|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('inactive Supplier or inactive Party link blocks all Shop transactions',async()=>{
  for(const altered of [{supplierStatus:'Inactive'},{partyStatus:'Inactive'}]){
    const ctx=await shop(altered);
    const before=await snapshot(ctx);
    await assert.rejects(()=>post(ctx),/denied|supplier|party|refused/i);
    assert.deepEqual(await snapshot(ctx),before);
  }
});

test('tampered price or unit snapshot refuses purchase without revaluing the original stock',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx,{lines:[{...baseLines()[0],unitRevision:'REV-2'},baseLines()[1]]}),
    /denied|product|revision|refused/i);
  await assert.rejects(()=>post(ctx,{lines:[{...baseLines()[0],unitPrice:'0.345'},baseLines()[1]]}),
    /denied|product|price|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('late failed statement after receiving and money legs rolls back everything atomically',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{
    now:NOW,injectLateFailure:true
  }),/late|abort|refused|denied/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('same SUP-000001 and PUR-000001 in two Shops cannot cross-read/pay either account',async()=>{
  const a=await shop();
  const b=await shop();
  await post(a);
  await post(b,{lines:[{id:'A',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'}],
    payments:[]});
  const sa=await snapshot(a),sb=await snapshot(b);
  assert.equal(sa.purchase[0].grand_paisa,67);
  assert.equal(sb.purchase[0].grand_paisa,34);
  assert.equal(sb.purchase[0].due_paisa,34);
  assert.equal(sa.stock[0].quantity,11);
  assert.equal(sb.stock[0].quantity,11);
  assert.equal(sa.supplierLedger.reduce((x,y)=>x+y.debit_paisa-y.credit_paisa,0),0);
  assert.equal(sb.supplierLedger.reduce((x,y)=>x+y.debit_paisa-y.credit_paisa,0),34);
});

test('foreign-Shop Supplier source ID cannot be used without exact same-Shop Party link',async()=>{
  const ctx=await shop();
  await DB.prepare('DELETE FROM m03_fp_supplier WHERE shop_id=? AND supplier_id=?')
    .bind(ctx.shopId,'SUP-000001').run();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|supplier|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('buyer cannot change Shop ID while reusing same valid bearer',async()=>{
  const a=await shop(),b=await shop();
  const before=await snapshot(b);
  await assert.rejects(()=>post(a,{shopId:b.shopId}),/denied|shop|refused/i);
  assert.deepEqual(await snapshot(b),before);
});

test('Cash/Bank amount larger than header fails before money and lots',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx,{payments:[
    {id:'BANK-1',method:'Bank',amountPaisa:'80',bankAccountId:'BANK-A'}
  ]}),/payment|amount|denied|over/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('concurrent identical submissions produce one committed receipt and one replay',async()=>{
  const ctx=await shop();
  const results=await Promise.allSettled([post(ctx),post(ctx)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.deepEqual(results.map(x=>x.value.state).sort(),['inserted','replay']);
  assert.equal((await snapshot(ctx)).seal.length,1);
});

test('Worker and public RPC are entirely absent from this test-only schema',async()=>{
  const response=await worker.fetch('http://m03-local.invalid/api/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'purchase.create',args:[999]})
  });
  assert.equal(response.status,404);
  const own=await worker.fetch('http://m03-local.invalid/__m03_first_purchase__');
  assert.equal(own.status,404);
});

test('authorization revoked after preflight but BEFORE SQL batch blocks all posting',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{
    now:NOW,beforeBatch:async db=>{
      await db.prepare('UPDATE auth_roles SET auth_version=auth_version+1 WHERE role_name=?')
        .bind(ctx.userRole).run();
    }
  }),/denied|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('Cash Session closure after preflight but BEFORE SQL batch denies atomic posting',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{
    now:NOW,beforeBatch:async db=>{
      await db.prepare("UPDATE m03_fp_cash_session SET status='Closed' WHERE shop_id=?")
        .bind(ctx.shopId).run();
    }
  }),/denied|refused/i);
  const after=await snapshot(ctx);
  assert.deepEqual(after,before);
});

test('expired current auth token refuses first purchase with no side effects',async()=>{
  const ctx=await shop();
  const before=await snapshot(ctx);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{
    now:NOW+3600001
  }),/denied|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('inactive receiving Bank account denies one atomic Cash/Bank purchase',async()=>{
  const ctx=await shop();
  await DB.prepare("UPDATE m03_fp_bank SET status='Inactive' WHERE shop_id=?")
    .bind(ctx.shopId).run();
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('sealed receipt and journal rows cannot be directly edited or appended',async()=>{
  const ctx=await shop();
  await post(ctx);
  const before=await snapshot(ctx);
  const attacks=[
    "UPDATE m03_fp_purchase SET grand_paisa=68",
    "DELETE FROM m03_fp_purchase",
    "UPDATE m03_fp_line SET allocated_paisa=35",
    "DELETE FROM m03_fp_lot",
    "UPDATE m03_fp_payment SET applied_paisa=1",
    "DELETE FROM m03_fp_money_book",
    "UPDATE m03_fp_supplier_ledger SET debit_paisa=68",
    "DELETE FROM m03_fp_seal",
    "INSERT INTO m03_fp_line VALUES ('"+ctx.shopId+"','PUR-000001','EXTRA','A',1,'0.335','REV-1',1)"
  ];
  for(const sql of attacks){
    await assert.rejects(()=>DB.prepare(sql).run(),
      /IMMUTABLE|ALREADY_SEALED|constraint|FOREIGN KEY/i);
  }
  assert.deepEqual(await snapshot(ctx),before);
});

test('JSON object field order does not create a false changed-intent conflict',async()=>{
  const ctx=await shop();
  await post(ctx);
  const before=await snapshot(ctx);
  const inputs=intent(ctx);
  inputs.lines=inputs.lines.map(x=>({
    unitRevision:x.unitRevision,unitPrice:x.unitPrice,
    id:x.id,quantity:x.quantity
  }));
  inputs.payments=inputs.payments.map(x=>Object.fromEntries(Object.entries(x).reverse()));
  assert.equal((await submitLocalFirstPurchase(DB,inputs,{now:NOW})).state,'replay');
  assert.deepEqual(await snapshot(ctx),before);
});


test('frozen Purchase.gs purchase.add denies POS-only roles before any Supplier, stock or money mutation',async()=>{
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('M03PosSaleOnly','Active','{"pos":{"add":true},"purchase":{"add":false}}','')`).run();
  const ctx=await shop({userRole:'M03PosSaleOnly'});
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx),/denied|permission|refused/i,
    'POS sale permission must not authorize createPurchase');
  assert.deepEqual(await snapshot(ctx),before);
});

test('frozen Purchase.gs purchase.add authorizes an unpaid purchase without POS grant or Cash Book movement',async()=>{
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('M03PurchaseOnly','Active','{"pos":{"add":false},"purchase":{"add":true}}','')`).run();
  const ctx=await shop({userRole:'M03PurchaseOnly'});
  const result=await post(ctx,{
    lines:[baseLines()[0]],payments:[]
  });
  assert.deepEqual(result,{state:'inserted',purchaseId:'PUR-000001',
    grandPaisa:'34',paidPaisa:'0',duePaisa:'34'});
  const s=await snapshot(ctx);
  assert.deepEqual(s.stock.filter(x=>x.product_id==='A').map(x=>x.quantity),[11]);
  assert.deepEqual(s.supplierLedger.map(x=>[
    x.entry_type,x.debit_paisa,x.credit_paisa
  ]),[['Purchase',34,0]]);
  assert.deepEqual(s.moneyBook,[]);
  assert.equal(s.seal.length,1);
});

test('frozen source Cash Session check still rejects zero-paid purchase when Closed',async()=>{
  const ctx=await shop({userRole:'M03PurchaseOnly',cashStatus:'Closed'});
  const before=await snapshot(ctx);
  await assert.rejects(()=>post(ctx,{
    lines:[baseLines()[0]],payments:[]
  }),/denied|session|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});

test('revoking purchase.add between JS preflight and SQL batch blocks the complete purchase',async()=>{
  await DB.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES ('M03PurchaseRevoked','Active','{"purchase":{"add":true}}','')`).run();
  const ctx=await shop({userRole:'M03PurchaseRevoked'});
  const before=await snapshot(ctx);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx,{
    lines:[baseLines()[0]],payments:[]
  }),{
    now:NOW,
    beforeBatch:async db=>db.prepare(
      'UPDATE auth_roles SET permissions_json=? WHERE role_name=?'
    ).bind('{"purchase":{"add":false}}','M03PurchaseRevoked').run()
  }),/denied|refused/i);
  assert.deepEqual(await snapshot(ctx),before);
});
