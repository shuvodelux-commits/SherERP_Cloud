import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSaleUpdateOracle} from './fixtures/m06-sale-update-source-oracle.mjs';
import {createNativeSplitUpdateOracle} from './fixtures/m06-split-sale-update-oracle.mjs';
import {createNativeSalePaymentOracle} from './fixtures/m06-payment-source-oracle.mjs';
import {planReviewedSplitSaleUpdate} from '../src/modules/reviewed-split-sale-update-intent.js';

const originalUpdate=createNativeSaleUpdateOracle();
const originalSplit=createNativeSplitUpdateOracle();
const originalPayment=createNativeSalePaymentOracle();
const id='INV-900';
const copy=value=>structuredClone(value);

function fixture(){
  return {
    invoiceId:id,
    sales:[{
      'Invoice ID':id,'Is Deleted':'FALSE','Created At':'2026-11-15T10:20:00.000Z',
      'Date':'2026-11-15','Time':'16:20:00','Subtotal':100,'Grand Total':100,
      'Customer ID':'CUS-REAL','Customer Name':'Actual Customer',
      'Customer Phone':'01700000000','Customer Address':'Original Address',
      'Discount':0,'Paid Amount':70,'Due Amount':30,
      'Payment Detail Version':'1','Payment Method':'Multiple',
      'Bank Account ID':''
    }],
    items:[{'Invoice ID':id,'Product ID':'PIPE','Product Name':'Pipe',
      'Quantity':2,'Unit Price':50,'Line Total':100,'Sold Product Type':'Standard'}],
    paymentRows:[
      {'Invoice ID':id,'Payment ID':'OLD-C','Revision':1,'Row Order':1,
        'Status':'Active','Method':'Cash','Bank Account ID':'',
        'Tendered Amount':50,'Applied Amount':40,'Change Amount':10},
      {'Invoice ID':id,'Payment ID':'OLD-B','Revision':1,'Row Order':2,
        'Status':'Active','Method':'Bank','Bank Account ID':'BANK-1',
        'Bank Account Name':'Business Bank',
        'Tendered Amount':30,'Applied Amount':30,'Change Amount':0}
    ],
    returnItems:[],
    sessions:[{'Session ID':'CS-ORIGINAL','Opened At':'2026-11-15T09:00:00.000Z',
      Status:'Open'}],
    bundleComponents:[],vendorSourcing:[],
    cashBookRows:[{'Reference':id,'Type':'Sale','Credit':40,'Debit':''}],
    bankBookRows:[{'Reference':id,'Type':'Sale','Bank Account ID':'BANK-1',
      'Credit':30,'Debit':''}],
    currentSettlement:{paidAmount:70,dueAmount:30},
    newItems:[{productId:'PIPE',name:'Pipe',qty:2,unitPrice:55}],
    discount:0,
    newPayments:[
      {id:'NEW-C',method:'Cash',amount:70,accountId:''},
      {id:'NEW-B',method:'Bank',amount:30,accountId:'BANK-1'}
    ],
    bankAccounts:[{'Bank Account ID':'BANK-1','Account Name':'Business Bank',
      'Account Type':'Bank','Status':'Active','Is Deleted':'FALSE'}]
  };
}

function sourceIntent(input){
  const original=originalUpdate.project(id,input,{canEditSales:true});
  const preview=originalSplit.project({
    invoiceId:id,sale:input.sales[0],oldItems:input.items,
    newItems:input.newItems,discount:input.discount,
    payments:input.newPayments,bankAccounts:input.bankAccounts
  });
  const previous=originalPayment.breakdown(copy(input.sales[0]),copy(input.paymentRows));
  originalPayment.assertBookEvidence(id,previous,
    copy(input.cashBookRows),copy(input.bankBookRows));
  const accountDeltas=originalPayment.accountDeltas(
    previous,preview.allocation.payments);
  return {original,preview,accountDeltas};
}
function compare(input=fixture()){
  const before=copy(input);
  const source=sourceIntent(input);
  const actual=planReviewedSplitSaleUpdate(input,{canEditSales:true});
  assert.deepEqual(actual.original,source.original);
  assert.deepEqual(actual.preview,source.preview);
  assert.deepEqual(actual.accountDeltas,source.accountDeltas);
  assert.deepEqual(input,before,'A reviewed Sales Update intent cannot mutate source evidence');
  return actual;
}

test('composes source update eligibility, split repricing and immutable old Cash/Bank payment evidence',()=>{
  const result=compare();
  assert.equal(result.original.customerId,'CUS-REAL');
  assert.equal(result.original.items[0].lineTotal,100);
  assert.equal(result.preview.subtotal,110);
  assert.equal(result.preview.grandTotal,110);
  assert.equal(result.preview.allocation.paidAmount,100);
  assert.equal(result.preview.allocation.dueAmount,10);
  assert.equal(result.nextRevision,2);
  assert.deepEqual(result.reversedPaymentIds,['OLD-C','OLD-B']);
  assert.deepEqual(result.accountDeltas,[{method:'Cash',accountId:'',amount:30}]);
});

test('cash tender change is metadata; only applied delta reaches signed payment-intent evidence',()=>{
  const data=fixture();
  data.newPayments[0].amount=100;
  const result=compare(data);
  assert.equal(result.preview.allocation.changeAmount,20);
  assert.equal(result.preview.allocation.payments[0].applied,80);
  assert.deepEqual(result.accountDeltas,[{method:'Cash',accountId:'',amount:40}]);
});

