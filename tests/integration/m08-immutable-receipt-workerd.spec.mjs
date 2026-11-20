/**
 * M08 Run 5 — isolated synthetic D1 receipt and return allocation proof.
 * Test-only, no operational source D1 migrations, worker/RPC, auth or funds.
 */
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {
  initSyntheticReceiptDb,submitSyntheticReceipt,recordSyntheticReturn,
  receiptSnapshot,quoteSyntheticInvoice
} from '../fixtures/m08-immutable-receipt-local.mjs';

const harness=createTestHarness({
  workers:[{configPath:'./wrangler.m08-exact-money-test.jsonc'}]
});
const worker=harness.getWorker('shererp-m08-exact-money-local-test');
let DB;
const lines=[
  {id:'A',quantity:'1',unitPrice:'0.335'},
  {id:'B',quantity:'1',unitPrice:'0.335'}
];
const payments=[
  {id:'BANK-1',method:'Bank',amount:'0.25',accountId:'BANK-A'},
  {id:'CASH-1',method:'Cash',amount:'0.50'}
];
const defaultIntent=(patch={})=>({
  shopId:'SHOP-A',invoiceId:'INV-1',operationId:'CREATE-1',
  lines,discount:'0',roundingMode:'HALF_UP',payments,...patch
});
const booked=async(patch={})=>submitSyntheticReceipt(DB,defaultIntent(patch));
const returned=async(patch={})=>recordSyntheticReturn(DB,{
  shopId:'SHOP-A',invoiceId:'INV-1',returnId:'RETURN-1',
  lineId:'A',returnedPaisa:'34',cashRefundPaisa:'34',...patch
});

before(async()=>{
  await harness.listen();
  ({DB}=await worker.getEnv());
});
after(async()=>harness.close());
beforeEach(async()=>initSyntheticReceiptDb(DB));

test('real local D1 stores immutable 67-paisa invoice, A=34 B=33, Bank 25 Cash 42 change 8',async()=>{
  const out=await booked();
  assert.equal(out.state,'inserted');
  assert.equal(out.grandPaisa,'67');
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.deepEqual(s.lines.map(x=>[x.line_id,x.net_paisa,x.raw_unit_price]),
    [['A',34,'0.335'],['B',33,'0.335']]);
  assert.deepEqual(s.payments.map(x=>[x.leg_id,x.method,x.applied_paisa,x.change_paisa]),
    [['BANK-1','Bank',25,0],['CASH-1','Cash',42,8]]);
  assert.equal(s.header.grand_paisa,67);
  assert.equal(s.header.due_paisa,0);
  assert.equal(s.seal.line_count,2);
  assert.equal(s.seal.payment_count,2);
});

test('lost response replay returns same immutable receipt; changed operation intent fails',async()=>{
  const first=await booked();
  const baseline=await receiptSnapshot(DB,'SHOP-A','INV-1');
  const replay=await booked();
  assert.equal(first.state,'inserted');
  assert.equal(replay.state,'replay');
  assert.equal(replay.grandPaisa,'67');
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),baseline);
  await assert.rejects(()=>booked({
    lines:[...lines.slice(0,1),{id:'B',quantity:'1',unitPrice:'0.345'}]
  }),/changed intent/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),baseline);
});

test('changed operation id cannot mint second receipt for the same Shop invoice',async()=>{
  await booked();
  const before=await receiptSnapshot(DB,'SHOP-A','INV-1');
  await assert.rejects(()=>booked({operationId:'CREATE-2'}),/already issued|UNIQUE|constraint/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),before);
});

test('same invoice ID and operation ID are isolated under distinct Shops in real local D1',async()=>{
  await booked();
  await booked({shopId:'SHOP-B',lines:[{id:'A',quantity:'1',unitPrice:'1.005'}],
    payments:[],roundingMode:'HALF_UP'});
  const a=await receiptSnapshot(DB,'SHOP-A','INV-1');
  const b=await receiptSnapshot(DB,'SHOP-B','INV-1');
  assert.equal(a.header.grand_paisa,67);
  assert.equal(b.header.grand_paisa,101);
  assert.equal(b.header.due_paisa,101);
  assert.equal(a.lines.length,2);
  assert.equal(b.lines.length,1);
});

test('late nonconserving line or forged applied money rolls back ALL synthetic receipt rows',async()=>{
  const before=await receiptSnapshot(DB,'SHOP-A','INV-1');
  await assert.rejects(()=>booked({invoiceId:'INV-BAD',operationId:'CREATE-BAD',
    testOnlyInjectedLineDeltaPaisa:1}),/CONSERVATION|constraint|rejected/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-BAD'),before);
  await assert.rejects(()=>booked({invoiceId:'INV-BAD2',operationId:'CREATE-BAD2',
    testOnlyInjectedPaymentDeltaPaisa:1}),/CONSERVATION|constraint|rejected/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-BAD2'),before);
});

test('return references sealed original allocation rather than recalculating price after a catalog change',async()=>{
  await booked({payments:[]});
  const q=quoteSyntheticInvoice({
    lines:[{id:'A',quantity:'1',unitPrice:'0.345'},{id:'B',quantity:'1',unitPrice:'0.335'}],
    discount:'0',roundingMode:'HALF_UP'
  });
  assert.equal(q.lines.find(x=>x.id==='A').netPaisa,'35');
  const r=await returned({cashRefundPaisa:'0'});
  assert.equal(r.state,'inserted');
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(s.lines.find(x=>x.line_id==='A').net_paisa,34);
  assert.deepEqual(s.returns.map(x=>[x.line_id,x.returned_paisa,x.cash_refund_paisa]),
    [['A',34,0]]);
});

test('unpaid invoice cannot cash refund and fails without changing the source due',async()=>{
  await booked({payments:[]});
  const before=await receiptSnapshot(DB,'SHOP-A','INV-1');
  await assert.rejects(()=>returned(),/REFUND_BACKING|constraint/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),before);
  const allowed=await returned({cashRefundPaisa:'0'});
  assert.equal(allowed.state,'inserted');
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(s.header.due_paisa,67);
  assert.equal(s.returns[0].noncash_paisa,34);
  assert.equal(s.returns[0].cash_refund_paisa,0);
});

test('verified net collections back cash refund, and duplicate return is idempotent',async()=>{
  await booked();
  const first=await returned();
  assert.equal(first.state,'inserted');
  const baseline=await receiptSnapshot(DB,'SHOP-A','INV-1');
  const replay=await returned();
  assert.equal(replay.state,'replay');
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),baseline);
  await assert.rejects(()=>returned({cashRefundPaisa:'33'}),/changed intent/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),baseline);
});

