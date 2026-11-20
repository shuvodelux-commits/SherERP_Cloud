/**
 * M08 Run 3: real local Workerd arithmetic + synthetic D1 integer-conservation
 * boundary only. No source DB, deployed Worker, SQL financial posting or RPC.
 */
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m08-exact-money-test.jsonc'}]});
const worker=harness.getWorker('shererp-m08-exact-money-local-test');
let DB;
const request=async(kind,value)=>worker.fetch('https://m08.internal/__m08_local_probe__',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({kind,value})
});
const rows=async(sql)=>(await DB.prepare(sql).all()).results.map(row=>({...row}));
const SCHEMA=[
  `CREATE TABLE m08_quote_headers (
    shop_id TEXT NOT NULL,quote_id TEXT NOT NULL,grand_paisa INTEGER NOT NULL
      CHECK(typeof(grand_paisa)='integer' AND grand_paisa BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY(shop_id,quote_id)
  )`,
  `CREATE TABLE m08_quote_lines (
    shop_id TEXT NOT NULL,quote_id TEXT NOT NULL,line_id TEXT NOT NULL,
    amount_paisa INTEGER NOT NULL
      CHECK(typeof(amount_paisa)='integer' AND amount_paisa BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY(shop_id,quote_id,line_id)
  )`,
  `CREATE TABLE m08_quote_receipts (
    shop_id TEXT NOT NULL,quote_id TEXT NOT NULL,line_count INTEGER NOT NULL,
    PRIMARY KEY(shop_id,quote_id)
  )`,
  `CREATE TRIGGER m08_quote_receipt_exact BEFORE INSERT ON m08_quote_receipts BEGIN
    SELECT CASE WHEN
      (SELECT COUNT(*) FROM m08_quote_lines
        WHERE shop_id=NEW.shop_id AND quote_id=NEW.quote_id)<>NEW.line_count
      OR (SELECT COALESCE(SUM(amount_paisa),0) FROM m08_quote_lines
        WHERE shop_id=NEW.shop_id AND quote_id=NEW.quote_id)
          <>(SELECT grand_paisa FROM m08_quote_headers
             WHERE shop_id=NEW.shop_id AND quote_id=NEW.quote_id)
      THEN RAISE(ABORT,'M08_NONCONSERVING_QUOTE') END;
  END`
];
async function persist(shop,id,quote,{corrupt=false}={}){
  const statements=[
    DB.prepare('INSERT INTO m08_quote_headers VALUES (?,?,?)')
      .bind(shop,id,Number(quote.grandPaisa)),
    ...quote.lines.map((line,i)=>
      DB.prepare('INSERT INTO m08_quote_lines VALUES (?,?,?,?)')
        .bind(shop,id,line.id,Number(line.netPaisa)+(corrupt&&i===0?1:0))),
    DB.prepare('INSERT INTO m08_quote_receipts VALUES (?,?,?)')
      .bind(shop,id,quote.lines.length)
  ];
  return DB.batch(statements);
}
async function snapshot(){
  return {
    headers:await rows('SELECT * FROM m08_quote_headers ORDER BY shop_id,quote_id'),
    lines:await rows('SELECT * FROM m08_quote_lines ORDER BY shop_id,quote_id,line_id'),
    receipts:await rows('SELECT * FROM m08_quote_receipts ORDER BY shop_id,quote_id')
  };
}
before(async()=>{await harness.listen();({DB}=await worker.getEnv());});
after(async()=>harness.close());
beforeEach(async()=>{
  for(const kind of ['m08_quote_receipts','m08_quote_lines','m08_quote_headers'])
    await DB.prepare('DROP TABLE IF EXISTS '+kind).run();
  for(const s of SCHEMA)await DB.prepare(s).run();
});

test('actual Workerd executes lossless fractional price; synthetic D1 retains integer paisa',async()=>{
  const r=await request('line',{quantity:'0.5',unitPrice:'10.005',roundingMode:'HALF_UP'});
  assert.equal(r.status,200);
  const {result}=await r.json();
  assert.deepEqual(result.exactAmount,{numerator:'2001',denominator:'400'});
  assert.equal(result.amountPaisa,'500');
  const q={grandPaisa:result.amountPaisa,lines:[{id:'PIPE',netPaisa:result.amountPaisa}]};
  await persist('SHOP-A','FRACTIONAL-1',q);
  assert.deepEqual((await snapshot()).headers,[{
    shop_id:'SHOP-A',quote_id:'FRACTIONAL-1',grand_paisa:500
  }]);
});

