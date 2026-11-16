import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  normalizeProductUnitChain_,
  resolveProductUnitBreakdown_,
  computeUnitBreakdownPurchasePricing_,
  computeUnitBreakdownSalePricing_,
} from '../src/modules/product-unit-conversions.js';

const activeUnits=(...names)=>names.map(name=>({'Unit Name':name,Status:'Active'}));
const mixed=()=>({
  product:{'Product ID':'P-MIX','Unit':'Pcs','Purchase Price':6,'Selling Price':10},
  conversions:[
    {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
      'Conversion Factor':100,'Purchase Price':500,'Selling Price':900,'Sort Order':1,'Status':'Active'},
    {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
      'Conversion Factor':20,'Purchase Price':100,'Selling Price':190,'Sort Order':2,'Status':'Active'}
  ],
  input:[{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},{conversionId:'BASE',qty:5}],
});
const resolve=({product,conversions,input},claimedQty=145)=>
  resolveProductUnitBreakdown_(product,input,claimedQty,conversions);

test('user-approved natural chain 1 Bag = 5 Box and 1 Box = 20 Pcs derives 100 Pcs',()=>{
  const chain=normalizeProductUnitChain_([
    {leftQty:1,leftUnit:'Bag',rightQty:5,rightUnit:'Box'},
    {leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'},
  ],activeUnits('Bag','Box','Pcs'));
  assert.equal(chain.stockUnit,'Pcs');
  assert.deepEqual(chain.conversions.map(c=>({unitName:c.unitName,factor:c.factor})),[
    {unitName:'Bag',factor:100},{unitName:'Box',factor:20}
  ]);
  assert.equal(chain.relations[0].rightUnit,'Box');
});

test('natural chains reject nonpositive quantities, disconnected/circular units and inactive or unmanaged names',()=>{
  const master=activeUnits('Bag','Box','Pcs');
  const good=[
    {leftQty:1,leftUnit:'Bag',rightQty:5,rightUnit:'Box'},
    {leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}
  ];
  for(const bad of [
    [{...good[0],rightQty:0},good[1]],
    [{...good[0],leftQty:-1},good[1]],
    [good[0],{...good[1],leftUnit:'Bag'}],
    [good[0],{...good[1],rightUnit:'Bag'}],
    [{...good[0],rightUnit:'Unknown'}],
  ]) assert.throws(()=>normalizeProductUnitChain_(bad,master));
  assert.throws(()=>normalizeProductUnitChain_(good,activeUnits('Bag','Pcs').concat([
    {'Unit Name':'Box',Status:'Inactive'}
  ])));
});

test('mixed 1 Bag + 2 Box + 5 Pcs is one authoritative 145 Pcs quantity and original snapshot',()=>{
  const s=mixed(),before=structuredClone(s);
  const out=resolve(s);
  assert.equal(out.baseQty,145);
  assert.equal(out.hasBreakdown,true);
  assert.deepEqual(out.snapshot,[
    {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5},
  ]);
  assert.deepEqual(s,before,'quantity resolution must not modify trusted product or converter records');
});

test('server ignores browser claimed factor and price, and rejects bad total and inactive conversions',()=>{
  const s=mixed();
  s.input[0]={conversionId:'C-BAG',qty:1,factor:9999,sellingPrice:0};
  assert.equal(resolve(s).baseQty,145);
  assert.throws(()=>resolve(s,144),/does not match/i);
  assert.throws(()=>resolve({...s,input:[{conversionId:'C-BAG',qty:1},{conversionId:'C-BAG',qty:1}]},200),/Duplicate unit/);
  assert.throws(()=>resolve({...s,input:[{conversionId:'C-UNKNOWN',qty:1}]}),/not available/);
  assert.throws(()=>resolve({...s,input:[{conversionId:'BASE',qty:-1}]}),/zero or greater/);
  assert.throws(()=>resolve({...s,input:[{conversionId:'BASE',qty:0}]}),/greater than zero/);
  assert.throws(()=>resolve({...s,conversions:s.conversions.map(c=>({...c,Status:'Inactive'}))}),/not available/);
});

test('no conversion input retains Mohim_ERP original single-unit purchase/POS quantity',()=>{
  const s=mixed();
  const out=resolveProductUnitBreakdown_(s.product,[],7,s.conversions);
  assert.deepEqual(out,{baseQty:7,snapshot:[],components:[],hasBreakdown:false});
});

test('mixed purchase uses source unit-specific costs but one base stock quantity',()=>{
  const s=mixed(),q=resolve(s);
  const amount=computeUnitBreakdownPurchasePricing_(q,s.product,s.conversions);
  assert.equal(amount.lineTotal,730);
  assert.equal(amount.unitPrice,730/145);
  assert.deepEqual(amount.pricingSnapshot.map(c=>c.unitPrice),[500,100,6]);
  assert.deepEqual(q.snapshot.map(c=>c.factor),[100,20,1]);
});

test('mixed sale uses custom Bag/Box prices and trusted FIFO lot price for base remainder',()=>{
  const s=mixed(),q=resolve(s);
  const amount=computeUnitBreakdownSalePricing_({
    draws:[{take:100,unitSellPrice:10},{take:45,unitSellPrice:12}],shortfall:0,
    fallbackSellPrice:10
  },q);
  assert.equal(amount.lineTotal,1340);
  assert.deepEqual(amount.pricingSnapshot.map(c=>c.unitPrice),[900,190,12]);
  assert.equal(amount.unitPrice,Math.round((1340/145+Number.EPSILON)*100)/100);
});

test('sequential FIFO pricing remains exact with no custom unit prices',()=>{
  const s=mixed(),q=resolve({...s,conversions:s.conversions.map(c=>({
    ...c,'Selling Price':''
  }))});
  const amount=computeUnitBreakdownSalePricing_({
    draws:[{take:20,unitSellPrice:10},{take:125,unitSellPrice:12}],
    shortfall:0,fallbackSellPrice:10
  },q);
  assert.equal(amount.lineTotal,20*10+125*12);
  assert.equal(amount.pricingSnapshot.length,3);
});

test('1 Gauge = 16 Gira with custom base Gira price gives 2 Gauge + 5 Gira = 37 Gira, ৳940',()=>{
  const p={'Product ID':'P-GAUGE','Unit':'Gira','Selling Price':25,'Stock Unit Selling Price Override':28};
  const conversions=[{
    'Conversion ID':'C-GAUGE','Product ID':'P-GAUGE','Unit Name':'Gauge',
    'Conversion Factor':16,'Selling Price':400,'Sort Order':1,'Status':'Active'
  }];
  const q=resolveProductUnitBreakdown_(p,[
    {conversionId:'C-GAUGE',qty:2},{conversionId:'BASE',qty:5}
  ],37,conversions);
  assert.equal(q.baseQty,37);
  const money=computeUnitBreakdownSalePricing_({
    draws:[{take:37,unitSellPrice:25}],shortfall:0,fallbackSellPrice:25
  },q);
  assert.equal(money.lineTotal,940);
  assert.deepEqual(money.pricingSnapshot.map(x=>x.unitPrice),[400,28]);
});

test('source specification files are pinned to reviewed supplementary implementation, without public wiring',()=>{
  const source=readFileSync(new URL('../src/modules/product-unit-conversions.js',import.meta.url),'utf8');
  assert.match(source,/sherERP_Mohim@590adfa/);
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/product-unit-conversions|resolveProductUnitBreakdown_/);
});
