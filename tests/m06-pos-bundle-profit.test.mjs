import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {originalMixedPosProfit} from './fixtures/m06-pos-bundle-profit-oracle.mjs';
import {estimateMixedPosInvoiceProfit} from '../src/modules/pos-profit-with-bundles.js';

const clone=data=>JSON.parse(JSON.stringify(data));
const product=(id,type,stock,purchase,sell,revision=0)=>({
  'Product ID':id,'Product Name':id,'Product Type':type,
  'Current Stock':stock,'Purchase Price':purchase,
  'Selling Price':sell,'Bundle Revision':revision
});
const lot=(id,pid,date,qty,cost,price)=>({
  'Lot ID':id,'Product ID':pid,'Purchase Date':date,
  'Remaining Quantity':qty,'Purchase Price':cost,'Sell Price':price,
  'Status':'Active','Created At':'2026-11-15T00:00:00Z'
});
const bundle=(id,extra={})=>({
  productId:id,qty:1,priceMode:'auto',unitPrice:0,
  bundleRevision:id==='SET-A'?2:1,...extra
});
const standalone=(id,extra={})=>({
  productId:id,qty:1,priceMode:'auto',unitPrice:0,...extra
});
const cart=(items,discount=0)=>({items,discount});
function fixture(){
  return {
    productsById:{
      'SET-A':product('SET-A','Bundle',0,0,85,2),
      'SET-B':product('SET-B','Bundle',0,0,50,1),
      PIPE:product('PIPE','Standard',12,5,20),
      WIRE:product('WIRE','Standard',6,4,15),
      CLIP:product('CLIP','Standard',9,2,5),
      SPRAY:product('SPRAY','Standard',1,9,30)
    },
    bundleDefinitions:{
      'SET-A':{bundleId:'SET-A',revision:2,components:[
        {productId:'PIPE',qtyPerSet:2,unit:'pcs'},
        {productId:'WIRE',qtyPerSet:1,unit:'pcs'}
      ]},
      'SET-B':{bundleId:'SET-B',revision:1,components:[
        {productId:'PIPE',qtyPerSet:1,unit:'pcs'},
        {productId:'CLIP',qtyPerSet:2,unit:'pcs'}
      ]}
    },
    stockLots:[
      lot('LOT-001','PIPE','2026-11-11',3,6,19),
      lot('LOT-002','PIPE','2026-11-13',4,7,21),
      lot('LOT-003','PIPE','2026-11-14',5,8,22),
      lot('LOT-004','WIRE','2026-11-11',2,4,14),
      lot('LOT-005','WIRE','2026-11-12',4,5,16),
      lot('LOT-006','CLIP','2026-11-09',9,2,5),
      lot('LOT-007','SPRAY','2026-11-11',1,9,30)
    ]
  };
}
function parity(payload,snapshot=fixture()){
  const originalInputs=clone({payload,snapshot});
  const expected=originalMixedPosProfit(clone(payload),clone(snapshot));
  const actual=estimateMixedPosInvoiceProfit(payload,snapshot);
  assert.deepEqual(clone(actual),expected,'original GAS profit parity');
  assert.deepEqual({payload,snapshot},originalInputs,'read-only projection must not mutate');
  assert.equal(actual.estimated,true);
  return actual;
}
function errorsMatch(payload,snapshot=fixture()){
  let expectedError,actualError;
  try{originalMixedPosProfit(clone(payload),clone(snapshot));}catch(e){expectedError=e.message;}
  try{estimateMixedPosInvoiceProfit(payload,snapshot);}catch(e){actualError=e.message;}
  assert.equal(typeof expectedError,'string','original must reject');
  assert.equal(actualError,expectedError,'must reject with exact original message');
}

test('physical demand port declaration remains byte-for-byte frozen Bundle source',()=>{
  const name='buildSaleStockDemands_';
  function extract(code){
    const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'});
    const found=ast.body.filter(x=>x.type==='FunctionDeclaration'&&x.id.name===name);
    assert.equal(found.length,1);
    return code.slice(found[0].start,found[0].end);
  }
  const old=readFileSync(new URL('../legacy/source/Bundles.gs',import.meta.url),'utf8');
  const current=readFileSync(new URL('../src/modules/pos-bundle-demands.js',import.meta.url),'utf8');
  assert.equal(extract(current),extract(old));
});

test('single Bundle: independent sale price and exact physical component COGS',()=>{
  const actual=parity(cart([bundle('SET-A')]));
  assert.deepEqual(actual,{
    subtotal:85,discount:0,grandTotal:85,cogs:16,profit:69,
    marginPercent:81.18,costComplete:true,estimated:true
  });
});

test('Bundle + standalone shared component uses one aggregated FIFO demand',()=>{
  const result=parity(cart([bundle('SET-A'),standalone('PIPE')]));
  assert.equal(result.subtotal,104); // Bundle 85 + standalone lot price 19
  assert.equal(result.cogs,22); // 3 PIPE at cost 6 + 1 WIRE at cost 4
  assert.equal(result.profit,82);
});

test('two Bundle recipes sharing PIPE aggregate its physical lot only once',()=>{
  const r=parity(cart([bundle('SET-A'),bundle('SET-B')]));
  assert.equal(r.subtotal,135);
  assert.equal(r.cogs,26); // PIPE 3x6 + WIRE 1x4 + CLIP 2x2
  assert.equal(r.profit,109);
});

