/**
 * M05 source-correctness acceptance for M03 TEST-ONLY first-purchase SQL.
 * Intentionally RED until M03 owner fixes source purchase:add authorization.
 * No public worker, original source, schema or real D1 is touched here.
 */
import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
let DB,serial=0;
const source=readFileSync(new URL('../../legacy/source/Purchase.gs',import.meta.url),'utf8');

const makeShop=role=>seedPurchaseTestShop(DB,{
  shopId:'SHOP-M05-PERM-'+(++serial),serial,now:NOW,
  userRole:role,cashStatus:'Open',supplierStatus:'Active',partyStatus:'Active'
});
const intent=ctx=>({
  shopId:ctx.shopId,token:ctx.token,operationId:'OP-M05-PURCHASE',
  purchaseId:'PUR-M05-PERM',supplierId:'SUP-000001',
  cashSessionId:ctx.cashSessionId,roundingMode:'HALF_UP',
  lines:[{id:'A',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'}],
  payments:[]
});

before(async()=>{
  assert.match(source,
    /requirePermission_\s*\(\s*token\s*,\s*'purchase'\s*,\s*'add'\s*\)\s*;\s*requireActiveCashSession_\s*\(\s*\)/,
    'Frozen Purchase.gs requires purchase:add then active Cash Session');
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules) VALUES
    ('M05PosOnly','Active','{"pos":{"add":true},"purchase":{"add":false}}',''),
    ('M05PurchaseOnly','Active','{"pos":{"add":false},"purchase":{"add":true}}','')`
  ).run();
});
beforeEach(async()=>createPurchaseTestSchema(DB));
after(async()=>harness.close());

test('source purchase:add prevents POS-only cashier from creating a purchase in SQL',async()=>{
  const ctx=await makeShop('M05PosOnly');
  const before=await inspectPurchaseTestShop(DB,ctx.shopId);
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{now:NOW}),
    /Denied|permission|refused/i,
    'POS-only authorization cannot create a source purchase');
  assert.deepEqual(await inspectPurchaseTestShop(DB,ctx.shopId),before,
    'denied purchase must leave stock, lots, supplier and Cash/Bank unchanged');
});

test('source purchase:add accepts Purchase-only staff without unrelated POS sales grant',async()=>{
  const ctx=await makeShop('M05PurchaseOnly');
  const result=await submitLocalFirstPurchase(DB,intent(ctx),{now:NOW});
  assert.deepEqual(result,{
    state:'inserted',purchaseId:'PUR-M05-PERM',
    grandPaisa:'34',paidPaisa:'0',duePaisa:'34'
  });
  const rows=await inspectPurchaseTestShop(DB,ctx.shopId);
  assert.deepEqual(rows.stock.filter(x=>x.product_id==='A').map(x=>x.quantity),[11]);
  assert.deepEqual(rows.supplierLedger.map(x=>[x.entry_type,x.debit_paisa,x.credit_paisa]),
    [['Purchase',34,0]]);
  assert.deepEqual(rows.moneyBook,[],'zero-paid purchase creates no drawer movement');
  assert.equal(rows.seal.length,1,'one immutable operation receipt');
});
