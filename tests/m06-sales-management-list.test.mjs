import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSalesListOracle} from './fixtures/m06-sales-list-oracle.mjs';
import {projectSalesManagementList} from '../src/modules/sales-management-list-read.js';

const source=createNativeSalesListOracle();
const fixture=()=>({
  sales:[
    {'Invoice ID':'INV-01','Is Deleted':'FALSE','Date':'2026-11-15',
      'Time':'13:00:00','Created At':'2026-11-15T10:30:00Z',
      'Customer ID':'CUS-1','Customer Name':'Buyer','Customer Phone':'01700000000',
      'Subtotal':100,'Grand Total':90,'Paid Amount':60,'Due Amount':30,
      'Payment Status':'Partial','Payment Type':'Partial'},
    {'Invoice ID':'INV-02','Is Deleted':'FALSE','Date':'2026-11-15',
      'Time':'12:00:00','Created At':'2026-11-15T09:00:00Z',
      'Customer ID':'','Customer Name':'Walk-in','Customer Phone':'01700000000',
      'Subtotal':50,'Grand Total':50,'Paid Amount':50,'Due Amount':0,
      'Payment Status':'Paid','Payment Type':'Paid'},
    {'Invoice ID':'INV-03','Is Deleted':'FALSE','Date':'2026-11-14',
      'Time':'11:00:00','Created At':'2026-11-14T08:30:00Z',
      'Customer ID':'CUS-3','Customer Name':'Old Buyer','Customer Phone':'01800000000',
      'Subtotal':40,'Grand Total':40,'Paid Amount':40,'Due Amount':0,
      'Payment Status':'Paid','Payment Type':'Paid'}
  ],
  items:[
    {'Invoice ID':'INV-01','Product ID':'PIPE','Quantity':2},
    {'Invoice ID':'INV-02','Product ID':'WIRE','Quantity':1},
    {'Invoice ID':'INV-03','Product ID':'WIRE','Quantity':1}
  ],
  returnItems:[],
  sessions:[
    {'Session ID':'CLOSED','Opened At':'2026-11-13T22:00:00Z',Status:'Closed'},
    {'Session ID':'OPEN','Opened At':'2026-11-15T08:00:00Z',Status:'Open'}
  ],
  bundleComponents:[],
  saleItemLots:[
    {'Invoice ID':'INV-01','Product ID':'PIPE','Quantity':2,'Unit Cost':15},
    {'Invoice ID':'INV-02','Product ID':'WIRE','Quantity':1,'Unit Cost':10},
    {'Invoice ID':'INV-03','Product ID':'WIRE','Quantity':1,'Unit Cost':12}
  ],
  vendorSourcing:[],
  settlementsByInvoice:{
    'INV-01':{paidAmount:80,dueAmount:10,customerCreditUsed:5,paymentStatus:'Partial'}
  }
});
function parity(data=fixture(),canViewProfit=false){
  const previous=structuredClone(data);
  const options={canViewSales:true,canViewProfit};
  const expected=source.project(data,options);
  const result=projectSalesManagementList(data,options);
  assert.deepEqual(result,expected);
  assert.deepEqual(data,previous,'Sales list must not mutate any supplied row');
  return result;
}

test('original Sales list order, source-shaped fields and historical session editability',()=>{
  const actual=parity();
  assert.deepEqual(actual.map(x=>x.invoiceId),['INV-01','INV-02','INV-03']);
  assert.equal(actual[0].editable,true);
  assert.equal(actual[1].editable,true);
  assert.equal(actual[2].editable,false);
  assert.deepEqual(actual.map(x=>x.returnStatus),['No Return','No Return','No Return']);
  assert.equal(actual[0].profit,undefined);
});

test('exact tracked Customer settlement replaces checkout status, not anonymous same-phone sale',()=>{
  const result=parity();
  assert.equal(result[0].paidAmount,80);
  assert.equal(result[0].dueAmount,10);
  assert.equal(result[0].customerCreditUsed,5);
  assert.equal(result[1].paidAmount,50);
  assert.equal(result[1].dueAmount,0);
  assert.equal(result[1].customerCreditUsed,0);
});

test('legacy raw-return discount is applied once, partial status blocks editing',()=>{
  const s=fixture();
  s.returnItems.push({'Invoice ID':'INV-01','Product ID':'PIPE',
    'Return Quantity':1,'Line Total':50,'Pricing Basis':''});
  s.saleItemLots[0].Quantity=1;
  const result=parity(s,true)[0];
  assert.equal(result.returnedAmount,45);
  assert.equal(result.netSale,45);
  assert.equal(result.returnStatus,'Partially Returned');
  assert.equal(result.editable,false);
  assert.equal(result.profit,30);
});

test('net-priced all-item return yields Fully Returned and no double discount',()=>{
  const s=fixture();
  s.returnItems.push({'Invoice ID':'INV-01','Product ID':'PIPE',
    'Return Quantity':2,'Line Total':90,'Pricing Basis':'NetAfterInvoiceDiscount'});
  s.saleItemLots[0].Quantity=0;
  const actual=parity(s,true)[0];
  assert.equal(actual.returnedAmount,90);
  assert.equal(actual.netSale,0);
  assert.equal(actual.returnStatus,'Fully Returned');
  assert.equal(actual.editable,false);
});

