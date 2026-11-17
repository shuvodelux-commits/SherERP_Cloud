import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSaleUpdateOracle} from './fixtures/m06-sale-update-source-oracle.mjs';
import {projectSaleForUpdate} from '../src/modules/sale-update-read-model.js';

const original=createNativeSaleUpdateOracle();
const invoiceId='INV-010';
const snapshot=()=>({
  sales:[{
    'Invoice ID':invoiceId,'Is Deleted':'FALSE','Created At':'2026-11-15T10:15:00.000Z',
    Date:'2026-11-15',Time:'14:20:05','Customer ID':'CUS-1','Customer Name':'Retail Buyer',
    'Customer Phone':'01700000000','Customer Address':'Shop Road',
    Discount:'5.25','Paid Amount':70,'Due Amount':30,'Payment Detail Version':'1',
    'Payment Method':'Multiple','Bank Account ID':''
  }],
  items:[{
    'Invoice ID':invoiceId,'Product ID':'PIPE','Product Name':'Pipe',
    Quantity:'2','Unit Price':'12.50','Line Total':'25.00','Sold Product Type':'Standard'
  }],
  paymentRows:[
    {'Invoice ID':invoiceId,'Payment ID':'PAY-C1','Revision':1,'Row Order':1,
      Status:'Active',Method:'Cash','Bank Account ID':'',
      'Tendered Amount':50,'Applied Amount':40,'Change Amount':10},
    {'Invoice ID':invoiceId,'Payment ID':'PAY-B1','Revision':1,'Row Order':2,
      Status:'Active',Method:'Bank','Bank Account ID':'BANK-1',
      'Bank Account Name':'Business Bank','Tendered Amount':30,'Applied Amount':30,
      'Change Amount':0}
  ],
  returnItems:[],
  sessions:[{'Session ID':'SESSION-A','Opened At':'2026-11-15T09:00:00.000Z',Status:'Open'}],
  bundleComponents:[],
  vendorSourcing:[]
});
const compare=(data=snapshot())=>{
  const before=structuredClone(data);
  const native=original.project(invoiceId,data,{canEditSales:true});
  const target=projectSaleForUpdate(invoiceId,data,{canEditSales:true});
  assert.deepEqual(target,native);
  assert.deepEqual(data,before,'Read projection must not change source rows or payments');
  return target;
};

test('source-exact Update Mode payload restores customer, split tender/change and original items',()=>{
  const result=compare();
  assert.equal(result.invoiceId,invoiceId);
  assert.equal(result.date,'2026-11-15');
  assert.equal(result.time,'14:20:05');
  assert.deepEqual(result.payments.map(p=>({method:p.method,applied:p.applied,change:p.change})),[
    {method:'Cash',applied:40,change:10},
    {method:'Bank',applied:30,change:0}
  ]);
  assert.deepEqual(result.items,[{
    productId:'PIPE',name:'Pipe',qty:2,unitPrice:12.5,
    productType:'Standard',bundleRevision:0,lineTotal:25,
    vendorId:'',vendorName:'',vendorUnitCost:0,vendorQty:0
  }]);
});

test('legacy payment detail remains source-shaped, with no invented payment children',()=>{
  const data=snapshot();
  data.sales[0]['Payment Detail Version']='';
  data.sales[0]['Payment Method']='';
  const result=compare(data);
  assert.equal(result.paymentDetailVersion,'');
  assert.deepEqual(result.payments,[]);
  assert.equal(result.paymentMethod,'Cash');
});

test('Bundle revision, saved line total and active vendor sourcing are identical to GAS',()=>{
  const data=snapshot();
  data.items.push({
    'Invoice ID':invoiceId,'Product ID':'KIT-1','Product Name':'Kit',
    Quantity:'2','Unit Price':'35','Line Total':'70','Sold Product Type':'Standard'
  });
  data.items[0]['Line Total']='';
  data.vendorSourcing.push({
    'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-1',
    'Vendor Name':'Trusted Vendor','Unit Cost':'8.75',Quantity:'1.5','Is Deleted':'FALSE'
  });
  data.vendorSourcing.push({
    'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-DELETED',
    'Vendor Name':'Deleted Vendor','Unit Cost':999,Quantity:9,'Is Deleted':'TRUE'
  });
  data.bundleComponents=[
    {'Invoice ID':invoiceId,'Bundle Product ID':'KIT-1','Bundle Revision':'3',
      'Sets Sold':'2','Component Product ID':'PIPE','Quantity Per Set':'1','Unit':'Pcs'},
    {'Invoice ID':invoiceId,'Bundle Product ID':'KIT-1','Bundle Revision':'3',
      'Sets Sold':'2','Component Product ID':'WIRE','Quantity Per Set':'1.5','Unit':'Feet'}
  ];
  const result=compare(data);
  assert.equal(result.items[0].lineTotal,25);
  assert.equal(result.items[0].vendorId,'V-1');
  assert.equal(result.items[0].vendorQty,1.5);
  assert.equal(result.items[1].productType,'Bundle');
  assert.equal(result.items[1].bundleRevision,3);
  assert.equal(result.items[1].lineTotal,70);
});

test('the latest historical session opened before sale must still be Open',()=>{
  const data=snapshot();
  data.sessions[0].Status='Closed';
  data.sessions.push({
    'Session ID':'SESSION-NEW','Opened At':'2026-11-15T12:00:00.000Z',Status:'Open'
  });
  assert.throws(()=>original.project(invoiceId,data,{canEditSales:true}),/closed Cash Session/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),/closed Cash Session/i);
});

