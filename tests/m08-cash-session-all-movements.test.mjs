import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeAllSessionCash} from '../src/modules/m08-cash-session-all-movements.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const row=(id,type,{inward='',outward='',method='Cash',reference='',deleted=false,date='2026-11-20'}={})=>({
  'Entry ID':id,'Type':type,'Reference':reference,'Credit':inward,
  'Debit':outward,'Payment Method':method,'Date':date,'Is Deleted':deleted
});
const marker=(sessionId,id='open-'+sessionId,opts={})=>row(id,'Session Open',{reference:sessionId,...opts});
const report=(rows,extra={})=>summarizeAllSessionCash({
  sessionId:'CASH-001',openingCash:'100.00',countedCash:'337.50',
  cashBookRows:rows,...extra
});

test('all actual Cash In/Cash Out categories contribute exactly once, with exact paisa',()=>{
  const movements=[
    marker('CASH-001'),
    row('sale','Sale',{inward:'120.00'}),
    row('customer','Customer Receipt',{inward:'50.00'}),
    row('loan','Loan Received',{inward:'300.00'}),
    row('owner','Owner Investment',{inward:'40.00'}),
    row('borrower-return','Borrower Repayment',{inward:'20.00'}),
    row('bank-withdraw','Bank Cash Withdrawal',{inward:'50.00'}),
    row('reversal','Cash Refund Received',{inward:'15.00'}),
    row('supplier','Supplier Payment',{outward:'80.00'}),
    row('expense','Expense',{outward:'10.00'}),
    row('sales-return','Sales Return',{outward:'30.00'}),
    row('loan-return','Loan Repayment',{outward:'100.00'}),
    row('owner-withdraw','Owner Withdrawal',{outward:'25.00'}),
    row('borrower-loan','Borrower Loan',{outward:'70.00'}),
    row('bank-deposit','Bank Cash Deposit',{outward:'40.00'})
  ];
  const result=report(movements);
  assert.equal(result.sessionId,'CASH-001');
  assert.equal(result.openingPaisa,10000);
  assert.equal(result.cashInPaisa,59500);
  assert.equal(result.cashOutPaisa,35500);
  assert.equal(result.expectedPaisa,34000);
  assert.equal(result.countedPaisa,33750);
  assert.equal(result.variancePaisa,-250);
  assert.equal(result.actualCashEntries,14);
  assert.equal(result.excludedHistoricalEntries,0);
  assert.equal(result.excludedSyntheticEntries,0);
  assert.equal(result.closeReady,true);
  assert.equal(result.productionReady,false);
  assert.equal(result.authorizesPosting,false);
  assert.equal(result.authorizesRemoteD1Write,false);
  assert.equal(result.authorizesCashClose,false);
});

test('historical opening loan/lender/borrower/customer/supplier/owner never turn into real session cash',()=>{
  const rows=[marker('CASH-001'),
    row('h1','Historical Opening',{inward:'10000.00'}),
    row('h2','Opening Loan',{inward:'1000.00'}),
    row('h3','Opening Lender',{inward:'1500.00'}),
    row('h4','Opening Borrower Loan',{outward:'1200.00'}),
    row('h5','Opening Owner Capital',{inward:'1000.00'}),
    row('h6','Opening Customer Balance',{outward:'170.00'}),
    row('h7','Opening Supplier Balance',{inward:'80.00'}),
    row('h8','Opening Balance',{inward:'200.00'}),
    row('real-loan','Loan Received',{inward:'30.00'}),
    row('real-opening-settlement','Supplier Payment',{outward:'15.00'})
  ];
  const r=report(rows,{countedCash:'115.00'});
  assert.equal(r.cashInPaisa,3000);
  assert.equal(r.cashOutPaisa,1500);
  assert.equal(r.expectedPaisa,11500);
  assert.equal(r.variancePaisa,0);
  assert.equal(r.excludedHistoricalEntries,8);
  assert.equal(r.actualCashEntries,2);
});

