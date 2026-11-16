import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectPostedSaleInvoice} from '../src/modules/sale-invoice-read-model.js';

// Source-shaped original checkout and independently supplied later settlement.
// Pure read projection only: neither test nor model posts or edits money.
function printInvoice(original={},settlement={
  paidAmount:95,dueAmount:5,customerCreditUsed:5,
  paymentType:'Partial',paymentStatus:'Partial'
}){
  const invoiceId='INV-ORIGINAL-100';
  return projectPostedSaleInvoice(invoiceId,{
    sales:[{
      'Invoice ID':invoiceId,'Date':'2026-11-15','Time':'09:05:00',
      'Grand Total':'100.00','Subtotal':'100.00','Discount':'0.00',
      'Paid Amount':'70.00','Due Amount':'30.00',
      'Payment Detail Version':'','Payment Method':'Cash',
      'Payment Type':'Partial','Payment Status':'Partial',
      'Customer ID':'CUS-1','Is Deleted':'FALSE',...original
    }],
    items:[],products:[],customers:[],paymentRows:[],
    settings:{'Invoice Payment Terms Days':0},
    shop:{name:'Original Shop'},settlement
  });
}

test('legitimate original checkout remains distinct from later customer settlement when reprinted',()=>{
  const result=printInvoice();
  assert.equal(result.grandTotal,'100.00');
  assert.equal(result.originalPaidAmount,70);
  assert.equal(result.paidAmount,95);
  assert.equal(result.dueAmount,5);
  assert.equal(result.customerCreditUsed,5);
  assert.equal(result.payments[0].applied,70);
});

test('posted invoice refuses original Paid + Due that disagrees with Grand, even if later settlement looks valid',()=>{
  const cases=[
    {'Due Amount':'30.01'},
    {'Paid Amount':'70.01'},
    {'Grand Total':'99.99'},
    {'Due Amount':'29.99'}
  ];
  for(const overrides of cases){
    assert.throws(()=>printInvoice(overrides),
      /NEEDS_REVIEW: posted invoice original checkout totals mismatch/,
      JSON.stringify(overrides));
  }
});

test('posted invoice refuses missing, negative, or sub-paisa original money instead of inventing a balanced receipt',()=>{
  const cases=[
    {'Due Amount':-1},
    {'Due Amount':'30.001'},
    {'Grand Total':'100.001'},
    {'Paid Amount':'70.001'},
    {'Due Amount':undefined},
    {'Grand Total':undefined}
  ];
  for(const overrides of cases){
    assert.throws(()=>printInvoice(overrides),
      /NEEDS_REVIEW: posted invoice original checkout totals mismatch/,
      JSON.stringify(overrides));
  }
});

test('fully due and fully cash original checkouts can be printed without creating Party or new payments',()=>{
  const allDue=printInvoice({
    'Paid Amount':0,'Due Amount':100,'Payment Detail Version':'1'
  },null);
  assert.equal(allDue.originalPaidAmount,0);
  assert.equal(allDue.payments.length,0);
  const paid=printInvoice({
    'Paid Amount':100,'Due Amount':0,'Customer ID':''
  },null);
  assert.equal(paid.originalPaidAmount,100);
  assert.equal(paid.payments[0].applied,100);
  assert.equal(paid.customerId,'');
});
