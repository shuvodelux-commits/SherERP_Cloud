import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preparePurchasePaymentPreflight} from '../src/modules/m05-purchase-payment-preflight.js';
import {prepareMultiUnitPurchasePreflight} from '../src/modules/m05-multi-unit-purchase-preflight.js';
import {prepareMultiUnitPurchasePaymentPreflight} from
  '../src/modules/m05-multi-unit-purchase-payment.js';

const products=[
  {'Product ID':'P-MIX','Product Name':'Cable','Product Type':'Standard',
    Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,_rowIndex:8},
  {'Product ID':'P-PLAIN','Product Name':'Pipe','Product Type':'Standard',
    Unit:'Feet','Purchase Price':7,'Selling Price':12,'Current Stock':-3,_rowIndex:9},
  {'Product ID':'P-BUNDLE','Product Name':'Bundle','Product Type':'Bundle',
    Unit:'Set','Purchase Price':0,'Selling Price':200,'Current Stock':0,_rowIndex:10}
];
const suppliers=[
  {'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-B','Supplier Name':'Supplier B',Status:'Inactive'}
];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
    'Conversion Factor':100,'Purchase Price':500,'Selling Price':900,
    'Sort Order':1,Status:'Active'},
  {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
    'Conversion Factor':20,'Purchase Price':100,'Selling Price':190,
    'Sort Order':2,Status:'Active'}
];
const bankAccounts=[
  {'Bank Account ID':'BA-MAIN','Account Name':'Business Bank',Status:'Active'},
  {'Bank Account ID':'BA-OLD','Account Name':'Historic Mobile',Status:'Inactive'}
];
const mixedLine=(extra={})=>({
  productId:'P-MIX',name:'Ignored browser label',qty:145,
  unitPrice:1,sellingPrice:10,
  unitBreakdown:[
    {conversionId:'C-BAG',qty:1},
    {conversionId:'C-BOX',qty:2},
    {conversionId:'BASE',qty:5}
  ],...extra
});
const plainLine=(extra={})=>({
  productId:'P-PLAIN',name:'Pipe',qty:2,unitPrice:9,sellingPrice:12,...extra
});
const purchase=(extra={})=>({
  supplierId:'SUP-A',items:[mixedLine(),plainLine()],discount:8,
  paidAmount:100,paymentMethod:'Bank',bankAccountId:'BA-MAIN',...extra
});
const context=()=>({products,suppliers,conversionRows,bankAccounts});
const preview=(input=purchase(),rows=context())=>
  prepareMultiUnitPurchasePaymentPreflight(input,rows);
const normalize=(input=purchase())=>
  prepareMultiUnitPurchasePreflight(input,{products,suppliers,conversionRows});

test('mixed 145-Pcs source-backed quantity, trusted 730+18 cost and Bank supplier due compose',()=>{
  const input=purchase();
  const before=structuredClone({input,products,suppliers,conversionRows,bankAccounts});
  const result=preview(input);
  assert.equal(result.supplierId,'SUP-A');
  assert.equal(result.supplierName,'Supplier A');
  assert.equal(result.lines[0].productId,'P-MIX');
  assert.equal(result.lines[0].name,'Cable');
  assert.equal(result.lines[0].qty,145);
  assert.equal(result.lines[0].unit.lineTotal,730);
  assert.deepEqual(result.lines[0].unit.unitSnapshot.map(v=>[v.unitName,v.qty,v.factor]),[
    ['Bag',1,100],['Box',2,20],['Pcs',5,1]
  ]);
  assert.equal(result.lines[1].qty,2);
  assert.equal(result.subtotal,748);
  assert.equal(result.discount,8);
  assert.equal(result.grandTotal,740);
  assert.equal(result.paidAmount,100);
  assert.equal(result.dueAmount,640);
  assert.equal(result.paymentStatus,'Partial');
  assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],
    ['Bank','BA-MAIN','Business Bank']);
  assert.deepEqual({input,products,suppliers,conversionRows,bankAccounts},before);
});

test('computed tender uses normalized lines rather than browser cost, unit factor or label',()=>{
  const tampered=mixedLine({
    qty:undefined,unitPrice:99999999,name:'Fraudulent name',
    unitBreakdown:[{conversionId:'C-BAG',qty:1,factor:1,unitPrice:1,unitName:'Fake'}]
  });
  const result=preview(purchase({items:[tampered],discount:0,paidAmount:50}));
  assert.equal(result.lines[0].name,'Cable');
  assert.equal(result.lines[0].qty,100);
  assert.equal(result.lines[0].price,5);
  assert.equal(result.lines[0].unit.lineTotal,500);
  assert.equal(result.subtotal,500);
  assert.equal(result.grandTotal,500);
  assert.equal(result.dueAmount,450);
  assert.equal(result.bankAccountId,'BA-MAIN');
});

test('no-breakdown purchase retains byte-for-byte source Payment preflight return shape',()=>{
  for(const line of [plainLine(),plainLine({unitBreakdown:[]})]){
    const input=purchase({items:[line],discount:2,paidAmount:5});
    assert.deepEqual(preview(input),preparePurchasePaymentPreflight(input,{
      products,suppliers,bankAccounts
    }));
  }
});

