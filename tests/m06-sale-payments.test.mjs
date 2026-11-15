import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as migrated from '../src/modules/sale-payments.js';

// Exercise the pinned, byte-preserved GAS functions as the behavioral oracle.
const original={};
runInNewContext(readFileSync(new URL('../legacy/source/SalePayments.gs',import.meta.url),'utf8'),original);
const accounts=[
  {'Bank Account ID':'BANK-1','Account Name':'Shop Bank','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'MOB-1','Account Name':'Mobile Wallet','Account Type':'Mobile Banking',Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'OLD-1','Account Name':'Old Bank','Account Type':'Bank',Status:'Inactive','Is Deleted':'FALSE'},
  {'Bank Account ID':'DEL-1','Account Name':'Deleted Bank','Account Type':'Bank',Status:'Active','Is Deleted':'TRUE'}
];
const cash=(id,amount)=>({id,method:'Cash',amount});
const bank=(id,amount,accountId='BANK-1')=>({id,method:'Bank',amount,accountId});
const mobile=(id,amount,accountId='MOB-1')=>({id,method:'Mobile Banking',amount,accountId});
const plain=x=>JSON.parse(JSON.stringify(x));
const outcome=(fn,args)=>{
  try{return {ok:true,value:plain(fn(...structuredClone(args)))}}catch(error){return {ok:false,error:error.message}}
};
function assertSourceParity(name,args){
  assert.equal(typeof migrated[name],'function',name+' is exported');
  assert.deepEqual(outcome(migrated[name],args),outcome(original[name],args),name+' source parity');
}

test('exact-paisa parser remains source-faithful on valid, invalid and boundary inputs',()=>{
  for(const value of [0,'0','1','1.2','1.23','.01','000.05',500000.99,'90071992547409.91','',null,
    '1.234','-1','1e2','1,000','a',NaN,Infinity]){
    assertSourceParity('salePaymentPaisa_',[value,'Tender',false]);
    assertSourceParity('salePaymentPaisa_',[value,'Tender',true]);
  }
  assert.equal(migrated.salePaymentPaisa_('15.27','Cash',false),1527);
  assert.throws(()=>migrated.salePaymentPaisa_('15.271','Cash',false),/two decimal places/);
});

test('full Cash tender records applied cash only; returned change is metadata',()=>{
  const args=[100,[cash('C-1','120.00')],accounts];
  assertSourceParity('normalizeSalePayments_',args);
  const result=migrated.normalizeSalePayments_(...args);
  assert.deepEqual(plain(result),{
    payments:[{rowId:'C-1',rowOrder:1,method:'Cash',bankAccountId:'',bankAccountName:'',tendered:120,applied:100,change:20}],
    paidAmount:100,dueAmount:0,changeAmount:20,paymentType:'Cash',paymentStatus:'Paid',
    paymentMethod:'Cash',bankAccountId:'',bankAccountName:''
  });
});

test('split Cash/Bank/Mobile tender and partial customer due preserve source amounts/account identity',()=>{
  const cases=[
    [100,[bank('B-1','35.25'),mobile('M-1','22.75'),cash('C-1',50)],accounts],
    [100,[bank('B-1','40'),cash('C-1','10')],accounts],
    [100,[],accounts],
    [100,[cash('C-1','0'),bank('B-1','100')],accounts],
    [0,[],accounts],
    [0,[bank('B-1','0')],accounts]
  ];
  cases.forEach(args=>assertSourceParity('normalizeSalePayments_',args));
  const split=migrated.normalizeSalePayments_(...cases[0]);
  assert.equal(split.paidAmount,100);
  assert.equal(split.dueAmount,0);
  assert.equal(split.changeAmount,8);
  assert.equal(split.paymentMethod,'Multiple');
  assert.deepEqual(split.payments.map(p=>p.applied),[35.25,22.75,42]);
  const partial=migrated.normalizeSalePayments_(...cases[1]);
  assert.equal(partial.paidAmount,50);
  assert.equal(partial.dueAmount,50);
  assert.equal(partial.paymentType,'Partial');
  assert.equal(partial.paymentStatus,'Partial');
});

test('invalid allocations cannot pass before D1 writes: account, input, duplicate, overpay, precision',()=>{
  const invalid=[
    [100,'bad',accounts],[100,[cash('C-1',1),cash('C-2',1)],accounts],
    [100,[bank('B-1','101')],accounts],[100,[mobile('M-1',1,'BANK-1')],accounts],
    [100,[bank('B-1',1,'OLD-1')],accounts],[100,[bank('B-1',1,'DEL-1')],accounts],
    [100,[bank('B-1',1,'MISSING')],accounts],[100,[bank('B-1',1),bank('B-1',2)],accounts],
    [100,[bank('B-1','0.001')],accounts],[0,[cash('C-1',1)],accounts],
    [100,Array.from({length:21},(_,i)=>bank('B-'+i,0)),accounts],
    [100,[{id:'A',method:'Cheque',amount:1}],accounts]
  ];
  invalid.forEach(args=>{
    assertSourceParity('normalizeSalePayments_',args);
    assert.equal(outcome(migrated.normalizeSalePayments_,args).ok,false);
  });
});

test('legacy payment fallback, versioned child rows, zero-child due and integrity errors match source',()=>{
  const sale={'Invoice ID':'INV-1','Paid Amount':60,'Payment Method':'Cash','Payment Detail Version':1};
  const rows=[
    {'Invoice ID':'INV-1','Payment ID':'P1',Revision:1,'Row Order':1,Method:'Bank',
      'Bank Account ID':'BANK-1','Bank Account Name':'Shop Bank','Tendered Amount':40,'Applied Amount':40,'Change Amount':0,Status:'Active'},
    {'Invoice ID':'INV-1','Payment ID':'P2',Revision:1,'Row Order':2,Method:'Cash',
      'Bank Account ID':'','Tendered Amount':30,'Applied Amount':20,'Change Amount':10,Status:'Active'}
  ];
  const cases=[
    [sale,rows],[{...sale,'Payment Detail Version':''},rows],
    [{...sale,'Paid Amount':0},[]],[{...sale,'Paid Amount':0,'Payment Detail Version':1},[]],
    [sale,[...rows,{...rows[0],'Payment ID':'P3','Row Order':1}]],
    [sale,[...rows.map((r,i)=>({...r,Revision:i+1}))]],
    [sale,[...rows.map((r,i)=>({...r,'Applied Amount':i?10:40}))]],
    [sale,[...rows.map((r,i)=>({...r,'Change Amount':i?9:0}))]],
    [{...sale,'Payment Detail Version':2},rows]
  ];
  cases.forEach(args=>assertSourceParity('readSalePaymentBreakdown_',args));
  assert.deepEqual(migrated.readSalePaymentBreakdown_(sale,rows).map(p=>p.applied),[40,20]);
});

test('cash and bank reconciliation, immutable revisions and journal replay decisions match source',()=>{
  const previous=[{method:'Cash',applied:30},{method:'Bank',bankAccountId:'BANK-1',applied:20}];
  const next=[{method:'Cash',applied:10},{method:'Bank',bankAccountId:'BANK-1',applied:40}];
  assertSourceParity('salePaymentAccountDeltas_',[previous,next]);
  assert.deepEqual(migrated.salePaymentAccountDeltas_(previous,next),[
    {method:'Bank',accountId:'BANK-1',amount:20},{method:'Cash',accountId:'',amount:-20}
  ]);
  assertSourceParity('salePaymentNextRevision_',['INV-1',[
    {'Invoice ID':'INV-1',Revision:2},{'Invoice ID':'OTHER',Revision:7},
    {'Invoice ID':'INV-1',Revision:3}
  ]]);
  const journal={'Payload Hash':'abc',State:'Committed'};
  for(const args of [[null,'abc'],[journal,'abc'],[journal,'different'],
    [{...journal,State:'Writing'},'abc'],[{...journal,State:'Needs Review'},'abc'],
    [{...journal,State:'??'},'abc']]) assertSourceParity('salePostingJournalDecision_',args);
});

test('sale Cash/Bank book evidence uses applied amounts, never change',()=>{
  const invoice='INV-2';
  const allocations=[{method:'Cash',applied:20,tendered:30,change:10},
    {method:'Bank',bankAccountId:'BANK-1',applied:35}];
  const cashRows=[{Type:'Sale',Reference:invoice,Credit:30,Debit:0},
    {Type:'Sale Update',Reference:invoice,Credit:0,Debit:10}];
  const bankRows=[{'Bank Account ID':'BANK-1',Type:'Sale',Reference:invoice,Credit:35,Debit:0}];
  assertSourceParity('assertSalePaymentBookEvidence_',[invoice,allocations,cashRows,bankRows]);
  assert.equal(migrated.assertSalePaymentBookEvidence_(invoice,allocations,cashRows,bankRows),true);
  const bad=[{...bankRows[0],Credit:36}];
  assertSourceParity('assertSalePaymentBookEvidence_',[invoice,allocations,cashRows,bad]);
  assert.throws(()=>migrated.assertSalePaymentBookEvidence_(invoice,allocations,cashRows,bad),/Needs Review/);
});

test('mechanical source port keeps all seven function bodies byte-identical to the pinned snapshot',()=>{
  const originalText=readFileSync(new URL('../legacy/source/SalePayments.gs',import.meta.url),'utf8');
  const portText=readFileSync(new URL('../src/modules/sale-payments.js',import.meta.url),'utf8');
  const sourceSlice=originalText.split('\n').slice(0,269).join('\n')+'\n';
  assert.ok(portText.includes(sourceSlice),'source function section must remain byte-exact');
  assert.equal(portText.includes('Utilities.computeDigest'),false,'GAS digest is not safe in Workers');
});
