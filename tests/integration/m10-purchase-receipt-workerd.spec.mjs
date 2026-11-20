/**
 * M10 Run 8 — independent read-only local Workerd D1 purchase conservation.
 * All fixture IDs are fabricated; this is NOT an operational purchase writer.
 */
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {
  createPurchaseTestSchema,seedPurchaseTestShop,submitLocalFirstPurchase
} from '../fixtures/m03-first-purchase-atomic-local.mjs';
import {auditM10LocalPurchaseReceiptD1} from '../../src/migration/m10-purchase-receipt-local-d1-audit.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-first-purchase-local-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-first-purchase-local-only');
const NOW=1800000000000;
let DB,serial=0;
const lines=()=>[
  {id:'A',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'},
  {id:'B',quantity:'1',unitPrice:'0.335',unitRevision:'REV-1'}
];
const payments=()=>[
  {id:'BANK-1',method:'Bank',amountPaisa:'25',bankAccountId:'BANK-A'},
  {id:'CASH-1',method:'Cash',amountPaisa:'42'}
];
async function shop(){
  const n=++serial;
  return seedPurchaseTestShop(DB,{shopId:'M10-SHOP-'+n,serial:n,now:NOW,
    userRole:'M10Cashier',cashStatus:'Open',supplierStatus:'Active',partyStatus:'Active'});
}
const intent=(ctx,changes={})=>({
  shopId:ctx.shopId,token:ctx.token,operationId:'M10-OP-001',
  purchaseId:'M10-PUR-001',supplierId:'SUP-000001',
  cashSessionId:ctx.cashSessionId,roundingMode:'HALF_UP',
  lines:lines(),payments:payments(),...changes
});
const expected=(ctx,change={})=>({
  shopId:ctx.shopId,purchaseId:'M10-PUR-001',operationId:'M10-OP-001',
  supplierId:'SUP-000001',partyId:'PARTY-1',
  grandPaisa:67,paidPaisa:67,duePaisa:0,
  initialStock:[{productId:'A',quantity:10},{productId:'B',quantity:10}],
  lines:[
    {lineId:'A',productId:'A',quantity:1,unitRevision:'REV-1',
      priceText:'0.335',allocatedPaisa:34},
    {lineId:'B',productId:'B',quantity:1,unitRevision:'REV-1',
      priceText:'0.335',allocatedPaisa:33}
  ],
  payments:[
    {legId:'BANK-1',method:'Bank',bankAccountId:'BANK-A',appliedPaisa:25},
    {legId:'CASH-1',method:'Cash',bankAccountId:null,appliedPaisa:42}
  ],
  ...change
});
const audit=(x,link=DB)=>auditM10LocalPurchaseReceiptD1({DB:link,expected:x});
const count=(r,code)=>r.issues.find(x=>x.code===code)?.count??0;
const one=sql=>DB.prepare(sql).first();
const post=(ctx,more={})=>submitLocalFirstPurchase(DB,intent(ctx,more),{now:NOW});
const mutate=async(table,sql,...args)=>{
  await DB.prepare('DROP TRIGGER IF EXISTS '+table+'_immutable_update').run();
  return DB.prepare(sql).bind(...args).run();
};

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.prepare(
    "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES('M10Cashier','Active','{\"pos\":{\"add\":true},\"purchase\":{\"add\":true}}','')"
  ).run();
});
beforeEach(async()=>{await createPurchaseTestSchema(DB);});
after(async()=>{await harness.close();});

test('frozen Purchase.gs source requires purchase.add while current M03 model is unapproved',async()=>{
  const source=readFileSync(new URL('../../legacy/source/Purchase.gs',import.meta.url),'utf8');
  assert.match(source,/requirePermission_\(token,\s*'purchase',\s*'add'\)/);
  const ctx=await shop(),r=await audit(expected(ctx));
  assert.equal(r.sourcePurchasePermissionVerified,false);
  assert.ok(r.releaseBlockers.includes('SOURCE_PURCHASE_AUTHORITY_NOT_VERIFIED'));
  assert.equal(r.productionReady,false);
});

test('cold real local D1 cannot fabricate a receipt from matching seeded products',async()=>{
  const ctx=await shop(),r=await audit(expected(ctx));
  assert.equal(r.syntheticReceiptConserved,false);
  assert.equal(count(r,'MISSING_PURCHASE'),1);
});