test('first-ever physical opening float is counted only once, never as a cash receipt',()=>{
  const rows=[
    marker('CASH-001','legacy-first',{inward:'500.00'}),
    row('historical','Historical Opening',{inward:'200.00'}),
    row('cash','Sale',{inward:'0.25'})
  ];
  const r=report(rows,{openingCash:'500.00',countedCash:'500.25'});
  assert.equal(r.openingPaisa,50000);
  assert.equal(r.cashInPaisa,25);
  assert.equal(r.expectedPaisa,50025);
  assert.equal(r.excludedHistoricalEntries,1);
  assert.equal(r.variancePaisa,0);
});

test('session windows use Cash Book posting order, not backdated transaction Date',()=>{
  const rows=[
    row('before','Sale',{inward:'990.00'}),
    marker('CASH-001'),
    row('late-post','Cash Sale',{inward:'10.55',date:'2025-01-01'}),
    row('gone','Expense',{outward:'900.00',deleted:'TRUE'}),
    row('reverse-correct','Expense Refund',{inward:'5.10'}),
    row('original-expense','Expense',{outward:'5.10'}),
    row('adjust','Day Close Adjustment',{inward:'880.00'}),
    marker('CASH-002'),
    row('after','Sale',{inward:'250.00'})
  ];
  const r=report(rows,{countedCash:'110.55'});
  assert.equal(r.cashInPaisa,1565);
  assert.equal(r.cashOutPaisa,510);
  assert.equal(r.expectedPaisa,11055);
  assert.equal(r.excludedSyntheticEntries,1);
  assert.equal(r.variancePaisa,0);
  assert.equal(r.actualCashEntries,3);
});

test('bank-only and mobile-only transactions cannot be silently included or dropped as physical Cash Book movements',()=>{
  assert.throws(()=>report([marker('CASH-001'),
    row('bank','Purchase Payment',{outward:'80.00',method:'Bank'})]),
    /Cash Session cash movements unavailable/);
  assert.throws(()=>report([marker('CASH-001'),
    row('mobile','Expense',{outward:'40.00',method:'Mobile Banking'})]),
    /Cash Session cash movements unavailable/);
  const rows=[marker('CASH-001'),row('sale','Sale',{inward:'20.00'})];
  const result=report(rows,{countedCash:'120.00'});
  assert.equal(result.cashInPaisa,2000);
  assert.equal(result.variancePaisa,0);
});

test('split cash tender legs can share one invoice reference but must have distinct Cash Book IDs',()=>{
  const r=report([
    marker('CASH-001'),
    row('payment-1','Sale Payment',{inward:'10.00',reference:'INV-001'}),
    row('payment-2','Sale Payment',{inward:'5.25',reference:'INV-001'})
  ],{countedCash:'115.25'});
  assert.equal(r.cashInPaisa,1525);
  assert.equal(r.actualCashEntries,2);
});

test('duplicate actual Cash Book IDs, missing or repeated session marker fail closed',()=>{
  assert.throws(()=>report([row('a','Sale',{inward:100})]),/Cash Session cash movements unavailable/);
  assert.throws(()=>report([marker('CASH-001'),marker('CASH-001','again')]),
    /Cash Session cash movements unavailable/);
  assert.throws(()=>report([marker('CASH-001'),
    row('x','Sale',{inward:'10'}),row('x','Sale',{inward:'10'})]),
    /Cash Session cash movements unavailable/);
});

test('malformed money, zero-value real records and impossible split debit/credit are never close-ready',()=>{
  for(const pair of [
    {inward:'1.005'},{inward:'NaN'},{inward:-1},{inward:'0'},
    {inward:'3.00',outward:'4.00'}, {outward:'Infinity'},
    {inward:'99999999999999999999999.99'}
  ]){
    assert.throws(()=>report([marker('CASH-001'),row('broken','Expense',pair)]),
      /Cash Session cash movements unavailable/);
  }
  for(const countedCash of ['bad','-1','1.111'])
    assert.throws(()=>report([marker('CASH-001')],{countedCash}),
      /Cash Session cash movements unavailable/);
});