test('returned, deleted and missing invoices are never reopened for edits',()=>{
  for(const change of [
    d=>d.returnItems.push({'Invoice ID':invoiceId,'Return ID':'RET-1'}),
    d=>{d.sales[0]['Is Deleted']='TRUE'},
    d=>{d.sales=[]}
  ]){
    const data=snapshot();change(data);
    assert.throws(()=>original.project(invoiceId,data,{canEditSales:true}),/return|delet|not found/i);
    assert.throws(()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),/return|delet|not found/i);
  }
});

test('duplicate historical headers fail closed without assigning child records',()=>{
  const data=snapshot();
  data.sales.push({...data.sales[0],'Customer ID':'CUS-DUP'});
  assert.throws(()=>original.project(invoiceId,data,{canEditSales:true}),/duplicate invoice id/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),/duplicate invoice id/i);
});

test('stored split-payment corruption cannot be ignored in Update Mode',()=>{
  const data=snapshot();
  data.paymentRows[0]['Change Amount']=11;
  assert.throws(()=>original.project(invoiceId,data,{canEditSales:true}),/integrity/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),/integrity/i);
});

test('historical bundle revision inconsistency is rejected instead of re-pricing',()=>{
  const data=snapshot();
  data.bundleComponents=[
    {'Invoice ID':invoiceId,'Bundle Product ID':'KIT-1','Bundle Revision':2,'Sets Sold':2,
      'Component Product ID':'PIPE','Quantity Per Set':1},
    {'Invoice ID':invoiceId,'Bundle Product ID':'KIT-1','Bundle Revision':3,'Sets Sold':2,
      'Component Product ID':'WIRE','Quantity Per Set':1}
  ];
  assert.throws(()=>original.project(invoiceId,data,{canEditSales:true}),/inconsistent historical bundle/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),/inconsistent historical bundle/i);
});

test('server edit permission is mandatory, and malformed snapshots fail closed',()=>{
  assert.throws(()=>original.project(invoiceId,snapshot(),{canEditSales:false}),/permission/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,snapshot(),{canEditSales:false}),/permission/i);
  assert.throws(()=>projectSaleForUpdate(invoiceId,snapshot(),{}),/permission|trusted/i);
  const malformed=snapshot();
  delete malformed.sessions;
  assert.throws(()=>projectSaleForUpdate(invoiceId,malformed,{canEditSales:true}),/trusted|session|snapshot/i);
  assert.throws(()=>projectSaleForUpdate('',snapshot(),{canEditSales:true}),/invoice/i);
});


test('ambiguous active vendor rows for one invoice/product must not silently select the last supplier',()=>{
  const data=snapshot();
  data.vendorSourcing=[
    {'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-ORIGINAL',
      'Vendor Name':'Original Supplier','Unit Cost':'7','Quantity':1,'Is Deleted':'FALSE'},
    {'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-CONFLICT',
      'Vendor Name':'Conflicting Supplier','Unit Cost':'11','Quantity':1,'Is Deleted':'FALSE'}
  ];
  assert.throws(
    ()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),
    /NEEDS_REVIEW: ambiguous historical vendor sourcing for Sales Update Mode/
  );
});

test('deleted vendor tombstones and unrelated invoice/product rows preserve native edit source parity',()=>{
  const data=snapshot();
  data.vendorSourcing=[
    {'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-ACTIVE',
      'Vendor Name':'Original Vendor','Unit Cost':'8.75','Quantity':1,'Is Deleted':'FALSE'},
    {'Invoice ID':invoiceId,'Product ID':'PIPE','Vendor ID':'V-DELETED',
      'Vendor Name':'Retired Vendor','Unit Cost':'99','Quantity':1,'Is Deleted':'TRUE'},
    {'Invoice ID':'INV-OTHER','Product ID':'PIPE','Vendor ID':'V-UNRELATED',
      'Vendor Name':'Other Invoice','Unit Cost':'10','Quantity':1,'Is Deleted':'FALSE'},
    {'Invoice ID':invoiceId,'Product ID':'UNRELATED-PRODUCT','Vendor ID':'V-OTHER',
      'Vendor Name':'Other Product','Unit Cost':'12','Quantity':1,'Is Deleted':'FALSE'}
  ];
  const result=compare(data);
  assert.equal(result.items[0].vendorId,'V-ACTIVE');
  assert.equal(result.items[0].vendorUnitCost,8.75);
});


test('unsupported historical Payment Detail Version cannot erase saved split tenders in Sale Update prefill',()=>{
  for(const version of ['2','01','v2']){
    const data=snapshot();
    data.sales[0]['Payment Detail Version']=version;
    const before=structuredClone(data);
    assert.throws(
      ()=>projectSaleForUpdate(invoiceId,data,{canEditSales:true}),
      /NEEDS_REVIEW: unsupported historical sale payment detail version in Update Mode/,
      JSON.stringify({version})
    );
    assert.deepEqual(data,before,'Unknown payment detail version must never mutate history');
  }
});

test('blank legacy and version 1 still preserve original source-shaped edit prefill',()=>{
  for(const version of ['', '1']){
    const data=snapshot();
    data.sales[0]['Payment Detail Version']=version;
    const projected=compare(data);
    assert.equal(projected.paymentDetailVersion,version);
    assert.equal(projected.paidAmount,70);
    assert.equal(projected.payments.length,version==='1'?2:0);
  }
});
