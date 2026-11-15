import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSaleLineTotalOracle} from './fixtures/m06-sale-update-line-totals-oracle.mjs';
import {planSaleUpdateLineTotals} from '../src/modules/sale-update-line-totals.js';

const original=createNativeSaleLineTotalOracle();
const invoiceId='INV-100';
const historical=(productId='PIPE',qty=2,price=12.5,total='24.995')=>({
  'Invoice ID':invoiceId,'Product ID':productId,
  'Quantity':qty,'Unit Price':price,'Line Total':total
});
const candidate=(productId='PIPE',qty=2,unitPrice=12.5)=>({
  productId,name:'Shop product',qty,unitPrice
});
function parity(oldRows,newItems,id=invoiceId){
  const beforeOld=structuredClone(oldRows),beforeNew=structuredClone(newItems);
  const expected=original.sourcePlan(id,oldRows,newItems);
  const actual=planSaleUpdateLineTotals(id,oldRows,newItems);
  assert.deepEqual(actual,expected,'Target edit line totals must equal native GAS oracle');
  assert.deepEqual(oldRows,beforeOld,'Historical source rows must not change');
  assert.deepEqual(newItems,beforeNew,'POS candidate rows must not change');
  return actual;
}

test('unchanged auto-priced source line keeps exact saved fractional amount, not qty×visible price',()=>{
  const result=parity([historical('PIPE',2,12.5,'24.995')],[candidate()]);
  assert.equal(result.lines[0].lineTotal,24.995);
  assert.equal(result.subtotal,25);
});

test('source 1e-9 tolerance preserves original line total when both inputs are near-identical',()=>{
  const result=parity(
    [historical('PIPE','2','12.5',24.995)],
    [candidate('PIPE',2+1e-10,12.5+1e-10)]
  );
  assert.equal(result.lines[0].lineTotal,24.995);
});

test('changed quantity or visible unit price recomputes line using original money rounding',()=>{
  const old=[historical()];
  const changedQty=parity(old,[candidate('PIPE',3,12.5)]);
  assert.equal(changedQty.lines[0].lineTotal,37.5);
  const changedPrice=parity(old,[candidate('PIPE',2,12.6)]);
  assert.equal(changedPrice.lines[0].lineTotal,25.2);
  const beyondTolerance=parity(old,[candidate('PIPE',2+1e-8,12.5)]);
  assert.notEqual(beyondTolerance.lines[0].lineTotal,24.995);
});

test('historical blank, null, invalid and negative totals safely use rounded multiplication',()=>{
  for(const total of ['',null,undefined,'invalid',-1,Infinity]){
    const row=historical();
    row['Line Total']=total; // Explicit undefined must not activate the fixture default.
    const result=parity([row],[candidate()]);
    assert.equal(result.lines[0].lineTotal,25);
  }
});

test('first matching historical Product ID wins while another invoice never supplies its price',()=>{
  const old=[
    {...historical('PIPE',2,12.5,500),'Invoice ID':'INV-OTHER'},
    historical('PIPE',2,12.5,24.995),
    historical('PIPE',2,12.5,99)
  ];
  const result=parity(old,[candidate()]);
  assert.equal(result.lines[0].lineTotal,24.995);
});

test('multiple unchanged fractional lines accumulate source rounded subtotal after each line',()=>{
  const old=[
    historical('P1',1,0.01,0.015),
    historical('P2',1,0.01,0.015),
    historical('P3',1,0.01,0.015)
  ];
  const updated=[candidate('P1',1,0.01),candidate('P2',1,0.01),candidate('P3',1,0.01)];
  const result=parity(old,updated);
  assert.deepEqual(result.lines.map(row=>row.lineTotal),[0.015,0.015,0.015]);
  assert.equal(result.subtotal,0.06);
  assert.notEqual(result.subtotal,original.sourceRoundMoney(0.015*3));
});

test('new product line has no old stored amount and zero-price lines remain allowed',()=>{
  const result=parity([historical()],[
    candidate('NEW',2,12.505),
    candidate('ZERO',1,0)
  ]);
  assert.equal(result.lines[0].lineTotal,original.sourceRoundMoney(2*12.505));
  assert.equal(result.lines[1].lineTotal,0);
  assert.equal(result.subtotal,original.sourceRoundMoney(result.lines[0].lineTotal));
});

test('duplicates, missing IDs, invalid qty and price are rejected before any write',()=>{
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],[
    candidate('PIPE',1,5),candidate('PIPE',2,5)
  ]),/duplicate|once/i);
  assert.throws(()=>planSaleUpdateLineTotals('',[],[candidate()]),/invoice/i);
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],[
    candidate('',2,5)
  ]),/product|id/i);
  for(const qty of [0,-1,NaN,Infinity,'garbage']){
    assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],[candidate('PIPE',qty,5)]),/quantity|qty/i);
  }
  for(const price of [-1,NaN,Infinity,'garbage']){
    assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],[candidate('PIPE',1,price)]),/price/i);
  }
});

test('nonplain snapshots, accessor rows and numeric line overflow fail closed',()=>{
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,null,[candidate()]),/trusted|old|snapshot/i);
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],null),/trusted|items|snapshot/i);
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[new Date()],[]),/trusted|plain|row/i);
  const row=historical();
  Object.defineProperty(row,'Quantity',{get:()=>2});
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[row],[candidate()]),/trusted|accessor|row/i);
  assert.throws(()=>planSaleUpdateLineTotals(invoiceId,[],[
    candidate('HUGE',Number.MAX_VALUE,Number.MAX_VALUE)
  ]),/overflow|finite|amount|money/i);
});