test('Workerd grand and line minor units conserve in synthetic D1, including duplicate-key guard',async()=>{
  const payload={lines:[
    {id:'C',quantity:'1',unitPrice:'0.335'},
    {id:'A',quantity:'1',unitPrice:'0.335'},
    {id:'B',quantity:'1',unitPrice:'0.335'}
  ],discount:'0',roundingMode:'HALF_UP'};
  const r=await request('invoice',payload);
  assert.equal(r.status,200);
  const {result}=await r.json();
  assert.equal(result.grandPaisa,'101');
  await persist('SHOP-A','INV-1',result);
  const before=await snapshot();
  assert.deepEqual(before.lines.map(x=>x.amount_paisa),[34,34,33]);
  assert.equal(before.headers[0].grand_paisa,101);
  await assert.rejects(()=>persist('SHOP-A','INV-1',result));
  assert.deepEqual(await snapshot(),before);
});

test('synthetic D1 late receipt mismatch rolls back header and ALL lines in one batch',async()=>{
  const r=await request('invoice',{lines:[
    {id:'A',quantity:'1',unitPrice:'1.005'},
    {id:'B',quantity:'1',unitPrice:'2.005'}
  ],discount:'0.50',roundingMode:'HALF_UP'});
  const {result}=await r.json();
  const baseline=await snapshot();
  await assert.rejects(()=>persist('SHOP-A','BAD-QUOTE',result,{corrupt:true}));
  assert.deepEqual(await snapshot(),baseline);
  await persist('SHOP-A','GOOD-QUOTE',result);
  assert.equal((await snapshot()).receipts.length,1);
});

test('two Shops share a synthetic quote ID without sharing totals or wrong-Shop cash',async()=>{
  const a=await (await request('invoice',{lines:[{id:'L',quantity:'1',unitPrice:'10.005'}],
    discount:'0',roundingMode:'HALF_UP'})).json();
  const b=await (await request('invoice',{lines:[{id:'L',quantity:'1',unitPrice:'20.005'}],
    discount:'0',roundingMode:'HALF_UP'})).json();
  await persist('SHOP-A','SHARED-ID',a.result);
  await persist('SHOP-B','SHARED-ID',b.result);
  const s=await snapshot();
  assert.deepEqual(s.headers.map(x=>[x.shop_id,x.grand_paisa]),[['SHOP-A',1001],['SHOP-B',2001]]);
  assert.equal(s.receipts.length,2);
});

test('Workerd final supplier return carries only the final 1-paisa residual',async()=>{
  const base={originalQuantity:'3',allocatedLinePaisa:'100',roundingMode:'HALF_UP'};
  const prior=await request('supplier-return',{...base,alreadyReturnedQuantity:'1',
    returnedQuantity:'1',alreadyCreditedPaisa:'33'});
  const final=await request('supplier-return',{...base,alreadyReturnedQuantity:'2',
    returnedQuantity:'1',alreadyCreditedPaisa:'66'});
  assert.equal((await prior.json()).result.returnPaisa,'33');
  assert.equal((await final.json()).result.returnPaisa,'34');
});

test('Workerd caps verified cash refund; public RPC remains absent in isolated test Worker',async()=>{
  const denied=await request('cash-refund',{
    returnPaisa:'7500',netCashCollectedPaisa:'0',
    priorCashRefundPaisa:'0',requestedCashRefundPaisa:'7500'
  });
  assert.equal(denied.status,422);
  const allowed=await request('cash-refund',{
    returnPaisa:'7500',netCashCollectedPaisa:'0',
    priorCashRefundPaisa:'0',requestedCashRefundPaisa:'0'
  });
  assert.deepEqual((await allowed.json()).result,{
    cashRefundPaisa:'0',storeCreditPaisa:'7500',remainingCashBackingPaisa:'0'
  });
  const forbidden=await worker.fetch('https://m08.internal/api/rpc',{method:'POST'});
  assert.equal(forbidden.status,404);
  const bad=await request('unknown',{});
  assert.equal(bad.status,422);
});

test('Workerd signed tie-mode proof must be explicit; no default floating-point rounding',async()=>{
  const probe=async(roundingMode)=>worker.fetch('https://m08.internal/__m08_local_probe__',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'signed',value:'-0.005',roundingMode})
  });
  const up=await probe('HALF_UP');
  const even=await probe('HALF_EVEN');
  const absent=await probe(undefined);
  assert.equal(up.status,200);
  assert.equal((await up.json()).result,'-1');
  assert.equal(even.status,200);
  assert.equal((await even.json()).result,'0');
  assert.equal(absent.status,422);
});
