import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSplitUpdateOracle} from './fixtures/m06-split-sale-update-oracle.mjs';
import {planSplitSaleUpdatePreview} from '../src/modules/split-sale-update-preview.js';

const native=createNativeSplitUpdateOracle();
const snapshot=()=>({
  invoiceId:'INV-777',
  sale:{
    'Invoice ID':'INV-777','Payment Detail Version':'1','Is Deleted':'FALSE',
    'Customer ID':'CUS-5','Paid Amount':30,'Due Amount':15
  },
  oldItems:[{
    'Invoice ID':'INV-777','Product ID':'PIPE',
    'Quantity':'2','Unit Price':'25','Line Total':'49.995'
  }],
  newItems:[{productId:'PIPE',name:'Pipe',qty:2,unitPrice:25}],
  discount:5,
  payments:[
    {id:'C1',method:'Cash',amount:30,accountId:''},
    {id:'B1',method:'Bank',amount:20,accountId:'BANK-1'}
  ],
  bankAccounts:[
    {'Bank Account ID':'BANK-1','Account Type':'Bank','Status':'Active',
     'Account Name':'Shop Bank','Is Deleted':'FALSE'},
    {'Bank Account ID':'MOBILE-1','Account Type':'Mobile Banking','Status':'Active',
     'Account Name':'Wallet','Is Deleted':'FALSE'}
  ]
});
const compare=(input=snapshot())=>{
  const before=structuredClone(input);
  const original=native.project(input);
  const actual=planSplitSaleUpdatePreview(input,{canEditSales:true});
  assert.deepEqual(actual,original);
  assert.deepEqual(input,before,'Preview must never mutate sale, bank, lines or tender.');
  return actual;
};

test('source-exact split checkout preserves auto-priced fractional historical line and rounds subtotal',()=>{
  const result=compare();
  assert.equal(result.lines[0].lineTotal,49.995);
  assert.equal(result.subtotal,50);
  assert.equal(result.discount,5);
  assert.equal(result.grandTotal,45);
  assert.equal(result.allocation.paidAmount,45);
  assert.equal(result.allocation.dueAmount,0);
  assert.equal(result.allocation.changeAmount,5);
  assert.equal(result.allocation.paymentMethod,'Multiple');
  assert.equal(result.allocation.payments[0].change,5);
  assert.equal(result.allocation.payments[1].bankAccountId,'BANK-1');
});

test('changing visible price recomputes historical line and Cash change using original source',()=>{
  const input=snapshot();
  input.newItems[0].unitPrice=26;
  const result=compare(input);
  assert.equal(result.lines[0].lineTotal,52);
  assert.equal(result.grandTotal,47);
  assert.equal(result.allocation.paidAmount,47);
  assert.equal(result.allocation.changeAmount,3);
});

test('split tender shortfall is a partial due sale; original customer amounts are not posted or inferred',()=>{
  const input=snapshot();
  input.payments=[
    {id:'C1',method:'Cash',amount:10,accountId:''},
    {id:'B1',method:'Bank',amount:20,accountId:'BANK-1'}
  ];
  const original=structuredClone(input.sale);
  const result=compare(input);
  assert.equal(result.allocation.paidAmount,30);
  assert.equal(result.allocation.dueAmount,15);
  assert.equal(result.allocation.paymentType,'Partial');
  assert.equal(result.allocation.paymentStatus,'Partial');
  assert.deepEqual(input.sale,original);
});

test('Mobile Banking requires exact active account type and retains unique payment account',()=>{
  const input=snapshot();
  input.payments=[
    {id:'M1',method:'Mobile Banking',amount:20,accountId:'MOBILE-1'},
    {id:'C1',method:'Cash',amount:25,accountId:''}
  ];
  const result=compare(input);
  assert.equal(result.allocation.dueAmount,0);
  assert.equal(result.allocation.payments[0].method,'Mobile Banking');
  assert.equal(result.allocation.payments[0].bankAccountId,'MOBILE-1');
});