test('Mobile Banking works with saved historic account without inventing account-type restrictions',()=>{
  const result=preview(purchase({paymentMethod:'Mobile Banking',bankAccountId:'BA-OLD'}));
  assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],
    ['Mobile Banking','BA-OLD','Historic Mobile']);
});

test('unpaid mixed-unit purchase ignores browser Bank fields and is Due without a tender posting',()=>{
  const result=preview(purchase({
    paidAmount:0,paymentMethod:'Bank',bankAccountId:'INVALID'
  }));
  assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],
    ['','','']);
  assert.equal(result.grandTotal,740);
  assert.equal(result.dueAmount,740);
  assert.equal(result.paymentStatus,'Due');
  assert.equal('operationId' in result,false);
  assert.equal('journal' in result,false);
});

test('paid Cash ignores stale Bank ID and bank duplicate catalog, preserving source method',()=>{
  const rows={...context(),bankAccounts:[
    ...bankAccounts,{'Bank Account ID':'BA-MAIN','Account Name':'Duplicate bank'}
  ]};
  const result=preview(purchase({paymentMethod:'Cash',bankAccountId:'BA-MAIN'}),rows);
  assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],
    ['Cash','','']);
});

test('mixed-unit overpayment is clamped against trusted discounted grand, never client price',()=>{
  const result=preview(purchase({
    items:[mixedLine({unitPrice:0.001})],discount:25,
    paidAmount:10000,paymentMethod:'Bank',bankAccountId:' BA-MAIN '
  }));
  assert.equal(result.subtotal,730);
  assert.equal(result.grandTotal,705);
  assert.equal(result.paidAmount,705);
  assert.equal(result.dueAmount,0);
  assert.equal(result.paymentStatus,'Paid');
  assert.equal(result.bankAccountId,'BA-MAIN');
});

test('selected Bank account missing, duplicate or unknown refuses without fallback',()=>{
  for(const id of ['',null,'   ','UNKNOWN']){
    assert.throws(()=>preview(purchase({bankAccountId:id})),
      id===null||!String(id).trim()?/Choose a bank account/i:/Bank account not found/i);
  }
  const rows={...context(),bankAccounts:[...bankAccounts,{...bankAccounts[0]}]};
  assert.throws(()=>preview(purchase(),rows),/Duplicate bank account ID/i);
});

test('duplicate Product, Supplier or Conversion source identity cannot choose the last/first row',()=>{
  assert.throws(()=>preview(purchase(),{
    ...context(),products:[...products,{...products[0],'Purchase Price':0}]
  }),/duplicate product id/i);
  assert.throws(()=>preview(purchase(),{
    ...context(),suppliers:[...suppliers,{...suppliers[0],'Supplier Name':'Other'}]
  }),/duplicate supplier id/i);
  assert.throws(()=>preview(purchase(),{
    ...context(),conversionRows:[...conversionRows,{...conversionRows[0],'Purchase Price':1}]
  }),/duplicate conversion id/i);
});

test('foreign and inactive conversion references, bundle or inactive supplier remain blocked',()=>{
  assert.throws(()=>preview(purchase({items:[mixedLine({
    unitBreakdown:[{conversionId:'BAD',qty:1}]
  })]})),/not available/i);
  const inactive=conversionRows.map(v=>({...v,Status:'Inactive'}));
  assert.throws(()=>preview(purchase(),{...context(),conversionRows:inactive}),/not available/i);
  assert.throws(()=>preview(purchase({items:[plainLine({productId:'P-BUNDLE'})]})),
    /virtual bundle/i);
  assert.throws(()=>preview(purchase({supplierId:'SUP-B'})),
    /supplier not found or inactive/i);
  assert.throws(()=>preview(purchase({items:[mixedLine({qty:144})]})),
    /does not match/i);
});

test('missing or accessor-bearing snapshots/payloads fail before any trusted financial calculation',()=>{
  assert.throws(()=>preview(purchase(),{...context(),conversionRows:null}),/conversion snapshot/i);
  assert.throws(()=>preview(purchase(),{...context(),bankAccounts:null}),/bank account snapshot/i);
  assert.throws(()=>preview(purchase(),{...context(),products:null}),/product snapshot/i);
  assert.throws(()=>preview(purchase(),{...context(),suppliers:null}),/supplier snapshot/i);
  const getter=Object.defineProperty({},'Purchase Price',{
    get(){throw new Error('accessor unexpectedly executed');}
  });
  assert.throws(()=>preview(purchase(),{...context(),products:[...products,getter]}),
    /trusted.*row|accessor/i);
  const input=purchase();
  Object.defineProperty(input.items[0],'qty',{get(){throw new Error('getter executed');}});
  assert.throws(()=>preview(input),/accessor|payload/i);
});

test('frozen source keeps the Cash Session requirement before account resolution: this preflight never authorizes or posts',()=>{
  const source=readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8');
  const call=source.slice(source.indexOf('function createPurchase('));
  assert.ok(call.indexOf('requireActiveCashSession_();')>=0);
  assert.ok(call.indexOf('requireActiveCashSession_();')<
    call.indexOf('resolveBankAccount_(paymentMethod, payload.bankAccountId)'));
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/m05-multi-unit-purchase-payment|prepareMultiUnitPurchasePaymentPreflight/);
});
