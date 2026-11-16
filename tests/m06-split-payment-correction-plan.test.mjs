import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSalePaymentOracle} from './fixtures/m06-payment-source-oracle.mjs';
import {planSaleSplitPaymentCorrection} from '../src/modules/sale-payment-correction-plan.js';

const oracle=createNativeSalePaymentOracle();
const json=value=>JSON.parse(JSON.stringify(value));
const bankAccounts=[
  {'Bank Account ID':'BANK-1','Account Name':'Shop Bank','Account Type':'Bank','Status':'Active'},
  {'Bank Account ID':'MOB-1','Account Name':'Shop Wallet','Account Type':'Mobile Banking','Status':'Active'}
];
const fixture=()=>({
  invoiceId:'INV-001',
  sale:{'Invoice ID':'INV-001','Is Deleted':'FALSE',
    'Payment Detail Version':'1','Grand Total':100,'Paid Amount':70,'Due Amount':30},
  paymentRows:[
    {'Invoice ID':'INV-001','Payment ID':'OLD-C','Row Order':1,'Revision':1,
      'Status':'Active','Method':'Cash','Bank Account ID':'',
      'Tendered Amount':50,'Applied Amount':40,'Change Amount':10},
    {'Invoice ID':'INV-001','Payment ID':'OLD-B','Row Order':2,'Revision':1,
      'Status':'Active','Method':'Bank','Bank Account ID':'BANK-1',
      'Tendered Amount':30,'Applied Amount':30,'Change Amount':0}
  ],
  cashBookRows:[{'Reference':'INV-001','Type':'Sale','Credit':40,'Debit':''}],
  bankBookRows:[{'Reference':'INV-001','Type':'Sale','Bank Account ID':'BANK-1',
    'Credit':30,'Debit':''}],
  bankAccounts:json(bankAccounts),
  currentSettlement:{paidAmount:70,dueAmount:30},
  newPayments:[
    {id:'NEW-M',method:'Mobile Banking',accountId:'MOB-1',amount:'25'},
    {id:'NEW-B',method:'Bank',accountId:'BANK-1',amount:'25'},
    {id:'NEW-C',method:'Cash',amount:'20'}
  ]
});
const sourceProjection=data=>{
  const previous=oracle.breakdown(json(data.sale),json(data.paymentRows));
  oracle.assertBookEvidence(data.invoiceId,previous,
    json(data.cashBookRows),json(data.bankBookRows));
  const allocation=oracle.normalize(data.sale['Grand Total'],
    json(data.newPayments),json(data.bankAccounts));
  return {previous,allocation,
    accountDeltas:oracle.accountDeltas(previous,allocation.payments)};
};

test('source-exact Cash/Bank/Mobile split correction returns only signed applied-money deltas',()=>{
  const data=fixture(),before=json(data);
  const target=planSaleSplitPaymentCorrection(data);
  const source=sourceProjection(data);
  assert.deepEqual(json(target.allocation),source.allocation);
  assert.deepEqual(json(target.accountDeltas),source.accountDeltas);
  assert.equal(target.nextRevision,2);
  assert.deepEqual(target.reversedPaymentIds,['OLD-C','OLD-B']);
  assert.deepEqual(target.accountDeltas,[
    {method:'Bank',accountId:'BANK-1',amount:-5},
    {method:'Cash',accountId:'',amount:-20},
    {method:'Mobile Banking',accountId:'MOB-1',amount:25}
  ]);
  assert.deepEqual(data,before,'No caller-owned financial snapshot is mutated');
});

test('Cash tender and change are metadata, never posted as Cash Book income',()=>{
  const data=fixture();
  data.newPayments=[
    {id:'NEW-B',method:'Bank',accountId:'BANK-1',amount:'25'},
    {id:'NEW-C',method:'Cash',amount:'100'}
  ];
  const target=planSaleSplitPaymentCorrection(data);
  assert.deepEqual(json(target.accountDeltas),sourceProjection(data).accountDeltas);
  assert.equal(target.allocation.changeAmount,25);
  assert.equal(target.allocation.paidAmount,100);
  assert.deepEqual(target.accountDeltas,[
    {method:'Bank',accountId:'BANK-1',amount:-5},
    {method:'Cash',accountId:'',amount:35}
  ]);
});

test('next source payment revision advances past historical reversed revisions',()=>{
  const data=fixture();
  data.paymentRows.push({'Invoice ID':'INV-001','Payment ID':'REV-4',
    'Row Order':1,'Revision':4,'Status':'Reversed'});
  assert.equal(planSaleSplitPaymentCorrection(data).nextRevision,5);
});

test('signed historical Cash/Bank evidence must reconcile before correction',()=>{
  for(const mutate of [
    d=>{d.cashBookRows[0]['Credit']=39.99},
    d=>{d.bankBookRows[0]['Credit']=31},
    d=>{d.bankBookRows[0]['Bank Account ID']='BANK-OTHER'}
  ]){
    const data=fixture();mutate(data);
    assert.throws(()=>planSaleSplitPaymentCorrection(data),/integrity mismatch|Needs Review/i);
  }
});

test('corrupt active payment child or unsupported stored detail version fails closed',()=>{
  for(const mutate of [
    d=>{d.paymentRows[0]['Change Amount']=11},
    d=>{d.paymentRows[1]['Revision']=2},
    d=>{d.sale['Payment Detail Version']='2'},
    d=>{d.sale['Payment Detail Version']=''}
  ]){
    const data=fixture();mutate(data);
    assert.throws(()=>planSaleSplitPaymentCorrection(data),/payment|version|split/i);
  }
});

test('later Customer settlement blocks replacing historical checkout money',()=>{
  const data=fixture();
  data.currentSettlement={paidAmount:80,dueAmount:20};
  assert.throws(()=>planSaleSplitPaymentCorrection(data),/settlement|reconcile/i);
});

test('missing trusted snapshots, deleted/mismatched invoice and invalid next revision are refused',()=>{
  const missing=fixture();delete missing.currentSettlement;
  assert.throws(()=>planSaleSplitPaymentCorrection(missing),/trusted|settlement/i);
  const missingBooks=fixture();delete missingBooks.cashBookRows;
  assert.throws(()=>planSaleSplitPaymentCorrection(missingBooks),/trusted|book/i);
  const deleted=fixture();deleted.sale['Is Deleted']='TRUE';
  assert.throws(()=>planSaleSplitPaymentCorrection(deleted),/deleted|inactive/i);
  const wrong=fixture();wrong.sale['Invoice ID']='INV-OTHER';
  assert.throws(()=>planSaleSplitPaymentCorrection(wrong),/invoice|mismatch/i);
  const unsafe=fixture();unsafe.paymentRows.push({'Invoice ID':'INV-001','Revision':Number.MAX_SAFE_INTEGER,'Status':'Reversed'});
  assert.throws(()=>planSaleSplitPaymentCorrection(unsafe),/revision|range/i);
});


test('unreconciled original checkout cannot produce a split-payment correction intent',()=>{
  const variants=[
    {field:'Due Amount',value:'30.01',settlementDue:30.01},
    {field:'Grand Total',value:'99.99',settlementDue:30}
  ];
  for(const variant of variants){
    const data=fixture();
    data.sale[variant.field]=variant.value;
    data.currentSettlement.dueAmount=variant.settlementDue;
    const before=json(data);
    assert.throws(
      ()=>planSaleSplitPaymentCorrection(data),
      /NEEDS_REVIEW: original split-payment checkout totals mismatch/,
      variant.field
    );
    assert.deepEqual(data,before,'A rejected correction must not mutate historical records');
  }
});
