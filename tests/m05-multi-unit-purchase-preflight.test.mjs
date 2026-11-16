import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparePurchasePreflight} from '../src/modules/purchase-preflight.js';
import {prepareMultiUnitPurchasePreflight} from '../src/modules/m05-multi-unit-purchase-preflight.js';

const products = [
  {'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
   'Unit':'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,_rowIndex:8},
  {'Product ID':'P-PLAIN','Product Name':'Pipe','Product Type':'Standard',
   'Unit':'Feet','Purchase Price':7,'Selling Price':12,'Current Stock':-3,_rowIndex:9},
  {'Product ID':'P-BUNDLE','Product Name':'Bundle','Product Type':'Bundle',
   'Unit':'Set','Purchase Price':0,'Selling Price':100,'Current Stock':0,_rowIndex:10},
  {'Product ID':'P-DELETED','Product Name':'Removed','Product Type':'Standard',
   'Unit':'Pcs','Is Deleted':'TRUE','Current Stock':0,_rowIndex:11}
];
const suppliers = [
  {'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-B','Supplier Name':'Supplier B',Status:'Inactive'}
];
const conversionRows = [
  {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
   'Conversion Factor':100,'Purchase Price':500,'Selling Price':900,
   'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
   'Conversion Factor':20,'Purchase Price':100,'Selling Price':190,
   'Sort Order':2,Status:'Active'}
];
const breakdown = () => [
  {conversionId:'C-BAG',qty:1},
  {conversionId:'C-BOX',qty:2},
  {conversionId:'BASE',qty:5}
];
const mixedLine = (extra={}) => ({
  productId:'P-MIX',name:'Ignored client label',qty:145,unitPrice:0.01,
  sellingPrice:10,unitBreakdown:breakdown(),...extra
});
const legacyLine = (extra={}) => ({
  productId:'P-PLAIN',name:'Pipe',qty:2,unitPrice:9,sellingPrice:12,...extra
});
const payload = (items=[mixedLine(),legacyLine()], extra={}) =>
  ({supplierId:'SUP-A',items,discount:8,paidAmount:100,...extra});
const context = () => ({products, suppliers, conversionRows});
const preview = (input, contextOverride=context()) => prepareMultiUnitPurchasePreflight(input,contextOverride);

test('purchase mix of 1 Bag, 2 Box, 5 Pcs normalizes to 145 stock units, preserving supplier due',()=>{
  const input=payload();
  const before=structuredClone({input,products,suppliers,conversionRows});
  const result=preview(input);
  assert.equal(result.supplierId,'SUP-A');
  assert.equal(result.supplierName,'Supplier A');
  assert.equal(result.lines.length,2);
  assert.deepEqual(result.lines[0],{
    productId:'P-MIX',name:'Cable',qty:145,price:730/145,sellPrice:10,
    rowIndex:8,currentStock:5,newStock:150,
    unit:{
      stockUnit:'Pcs',lineTotal:730,
      unitSnapshot:[
        {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
        {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
        {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
      ],
      pricingSnapshot:[
        {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1,unitPrice:500},
        {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2,unitPrice:100},
        {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5,unitPrice:6}
      ]
    }
  });
  assert.deepEqual(result.lines[1],{
    productId:'P-PLAIN',name:'Pipe',qty:2,price:9,sellPrice:12,
    rowIndex:9,currentStock:-3,newStock:-1
  });
  assert.equal(result.subtotal,748);
  assert.equal(result.discount,8);
  assert.equal(result.grandTotal,740);
  assert.equal(result.paidAmount,100);
  assert.equal(result.dueAmount,640);
  assert.equal(result.paymentStatus,'Partial');
  assert.deepEqual({input,products,suppliers,conversionRows},before,
    'purchase preview must never modify input, product, supplier or unit rows');
  assert.equal('statements' in result,false);
  assert.equal('journal' in result,false);
  assert.equal('operationId' in result,false);
});

test('untrusted browser unit factor, price and label cannot change trusted conversion cost',()=>{
  const tampered=mixedLine({
    qty:undefined,unitPrice:999999,name:'Spoofed',
    unitBreakdown:[{conversionId:'C-BAG',qty:1,factor:1,unitPrice:1,sellingPrice:1}]
  });
  const result=preview(payload([tampered],{discount:0,paidAmount:0}));
  assert.equal(result.lines[0].qty,100);
  assert.equal(result.lines[0].price,5);
  assert.equal(result.lines[0].name,'Cable');
  assert.equal(result.lines[0].unit.lineTotal,500);
  assert.equal(result.lines[0].unit.unitSnapshot[0].factor,100);
  assert.equal(result.paymentStatus,'Due');
});

test('no breakdown is exact backward-compatible single-unit purchase preflight',()=>{
  const input=payload([legacyLine()],{discount:2,paidAmount:5});
  assert.deepEqual(preview(input),
    preparePurchasePreflight(input,{products,suppliers}));
  const empty=payload([legacyLine({unitBreakdown:[]})],{discount:0,paidAmount:50});
  assert.deepEqual(preview(empty),
    preparePurchasePreflight(empty,{products,suppliers}));
});

test('mixed-unit discount and payment clamping retain existing source purchase semantics',()=>{
  const result=preview(payload([mixedLine()],{discount:25,paidAmount:999999}));
  assert.equal(result.subtotal,730);
  assert.equal(result.grandTotal,705);
  assert.equal(result.paidAmount,705);
  assert.equal(result.dueAmount,0);
  assert.equal(result.paymentStatus,'Paid');
});

test('invalid, inactive and foreign conversion references reject before a preview',()=>{
  assert.throws(()=>preview(payload([mixedLine({qty:144})])),/does not match/i);
  assert.throws(()=>preview(payload([mixedLine({unitBreakdown:'Bag'})])),/unit breakdown.*array/i);
  assert.throws(()=>preview(payload([mixedLine({unitBreakdown:[
    {conversionId:'C-BAG',qty:1},{conversionId:'C-BAG',qty:1}
  ]})])),/duplicate unit/i);
  assert.throws(()=>preview(payload([mixedLine({unitBreakdown:[
    {conversionId:'NOT-OWNED',qty:1}
  ]})])),/not available/i);
  const inactive=conversionRows.map(x=>({...x,Status:'Inactive'}));
  assert.throws(()=>preview(payload([mixedLine()],{discount:0}),
    {...context(),conversionRows:inactive}),/not available/i);
  const foreign=[...conversionRows.map(x=>({...x,'Product ID':'OTHER'}))];
  assert.throws(()=>preview(payload([mixedLine()],{discount:0}),
    {...context(),conversionRows:foreign}),/not available/i);
});

test('supplier, bundle, duplicate and deleted-product rules still come from original purchase preflight',()=>{
  assert.throws(()=>preview(payload([mixedLine()],{supplierId:'SUP-B'})),/Supplier not found or inactive/);
  assert.throws(()=>preview(payload([mixedLine()],{supplierId:'unknown'})),/Supplier not found or inactive/);
  assert.throws(()=>preview(payload([mixedLine(),mixedLine()])),/appears more than once/);
  assert.throws(()=>preview(payload([legacyLine({productId:'P-BUNDLE'})])),/Virtual bundle sets/);
  assert.throws(()=>preview(payload([legacyLine({productId:'P-DELETED'})])),/no longer exists/);
  assert.throws(()=>preview(payload([legacyLine({productId:'P-MISSING'})])),/no longer exists/);
});

test('missing trusted snapshots and invalid purchase envelopes fail closed',()=>{
  assert.throws(()=>preview(payload(),{...context(),conversionRows:null}),/conversion snapshot/i);
  assert.throws(()=>preview(payload(),{...context(),products:null}),/product snapshot/i);
  assert.throws(()=>preview(payload(),{...context(),suppliers:null}),/supplier snapshot/i);
  assert.throws(()=>preview(null),/supplier|purchase/i);
  assert.throws(()=>preview(payload([null])),/line 1/i);
  assert.throws(()=>preview(payload([mixedLine({unitBreakdown:{conversionId:'BASE',qty:1}})])),
    /unit breakdown.*array/i);
});

test('pricing snapshot remains immutable evidence after trusted catalog later changes',()=>{
  const result=preview(payload([mixedLine()],{discount:0,paidAmount:0}));
  const originalPrice=result.lines[0].unit.pricingSnapshot[0].unitPrice;
  const synthetic=structuredClone(conversionRows);
  synthetic[0]['Purchase Price']=999;
  assert.equal(originalPrice,500);
  assert.equal(result.lines[0].unit.lineTotal,730);
  const newer=preview(payload([mixedLine()],{discount:0,paidAmount:0}),
    {...context(),conversionRows:synthetic});
  assert.equal(newer.lines[0].unit.pricingSnapshot[0].unitPrice,999);
  assert.equal(result.lines[0].unit.pricingSnapshot[0].unitPrice,500);
});

test('pure helper is not registered as a Worker route or a D1 posting entrypoint',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/m05-multi-unit-purchase-preflight|prepareMultiUnitPurchasePreflight/);
});