test('67-paisa two-line local Shop receipt independently conserves purchase, lots, Supplier and money',async()=>{
  const ctx=await shop(),x=expected(ctx),prior=structuredClone(x);
  assert.equal((await post(ctx)).state,'inserted');
  const r=await audit(x);
  assert.equal(r.syntheticReceiptConserved,true);
  assert.equal(r.purchaseConserved,true);
  assert.equal(r.stockLotConserved,true);
  assert.equal(r.supplierLedgerConserved,true);
  assert.equal(r.paymentBookConserved,true);
  assert.equal(r.expectedLines,2);
  assert.equal(r.observedLines,2);
  assert.deepEqual(r.issues,[]);
  assert.deepEqual(x,prior);
  for(const key of ['authorizesCutover','authorizesRealImport','authorizesRemoteD1Write',
    'realSourceReconciled','returnReversalIntegrated','productionReady'])
    assert.equal(r[key],false,key);
  assert.doesNotMatch(JSON.stringify(r),/M10-SHOP|SUP-000001|M10-PUR|M10-OP|PARTY-1|BANK-A|SELECT|INSERT|token/i);
});

test('single coherent batch uses nine fixed read-only Shop-scoped SELECTs',async()=>{
  const ctx=await shop();await post(ctx);
  const sql=[];let batches=0;
  const wrapped={prepare(q){sql.push(q);return DB.prepare(q);},
    async batch(stmts){batches++;return DB.batch(stmts);}};
  assert.equal((await audit(expected(ctx),wrapped)).syntheticReceiptConserved,true);
  assert.equal(batches,1);
  assert.equal(sql.length,9);
  assert.ok(sql.every(q=>/^SELECT\s/i.test(q.trim())));
  assert.ok(sql.every(q=>!/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ATTACH|DETACH|PRAGMA)\b/i.test(q)));
  assert.ok(sql.every(q=>/shop_id=\?/i.test(q)));
  assert.ok(sql.every(q=>/\bLIMIT\s+\?/i.test(q)));
});

test('same operation replay preserves exact stock, lot and financial evidence',async()=>{
  const ctx=await shop();await post(ctx);
  const first=await audit(expected(ctx));
  assert.equal((await post(ctx)).state,'replay');
  assert.deepEqual(await audit(expected(ctx)),first);
  assert.equal(first.syntheticReceiptConserved,true);
});

test('two Shop records reuse exact purchase and supplier IDs without cross-Shop readback',async()=>{
  const a=await shop(),b=await shop();
  await post(a);
  await post(b,{lines:[lines()[0]],payments:[]});
  const xb=expected(b,{grandPaisa:34,paidPaisa:0,duePaisa:34,
    lines:[expected(b).lines[0]],payments:[]});
  assert.equal((await audit(expected(a))).syntheticReceiptConserved,true);
  const result=await audit(xb);
  assert.equal(result.syntheticReceiptConserved,true);
  assert.equal(result.observedLines,1);
});

test('unchanged total but swapped original line allocations still fails by each line ID',async()=>{
  const ctx=await shop();await post(ctx);
  await mutate('m03_fp_line',
    "UPDATE m03_fp_line SET allocated_paisa=CASE WHEN line_id='A' THEN 33 ELSE 34 END WHERE shop_id=?",
    ctx.shopId);
  const r=await audit(expected(ctx));
  assert.equal(count(r,'LINE_MISMATCH'),2);
  assert.equal(r.syntheticReceiptConserved,false);
});

test('changed lot product lineage is rejected even when grand total remains 67',async()=>{
  const ctx=await shop();await post(ctx);
  await mutate('m03_fp_lot',"UPDATE m03_fp_lot SET product_id='B' WHERE shop_id=? AND line_id='A'",ctx.shopId);
  const r=await audit(expected(ctx));
  assert.equal(count(r,'LOT_MISMATCH'),1);
  assert.equal(r.stockLotConserved,false);
});

test('product stock delta mismatch blocks parity when ledger and receipt remain untouched',async()=>{
  const ctx=await shop();await post(ctx);
  await DB.prepare("UPDATE m03_fp_stock SET quantity=quantity+1 WHERE shop_id=? AND product_id='A'")
    .bind(ctx.shopId).run();
  const r=await audit(expected(ctx));
  assert.equal(count(r,'STOCK_DELTA_MISMATCH'),1);
  assert.equal(r.syntheticReceiptConserved,false);
});