test('even zero-value active return blocks edit, although status remains No Return',()=>{
  const s=fixture();
  s.returnItems.push({'Invoice ID':'INV-01','Product ID':'PIPE',
    'Return Quantity':0,'Line Total':0,'Pricing Basis':'NetAfterInvoiceDiscount'});
  const actual=parity(s)[0];
  assert.equal(actual.returnStatus,'No Return');
  assert.equal(actual.editable,false);
});

test('duplicate historical invoice headers are visible as integrity error with no cost or net',()=>{
  const s=fixture();
  s.sales.push({...s.sales[0],'Customer ID':'CUS-OTHER','Time':'14:00:00'});
  const matching=parity(s,true).filter(x=>x.invoiceId==='INV-01');
  assert.equal(matching.length,2);
  for(const x of matching){
    assert.equal(x.duplicateInvoiceId,true);
    assert.equal(x.returnStatus,'Integrity Error');
    assert.equal(x.returnedAmount,null);
    assert.equal(x.netSale,null);
    assert.equal(x.editable,false);
    assert.equal(Object.hasOwn(x,'profit'),false);
  }
});

test('a newer open Cash Session does not permit editing old closed-session sale',()=>{
  const s=fixture();
  s.sessions[0].Status='Closed';
  const old=parity(s).find(x=>x.invoiceId==='INV-03');
  assert.equal(old.editable,false);
});

test('profit is private and sourced from physical bundle FIFO component quantities',()=>{
  const s=fixture();
  s.items[0]['Product ID']='KIT';
  s.bundleComponents=[
    {'Invoice ID':'INV-01','Bundle Product ID':'KIT',
      'Component Product ID':'PIPE','Quantity Per Set':1},
    {'Invoice ID':'INV-01','Bundle Product ID':'KIT',
      'Component Product ID':'WIRE','Quantity Per Set':2}
  ];
  s.saleItemLots=[
    {'Invoice ID':'INV-01','Product ID':'PIPE','Quantity':2,'Unit Cost':7},
    {'Invoice ID':'INV-01','Product ID':'WIRE','Quantity':4,'Unit Cost':2}
  ];
  const visible=parity(s,true)[0];
  assert.equal(visible.profit,68);
  assert.equal(visible.profitCostComplete,true);
  const hidden=parity(s,false)[0];
  for(const key of ['profit','profitMarginPercent','profitCostComplete'])
    assert.equal(Object.hasOwn(hidden,key),false);
  s.saleItemLots.pop();
  assert.equal(parity(s,true)[0].profitCostComplete,false);
});

test('valid vendor Total Cost overrides unit price and unrelated/deleted sources are excluded',()=>{
  const s=fixture();
  s.items[0]['Product ID']='VENDOR-P';
  s.saleItemLots=s.saleItemLots.filter(x=>x['Invoice ID']!=='INV-01');
  s.vendorSourcing=[
    {'Invoice ID':'INV-01','Product ID':'VENDOR-P','Quantity':2,
      'Unit Cost':20,'Total Cost':43,'Is Deleted':'FALSE'},
    {'Invoice ID':'INV-01','Product ID':'VENDOR-P','Quantity':2,
      'Unit Cost':999,'Total Cost':999,'Is Deleted':'TRUE'},
    {'Invoice ID':'INV-02','Product ID':'VENDOR-P','Quantity':1,
      'Unit Cost':999,'Total Cost':999,'Is Deleted':'FALSE'}
  ];
  const actual=parity(s,true)[0];
  assert.equal(actual.profit,47);
  assert.equal(actual.profitCostComplete,true);
});

test('missing current settlement for tracked due invoice fails closed rather than presenting old due',()=>{
  const s=fixture();delete s.settlementsByInvoice['INV-01'];
  assert.throws(()=>projectSalesManagementList(s,{
    canViewSales:true,canViewProfit:false
  }),/settlement|trusted|snapshot/i);
});

test('authorization and all snapshot row groups are required, with no inherited accessors',()=>{
  assert.throws(()=>source.project(fixture(),{canViewSales:false,canViewProfit:true}),/permission/i);
  assert.throws(()=>projectSalesManagementList(fixture(),{
    canViewSales:false,canViewProfit:true
  }),/permission/i);
  for(const name of ['returnItems','saleItemLots','vendorSourcing','bundleComponents','sessions']){
    const invalid=fixture();delete invalid[name];
    assert.throws(()=>projectSalesManagementList(invalid,{canViewSales:true}),/trusted|snapshot/i);
  }
  const data=fixture();
  Object.defineProperty(data.sales[0],'Grand Total',{get:()=>90});
  assert.throws(()=>projectSalesManagementList(data,{canViewSales:true}),/accessor|trusted|snapshot/i);
});