test('mixed Bundle and Standard stock demands cross multiple FIFO supplier lots',()=>{
  const r=parity(cart([bundle('SET-A',{qty:2}),standalone('PIPE',{qty:2})]));
  assert.equal(r.subtotal,208); // 2x85 + 2x19
  assert.equal(r.cogs,47); // PIPE (3x6+3x7) plus WIRE 2x4
  assert.equal(r.profit,161);
});

test('Bundle physical shortages use original product purchase fallback, not bundle cost',()=>{
  const data=fixture();
  data.stockLots=data.stockLots.filter(x=>x['Product ID']!=='PIPE');
  const r=parity(cart([bundle('SET-A'),standalone('PIPE')]),data);
  assert.equal(r.cogs,19); // (2 + 1) PIPE x fallback 5 + 1 WIRE cost 4
  assert.equal(r.costComplete,true);
});

test('missing fallback purchase costs never claim a complete profit estimate',()=>{
  const data=fixture();
  data.stockLots=data.stockLots.filter(x=>x['Product ID']!=='PIPE');
  data.productsById.PIPE['Purchase Price']=0;
  const r=parity(cart([bundle('SET-A')]),data);
  assert.equal(r.cogs,4);
  assert.equal(r.costComplete,false);
});

test('zero positive FIFO lot cost inside Bundle marks cost incomplete',()=>{
  const data=fixture();
  data.stockLots.find(x=>x['Lot ID']==='LOT-001')['Purchase Price']=0;
  const r=parity(cart([bundle('SET-A')]),data);
  assert.equal(r.cogs,4);
  assert.equal(r.costComplete,false);
});

test('vendor sourcing on unrelated standalone product keeps its independent COGS',()=>{
  const data=fixture();
  const r=parity(cart([
    bundle('SET-A'),
    standalone('SPRAY',{qty:3,vendorId:'VEND-1',vendorUnitCost:8})
  ]),data);
  assert.equal(r.cogs,41); // Bundle 16, 1 owned SPRAY cost 9 + 2 vendor cost 8
  assert.equal(r.subtotal,175);
  assert.equal(r.profit,134);
});

test('Bundle and vendor-sourced standalone shared component is forbidden',()=>{
  errorsMatch(cart([
    bundle('SET-A'),
    standalone('PIPE',{qty:20,vendorId:'VEND-1',vendorUnitCost:10})
  ]));
});

test('Bundle revision changed, missing definition and noninteger sets are rejected',()=>{
  errorsMatch(cart([bundle('SET-A',{bundleRevision:1})]));
  errorsMatch(cart([bundle('SET-A',{qty:1.5})]));
  const data=fixture();
  delete data.bundleDefinitions['SET-A'];
  errorsMatch(cart([bundle('SET-A')]),data);
});

test('vendor shortages can never be selected on a Bundle',()=>{
  errorsMatch(cart([bundle('SET-A',{vendorId:'VEND-1',vendorUnitCost:2})]));
});

test('invalid nested, missing or nonsensical component demand fails like original GAS',()=>{
  for(const [id,qty] of [['SET-B',2],['MISSING',1],['PIPE',0],['PIPE',-1]]){
    const data=fixture();
    data.bundleDefinitions['SET-A'].components=[{productId:id,qtyPerSet:qty}];
    errorsMatch(cart([bundle('SET-A')]),data);
  }
});

test('manual and fixed Bundle sale prices preserve original line total rounding',()=>{
  const r=parity(cart([
    bundle('SET-A',{qty:2,priceMode:'manual',unitPrice:44.25}),
    bundle('SET-B',{priceMode:'fixed',lineTotal:31.19})
  ],1.44));
  assert.equal(r.subtotal,119.69);
  assert.equal(r.discount,1.44);
});

test('discount exceeding gross revenue floors total and margin at zero',()=>{
  const r=parity(cart([bundle('SET-A')],9999));
  assert.equal(r.grandTotal,0);
  assert.equal(r.marginPercent,0);
  assert.equal(r.profit,-16);
});

test('Standard-only cart delegates to existing M06 estimator and remains source-exact',()=>{
  const r=parity(cart([standalone('PIPE',{qty:4}),standalone('WIRE',{qty:1})],5));
  assert.equal(r.cogs,29); // PIPE costs 3x6+1x7, WIRE 1x4
});

test('bad cart, duplicate product, bad discount and invalid price reject original messages',()=>{
  errorsMatch(cart([]));
  errorsMatch(cart([bundle('SET-A'),bundle('SET-A')]));
  errorsMatch(cart([bundle('SET-A')],-1));
  errorsMatch(cart([bundle('SET-A',{priceMode:'manual',unitPrice:-1})]));
  errorsMatch(cart([bundle('SET-A',{qty:0})]));
});

test('untrusted/missing component definitions or lot snapshot cannot be used',()=>{
  const c=cart([bundle('SET-A')]);
  assert.throws(()=>estimateMixedPosInvoiceProfit(c,null),/trusted|snapshot/i);
  const noDefs=fixture();delete noDefs.bundleDefinitions;
  assert.throws(()=>estimateMixedPosInvoiceProfit(c,noDefs),/trusted|snapshot/i);
  const noLots=fixture();delete noLots.stockLots;
  assert.throws(()=>estimateMixedPosInvoiceProfit(c,noLots),/trusted|snapshot/i);
});
