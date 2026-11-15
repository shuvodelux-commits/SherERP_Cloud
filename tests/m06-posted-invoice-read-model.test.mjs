import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinnedPostedInvoice} from './fixtures/m06-posted-invoice-oracle.mjs';
import {projectPostedSaleInvoice} from '../src/modules/sale-invoice-read-model.js';

const json=value=>JSON.parse(JSON.stringify(value));
const basic=()=>({
  invoiceId:'INV-100',
  sales:[{
    'Invoice ID':'INV-100','Date':'2026-11-15T10:45:00',
    'Time':'1899-12-30T17:35:01',
    'Customer ID':'CUS-2','Customer Name':'Customer Two',
    'Customer Phone':'01700000000','Customer Address':'Rajshahi',
    'Customer Relation Type':'Husband','Customer Relation Name':'Rahim',
    'Subtotal':100,'Discount':0,'Grand Total':100,'Paid Amount':70,
    'Due Amount':30,'Payment Type':'Partial','Payment Status':'Partial',
    'Payment Method':'Multiple','Bank Account ID':'','Bank Account Name':'',
    'Payment Detail Version':'1','Is Deleted':'FALSE'
  }],
  items:[
    {'Invoice ID':'INV-100','Product ID':'PIPE','Product Name':'Pipe',
      'Quantity':2,'Unit Price':50,'Line Total':100,
      'Supplier ID':'SUP-1','Supplier Name':'Supplier One'},
    {'Invoice ID':'INV-OTHER','Product ID':'OTHER','Product Name':'Other',
      'Quantity':1,'Unit Price':999,'Line Total':999}
  ],
  products:[
    {'Product ID':'PIPE','Unit':'Feet'},
    {'Product ID':'OTHER','Unit':'Pcs'}
  ],
  customers:[
    {'Customer ID':'CUS-1','Phone':'01700000000','Father Name':'Wrong Father'},
    {'Customer ID':'CUS-2','Phone':'01700000000','Father Name':'Original Father'}
  ],
  paymentRows:[
    {'Invoice ID':'INV-100','Payment ID':'PAY-C1','Row Order':1,'Revision':1,
      'Method':'Cash','Bank Account ID':'','Bank Account Name':'',
      'Tendered Amount':50,'Applied Amount':40,'Change Amount':10,'Status':'Active'},
    {'Invoice ID':'INV-100','Payment ID':'PAY-B1','Row Order':2,'Revision':1,
      'Method':'Bank','Bank Account ID':'BANK-1','Bank Account Name':'Shop Bank',
      'Tendered Amount':30,'Applied Amount':30,'Change Amount':0,'Status':'Active'}
  ],
  settings:{'Invoice Payment Terms Days':7,'Shop Name':'Example Shop'},
  settlement:{paidAmount:90,dueAmount:10,customerCreditUsed:5,
    paymentType:'Partial',paymentStatus:'Partial'}
});

function project(input){
  const source=pinnedPostedInvoice(json(input));
  const rendered=projectPostedSaleInvoice(input.invoiceId,{
    sales:input.sales,items:input.items,products:input.products,
    customers:input.customers,paymentRows:input.paymentRows,
    settings:input.settings,shop:source.shop,settlement:input.settlement
  });
  assert.deepEqual(json(rendered),source);
  return rendered;
}
function outcome(call){
  try{return {ok:true,value:json(call())}}catch(e){return {ok:false,error:e.message}}
}

test('posted split-tender invoice equals native source, including Cash change and immutable checkout payment',()=>{
  const input=basic(),before=json(input);
  const actual=project(input);
  assert.equal(actual.invoiceId,'INV-100');
  assert.equal(actual.originalPaidAmount,70);
  assert.equal(actual.paidAmount,90);
  assert.equal(actual.dueAmount,10);
  assert.equal(actual.customerCreditUsed,5);
  assert.equal(actual.payments[0].change,10);
  assert.equal(actual.payments[0].applied,40);
  assert.equal(actual.payments[1].bankAccountId,'BANK-1');
  assert.equal(actual.items.length,1);
  assert.equal(actual.items[0].unit,'Feet');
  assert.deepEqual(input,before);
});

test('reprint without later settlement falls back to original payment status, not mutated payment rows',()=>{
  const input=basic();
  input.settlement=null;
  const actual=project(input);
  assert.equal(actual.paidAmount,70);
  assert.equal(actual.dueAmount,30);
  assert.equal(actual.paymentStatus,'Partial');
  assert.equal(actual.originalPaidAmount,70);
});

test('legacy invoice synthesizes exactly one historical tender without SALE_PAYMENTS',()=>{
  const input=basic();
  Object.assign(input.sales[0],{
    'Payment Detail Version':'','Payment Method':'Mobile Banking',
    'Bank Account ID':'MOB-1','Bank Account Name':'Mobile Wallet'
  });
  input.paymentRows=[];
  const actual=project(input);
  assert.equal(actual.paymentDetailVersion,'');
  assert.deepEqual(actual.payments,[{
    rowId:'legacy',method:'Mobile Banking',bankAccountId:'MOB-1',
    bankAccountName:'Mobile Wallet',tendered:70,applied:70,change:0,legacy:true
  }]);
});