test('blank discount is zero; a discount above subtotal clamps grand total to zero',()=>{
  const noDiscount=snapshot();
  noDiscount.discount='';
  noDiscount.payments=[{id:'C1',method:'Cash',amount:50,accountId:''}];
  const full=compare(noDiscount);
  assert.equal(full.discount,0);
  assert.equal(full.grandTotal,50);
  const free=snapshot();
  free.discount=100;
  free.payments=[];
  const result=compare(free);
  assert.equal(result.grandTotal,0);
  assert.equal(result.allocation.paidAmount,0);
  assert.equal(result.allocation.dueAmount,0);
});

test('source split allocator rejects unbalanced bank, wrong account and cash overpayment of free sale',()=>{
  const cases=[
    x=>{x.payments=[{id:'B1',method:'Bank',amount:46,accountId:'BANK-1'}]},
    x=>{x.payments=[{id:'B1',method:'Bank',amount:20,accountId:'MOBILE-1'}]},
    x=>{x.bankAccounts[0].Status='Inactive'},
    x=>{x.discount=100;x.payments=[{id:'C1',method:'Cash',amount:1,accountId:''}]},
    x=>{x.payments.push({id:'C1',method:'Cash',amount:1,accountId:''})}
  ];
  for(const alter of cases){
    const input=snapshot();alter(input);
    assert.throws(()=>native.project(input));
    assert.throws(()=>planSplitSaleUpdatePreview(input,{canEditSales:true}));
  }
});

test('missing edit capability, deleted or mismatched original invoice, legacy version refuse preview',()=>{
  assert.throws(()=>planSplitSaleUpdatePreview(snapshot(),{canEditSales:false}),/permission|authorize/i);
  for(const mutate of [
    x=>{x.sale['Is Deleted']='TRUE'},
    x=>{x.sale['Invoice ID']='INV-OTHER'},
    x=>{x.sale['Payment Detail Version']=''},
    x=>{x.sale['Payment Detail Version']='2'},
    x=>{x.invoiceId=''}
  ]){
    const input=snapshot();mutate(input);
    assert.throws(()=>planSplitSaleUpdatePreview(input,{canEditSales:true}),/invoice|version|deleted|trusted/i);
  }
});

test('duplicate edited products and invalid amounts fail before preparing any allocation',()=>{
  const dupe=snapshot();
  dupe.newItems.push({...dupe.newItems[0]});
  assert.throws(()=>planSplitSaleUpdatePreview(dupe,{canEditSales:true}),/duplicate/i);
  for(const v of [-1,'INVALID',Infinity,NaN]){
    const input=snapshot();input.discount=v;
    assert.throws(()=>planSplitSaleUpdatePreview(input,{canEditSales:true}),/discount|amount|finite/i);
  }
  const invalid=snapshot();
  invalid.newItems[0].qty=0;
  assert.throws(()=>planSplitSaleUpdatePreview(invalid,{canEditSales:true}),/quantity/i);
});

test('malformed or accessor-backed row inputs cannot execute as trusted server data',()=>{
  for(const key of ['sale','oldItems','newItems','payments','bankAccounts']){
    const x=snapshot();delete x[key];
    assert.throws(()=>planSplitSaleUpdatePreview(x,{canEditSales:true}),/trusted|snapshot|array|record/i);
  }
  const row=snapshot();
  Object.defineProperty(row.bankAccounts[0],'Status',{get:()=> 'Active'});
  assert.throws(()=>planSplitSaleUpdatePreview(row,{canEditSales:true}),/accessor|trusted|record/i);
  const inherited=snapshot();
  inherited.sale=Object.create({'Invoice ID':'INV-777'});
  assert.throws(()=>planSplitSaleUpdatePreview(inherited,{canEditSales:true}),/trusted|record/i);
});

test('all-due split invoice with no payment rows uses native zero tender state',()=>{
  const input=snapshot();
  input.payments=[];
  const r=compare(input);
  assert.equal(r.allocation.paidAmount,0);
  assert.equal(r.allocation.dueAmount,45);
  assert.equal(r.allocation.paymentStatus,'Due');
  assert.deepEqual(r.allocation.payments,[]);
});