test('immutable projection, counted cash optional and no fabricated posting or closing',()=>{
  const rows=Object.freeze([
    Object.freeze(marker('CASH-001')),
    Object.freeze(row('sale','Sale',{inward:'0.10'}))
  ]);
  const r=report(rows,{countedCash:null});
  assert.equal(r.expectedPaisa,10010);
  assert.equal(r.countedPaisa,null);
  assert.equal(r.variancePaisa,null);
  assert.equal(r.closeReady,true);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(rows[0]),true);
  assert.doesNotMatch(JSON.stringify(r),/PRD-|SUP-|017\\d+|Customer Name|Owner Subject/);
});

test('source evidence pins the single real Cash Book writer and excludes opening-only money',()=>{
  const cash=readFileSync(new URL('../legacy/source/CashBook.gs',import.meta.url),'utf8');
  const session=readFileSync(new URL('../legacy/source/CashSession.gs',import.meta.url),'utf8');
  const finance=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.match(cash,/function addCashBookEntry_/);
  assert.match(cash,/Debit = cash going out, Credit = cash coming in/);
  assert.match(session,/cashSessionSummaryFromRows_/);
  assert.match(session,/Historical Opening/);
  for(const type of ['Owner Investment','Owner Withdrawal','Loan Received',
    'Loan Repayment','Borrower Loan','Borrower Repayment'])
    assert.ok(finance.includes(type),type);
  for(const type of ['Opening Owner Capital','Opening Loan','Opening Borrower Loan'])
    assert.ok(finance.includes(type),type);
});


test('all cash-source directions match frozen original CashSession.gs on real Cash Book rows',()=>{
  const legacy=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'CashBook.gs':['getCashBalance_'],
    'CashSession.gs':['getCashMismatch_','cashSessionExplanationIds_',
      'cashSessionLinkedReconciliationEntryIds_','cashSessionSummaryFromRows_']
  });
  const current={
    'Session ID':'CASH-001','Status':'Open','Opening Cash':100,
    'Opened At':'2026-11-20T10:00:00+06:00','Notes':'source parity'
  };
  const rows=[
    row('prior','Sale',{inward:300}),
    marker('CASH-001'),
    row('sale','Sale',{inward:'17.35'}),
    row('collection','Customer Payment',{inward:'250.50'}),
    row('owner','Owner Investment',{inward:'60.00'}),
    row('borrower','Borrower Repayment',{inward:'12.00'}),
    row('expense','Expense',{outward:'20.30'}),
    row('supplier','Supplier Payment',{outward:'14.15'}),
    row('loan','Loan Repayment',{outward:'75.00'}),
    row('historical','Historical Opening',{inward:'9000.00',date:'2025-03-01'})
  ];
  const source=legacy.cashSessionSummaryFromRows_(current,[current],rows);
  const actual=report(rows,{countedCash:null});
  assert.equal(actual.cashInPaisa,Math.round(source.cashIn*100));
  assert.equal(actual.cashOutPaisa,Math.round(source.cashOut*100));
  assert.equal(actual.expectedPaisa,Math.round(source.expectedCash*100));
  assert.equal(actual.excludedHistoricalEntries,1);
  assert.equal(actual.actualCashEntries,7);
});

test('same invoices may have multiple distinct cash legs, but exact amounts never drift',()=>{
  const rows=[marker('CASH-001'),
    row('leg1','Sale',{inward:'0.10',reference:'INV-001'}),
    row('leg2','Sale',{inward:'0.20',reference:'INV-001'}),
    row('reversal','Sales Return',{outward:'0.05',reference:'SRT-001'})];
  const r=report(rows,{openingCash:'0.00',countedCash:'0.25'});
  assert.equal(r.cashInPaisa,30);
  assert.equal(r.cashOutPaisa,5);
  assert.equal(r.expectedPaisa,25);
  assert.equal(r.variancePaisa,0);
});
