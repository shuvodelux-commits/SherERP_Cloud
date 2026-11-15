import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSalesDetailOracle} from './fixtures/m06-sales-detail-oracle.mjs';
import {projectSalesManagementDetail} from '../src/modules/sales-management-detail-read.js';

const native=createNativeSalesDetailOracle();
const clone=value=>structuredClone(value);
const data=()=>({
  sales:[{
    'Invoice ID':'INV-100','Is Deleted':'FALSE','Date':'2026-11-15',
    'Time':'10:15:00','Customer ID':'CUS-1','Customer Name':'Buyer',
    'Customer Phone':'01700000000','Customer Address':'Rajshahi',
    'Customer Relation Type':'Father','Customer Relation Name':'',
    'Subtotal':100,'Discount':10,'Grand Total':90,'Paid Amount':60,'Due Amount':30,
    'Payment Type':'Partial','Payment Status':'Partial','Payment Method':'Cash',
    'Payment Detail Version':'1','Bank Account ID':'','Bank Account Name':''
  }],
  items:[{'Invoice ID':'INV-100','Product ID':'PIPE','Product Name':'Pipe',
    'Quantity':2,'Unit Price':50,'Line Total':100,'Supplier ID':'SUP-1','Supplier Name':'Supplier'}],
  products:[{'Product ID':'PIPE','Unit':'Pcs'}],
  customers:[{'Customer ID':'CUS-1','Father Name':'Father'}],
  paymentRows:[{'Invoice ID':'INV-100','Payment ID':'PAY-1','Revision':1,'Row Order':1,
    'Method':'Cash','Bank Account ID':'','Tendered Amount':60,'Applied Amount':60,
    'Change Amount':0,'Status':'Active'}],
  settings:{'Invoice Payment Terms Days':7},
  shop:{name:'Example Shop'},
  settlement:null,
  returnItems:[],
  saleItemLots:[{'Invoice ID':'INV-100','Product ID':'PIPE','Quantity':2,'Unit Cost':15}],
  vendorSourcing:[],
  bundleComponents:[]
});
function parity(snapshot=data(),canViewProfit=true){
  const before=clone(snapshot);
  const opts={canViewSales:true,canViewProfit};
  const original=native.project('INV-100',snapshot,opts);
  const target=projectSalesManagementDetail('INV-100',snapshot,opts);
  assert.deepEqual(target,original);
  assert.deepEqual(snapshot,before,'Read-only Sales detail must not mutate trusted rows');
  return target;
}

test('original posted split tender and later settlement survive Sales detail without mutation',()=>{
  const s=data();s.settlement={
    paidAmount:80,dueAmount:10,customerCreditUsed:0,
    paymentType:'Partial',paymentStatus:'Partial'
  };
  const result=parity(s,false);
  assert.equal(result.originalPaidAmount,60);
  assert.equal(result.paidAmount,80);
  assert.equal(result.payments[0].applied,60);
  assert.equal(result.items[0].supplierId,'SUP-1');
  assert.equal(Object.hasOwn(result,'profit'),false);
});

test('legacy raw returns prorate by invoice discount; net FIFO lot cost is source-faithful',()=>{
  const s=data();s.returnItems=[
    {'Invoice ID':'INV-100','Return ID':'RET-1','Product ID':'PIPE',
     'Return Quantity':1,'Line Total':50,'Pricing Basis':''}
  ];
  s.saleItemLots[0].Quantity=1;
  const result=parity(s,true);
  assert.equal(result.returnedAmount,45);
  assert.equal(result.netSale,45);
  assert.equal(result.profit,30);
  assert.equal(result.profitCostComplete,true);
  assert.equal(result.profitMarginPercent,30/45*100);
});

test('NetAfterInvoiceDiscount returns are not discounted twice',()=>{
  const s=data();
  s.returnItems=[{'Invoice ID':'INV-100','Product ID':'PIPE',
    'Return Quantity':1,'Line Total':45,'Pricing Basis':'NetAfterInvoiceDiscount'}];
  s.saleItemLots[0].Quantity=1;
  const result=parity(s,true);
  assert.equal(result.returnedAmount,45);
  assert.equal(result.profit,30);
});