test('version 1 all-due invoice legitimately has zero payment rows',()=>{
  const input=basic();
  Object.assign(input.sales[0],{
    'Paid Amount':0,'Due Amount':100,'Payment Status':'Due','Payment Type':'Due'
  });
  input.paymentRows=[];
  input.settlement=null;
  const actual=project(input);
  assert.deepEqual(actual.payments,[]);
  assert.equal(actual.originalPaidAmount,0);
  assert.equal(actual.dueAmount,100);
});

test('legacy Father fallback uses exact selected Customer ID despite duplicate phone',()=>{
  const input=basic();
  input.sales[0]['Customer Relation Type']='';
  input.sales[0]['Customer Relation Name']='';
  const actual=project(input);
  assert.equal(actual.customerId,'CUS-2');
  assert.equal(actual.customerFatherName,'Original Father');
  assert.equal(actual.customerRelationType,'Father');
});

test('new Husband snapshot remains immutable even when current Customer relation master changed',()=>{
  const input=basic();
  input.customers[1]['Father Name']='Changed Later';
  const actual=project(input);
  assert.equal(actual.customerFatherName,'Rahim');
  assert.equal(actual.customerRelationType,'Husband');
});

test('cash walk-in invoice retains blank Customer ID, not an inferred Party/customer',()=>{
  const input=basic();
  Object.assign(input.sales[0],{
    'Customer ID':'','Customer Name':'Walk-in',
    'Customer Relation Type':'Father','Customer Relation Name':''
  });
  const actual=project(input);
  assert.equal(actual.customerId,'');
  assert.equal(actual.customerFatherName,'');
});

test('year-end due date and time-only input preserve source print date/time',()=>{
  const input=basic();
  input.sales[0]['Date']='2026-12-28T00:00:00';
  input.sales[0]['Time']='09:03';
  const actual=project(input);
  assert.equal(actual.date,'2026-12-28');
  assert.equal(actual.dueDate,'2027-01-04');
  assert.equal(actual.time,'09:03:00');
});

test('zero payment terms hides the due-date row instead of inventing a date',()=>{
  const input=basic();
  input.settings['Invoice Payment Terms Days']=0;
  assert.equal(project(input).dueDate,'');
});

test('deleted invoice fails closed and excludes printed financial details',()=>{
  const input=basic();
  input.sales[0]['Is Deleted']='TRUE';
  const source=outcome(()=>pinnedPostedInvoice(json(input)));
  const actual=outcome(()=>projectPostedSaleInvoice(input.invoiceId,{
    sales:input.sales,items:input.items,products:input.products,
    customers:input.customers,paymentRows:input.paymentRows,
    settings:input.settings,shop:{},settlement:input.settlement
  }));
  assert.deepEqual(actual,source);
});

test('missing invoice and duplicate invoice IDs refuse reprinting',()=>{
  for(const mutate of [
    i=>{i.sales=[]},
    i=>{i.sales.push({...i.sales[0]})}
  ]){
    const input=basic();mutate(input);
    const source=outcome(()=>pinnedPostedInvoice(json(input)));
    const actual=outcome(()=>projectPostedSaleInvoice(input.invoiceId,{
      sales:input.sales,items:input.items,products:input.products,
      customers:input.customers,paymentRows:input.paymentRows,
      settings:input.settings,shop:{},settlement:input.settlement
    }));
    assert.equal(actual.ok,false);
    assert.deepEqual(actual,source);
  }
});

test('corrupt payment revision, duplicate order and inconsistent paid sum are refused',()=>{
  for(const mutate of [
    i=>{i.paymentRows[1]['Revision']=2},
    i=>{i.paymentRows[1]['Row Order']=1},
    i=>{i.paymentRows[1]['Applied Amount']=31},
    i=>{i.sales[0]['Payment Detail Version']='2'}
  ]){
    const input=basic();mutate(input);
    const source=outcome(()=>pinnedPostedInvoice(json(input)));
    const actual=outcome(()=>projectPostedSaleInvoice(input.invoiceId,{
      sales:input.sales,items:input.items,products:input.products,
      customers:input.customers,paymentRows:input.paymentRows,
      settings:input.settings,shop:{},settlement:input.settlement
    }));
    assert.equal(actual.ok,false);
    assert.deepEqual(actual,source);
  }
});

test('deleted product has blank unit fallback but keeps original invoice line',()=>{
  const input=basic();
  input.products=[];
  const actual=project(input);
  assert.equal(actual.items[0].unit,'');
  assert.equal(actual.items[0].name,'Pipe');
});

test('missing trusted input groups cannot become an apparently complete printed invoice',()=>{
  const input=basic();
  assert.throws(()=>projectPostedSaleInvoice('INV-100',{
    sales:input.sales,items:input.items,products:input.products,
    customers:input.customers,settings:input.settings,shop:{}
  }),/paymentRows|snapshot|trusted/i);
  assert.throws(()=>projectPostedSaleInvoice('INV-100',null),/snapshot|trusted/i);
});
