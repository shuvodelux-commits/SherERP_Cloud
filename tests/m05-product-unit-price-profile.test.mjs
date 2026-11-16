import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeProductPriceProfile_} from '../src/modules/m05-product-unit-price-profile.js';

const gauge = () => [{
  id:'C-GAUGE',unitName:'Gauge',factor:16,relationQty:16,
  relationUnitName:'Gira',purchasePrice:'',sellingPrice:'',
  sortOrder:1
}];
const sizes = () => [
  {id:'C-BAG',unitName:'Bag',factor:100,relationQty:5,
   relationUnitName:'Box',purchasePrice:'',sellingPrice:'',sortOrder:1},
  {id:'C-BOX',unitName:'Box',factor:20,relationQty:20,
   relationUnitName:'Pcs',purchasePrice:'',sellingPrice:'',sortOrder:2}
];

test('source preserves fractional base cost and exact Gauge anchor to prevent edit price drift',()=>{
  const conversion=gauge();
  const input={
    purchasePrice:70,sellingPrice:160,
    purchasePriceUnit:'Gauge',sellingPriceUnit:'Gauge'
  };
  const before=structuredClone({conversion,input});
  const result=normalizeProductPriceProfile_('Gira',conversion,input);
  assert.equal(result.purchaseBasePrice,4.375);
  assert.equal(result.sellingBasePrice,10);
  assert.equal(result.purchasePriceUnit,'Gauge');
  assert.equal(result.sellingPriceUnit,'Gauge');
  assert.equal(result.conversions[0].purchasePrice,70);
  assert.equal(result.conversions[0].sellingPrice,160);
  assert.equal(result.conversions[0].status,'Active');
  assert.deepEqual({conversion,input},before);
});

test('independent price anchors use different configured units without premature rounding',()=>{
  const result=normalizeProductPriceProfile_('Pcs',sizes(),{
    purchasePrice:600,purchasePriceUnit:'Bag',
    sellingPrice:240,sellingPriceUnit:'Box'
  });
  assert.equal(result.purchaseBasePrice,6);
  assert.equal(result.sellingBasePrice,12);
  assert.equal(result.conversions[0].purchasePrice,600);
  assert.equal(result.conversions[1].sellingPrice,240);
  assert.equal(result.stockPurchaseOverride,'');
  assert.equal(result.stockSellingOverride,'');
});

test('nonanchor Box overrides and stock-unit purchase override are independent',()=>{
  const result=normalizeProductPriceProfile_('Pcs',sizes(),{
    purchasePrice:600,purchasePriceUnit:'Bag',
    sellingPrice:12,sellingPriceUnit:'Pcs',
    unitPriceOverrides:[
      {unitName:'Box',purchasePrice:110,sellingPrice:249},
      {unitName:'Pcs',purchasePrice:5.5}
    ]
  });
  assert.equal(result.purchaseBasePrice,6);
  assert.equal(result.sellingBasePrice,12);
  assert.equal(result.conversions[0].purchasePrice,600);
  assert.equal(result.conversions[1].purchasePrice,110);
  assert.equal(result.conversions[1].sellingPrice,249);
  assert.equal(result.stockPurchaseOverride,5.5);
  assert.equal(result.stockSellingOverride,'');
});

test('single-unit legacy profile is unchanged with no conversions or overrides',()=>{
  const result=normalizeProductPriceProfile_('Feet',[],{
    purchasePrice:7.5,sellingPrice:10.25
  });
  assert.deepEqual(result,{
    purchaseBasePrice:7.5,sellingBasePrice:10.25,
    purchasePriceUnit:'Feet',sellingPriceUnit:'Feet',
    stockPurchaseOverride:'',stockSellingOverride:'',conversions:[]
  });
});

test('source errors reject unconfigured price anchors and negative prices',()=>{
  assert.throws(()=>normalizeProductPriceProfile_('',[],{
    purchasePrice:10,sellingPrice:20
  }),/Stock unit is required/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',sizes(),{
    purchasePrice:6,sellingPrice:10,purchasePriceUnit:'Carton'
  }),/purchase price unit is not configured/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',sizes(),{
    purchasePrice:6,sellingPrice:10,sellingPriceUnit:'Carton'
  }),/selling price unit is not configured/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',[],{
    purchasePrice:-1,sellingPrice:10
  }),/Purchase price must be a valid number/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',[],{
    purchasePrice:6,sellingPrice:-1
  }),/Selling price must be a valid number/);
});

test('source refuses overrides on the same side as the main anchor price',()=>{
  assert.throws(()=>normalizeProductPriceProfile_('Gira',gauge(),{
    purchasePrice:70,purchasePriceUnit:'Gauge',sellingPrice:10,
    unitPriceOverrides:[{unitName:'Gauge',purchasePrice:99}]
  }),/use the main Purchase Price field/);
  assert.throws(()=>normalizeProductPriceProfile_('Gira',gauge(),{
    purchasePrice:4,purchasePriceUnit:'Gira',sellingPrice:160,
    sellingPriceUnit:'Gauge',
    unitPriceOverrides:[{unitName:'Gauge',sellingPrice:99}]
  }),/use the main Selling Price field/);
  assert.throws(()=>normalizeProductPriceProfile_('Gira',gauge(),{
    purchasePrice:4,sellingPrice:10,
    unitPriceOverrides:[{unitName:'Box',purchasePrice:8}]
  }),/not configured for this product/);
});

test('source refuses invalid conversion factors and invalid optional per-unit prices',()=>{
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',[
    {...sizes()[0],factor:0}
  ],{purchasePrice:10,sellingPrice:11}),/valid conversion factor/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',[
    {...sizes()[0],purchasePrice:-5}
  ],{purchasePrice:10,sellingPrice:11}),/purchase price must be zero or greater/);
  assert.throws(()=>normalizeProductPriceProfile_('Pcs',sizes(),{
    purchasePrice:10,sellingPrice:11,
    unitPriceOverrides:[{unitName:'Box',sellingPrice:-3}]
  }),/selling price must be zero or greater/);
});

test('pure profile calculation has no RPC, SQL, D1 write, or original GAS mutation',()=>{
  const module=readFileSync(new URL('../src/modules/m05-product-unit-price-profile.js',import.meta.url),'utf8');
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(module,/sherERP_Mohim@590adfad/);
  assert.doesNotMatch(module,/SpreadsheetApp|LockService|D1Database|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
  assert.doesNotMatch(runtime,/m05-product-unit-price-profile|normalizeProductPriceProfile_/);
});