test('Bank book drift is detected independently from correct split-payment rows',async()=>{
  const ctx=await shop();await post(ctx);
  await mutate('m03_fp_money_book',
    "UPDATE m03_fp_money_book SET amount_paisa=24 WHERE shop_id=? AND method='Bank'",ctx.shopId);
  const r=await audit(expected(ctx));
  assert.equal(count(r,'MONEY_BOOK_MISMATCH'),1);
  assert.equal(r.paymentBookConserved,false);
});

test('Supplier Ledger debit drift cannot net against unchanged Cash/Bank',async()=>{
  const ctx=await shop();await post(ctx);
  await mutate('m03_fp_supplier_ledger',
    "UPDATE m03_fp_supplier_ledger SET debit_paisa=66 WHERE shop_id=? AND entry_type='Purchase'",
    ctx.shopId);
  const r=await audit(expected(ctx));
  assert.ok(count(r,'SUPPLIER_LEDGER_MISMATCH')>0);
  assert.equal(r.supplierLedgerConserved,false);
});

test('original Supplier or operation ID mismatch is caught independently from money',async()=>{
  const ctx=await shop();await post(ctx);
  assert.equal(count(await audit(expected(ctx,{supplierId:'SUP-WRONG'})),'PURCHASE_IDENTITY_MISMATCH'),1);
  assert.equal(count(await audit(expected(ctx,{operationId:'OP-WRONG'})),'PURCHASE_IDENTITY_MISMATCH'),1);
});

test('missing seal is not treated as posted even when all money and stock rows remain',async()=>{
  const ctx=await shop();await post(ctx);
  await DB.prepare('DROP TRIGGER IF EXISTS m03_fp_seal_immutable_delete').run();
  await DB.prepare('DELETE FROM m03_fp_seal WHERE shop_id=?').bind(ctx.shopId).run();
  const r=await audit(expected(ctx));
  assert.equal(count(r,'SEAL_MISSING'),1);
  assert.equal(r.syntheticReceiptConserved,false);
});

test('late injected statement failure rolls back header, lots, Supplier, cash and bank',async()=>{
  const ctx=await shop();
  await assert.rejects(()=>submitLocalFirstPurchase(DB,intent(ctx),{now:NOW,injectLateFailure:true}),
    /late|abort|denied|refused/i);
  assert.equal(count(await audit(expected(ctx)),'MISSING_PURCHASE'),1);
  assert.equal((await one('SELECT COUNT(*) n FROM m03_fp_lot')).n,0);
  assert.equal((await one('SELECT COUNT(*) n FROM m03_fp_money_book')).n,0);
});

test('invalid expected source packet fails before reading D1 and never echoes raw input',async()=>{
  const ctx=await shop(),valid=expected(ctx);
  const spy={prepare(){throw Error('SENSITIVE_D1_CALLED')},batch(){throw Error('SENSITIVE_D1_CALLED')}};
  for(const x of [
    {...valid,grandPaisa:67.1},
    {...valid,lines:[valid.lines[0],valid.lines[0]]},
    {...valid,payments:[{...valid.payments[0],appliedPaisa:-1}]},
    {...valid,initialStock:[]},
    {...valid,shopId:' '},
    {...valid,leakedCustomerInfo:'SECRET'}
  ])await assert.rejects(()=>audit(x,spy),{message:'M10 local purchase receipt audit unavailable'});
});

test('invalid D1 success envelope or SQL driver error is always redacted',async()=>{
  const ctx=await shop();await post(ctx);
  const bad={prepare(q){return DB.prepare(q);},
    async batch(stmts){const v=await DB.batch(stmts);return v.map((x,i)=>i===1?{...x,success:1}:x);}};
  await assert.rejects(()=>audit(expected(ctx),bad),
    {message:'M10 local purchase receipt audit unavailable'});
  await assert.rejects(()=>audit(expected(ctx),{
    prepare(){throw Error('PRIVATE BUYER BANK-A SQL')},batch(){throw Error('PRIVATE')}
  }),{message:'M10 local purchase receipt audit unavailable'});
});

test('test-only Workerd does not expose purchase readback or public RPC routes',async()=>{
  const ctx=await shop();await post(ctx);
  for(const route of ['/api/rpc','/api/purchase','/__m10__/receipt']){
    const res=await worker.fetch('http://synthetic.local'+route,{method:'POST',body:'{}'});
    assert.equal(res.status,404);
  }
  assert.equal((await audit(expected(ctx))).productionReady,false);
});
