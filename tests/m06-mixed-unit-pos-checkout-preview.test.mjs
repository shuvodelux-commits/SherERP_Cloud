import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSalePayments_} from '../src/modules/sale-payments.js';

// RED first: do not hide the absent implementation with a passing stub.
const plan=await import('../src/modules/m06-mixed-unit-pos-checkout-preview.js')
  .then(mod=>mod.planMultiUnitPosCheckoutPreview)
  .catch(error=>{
    if(error?.code==='ERR_MODULE_NOT_FOUND')return undefined;
    throw error;
  });
const checkout=(intent,snapshot)=>{
  assert.equal(typeof plan,'function','M06 mixed-unit POS checkout preview is missing');
  return plan(intent,snapshot);
};
const clone=x=>structuredClone(x);
const product=(id,name,unit,price,stock)=>({
  'Product ID':id,'Product Name':name,'Product Type':'Standard',
  Status:'Active','Is Deleted':'FALSE',Unit:unit,
  'Selling Price':price,'Purchase Price':3,'Current Stock':stock
});
const account=(id,type)=>({
  'Bank Account ID':id,'Account Name':type+' '+id,'Account Type':type,
  Status:'Active','Is Deleted':'FALSE'
});
const sale=()=>({
  products:[
    product('P-MIX','Fasteners','Pcs',10,145),
    product('P-PIPE','Pipe','Feet',30,9)
  ],
  conversionRows:[
    {'Conversion ID':'C-BAG','Product ID':'P-MIX','Unit Name':'Bag',
      'Conversion Factor':100,'Selling Price':900,'Sort Order':1,Status:'Active'},
    {'Conversion ID':'C-BOX','Product ID':'P-MIX','Unit Name':'Box',
      'Conversion Factor':20,'Selling Price':190,'Sort Order':2,Status:'Active'}
  ],
  stockLots:[
    {'Lot ID':'LOT-A','Product ID':'P-MIX','Purchase Date':'2026-11-10',
      'Remaining Quantity':100,'Sell Price':10,'Purchase Price':3,Status:'Active'},
    {'Lot ID':'LOT-B','Product ID':'P-MIX','Purchase Date':'2026-11-12',
      'Remaining Quantity':45,'Sell Price':12,'Purchase Price':4,Status:'Active'},
    {'Lot ID':'LOT-P','Product ID':'P-PIPE','Purchase Date':'2026-11-10',
      'Remaining Quantity':9,'Sell Price':30,'Purchase Price':10,Status:'Active'}
  ],
  bankAccounts:[account('BANK-1','Bank'),account('MOB-1','Mobile Banking')]
});
const intent=()=>({
  lines:[
    {productId:'P-MIX',claimedBaseQty:145,shortageMode:'Own',unitBreakdown:[
      {conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
      {conversionId:'BASE',qty:5}
    ]},
    {productId:'P-PIPE',claimedBaseQty:2,shortageMode:'Own',unitBreakdown:[]}
  ],
  discount:'15',
  payments:[
    {id:'B-1',method:'Bank',accountId:'BANK-1',amount:500},
    {id:'M-1',method:'Mobile Banking',accountId:'MOB-1',amount:285},
    {id:'C-1',method:'Cash',amount:650}
  ]
});

test('mixed Bag/Box/Pcs and legacy Pipe produce exact subtotal, discount, grand and source split tender',()=>{
  const snapshot=sale(),input=intent(),original=clone({snapshot,input});
  const value=checkout(input,snapshot);
  assert.equal(value.lines.length,2);
  assert.deepEqual(value.lines.map(l=>l.productId),['P-MIX','P-PIPE']);
  assert.deepEqual(value.lines.map(l=>l.baseQty),[145,2]);
  assert.deepEqual(value.lines.map(l=>l.lineTotal),[1340,60]);
  assert.equal(value.lines[0].unitPrice,9.24);
  assert.notEqual(value.lines[0].baseQty*value.lines[0].unitPrice,
    value.lines[0].lineTotal,'Never reconstruct money from rounded effective base rate');
  assert.deepEqual(value.lines[0].unitBreakdownSnapshot.map(c=>c.factor),[100,20,1]);
  assert.deepEqual(value.lines[0].unitPricingSnapshot.map(c=>c.unitPrice),[900,190,12]);
  assert.deepEqual(value.lines[1].unitBreakdownSnapshot,[]);
  assert.equal(value.subtotal,1400);
  assert.equal(value.discount,15);
  assert.equal(value.grandTotal,1385);
  assert.deepEqual(value.allocation,normalizeSalePayments_(1385,input.payments,snapshot.bankAccounts));
  assert.equal(value.allocation.paidAmount,1385);
  assert.equal(value.allocation.dueAmount,0);
  assert.equal(value.allocation.changeAmount,50);
  assert.deepEqual(value.allocation.payments.map(p=>p.applied),[500,285,600]);
  assert.equal(value.allocation.paymentMethod,'Multiple');
  assert.equal(JSON.stringify(value).includes('Purchase Price'),false);
  assert.equal(JSON.stringify(value).includes('unitCost'),false);
  assert.equal(Object.hasOwn(value,'customerId'),false,
    'Anonymous cash checkout must never manufacture a Customer/Party');
  assert.deepEqual({snapshot,input},original,'Checkout read-only preview must not mutate source');
});

test('one Product ID means one logical sale line, not two independent FIFO draws',()=>{
  const data=intent();
  data.lines.push({...data.lines[0]});
  assert.throws(()=>checkout(data,sale()),/duplicate|one.*line|product/i);
});

test('trusted Payment Account IDs must be unique before Bank allocation',()=>{
  const snapshot=sale();
  snapshot.bankAccounts.push({...snapshot.bankAccounts[0]});
  assert.throws(()=>checkout(intent(),snapshot),/duplicate|ambiguous|NEEDS_REVIEW/i);
});

test('base quantity, factor and unit price cannot be forged by browser claims',()=>{
  const x=intent();
  x.lines[0].unitBreakdown[0].factor=1;
  x.lines[0].unitBreakdown[0].sellingPrice=0;
  x.lines[0].unitBreakdown[0].unitPrice=0;
  const out=checkout(x,sale());
  assert.equal(out.subtotal,1400);
  assert.equal(out.lines[0].baseQty,145);
  x.lines[0].claimedBaseQty=144;
  assert.throws(()=>checkout(x,sale()),/does not match|quantity/i);
});

test('invalid discount precision, negative discounts and empty carts must fail closed',()=>{
  for(const discount of ['0.001','-1','1e2','bad']){
    const x=intent();x.discount=discount;
    assert.throws(()=>checkout(x,sale()),/decimal|amount|discount|two decimal|out of range/i);
  }
  assert.throws(()=>checkout({...intent(),lines:[]},sale()),/cart|line|empty/i);
});

test('source Cash-only partial sale conserves exact Customer due without any Party synthesis',()=>{
  const x=intent();
  x.discount='0.01';
  x.payments=[{id:'C',method:'Cash',amount:'300'}];
  const result=checkout(x,sale());
  assert.equal(result.subtotal,1400);
  assert.equal(result.grandTotal,1399.99);
  assert.equal(result.allocation.paidAmount,300);
  assert.equal(result.allocation.dueAmount,1099.99);
  assert.equal(result.allocation.paymentStatus,'Partial');
  assert.equal(Object.hasOwn(result,'customerId'),false);
});

test('source zero-total discount clamp allows empty payment but rejects Cash tender for zero',()=>{
  const x=intent();
  x.discount='2000';x.payments=[];
  const out=checkout(x,sale());
  assert.equal(out.grandTotal,0);
  assert.equal(out.allocation.paymentStatus,'Paid');
  x.payments=[{id:'C',method:'Cash',amount:1}];
  assert.throws(()=>checkout(x,sale()),/zero-value invoice/);
});

test('source Bank/Mobile overpayment, inactive account, mismatched account and duplicated Cash are rejected',()=>{
  for(const change of [
    x=>{x.payments=[{id:'B',method:'Bank',accountId:'BANK-1',amount:2000}];},
    x=>{x.payments=[{id:'M',method:'Mobile Banking',accountId:'BANK-1',amount:10}];},
    x=>{x.payments=[{id:'C-1',method:'Cash',amount:10},{id:'C-2',method:'Cash',amount:10}];}
  ]){
    const x=intent();change(x);
    assert.throws(()=>checkout(x,sale()),/exceed|account type|Cash row/i);
  }
  const snapshot=sale();
  snapshot.bankAccounts[0].Status='Inactive';
  assert.throws(()=>checkout(intent(),snapshot),/active payment account/i);
});

test('Negative and Vendor shortfall stay distinct read-only shortage modes',()=>{
  const snapshot=sale();snapshot.products[0]['Current Stock']=140;
  const input=intent();input.lines[0].shortageMode='Own';
  assert.throws(()=>checkout(input,snapshot),/Owned stock shortage/);
  input.lines[0].shortageMode='Negative';
  const neg=checkout(input,snapshot);
  assert.equal(neg.lines[0].shortageMode,'Negative');
  assert.equal(neg.lines[0].shortfallBaseQty,0,
    'Original Negative planner draws existing 145 positive FIFO lots; net stock is not a new posting engine');
  input.lines[0].shortageMode='Vendor';
  const vendor=checkout(input,snapshot);
  assert.equal(vendor.lines[0].shortfallBaseQty,5);
  assert.deepEqual(vendor.lines[0].fifoDraws.map(d=>d.baseQty),[100,40]);
});

test('plain input and server snapshots disallow getters/accessors and absent bank array',()=>{
  const bad=sale();
  Object.defineProperty(bad.bankAccounts[0],'Bank Account ID',{get:()=> 'BANK-1'});
  assert.throws(()=>checkout(intent(),bad),/trusted|accessor|account/i);
  const second=sale();delete second.bankAccounts;
  assert.throws(()=>checkout(intent(),second),/trusted|account|snapshot/i);
  const x=intent();
  Object.defineProperty(x.payments[0],'amount',{get:()=> 100});
  assert.throws(()=>checkout(x,sale()),/trusted|accessor|payment/i);
});