test('active vendor cost overrides quantity times unit cost and cost evidence is private',()=>{
  const s=data();s.items.push({
    'Invoice ID':'INV-100','Product ID':'WIRE','Product Name':'Wire',
    'Quantity':1,'Unit Price':0,'Line Total':0
  });
  s.vendorSourcing=[
    {'Invoice ID':'INV-100','Product ID':'WIRE','Quantity':1,
      'Unit Cost':20,'Total Cost':22,'Is Deleted':'FALSE'},
    {'Invoice ID':'INV-100','Product ID':'WIRE','Quantity':1,
      'Unit Cost':999,'Total Cost':999,'Is Deleted':'TRUE'}
  ];
  const result=parity(s,true);
  assert.equal(result.profit,90-30-22);
  assert.equal(result.profitCostComplete,true);
  const hidden=parity(s,false);
  for(const key of ['profit','profitMarginPercent','profitCostComplete'])
    assert.equal(Object.hasOwn(hidden,key),false);
});

test('bundle virtual parent is costed from net physical component quantities, never phantom lot',()=>{
  const s=data();s.items=[
    {'Invoice ID':'INV-100','Product ID':'KIT-1','Product Name':'Kit',
      'Quantity':2,'Unit Price':50,'Line Total':100}
  ];
  s.returnItems=[{
    'Invoice ID':'INV-100','Product ID':'KIT-1','Return Quantity':1,
    'Line Total':45,'Pricing Basis':'NetAfterInvoiceDiscount'
  }];
  s.bundleComponents=[
    {'Invoice ID':'INV-100','Bundle Product ID':'KIT-1','Component Product ID':'PIPE',
      'Quantity Per Set':1,'Sets Sold':2,'Bundle Revision':3},
    {'Invoice ID':'INV-100','Bundle Product ID':'KIT-1','Component Product ID':'WIRE',
      'Quantity Per Set':2,'Sets Sold':2,'Bundle Revision':3}
  ];
  s.saleItemLots=[
    {'Invoice ID':'INV-100','Product ID':'PIPE','Quantity':1,'Unit Cost':8},
    {'Invoice ID':'INV-100','Product ID':'WIRE','Quantity':2,'Unit Cost':4}
  ];
  const result=parity(s,true);
  assert.equal(result.returnedAmount,45);
  assert.equal(result.profit,29);
  assert.equal(result.profitCostComplete,true);
});

test('imported invoice with missing source lot/vendor coverage never claims exact profit',()=>{
  const s=data();s.saleItemLots=[];
  const result=parity(s,true);
  assert.equal(result.profitCostComplete,false);
  assert.equal(result.profit,90);
});

test('unrelated invoice return/cost records do not enter source invoice accounting',()=>{
  const s=data();
  s.returnItems.push({'Invoice ID':'INV-OTHER','Product ID':'PIPE',
    'Return Quantity':20,'Line Total':1000,'Pricing Basis':''});
  s.saleItemLots.push({'Invoice ID':'INV-OTHER','Product ID':'PIPE','Quantity':5,'Unit Cost':999});
  s.vendorSourcing.push({'Invoice ID':'INV-OTHER','Product ID':'PIPE','Quantity':1,'Total Cost':999,'Is Deleted':'FALSE'});
  const result=parity(s,true);
  assert.equal(result.returnedAmount,0);
  assert.equal(result.profit,60);
});

test('duplicate/deleted headers and corrupted payment children fail closed before showing detail',()=>{
  for(const change of [
    s=>s.sales.push({...s.sales[0]}),
    s=>{s.sales[0]['Is Deleted']='TRUE'},
    s=>{s.paymentRows[0]['Applied Amount']=61}
  ]){
    const s=data();change(s);
    assert.throws(()=>native.project('INV-100',s,{canViewSales:true,canViewProfit:true}));
    assert.throws(()=>projectSalesManagementDetail('INV-100',s,{canViewSales:true,canViewProfit:true}));
  }
});

test('explicit Sales View authorization and complete active-row snapshots are required',()=>{
  assert.throws(()=>native.project('INV-100',data(),{canViewSales:false,canViewProfit:true}),/Permission denied/i);
  assert.throws(()=>projectSalesManagementDetail('INV-100',data(),{canViewSales:false,canViewProfit:true}),/permission/i);
  const missing=data();delete missing.bundleComponents;
  assert.throws(()=>projectSalesManagementDetail('INV-100',missing,{canViewSales:true,canViewProfit:true}),/trusted|snapshot/i);
  const missingReturns=data();delete missingReturns.returnItems;
  assert.throws(()=>projectSalesManagementDetail('INV-100',missingReturns,{canViewSales:true,canViewProfit:false}),/trusted|snapshot/i);
  assert.throws(()=>projectSalesManagementDetail('',data(),{canViewSales:true,canViewProfit:true}),/invoice/i);
});
