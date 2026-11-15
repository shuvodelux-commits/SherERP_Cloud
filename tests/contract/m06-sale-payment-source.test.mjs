import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNativeSalePaymentOracle} from '../fixtures/m06-payment-source-oracle.mjs';

const sourceCommit = '29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const accounts = [
  {'Bank Account ID':'BANK-1','Account Type':'Bank','Account Name':'Business Bank','Status':'Active'},
  {'Bank Account ID':'MOBILE-1','Account Type':'Mobile Banking','Account Name':'Business Wallet','Status':'Active'}
];
const oracle = createNativeSalePaymentOracle();
const bank = (amount, id='bank-1', accountId='BANK-1') => ({id,method:'Bank',amount,accountId});
const cash = (amount, id='cash-1') => ({id,method:'Cash',amount});
const mobile = (amount, id='mobile-1') => ({id,method:'Mobile Banking',amount,accountId:'MOBILE-1'});

test('frozen source and pinned origin remain the payment parity authority', () => {
  const manifest=JSON.parse(readFileSync(new URL('../../docs/baseline/source-manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.source.commit,sourceCommit);
  assert.ok(manifest.files.some(x=>x.path==='SalePayments.gs' && x.blobSha==='dd08b0c1e27a799c9c16feda50239f172eb7eb4f'));
  assert.equal(oracle.origin,'legacy/source/SalePayments.gs');
});

test('cash plus bank is fully paid, with change excluded from applied money', () => {
  const result=oracle.normalize('1000.00',[cash('800.00'),bank('300.00')],accounts);
  assert.deepEqual({
    paid:result.paidAmount,due:result.dueAmount,change:result.changeAmount,
    method:result.paymentMethod,type:result.paymentType,status:result.paymentStatus
  },{paid:1000,due:0,change:100,method:'Multiple',type:'Cash',status:'Paid'});
  assert.deepEqual(result.payments.map(p=>[p.method,p.tendered,p.applied,p.change]),[
    ['Cash',800,700,100],['Bank',300,300,0]
  ]);
});

test('partial cash plus mobile keeps the due separate from tendered money', () => {
  const result=oracle.normalize('500.00',[cash('200.00'),mobile('100.00')],accounts);
  assert.deepEqual([result.paidAmount,result.dueAmount,result.changeAmount,result.paymentStatus,result.paymentMethod],
    [300,200,0,'Partial','Multiple']);
  assert.deepEqual(result.payments.map(p=>p.bankAccountId),['','MOBILE-1']);
});

test('invoice without any tender is due-only and has no payment account', () => {
  const result=oracle.normalize('250.00',[],accounts);
  assert.deepEqual([result.paidAmount,result.dueAmount,result.paymentStatus,result.paymentMethod,result.payments.length],
    [0,250,'Due','',0]);
});

test('strict paisa arithmetic accepts exact hundredths and rejects precision or overflows', () => {
  const exact=oracle.normalize('.30',[cash('.10'),bank('.20')],accounts);
  assert.deepEqual([exact.paidAmount,exact.dueAmount],[0.30,0]);
  assert.throws(()=>oracle.normalize('1.001',[],accounts),/two decimal places/i);
  assert.throws(()=>oracle.normalize('1.00',[cash('0.001')],accounts),/two decimal places/i);
  assert.throws(()=>oracle.normalize('9007199254740991',[],accounts),/out of range/i);
});

test('invalid payment rows cannot become accepted applied tenders', () => {
  const cases = [
    [ [cash('1','dup'),bank('1','dup')], /duplicate payment row ID/i ],
    [ [cash('1'),cash('2','cash-2')], /one Cash row/i ],
    [ [{id:'x',method:'Voucher',amount:'1'}], /unsupported payment method/i ],
    [ [{...cash('1'),accountId:'BANK-1'}], /must not select a bank/i ],
    [ [bank('1','b','missing')], /active payment account/i ],
    [ [bank('1','b','MOBILE-1')], /type does not match/i ],
    [ [bank('110')], /exceed invoice total/i ],
    [ Array.from({length:21},(_,i)=>({id:'b'+i,method:'Bank',amount:'0'})), /maximum 20/i ]
  ];
  for(const [rows,pattern] of cases) assert.throws(()=>oracle.normalize('100',rows,accounts),pattern);
  assert.throws(()=>oracle.normalize('0',[cash('1')],accounts),/zero-value invoice/i);
  assert.throws(()=>oracle.normalize('10',[bank('1')],[{...accounts[0],Status:'Inactive'}]),/active payment account/i);
});

test('legacy invoice payment reconstruction is read-only and leaves source rows intact', () => {
  const sale={'Invoice ID':'INV-OLD','Paid Amount':120,'Payment Method':'Bank','Bank Account ID':'BANK-1','Bank Account Name':'Business Bank'};
  const before=JSON.stringify(sale);
  const out=oracle.breakdown(sale,[]);
  assert.deepEqual(out,[{rowId:'legacy',method:'Bank',bankAccountId:'BANK-1',bankAccountName:'Business Bank',tendered:120,applied:120,change:0,legacy:true}]);
  assert.equal(JSON.stringify(sale),before);
});

test('version 1 payment children are authoritative and must reconcile with sale paid amount', () => {
  const sale={'Invoice ID':'INV-1','Payment Detail Version':'1','Paid Amount':500};
  const rows=[
    {'Invoice ID':'INV-1','Status':'Active','Payment ID':'PAY-2','Revision':1,'Row Order':2,'Method':'Bank','Bank Account ID':'BANK-1','Bank Account Name':'Business Bank','Tendered Amount':200,'Applied Amount':200,'Change Amount':0},
    {'Invoice ID':'INV-1','Status':'Active','Payment ID':'PAY-1','Revision':1,'Row Order':1,'Method':'Cash','Tendered Amount':350,'Applied Amount':300,'Change Amount':50},
    {'Invoice ID':'OTHER','Status':'Active','Payment ID':'PAY-other','Row Order':3,'Method':'Cash','Tendered Amount':1,'Applied Amount':1},
  ];
  const out=oracle.breakdown(sale,rows);
  assert.deepEqual(out.map(p=>[p.rowId,p.method,p.applied,p.change]),[['PAY-1','Cash',300,50],['PAY-2','Bank',200,0]]);
  assert.throws(()=>oracle.breakdown({...sale,'Paid Amount':501},rows),/integrity mismatch/i);
  assert.throws(()=>oracle.breakdown(sale,[...rows,{...rows[0],'Payment ID':'PAY-3',Revision:2,'Row Order':3}]),/mixed active revisions/i);
});

test('payment edits calculate per-account net changes, not gross retendered cash', () => {
  const old=[{method:'Cash',applied:700},{method:'Bank',bankAccountId:'BANK-1',applied:300}];
  const next=[{method:'Cash',applied:600},{method:'Bank',bankAccountId:'BANK-1',applied:400}];
  assert.deepEqual(oracle.accountDeltas(old,next),[
    {method:'Bank',accountId:'BANK-1',amount:100},
    {method:'Cash',accountId:'',amount:-100}
  ]);
  assert.deepEqual(oracle.accountDeltas(old,old),[]);
});

test('cash/bank evidence reconciles only applied amounts, and mismatches require review', () => {
  const payments=[{method:'Cash',applied:700,tendered:800,change:100},{method:'Bank',bankAccountId:'BANK-1',applied:300}];
  const cashRows=[{Reference:'INV-1',Type:'Sale',Credit:700,Debit:0}];
  const bankRows=[{Reference:'INV-1',Type:'Sale','Bank Account ID':'BANK-1',Credit:300,Debit:0}];
  assert.equal(oracle.assertBookEvidence('INV-1',payments,cashRows,bankRows),true);
  assert.throws(()=>oracle.assertBookEvidence('INV-1',payments,[{...cashRows[0],Credit:800}],bankRows),/Needs Review/i);
  assert.throws(()=>oracle.assertBookEvidence('INV-1',payments,cashRows,[]),/Needs Review/i);
});

test('posting journal allows only same-payload committed replay, never ambiguous repost', () => {
  assert.equal(oracle.journalDecision(null,'hash'),'new');
  assert.equal(oracle.journalDecision({'Payload Hash':'hash',State:'Committed'},'hash'),'replay');
  for (const state of ['Prepared','Writing','Needs Review']) {
    assert.equal(oracle.journalDecision({'Payload Hash':'hash',State:state},'hash'),'review');
  }
  assert.throws(()=>oracle.journalDecision({'Payload Hash':'different',State:'Committed'},'hash'),/different payment payload/i);
  assert.throws(()=>oracle.journalDecision({'Payload Hash':'hash',State:'Unknown'},'hash'),/unknown posting journal state/i);
});

test('version 1 due-only invoice may legitimately have no active payment children', () => {
  assert.deepEqual(oracle.breakdown({'Invoice ID':'INV-DUE','Paid Amount':0,'Payment Detail Version':'1'},[]),[]);
  assert.throws(()=>oracle.breakdown({'Invoice ID':'INV-BROKEN','Paid Amount':1,'Payment Detail Version':'1'},[]),/integrity mismatch/i);
});

test('cash wholly returned as change stays in tender metadata, never in cash receipts', () => {
  const result=oracle.normalize('100',[bank('100'),cash('25')],accounts);
  assert.deepEqual([result.paidAmount,result.dueAmount,result.changeAmount],[100,0,25]);
  assert.deepEqual(result.payments.map(p=>[p.method,p.tendered,p.applied,p.change]),[
    ['Bank',100,100,0],['Cash',25,0,25]
  ]);
  assert.equal(oracle.assertBookEvidence('INV-BANK',result.payments,[],[
    {Reference:'INV-BANK',Type:'Sale','Bank Account ID':'BANK-1',Credit:100,Debit:0}
  ]),true);
});