test('original version-1 entirely due sale accepts zero child rows and creates revision 1',()=>{
  const data=fixture();
  data.sales[0]['Paid Amount']=0;
  data.sales[0]['Due Amount']=100;
  data.paymentRows=[];
  data.cashBookRows=[];
  data.bankBookRows=[];
  data.currentSettlement={paidAmount:0,dueAmount:100};
  data.newPayments=[{id:'NEW-C',method:'Cash',amount:40,accountId:''}];
  const result=compare(data);
  assert.equal(result.nextRevision,1);
  assert.deepEqual(result.reversedPaymentIds,[]);
  assert.equal(result.preview.allocation.dueAmount,70);
  assert.deepEqual(result.accountDeltas,[{method:'Cash',accountId:'',amount:40}]);
});

test('closed original session, return, deleted or duplicate invoice blocks any new edit proposal',()=>{
  for(const change of [
    d=>{d.sessions[0].Status='Closed'},
    d=>{d.sessions.push({'Session ID':'NEW','Opened At':'2026-11-15T11:00:00.000Z',Status:'Open'});d.sessions[0].Status='Closed'},
    d=>{d.returnItems.push({'Invoice ID':id,'Return ID':'RET-1'})},
    d=>{d.sales[0]['Is Deleted']='TRUE'},
    d=>{d.sales.push({...d.sales[0],'Customer ID':'CUS-DUP'})}
  ]){
    const data=fixture();change(data);
    assert.throws(()=>originalUpdate.project(id,data,{canEditSales:true}));
    assert.throws(()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),/session|return|deleted|duplicate/i);
  }
});

test('later Customer settlement or advance usage refuses historical payment rewrite',()=>{
  for(const settlement of [
    {paidAmount:80,dueAmount:20},{paidAmount:60,dueAmount:40},
    {paidAmount:70.005,dueAmount:29.995}
  ]){
    const data=fixture();data.currentSettlement=settlement;
    assert.throws(()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),/settlement|reconcile|decimal/i);
  }
});

test('original Cash/Bank book mismatches fail closed before computing account deltas',()=>{
  for(const change of [
    d=>{d.cashBookRows[0].Credit=39},
    d=>{d.bankBookRows[0].Credit=29.99},
    d=>{d.bankBookRows[0]['Bank Account ID']='BANK-OTHER'},
    d=>{d.bankBookRows=[]}
  ]){
    const data=fixture();change(data);
    assert.throws(()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),/book|integrity|review/i);
  }
});

test('payment corruption, non-v1 version and unsafe next revision all fail closed',()=>{
  for(const change of [
    d=>{d.paymentRows[0]['Change Amount']=11},
    d=>{d.paymentRows[1]['Revision']=2},
    d=>{d.sales[0]['Payment Detail Version']=''},
    d=>{d.sales[0]['Payment Detail Version']='2'},
    d=>{d.paymentRows.push({'Invoice ID':id,'Revision':Number.MAX_SAFE_INTEGER,'Status':'Reversed'})}
  ]){
    const data=fixture();change(data);
    assert.throws(()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),/payment|version|revision|integrity|range/i);
  }
});

test('trusted Sales edit authorization and complete original evidence are mandatory',()=>{
  assert.throws(()=>planReviewedSplitSaleUpdate(fixture(),{}),/permission|auth/i);
  assert.throws(()=>planReviewedSplitSaleUpdate(fixture(),{canEditSales:false}),/permission|auth/i);
  for(const key of [
    'sales','items','paymentRows','returnItems','sessions','bundleComponents',
    'vendorSourcing','cashBookRows','bankBookRows','currentSettlement',
    'newItems','newPayments','bankAccounts'
  ]){
    const data=fixture();delete data[key];
    assert.throws(()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),
      /trusted|snapshot|missing|array|settlement/i);
  }
});

test('header mismatch, getters and prototype-based records cannot smuggle financial fields',()=>{
  const wrong=fixture();wrong.invoiceId='INV-OTHER';
  assert.throws(()=>planReviewedSplitSaleUpdate(wrong,{canEditSales:true}),/invoice|not found|mismatch/i);
  const hidden=fixture();hidden.sales[0]=Object.create({'Invoice ID':id});
  assert.throws(()=>planReviewedSplitSaleUpdate(hidden,{canEditSales:true}),/trusted|record|plain/i);
  const getter=fixture();
  Object.defineProperty(getter.newPayments[0],'amount',{get:()=> 70});
  assert.throws(()=>planReviewedSplitSaleUpdate(getter,{canEditSales:true}),/accessor|trusted|record/i);
});

test('source original Customer ID cannot be replaced by a same-phone different Party',()=>{
  const data=fixture();
  data.sales[0]['Customer ID']='CUS-OTHER';
  data.sales[0]['Customer Name']='Same Phone Different ID';
  const result=compare(data);
  assert.equal(result.original.customerId,'CUS-OTHER');
  assert.equal(result.preview.invoiceId,id);
  assert.equal(Object.hasOwn(result.preview,'customerId'),false);
});


test('reviewed split Sale Update refuses unreconciled original checkout before proposing any correction',()=>{
  for(const mutate of [
    d=>{
      d.sales[0]['Due Amount']='30.01';
      d.currentSettlement.dueAmount=30.01;
    },
    d=>{
      d.sales[0]['Grand Total']='99.99';
    }
  ]){
    const data=fixture();
    mutate(data);
    const before=copy(data);
    assert.throws(
      ()=>planReviewedSplitSaleUpdate(data,{canEditSales:true}),
      /NEEDS_REVIEW: original reviewed Sale Update checkout totals mismatch/
    );
    assert.deepEqual(data,before,'Rejected historical source must remain unmodified');
  }
});