test('second independent return cannot exceed original line allocation or total collected backing',async()=>{
  await booked();
  await returned();
  const before=await receiptSnapshot(DB,'SHOP-A','INV-1');
  await assert.rejects(()=>returned({returnId:'RETURN-2',returnedPaisa:'1',cashRefundPaisa:'1'}),
    /OVER_RETURN|constraint/i);
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),before);
  await returned({returnId:'RETURN-B',lineId:'B',returnedPaisa:'33',cashRefundPaisa:'33'});
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(s.returns.reduce((sum,x)=>sum+x.cash_refund_paisa,0),67);
});

test('foreign Shop/line return cannot affect another Shop receipt even when invoice ID matches',async()=>{
  await booked();
  await booked({shopId:'SHOP-B',payments:[],lines:[{id:'C',quantity:'1',unitPrice:'1'}]});
  await assert.rejects(()=>returned({shopId:'SHOP-B',lineId:'A',cashRefundPaisa:'0'}),
    /FOREIGN KEY|constraint|REFERENCED_LINE/i);
  const b=await receiptSnapshot(DB,'SHOP-B','INV-1');
  assert.equal(b.returns.length,0);
  assert.equal(b.header.grand_paisa,100);
});

test('source-authenticated runtime integration remains intentionally unavailable',async()=>{
  await booked();
  const unauthorized=await worker.fetch('https://m08.internal/api/rpc',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({method:'purchase.create',amount:'67'})
  });
  assert.equal(unauthorized.status,404);
  const snapshot=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(snapshot.header.grand_paisa,67);
});

test('sealed receipt and returned amount are immutable even through direct local D1 SQL',async()=>{
  await booked();
  await returned();
  const baseline=await receiptSnapshot(DB,'SHOP-A','INV-1');
  const mutations=[
    "UPDATE m08_r5_headers SET grand_paisa=68 WHERE shop_id='SHOP-A'",
    "DELETE FROM m08_r5_headers WHERE shop_id='SHOP-A'",
    "UPDATE m08_r5_lines SET net_paisa=35 WHERE shop_id='SHOP-A' AND line_id='A'",
    "DELETE FROM m08_r5_lines WHERE shop_id='SHOP-A' AND line_id='A'",
    "UPDATE m08_r5_payments SET applied_paisa=26 WHERE shop_id='SHOP-A' AND leg_id='BANK-1'",
    "DELETE FROM m08_r5_payments WHERE shop_id='SHOP-A' AND leg_id='BANK-1'",
    "UPDATE m08_r5_returns SET cash_refund_paisa=33 WHERE shop_id='SHOP-A'",
    "DELETE FROM m08_r5_returns WHERE shop_id='SHOP-A'",
    "DELETE FROM m08_r5_seals WHERE shop_id='SHOP-A'",
    "INSERT INTO m08_r5_lines VALUES('SHOP-A','INV-1','NEW','1','1',1)",
    "INSERT INTO m08_r5_payments VALUES('SHOP-A','INV-1','EXTRA','Cash',1,0)"
  ];
  for(const sql of mutations){
    await assert.rejects(()=>DB.prepare(sql).run(),/M08_R5_IMMUTABLE|M08_R5_SEALED|constraint/i);
  }
  assert.deepEqual(await receiptSnapshot(DB,'SHOP-A','INV-1'),baseline);
});

test('two identical concurrent operations commit at most one sealed receipt',async()=>{
  const results=await Promise.allSettled([booked(),booked()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  assert.deepEqual(results.map(x=>x.value.state).sort(),['inserted','replay']);
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(s.lines.length,2);
  assert.equal(s.seal.line_count,2);
  assert.equal(s.payments.length,2);
});

test('concurrent Cash returns cannot spend the same verified money backing twice',async()=>{
  await booked({payments:[
    {id:'BANK-1',method:'Bank',amount:'0.25',accountId:'BANK-A'}
  ]});
  const attempts=[
    returned({returnId:'RETURN-A',lineId:'A',returnedPaisa:'20',cashRefundPaisa:'20'}),
    returned({returnId:'RETURN-B',lineId:'B',returnedPaisa:'20',cashRefundPaisa:'20'})
  ];
  const outcomes=await Promise.allSettled(attempts);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const s=await receiptSnapshot(DB,'SHOP-A','INV-1');
  assert.equal(s.returns.length,1);
  assert.equal(s.returns[0].cash_refund_paisa,20);
  assert.equal(s.header.due_paisa,42);
});
