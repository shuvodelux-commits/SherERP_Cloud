import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceEstimatePosInvoiceProfit} from './fixtures/m06-pos-profit-source-oracle.mjs';
import {estimateStandardPosInvoiceProfit} from '../src/modules/pos-profit-standard.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const product=(id,more={})=>({
  'Product ID':id,'Product Name':id,'Product Type':'Standard',
  'Current Stock':4,'Purchase Price':9,'Selling Price':20,...more
});
const lot=(id,productId,date,qty,cost,sell)=>({
  'Lot ID':id,'Product ID':productId,'Purchase Date':date,
  'Remaining Quantity':qty,'Purchase Price':cost,'Sell Price':sell,
  'Created At':'2026-11-15T11:00:00Z','Status':'Active',
  '_rowIndex':Number(id.split('-').at(-1))+2
});
const stock=()=>({
  productsById:{
    PIPE:product('PIPE'),
    WIRE:product('WIRE',{'Current Stock':1,'Purchase Price':6,'Selling Price':15})
  },
  stockLots:[
    lot('LOT-003','PIPE','2026-11-13',2,11,19),
    lot('LOT-001','PIPE','2026-11-12',2,10,17),
    lot('LOT-002','WIRE','2026-11-11',1,6,14)
  ]
});
const item=(more={})=>({productId:'PIPE',qty:4,priceMode:'auto',unitPrice:20,...more});
const cart=(items=[item()],discount=0)=>({items,discount});
function parity(payload,context=stock()){
  const before=clone({payload,context});
  const expected=sourceEstimatePosInvoiceProfit(clone(payload),
    clone(context.productsById),clone(context.stockLots));
  const actual=estimateStandardPosInvoiceProfit(payload,context);
  assert.deepEqual(clone(actual),expected);
  assert.deepEqual({payload,context},before,'profit preview must not mutate cart, lot or products');
  assert.equal(actual.estimated,true);
  return actual;
}
function thrown(call){
  try{return {ok:true,value:clone(call())};}
  catch(error){return {ok:false,message:error.message};}
}
function parityError(payload,context=stock()){
  const expected=thrown(()=>sourceEstimatePosInvoiceProfit(clone(payload),
    clone(context.productsById),clone(context.stockLots)));
  const actual=thrown(()=>estimateStandardPosInvoiceProfit(payload,context));
  assert.deepEqual(actual,expected);
  assert.equal(actual.ok,false);
}

test('FIFO profit uses original Purchase Date and lot costs across suppliers',()=>{
  const result=parity(cart());
  assert.deepEqual(result,{
    subtotal:72,discount:0,grandTotal:72,cogs:42,
    profit:30,marginPercent:41.67,costComplete:true,estimated:true
  });
});

test('multiple standard products have independent FIFO plans and line totals',()=>{
  const result=parity(cart([item({qty:3}),item({
    productId:'WIRE',qty:1,priceMode:'auto',unitPrice:15
  })],3));
  assert.equal(result.subtotal,67); // PIPE 53 and WIRE 14
  assert.equal(result.cogs,37); // PIPE 2 x 10 + 1 x 11, WIRE 1 x 6
  assert.equal(result.grandTotal,64);
  assert.equal(result.profit,27);
});

test('manual unit price uses quantity while preserving original lot COGS',()=>{
  const r=parity(cart([item({qty:2,priceMode:'manual',unitPrice:21.25})],2.25));
  assert.equal(r.subtotal,42.5);
  assert.equal(r.cogs,20);
  assert.equal(r.profit,20.25);
});

test('fixed original draft line total is used as-is instead of qty times unit price',()=>{
  const r=parity(cart([item({
    qty:2,priceMode:'fixed',unitPrice:20,lineTotal:37.77
  })],0));
  assert.equal(r.subtotal,37.77);
  assert.equal(r.cogs,20);
});

test('vendor shortage uses NET current shop stock, not gross positive lot quantities',()=>{
  const source=stock();
  source.productsById.PIPE['Current Stock']=1; // gross lots still four
  const r=parity(cart([item({qty:4,vendorId:'VEND-1',vendorUnitCost:8})]),source);
  assert.equal(r.cogs,34); // one own x 10, three vendor x 8
  assert.equal(r.subtotal,77); // 17 own + three at fallback selling price 20
});

test('negative own stock leaves shortage and uses source Purchase Price fallback',()=>{
  const source=stock();
  source.stockLots=[];
  source.productsById.PIPE['Current Stock']=-4;
  const r=parity(cart([item({qty:2})]),source);
  assert.equal(r.subtotal,40);
  assert.equal(r.cogs,18);
  assert.equal(r.costComplete,true);
});

test('zero or unknown lot cost marks costComplete false without inventing an amount',()=>{
  const source=stock();
  source.stockLots[1]['Purchase Price']=0;
  const r=parity(cart([item({qty:1,priceMode:'manual',unitPrice:18})]),source);
  assert.equal(r.cogs,0);
  assert.equal(r.costComplete,false);
});

test('vendor zero-cost shortfall stays incomplete even if POS revenue is positive',()=>{
  const source=stock();
  source.productsById.PIPE['Current Stock']=0;
  const r=parity(cart([item({qty:3,vendorId:'VEND-1',vendorUnitCost:0})]),source);
  assert.equal(r.cogs,0);
  assert.equal(r.costComplete,false);
});

test('discount above subtotal floors grand total to zero; margin stays zero',()=>{
  const r=parity(cart([item({qty:1,priceMode:'manual',unitPrice:15})],100));
  assert.equal(r.grandTotal,0);
  assert.equal(r.marginPercent,0);
  assert.equal(r.profit,-10);
});

test('invalid quantity, missing product, duplicate SKU and negative price reject like original',()=>{
  parityError(cart([item({qty:0})]));
  parityError(cart([item({productId:'MISSING'})]));
  parityError(cart([item({qty:1}),item({qty:1})]));
  parityError(cart([item({priceMode:'manual',unitPrice:-1})]));
  parityError(cart([item({qty:NaN})]));
});

test('invalid discount and invalid vendor sourcing reject like original',()=>{
  parityError(cart([item()],-1));
  parityError(cart([item({qty:1,vendorId:'VEND-1',vendorUnitCost:6})]));
  parityError(cart([item({qty:5,vendorId:'VEND-1',vendorUnitCost:-1})]));
});

test('zero-line and over-200-line carts reject using frozen original message',()=>{
  parityError(cart([]));
  parityError(cart(Array.from({length:201},(_,i)=>item({productId:'P'+i}))));
});

test('read-only preview refuses bundles, whose component COGS needs approved shared demand planner',()=>{
  const source=stock();
  source.productsById.PIPE['Product Type']='Bundle';
  assert.throws(()=>estimateStandardPosInvoiceProfit(cart(),source),/Bundle|bundle/i);
});

test('read-only preview rejects missing trusted product/stock input',()=>{
  assert.throws(()=>estimateStandardPosInvoiceProfit(cart(),null),/trusted|products|stock/i);
  assert.throws(()=>estimateStandardPosInvoiceProfit(cart(),{productsById:stock().productsById}),/trusted|products|stock/i);
  assert.throws(()=>estimateStandardPosInvoiceProfit(cart(),{stockLots:stock().stockLots}),/trusted|products|stock/i);
});
